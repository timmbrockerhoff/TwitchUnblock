// Chat: IRC over WebSocket, Twitch/BTTV/FFZ/7TV emotes, badges, recent history, auto-translation,
// VOD chat replay. Ported from Sources/Chat (ChatService, EmoteService, BadgeService, ChatTranslation, VodChatService).
import { parseIRC, parseEmoteRanges, readableColor, type IRCMessage } from './logic';
import { gql, gqlPersisted, recentMessages } from './twitch';
import { state } from './store';

export type Part = { t: 'text'; v: string } | { t: 'emote'; v: string; url: string } | { t: 'link'; v: string } | { t: 'mention'; v: string };
export type ChatMsg = {
  id: string; login: string; name: string; color: string; badges: { url: string; title: string }[];
  parts: Part[]; text: string; ts: number; system?: string; action?: boolean; mention?: boolean; deleted?: boolean;
  history?: boolean; translation?: string; offset?: number;
};

// Emotes ---------------------------------------------------------------------------------------
const globalEmotes = new Map<string, string>();
const channelEmotes = new Map<string, Map<string, string>>();
let globalsLoaded: Promise<void> | undefined;
const json = (u: string) => fetch(u, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : undefined).catch(() => undefined);
const stv = (e: any) => { const h = e.data?.host; return h ? `https:${h.url}/2x.webp` : undefined; };
const ffzURL = (e: any) => { const u = e.urls?.['2'] ?? e.urls?.['1']; return u ? (u.startsWith('//') ? 'https:' + u : u) : undefined; };

export function loadGlobalEmotes() {
  globalsLoaded ??= Promise.all([
    json('https://api.betterttv.net/3/cached/emotes/global').then(l => l?.forEach((e: any) => globalEmotes.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`))),
    json('https://api.frankerfacez.com/v1/set/global').then(j => j && j.default_sets?.forEach((s: number) => j.sets[s]?.emoticons.forEach((e: any) => { const u = ffzURL(e); if (u) globalEmotes.set(e.name, u); }))),
    json('https://7tv.io/v3/emote-sets/global').then(j => j?.emotes?.forEach((e: any) => { const u = stv(e); if (u) globalEmotes.set(e.name, u); })),
    loadGlobalBadges(),
  ]).then(() => {});
  return globalsLoaded;
}
export async function loadChannelEmotes(channelId: string, login: string) {
  if (channelEmotes.has(channelId)) return;
  const map = new Map<string, string>();
  channelEmotes.set(channelId, map);
  await Promise.all([
    json(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`).then(j => [...(j?.channelEmotes ?? []), ...(j?.sharedEmotes ?? [])]
      .forEach((e: any) => map.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`))),
    json(`https://api.frankerfacez.com/v1/room/${login}`).then(j => j && Object.values<any>(j.sets ?? {}).forEach(s => s.emoticons.forEach((e: any) => { const u = ffzURL(e); if (u) map.set(e.name, u); }))),
    json(`https://7tv.io/v3/users/twitch/${channelId}`).then(j => j?.emote_set?.emotes?.forEach((e: any) => { const u = stv(e); if (u) map.set(e.name, u); })),
    loadChannelBadges(channelId),
  ]);
}
/** Emote list for the picker: channel first, then global third-party. */
export function emoteList(channelId?: string): { name: string; url: string }[] {
  const ch = channelId ? [...(channelEmotes.get(channelId) ?? [])] : [];
  return [...ch, ...globalEmotes].map(([name, url]) => ({ name, url }));
}

// Badges (public GQL, no account needed) ---------------------------------------------------------
const globalBadges = new Map<string, { url: string; title: string }>();
const channelBadges = new Map<string, Map<string, { url: string; title: string }>>();
async function loadGlobalBadges() {
  const d = await gql('query { badges { setID version title imageURL(size: DOUBLE) } }');
  d?.badges?.forEach((b: any) => globalBadges.set(`${b.setID}/${b.version}`, { url: b.imageURL, title: b.title }));
}
async function loadChannelBadges(id: string) {
  const d = await gql('query($id: ID!) { user(id: $id) { broadcastBadges { setID version title imageURL(size: DOUBLE) } } }', { id });
  const m = new Map<string, { url: string; title: string }>();
  d?.user?.broadcastBadges?.forEach((b: any) => m.set(`${b.setID}/${b.version}`, { url: b.imageURL, title: b.title }));
  channelBadges.set(id, m);
}
function badgesFor(raw: string[], channelId?: string) {
  return raw.map(b => (channelId && channelBadges.get(channelId)?.get(b)) || globalBadges.get(b)).filter(Boolean) as { url: string; title: string }[];
}

// Message building ----------------------------------------------------------------------------
const linkRe = /^(https?:\/\/|www\.)\S+\.\S+/i;
function words(text: string, channelId: string | undefined, out: Part[]) {
  const ch = channelId ? channelEmotes.get(channelId) : undefined;
  for (const w of text.split(/(\s+)/)) {
    if (!w) continue;
    const url = ch?.get(w) ?? globalEmotes.get(w);
    if (url) out.push({ t: 'emote', v: w, url });
    else if (linkRe.test(w)) out.push({ t: 'link', v: w });
    else if (/^@\w+/.test(w)) out.push({ t: 'mention', v: w });
    else {
      const last = out[out.length - 1];
      if (last?.t === 'text') last.v += w; else out.push({ t: 'text', v: w });
    }
  }
}
export function buildParts(text: string, twitchEmotes: string, channelId?: string): Part[] {
  const out: Part[] = [];
  let pos = 0;
  for (const [id, s, e] of parseEmoteRanges(twitchEmotes, text)) {
    if (s < pos) continue;
    words(text.slice(pos, s), channelId, out);
    out.push({ t: 'emote', v: text.slice(s, e), url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0` });
    pos = e;
  }
  words(text.slice(pos), channelId, out);
  return out;
}
const BOTS = new Set(['nightbot', 'streamelements', 'moobot', 'fossabot', 'streamlabs', 'wizebot', 'soundalerts', 'sery_bot', 'botrixoficial', 'kofistreambot', 'commanderroot']);
export const isBotLine = (m: ChatMsg) => BOTS.has(m.login) || m.text.startsWith('!');

function fromIRC(m: IRCMessage, channelId: string | undefined, me?: string): ChatMsg | undefined {
  const t = m.tags;
  let text = m.params[1] ?? '';
  let action = false;
  const act = text.match(/^\u0001ACTION (.*)\u0001$/);
  if (act) { text = act[1]; action = true; }
  const login = m.prefix?.split('!')[0] ?? t.login ?? '';
  const msg: ChatMsg = {
    id: t.id || `${Date.now()}-${Math.random()}`, login, name: t['display-name'] || login,
    color: readableColor(t.color || nickColor(login)), badges: badgesFor((t.badges || '').split(',').filter(Boolean), channelId),
    parts: buildParts(text, t.emotes || '', channelId), text, ts: Number(t['tmi-sent-ts']) || Date.now(), action,
    history: t['historical'] === '1' || t['rm-received-ts'] != null,
  };
  if (me && text.toLowerCase().includes('@' + me.toLowerCase())) msg.mention = true;
  if (m.command === 'USERNOTICE') {
    msg.system = t['system-msg'] || t['msg-id'];
    if (!text) msg.parts = [];
  }
  return msg;
}
const palette = ['#FF0000', '#0000FF', '#00FF00', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
function nickColor(login: string) { let h = 0; for (const c of login) h = (h * 31 + c.charCodeAt(0)) | 0; return palette[Math.abs(h) % palette.length]; }

// Live chat over IRC -----------------------------------------------------------------------------
export type RoomState = { slow?: number; followers?: number; subs?: boolean; emoteOnly?: boolean; r9k?: boolean };
export class ChatClient {
  private ws?: WebSocket;
  private queue: ChatMsg[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private retry = 0;
  private userState: Record<string, string> = {};
  room: RoomState = {};
  connected = false;
  constructor(private login: string, private channelId: string | undefined,
              private onBatch: (msgs: ChatMsg[]) => void,
              private onEvent: (e: { type: 'clear'; login?: string; id?: string } | { type: 'notice'; text: string } | { type: 'state' }) => void) {
    this.connect(true);
  }
  private connect(withHistory: boolean) {
    if (this.closed) return;
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    this.ws = ws;
    const acc = state.account;
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      if (acc) { ws.send(`PASS oauth:${acc.token}`); ws.send(`NICK ${acc.login}`); }
      else { ws.send('PASS SCHMOOPIIE'); ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`); }
      ws.send(`JOIN #${this.login}`);
      this.retry = 0; this.connected = true; this.onEvent({ type: 'state' });
    };
    ws.onmessage = e => String(e.data).split('\r\n').forEach(l => l && this.handle(l));
    ws.onclose = () => {
      this.connected = false; this.onEvent({ type: 'state' });
      if (!this.closed) setTimeout(() => this.connect(false), Math.min(30000, 1000 * 2 ** this.retry++));
    };
    if (withHistory) recentMessages(this.login).then(lines => {
      const msgs = lines.map(parseIRC).filter(m => m?.command === 'PRIVMSG' || m?.command === 'USERNOTICE')
        .map(m => fromIRC(m!, this.channelId)).filter(Boolean) as ChatMsg[];
      msgs.forEach(m => m.history = true);
      if (msgs.length) this.onBatch(msgs);
    });
  }
  private handle(line: string) {
    const m = parseIRC(line); if (!m) return;
    switch (m.command) {
      case 'PING': this.ws?.send(`PONG :${m.params[0] ?? 'tmi.twitch.tv'}`); break;
      case 'RECONNECT': this.ws?.close(); break;
      case 'PRIVMSG': case 'USERNOTICE': {
        const msg = fromIRC(m, this.channelId, state.account?.login);
        if (msg) this.push(msg);
        break;
      }
      case 'CLEARCHAT': this.onEvent({ type: 'clear', login: m.params[1] }); break;
      case 'CLEARMSG': this.onEvent({ type: 'clear', id: m.tags['target-msg-id'] }); break;
      case 'NOTICE': this.onEvent({ type: 'notice', text: m.params[1] ?? '' }); break;
      case 'USERSTATE': this.userState = m.tags; break;
      case 'ROOMSTATE': {
        const t = m.tags, r = this.room;
        if ('slow' in t) r.slow = Number(t.slow) || 0;
        if ('followers-only' in t) r.followers = Number(t['followers-only']);
        if ('subs-only' in t) r.subs = t['subs-only'] === '1';
        if ('emote-only' in t) r.emoteOnly = t['emote-only'] === '1';
        if ('r9k' in t) r.r9k = t.r9k === '1';
        this.onEvent({ type: 'state' });
        break;
      }
    }
  }
  private push(msg: ChatMsg) {
    this.queue.push(msg);
    // Batched like the Swift ChatService (~200 ms): one render for a burst of messages.
    this.flushTimer ??= setTimeout(() => { this.flushTimer = undefined; const q = this.queue; this.queue = []; this.onBatch(q); }, 200);
  }
  get canSend() { return !!state.account && this.connected; }
  send(text: string) {
    const acc = state.account; if (!acc || !this.ws || !this.connected) return false;
    this.ws.send(`PRIVMSG #${this.login} :${text.replace(/[\r\n]/g, ' ')}`);
    // Twitch doesn't echo our own message: show it locally with our USERSTATE (color, badges).
    const t = this.userState;
    this.push({ id: `me-${Date.now()}`, login: acc.login, name: t['display-name'] || acc.name, color: readableColor(t.color || nickColor(acc.login)),
      badges: badgesFor((t.badges || '').split(',').filter(Boolean), this.channelId), parts: buildParts(text, '', this.channelId), text, ts: Date.now() });
    return true;
  }
  close() { this.closed = true; clearTimeout(this.flushTimer); this.ws?.close(); }
}

// Auto-translation ------------------------------------------------------------------------------
// Google's free web endpoint (the Swift app's fallback when Apple's on-device model isn't there;
// browsers have no on-device translation API on iOS). Detection: Google's own (`sl=auto`).
const tCache = new Map<string, string | null>();
const tQueue: { text: string; done: (s: string | null) => void }[] = [];
let tRunning = 0;
function letters(s: string) { return (s.match(/\p{L}/gu) ?? []).length; }
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\s]/gu, '').replace(/(\p{L})\1+/gu, '$1').trim();
function sameWords(a: string, b: string) {
  const x = squash(a), y = squash(b);
  if (x === y) return true;
  const wb = new Set(y.split(/\s+/)), wa = x.split(/\s+/);
  return wa.filter(w => wb.has(w)).length / wa.length >= 0.8;
}
export function wantsTranslation(m: ChatMsg) {
  const text = m.parts.filter(p => p.t === 'text').map(p => p.v).join(' ');
  // Two words at least: single words ("dancer", emote names we don't know) were mostly noise.
  return !m.system && !m.text.startsWith('!') && letters(text) >= 4 && text.trim().split(/\s+/).filter(w => letters(w) > 0).length >= 2;
}
export function translate(text: string): Promise<string | null> {
  if (tCache.has(text)) return Promise.resolve(tCache.get(text)!);
  return new Promise(done => {
    tQueue.push({ text, done });
    while (tQueue.length > 30) tQueue.shift()!.done(null); // fast chats: drop the oldest
    pump();
  });
}
function pump() {
  while (tRunning < 3 && tQueue.length) {
    const job = tQueue.shift()!;
    tRunning++;
    fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=de&dt=t&q=' + encodeURIComponent(job.text), { signal: AbortSignal.timeout(8000) })
      .then(r => r.json()).then(j => {
        const lang = j?.[2] as string | undefined;
        const confidence = Number(j?.[6] ?? 0);
        const out = (j?.[0] ?? []).map((s: any) => s?.[0] ?? '').join('').trim();
        // Same thresholds as the Swift detector (≥ 0.5), and no "translation" that only changes
        // case or laughter ("hahaha" → "Haha", "pow pow" → "Pow Pow").
        const res = !lang || lang === 'de' || confidence < 0.5 || !out || sameWords(out, job.text) ? null : out;
        tCache.set(job.text, res); job.done(res);
      }).catch(() => job.done(null)).finally(() => { tRunning--; pump(); });
  }
}

// VOD chat replay ---------------------------------------------------------------------------------
const COMMENTS_HASH = 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a';
export class VodChat {
  private buffer: ChatMsg[] = [];
  private seen = new Set<string>();
  private fetchedUntil = -1;
  private fetching = false;
  private last = 0;
  private gen = 0;
  constructor(private videoId: string, private channelId?: string) {}
  /** Messages due up to `t` (seconds into the VOD). A jump (> 15 s) restarts from there. */
  async tick(t: number): Promise<{ msgs: ChatMsg[]; reset: boolean }> {
    let reset = false;
    if (Math.abs(t - this.last) > 15) { this.gen++; this.buffer = []; this.seen.clear(); this.fetchedUntil = t - 1; reset = true; }
    this.last = t;
    if (!this.fetching && this.fetchedUntil < t + 20) this.load(Math.max(0, Math.floor(this.fetchedUntil + 1)));
    const due = this.buffer.filter(m => m.offset! <= t);
    this.buffer = this.buffer.filter(m => m.offset! > t);
    return { msgs: due, reset };
  }
  private async load(offset: number) {
    this.fetching = true;
    const gen = this.gen;
    const res = await gqlPersisted('VideoCommentsByOffsetOrCursor', { videoID: this.videoId, contentOffsetSeconds: offset }, COMMENTS_HASH);
    this.fetching = false;
    if (gen !== this.gen) return;
    const edges = res?.data?.video?.comments?.edges;
    if (!edges) { this.fetchedUntil = offset + 30; return; } // no chat / failure: move on, retry later parts
    let newest = this.fetchedUntil;
    for (const e of edges) {
      const n = e.node; if (!n || this.seen.has(n.id)) continue;
      this.seen.add(n.id);
      newest = Math.max(newest, n.contentOffsetSeconds);
      const text = (n.message?.fragments ?? []).map((f: any) => f.text).join('');
      const parts: Part[] = [];
      for (const f of n.message?.fragments ?? []) {
        if (f.emote?.emoteID) parts.push({ t: 'emote', v: f.text, url: `https://static-cdn.jtvnw.net/emoticons/v2/${f.emote.emoteID}/default/dark/2.0` });
        else words(f.text, this.channelId, parts);
      }
      const login = n.commenter?.login ?? '';
      this.buffer.push({ id: n.id, login, name: n.commenter?.displayName ?? login, color: readableColor(n.message?.userColor || nickColor(login)),
        badges: badgesFor((n.message?.userBadges ?? []).filter((b: any) => b.setID).map((b: any) => `${b.setID}/${b.version}`), this.channelId),
        parts, text, ts: 0, offset: n.contentOffsetSeconds });
    }
    this.buffer.sort((a, b) => a.offset! - b.offset!);
    this.fetchedUntil = newest > this.fetchedUntil ? newest : offset + 5;
  }
}
