// Chat: IRC over WebSocket, Twitch/BTTV/FFZ/7TV emotes, badges, recent history, auto-translation,
// VOD chat replay. Ported from Sources/Chat (ChatService, EmoteService, BTTVLive, BadgeService,
// ChatTranslation, VodChatService).
import { parseIRC, parseEmoteRanges, readableColor, rejectionText, chatHidden, chatMentions, replayHistory, chatSync, LiveSyncEstimator,
  KNOWN_BOTS, mergeMessages, type IRCMessage } from './logic';
export { mergeMessages };
import { gql, gqlPersisted } from './twitch';
import { state } from './store';
import { addLog } from './log';

export type Part = { t: 'text'; v: string } | { t: 'emote'; v: string; url: string; zeroWidth?: boolean } | { t: 'link'; v: string } | { t: 'mention'; v: string };
export type ChatMsg = {
  id: string; login: string; name: string; color: string; badges: { url: string; title: string }[];
  parts: Part[]; text: string; ts: number; system?: string; action?: boolean; mention?: boolean; deleted?: boolean;
  history?: boolean; translation?: string; offset?: number;
  /** Twitch user id (personal BTTV emotes are per author). */
  userId?: string;
  /** Highlight word hit or Twitch's "highlighted-message" redemption. */
  highlighted?: boolean;
  /** First message in this channel (`first-msg`). */
  firstMsg?: boolean;
  /** Reply quote (`reply-parent-*`): who and what. */
  reply?: { login: string; text: string };
  /** USERNOTICE `msg-id` (sub, resub, raid, announcement …); `accent` = announcement colour. */
  noticeKind?: string; accent?: string;
  /** USERNOTICE raid: the raiding channel's login (tap → open it). */
  raider?: string;
};

// Emotes (EmoteService.swift) -------------------------------------------------------------------
type Emote = { id: string; url: string; zeroWidth?: boolean };
type EmoteMap = Map<string, Emote>;
const globalBTTV: EmoteMap = new Map(), globalFFZ: EmoteMap = new Map(), global7TV: EmoteMap = new Map();
const channelBTTV = new Map<string, EmoteMap>(), channelFFZ = new Map<string, EmoteMap>(), channel7TV = new Map<string, EmoteMap>();
/** BTTV Pro personal emotes by Twitch user id (announced by BTTV's socket when they open a chat). */
const personalBTTV = new Map<string, EmoteMap>();
/** Channel id → its 7TV emote set id (the live socket subscribes to that set). */
const stvSets = new Map<string, Promise<string | undefined>>();
const channelLoaded = new Map<string, Promise<void>>();
let globalsLoaded: Promise<void> | undefined;
const json = (u: string) => fetch(u, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : undefined).catch(() => undefined);
const bttv = (e: any): Emote | undefined => e?.id && e.code ? { id: String(e.id), url: `https://cdn.betterttv.net/emote/${e.id}/2x` } : undefined;
// FFZ keeps animated emotes in `animated` (WebP); `urls` only has a still frame.
const ffz = (e: any): Emote | undefined => {
  const u = e.animated?.['2'] ?? e.urls?.['2'] ?? e.urls?.['1'];
  return u && e.name ? { id: String(e.id), url: u.startsWith('//') ? 'https:' + u : u } : undefined;
};
// 7TV: `flags & 1` = zero-width in this set (drawn over the previous emote).
const stv = (e: any): Emote | undefined => {
  const h = e?.data?.host?.url;
  return h && e.name ? { id: String(e.id), url: `https:${h}/2x.webp`, zeroWidth: ((e.flags ?? 0) & 1) !== 0 } : undefined;
};
const fill = (map: EmoteMap, list: any[] | undefined, make: (e: any) => Emote | undefined) =>
  list?.forEach(e => { const m = make(e); if (m) map.set(e.code ?? e.name, m); });

export function loadGlobalEmotes() {
  globalsLoaded ??= Promise.all([
    json('https://api.betterttv.net/3/cached/emotes/global').then(l => fill(globalBTTV, l, bttv)),
    json('https://api.frankerfacez.com/v1/set/global').then(j => j?.default_sets?.forEach((s: number) => fill(globalFFZ, j.sets[s]?.emoticons, ffz))),
    json('https://7tv.io/v3/emote-sets/global').then(j => fill(global7TV, j?.emotes, stv)),
    loadGlobalBadges(),
  ]).then(() => {});
  return globalsLoaded;
}
export function loadChannelEmotes(channelId: string, login: string) {
  let p = channelLoaded.get(channelId);
  if (p) return p;
  const b: EmoteMap = new Map(), f: EmoteMap = new Map(), s: EmoteMap = new Map();
  channelBTTV.set(channelId, b); channelFFZ.set(channelId, f); channel7TV.set(channelId, s);
  let stvSet!: (id?: string) => void;
  stvSets.set(channelId, new Promise(r => stvSet = r));
  p = Promise.all([
    json(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`).then(j => fill(b, [...(j?.channelEmotes ?? []), ...(j?.sharedEmotes ?? [])], bttv)),
    json(`https://api.frankerfacez.com/v1/room/${login}`).then(j => j && Object.values<any>(j.sets ?? {}).forEach(set => fill(f, set.emoticons, ffz))),
    json(`https://7tv.io/v3/users/twitch/${channelId}`).then(j => { stvSet(j?.emote_set_id); fill(s, j?.emote_set?.emotes, stv); }),
    loadChannelBadges(channelId),
  ]).then(() => {});
  channelLoaded.set(channelId, p);
  return p;
}
/** EmoteService.resolve: channel BTTV → FFZ → 7TV, the author's BTTV Pro emotes, then global. */
function resolveEmote(name: string, channelId?: string, userId?: string): Emote | undefined {
  if (channelId) {
    const e = channelBTTV.get(channelId)?.get(name) ?? channelFFZ.get(channelId)?.get(name) ?? channel7TV.get(channelId)?.get(name);
    if (e) return e;
  }
  return (userId && personalBTTV.get(userId)?.get(name)) || globalBTTV.get(name) || globalFFZ.get(name) || global7TV.get(name);
}
const dropEmote = (m: EmoteMap | undefined, id: string) => { m?.forEach((e, k) => { if (e.id === id) m.delete(k); }); };

// BTTV live socket (BTTVLive.swift): ONE connection for every open chat (multi-live included).
// Personal Pro emotes (`lookup_user`) and channel emotes added/renamed/removed during the live.
const bttvLive = { ws: undefined as WebSocket | undefined, channels: new Map<string, number>(), retry: 2, timer: undefined as ReturnType<typeof setTimeout> | undefined };
const bttvSend = (name: string, data: unknown) => { if (bttvLive.ws?.readyState === WebSocket.OPEN) bttvLive.ws.send(JSON.stringify({ name, data })); };
function bttvConnect() {
  const ws = new WebSocket('wss://sockets.betterttv.net/ws');
  bttvLive.ws = ws;
  ws.onopen = () => { bttvLive.retry = 2; for (const id of bttvLive.channels.keys()) bttvSend('join_channel', { name: `twitch:${id}` }); };
  ws.onmessage = e => {
    let m: any; try { m = JSON.parse(String(e.data)); } catch { return; }
    const d = m?.data, channelId = String(d?.channel ?? '').split(':').pop() ?? '';
    if (m.name === 'lookup_user' && d?.pro && d.providerId && d.emotes?.length) {
      const map: EmoteMap = new Map();
      fill(map, d.emotes, bttv);
      personalBTTV.set(String(d.providerId), map);
      if (personalBTTV.size > 500) personalBTTV.delete(personalBTTV.keys().next().value!);
    } else if ((m.name === 'emote_create' || m.name === 'emote_update') && d?.emote && channelId) {
      const map = channelBTTV.get(channelId), e = bttv(d.emote);
      if (map && e) { dropEmote(map, e.id); map.set(d.emote.code, e); }   // rename: the old code goes away
    } else if (m.name === 'emote_delete' && d?.emoteId && channelId) dropEmote(channelBTTV.get(channelId), String(d.emoteId));
  };
  ws.onclose = () => {
    if (bttvLive.ws !== ws) return;
    bttvLive.ws = undefined;
    if (!bttvLive.channels.size) return;
    bttvLive.timer = setTimeout(bttvConnect, bttvLive.retry * 1000);
    bttvLive.retry = Math.min(60, bttvLive.retry * 2);
  };
}
function bttvJoin(channelId: string) {
  bttvLive.channels.set(channelId, (bttvLive.channels.get(channelId) ?? 0) + 1);
  if (!bttvLive.ws) bttvConnect();
  else if (bttvLive.channels.get(channelId) === 1) bttvSend('join_channel', { name: `twitch:${channelId}` });
}
function bttvLeave(channelId: string) {
  const n = bttvLive.channels.get(channelId) ?? 0;
  if (n > 1) { bttvLive.channels.set(channelId, n - 1); return; }
  bttvLive.channels.delete(channelId);
  bttvSend('part_channel', { name: `twitch:${channelId}` });
  if (!bttvLive.channels.size) { clearTimeout(bttvLive.timer); const ws = bttvLive.ws; bttvLive.ws = undefined; ws?.close(); }
}

/** One WebSocket kept open with the IRC backoff (2 → 60 s); returns a stop function. */
function keepOpen(url: string, onOpen: (ws: WebSocket) => void, onMsg: (m: any, ws: WebSocket) => void) {
  let ws: WebSocket | undefined, retry = 2, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const open = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    const w = ws;
    w.onopen = () => { retry = 2; onOpen(w); };
    w.onmessage = e => { try { onMsg(JSON.parse(String(e.data)), w); } catch { /* not JSON */ } };
    w.onclose = () => { if (!stopped) { timer = setTimeout(open, retry * 1000); retry = Math.min(60, retry * 2); } };
  };
  open();
  return () => { stopped = true; clearTimeout(timer); ws?.close(); };
}
export function liveEmotes(channelId: string, login: string): () => void {
  bttvJoin(channelId);
  let stop7tv: (() => void) | undefined, stopped = false;
  loadChannelEmotes(channelId, login).then(() => stvSets.get(channelId)).then(set => {
    if (!set || stopped) return;
    const map = () => channel7TV.get(channelId);
    // 7TV EventAPI v3: op 35 = subscribe, op 0 = dispatch, op 4 = reconnect.
    stop7tv = keepOpen('wss://events.7tv.io/v3',
      ws => ws.send(JSON.stringify({ op: 35, d: { type: 'emote_set.update', condition: { object_id: set } } })),
      (m, ws) => {
        if (m.op === 4) ws.close();   // server asks us to move to another instance
        else if (m.op === 0 && m.d?.type === 'emote_set.update' && m.d.body?.id === set) {
          const b = m.d.body;
          for (const c of [...(b.pulled ?? []), ...(b.updated ?? [])]) if (c.key === 'emotes' && c.old_value?.id) dropEmote(map(), String(c.old_value.id));
          for (const c of [...(b.pushed ?? []), ...(b.updated ?? [])]) if (c.key === 'emotes' && c.value?.id && c.value.name)
            map()?.set(c.value.name, stv(c.value) ?? { id: String(c.value.id), url: `https://cdn.7tv.app/emote/${c.value.id}/2x.webp` });
        }
      });
  });
  return () => { stopped = true; bttvLeave(channelId); stop7tv?.(); };
}

/** Emote list for the picker: channel first, then global third-party. */
export function emoteList(channelId?: string): { name: string; url: string; zeroWidth?: boolean }[] {
  const maps = channelId ? [channelBTTV.get(channelId), channelFFZ.get(channelId), channel7TV.get(channelId)] : [];
  const out: { name: string; url: string; zeroWidth?: boolean }[] = [], seen = new Set<string>();
  for (const m of [...maps, globalBTTV, globalFFZ, global7TV]) m?.forEach((e, name) => { if (!seen.has(name)) { seen.add(name); out.push({ name, url: e.url, zeroWidth: e.zeroWidth }); } });
  return out;
}

// Badges (public GQL, no account needed; static CDN when a badge is unknown) ---------------------
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
  return raw.map(b => {
    const known = (channelId && channelBadges.get(channelId)?.get(b)) || globalBadges.get(b);
    if (known) return known;
    const [set, v] = b.split('/');
    return set && v ? { url: `https://static-cdn.jtvnw.net/badges/v1/${set}/${v}/2`, title: set.replace(/[-_]/g, ' ') } : undefined;
  }).filter(Boolean) as { url: string; title: string }[];
}

// Message building ----------------------------------------------------------------------------
const linkRe = /^(https?:\/\/|www\.)\S+\.\S+/i;
function words(text: string, channelId: string | undefined, userId: string | undefined, out: Part[]) {
  for (const w of text.split(/(\s+)/)) {
    if (!w) continue;
    const e = resolveEmote(w, channelId, userId);
    if (e) out.push({ t: 'emote', v: w, url: e.url, zeroWidth: e.zeroWidth });
    else if (linkRe.test(w)) out.push({ t: 'link', v: w });
    else if (/^@\w+/.test(w)) out.push({ t: 'mention', v: w });
    else {
      const last = out[out.length - 1];
      if (last?.t === 'text') last.v += w; else out.push({ t: 'text', v: w });
    }
  }
}
export function buildParts(text: string, twitchEmotes: string, channelId?: string, userId?: string): Part[] {
  const out: Part[] = [];
  let pos = 0;
  for (const [id, s, e] of parseEmoteRanges(twitchEmotes, text)) {
    if (s < pos) continue;
    words(text.slice(pos, s), channelId, userId, out);
    out.push({ t: 'emote', v: text.slice(s, e), url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0` });
    pos = e;
  }
  words(text.slice(pos), channelId, userId, out);
  return out;
}
/** A known chat bot wrote it (AppStore.knownBots, 17 names). "!commands" are `chatHideCommands`. */
export const isBotLine = (m: ChatMsg) => KNOWN_BOTS.has(m.login);
/** Hidden by the user's filters (blocked, bots, !commands, muted words) — decided at render time
 *  so a changed setting applies to the lines already shown (ChatService.reclassify). */
export function isFiltered(m: ChatMsg): boolean {
  if (m.system) return false;
  const s = state.settings;
  return chatHidden(m.login, m.text, { me: state.account?.login, blockedUsers: s.chatBlockedUsers, mutedWords: s.chatMutedWords,
    hideBots: s.chatHideBots, hideCommands: s.chatHideCommands, highlightWords: s.chatHighlightWords });
}
const ANNOUNCEMENT = { PRIMARY: '#9146ff', BLUE: '#387aff', GREEN: '#00c853', ORANGE: '#ff9a00', PURPLE: '#bf94ff' } as Record<string, string>;

function fromIRC(m: IRCMessage, channelId: string | undefined, me?: string): ChatMsg | undefined {
  const t = m.tags;
  let text = m.params[1] ?? '';
  let action = false;
  const act = text.match(/^\u0001ACTION (.*)\u0001$/);
  if (act) { text = act[1]; action = true; }
  const login = t.login || m.prefix?.split('!')[0] || '';
  const userId = t['user-id'] || undefined;
  const msg: ChatMsg = {
    id: t.id || `${Date.now()}-${Math.random()}`, login, name: t['display-name'] || login, userId,
    color: readableColor(t.color || nickColor(login)), badges: badgesFor((t.badges || '').split(',').filter(Boolean), channelId),
    parts: buildParts(text, t.emotes || '', channelId, userId), text, ts: Number(t['tmi-sent-ts']) || Date.now(), action,
    history: t['historical'] === '1' || t['rm-received-ts'] != null,
  };
  if (m.command === 'USERNOTICE') {
    const kind = t['msg-id'] || '';
    const sys = kind === 'announcement' ? '' : t['system-msg'] || '';
    if (!sys && !text) return undefined;
    msg.noticeKind = kind || undefined;
    msg.system = sys || undefined;
    msg.highlighted = kind !== 'raid';
    if (kind === 'announcement') msg.accent = ANNOUNCEMENT[t['msg-param-color'] ?? ''] ?? ANNOUNCEMENT.PRIMARY;
    const raider = (t['msg-param-login'] ?? '').toLowerCase();
    if (kind === 'raid' && /^[a-z0-9_]+$/.test(raider)) msg.raider = raider;
    if (!text) msg.parts = [];
    return msg;
  }
  const hit = chatMentions(login, text, me, state.settings.chatHighlightWords);
  if (hit.mention) msg.mention = true;
  if (hit.highlighted || t['msg-id'] === 'highlighted-message') msg.highlighted = true;
  if (t['first-msg'] === '1') msg.firstMsg = true;
  const replyLogin = t['reply-parent-display-name'] || t['reply-parent-user-login'];
  if (replyLogin && t['reply-parent-msg-body'] != null) msg.reply = { login: replyLogin, text: t['reply-parent-msg-body'] };
  return msg;
}
const palette = ['#FF0000', '#0000FF', '#00FF00', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
function nickColor(login: string) { let h = 0; for (const c of login) h = (h * 31 + c.charCodeAt(0)) | 0; return palette[Math.abs(h) % palette.length]; }

// Live chat over IRC -----------------------------------------------------------------------------
export type RoomState = { slow?: number; followers?: number; subs?: boolean; emoteOnly?: boolean; r9k?: boolean;
  /** GQL chatSettings: the channel's rules and "verified account required". */
  rules?: string[]; verifiedOnly?: boolean };
type ClearEvent = { type: 'clear'; login?: string; id?: string };
const CONNECT_TIMEOUT = 10000, PING_EVERY = 240000;
let sysSeq = 0;
export class ChatClient {
  private ws?: WebSocket;
  /** Live messages and moderation clears in arrival order, held `delay` seconds (clears too,
   *  so they still find the message they target). */
  private held: { at: number; msg?: ChatMsg; clear?: ClearEvent }[] = [];
  /** Seconds to hold live messages so they match the picture (set by the player; 0 = at once). */
  delay = 0;
  /** Smooths the live edge's age for `applySync`. */
  readonly est = new LiveSyncEstimator();
  /** Shown lines, deduped by id and capped (200 / 600 while `paused`). */
  messages: ChatMsg[] = [];
  private paused = false;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private retryDelay = 2;
  private failures = 0;
  /** Connected without the account: the IRC refused the token, or the socket never answered. */
  private anonymous = false;
  /** Twitch refuses the account in this room (`msg_banned` at JOIN): read it without the account. */
  readOnly = false;
  private stopEmotes?: () => void;
  private userState: Record<string, string> = {};
  room: RoomState = {};
  /** Logins present in the room (ChatService.presentUsers): NAMES list, JOIN/PART and anyone who
   *  wrote. `presenceSupported` once Twitch sent (or ended) the list. */
  present = new Set<string>();
  presenceSupported = false;
  connected = false;
  private onVisible = () => { if (document.visibilityState === 'visible') this.checkConnection(); };
  constructor(private login: string, private channelId: string | undefined,
              private onBatch: (msgs: ChatMsg[]) => void,
              private onEvent: (e: ClearEvent | { type: 'notice'; text: string } | { type: 'state' }) => void) {
    this.connect();
    if (state.settings.chatLoadRecent) this.loadHistory();
    this.loadChatSettings();
    if (channelId) this.stopEmotes = liveEmotes(channelId, login);
    document.addEventListener('visibilitychange', this.onVisible);
  }
  /** Reader scrolled up: keep 600 lines instead of 200 so nothing slides away under them. */
  setPaused(p: boolean) { this.paused = p; if (!p) this.push([]); }
  private get asAccount() { return !!state.account && !this.anonymous && !this.readOnly; }
  private connect() {
    if (this.closed) return;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    this.ws = ws;
    const acc = this.asAccount ? state.account : null;
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership');
      if (acc) { ws.send(`PASS oauth:${acc.token}`); ws.send(`NICK ${acc.login}`); }
      else { ws.send('PASS SCHMOOPIIE'); ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`); }
      ws.send(`JOIN #${this.login}`);
    };
    // No welcome within 10 s (dead socket after the background, filtered network): with the
    // account, try again anonymously; without, count a failure and back off.
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.ws !== ws || this.connected) return;
      addLog('Chat', `#${this.login}: keine Antwort in 10 s${acc ? ', anonymer Versuch' : ''}`, false);
      if (acc) this.anonymous = true;
      ws.onclose = null; ws.close();
      this.scheduleReconnect('Timeout');
    }, CONNECT_TIMEOUT);
    ws.onmessage = e => String(e.data).split('\r\n').forEach(l => l && this.handle(l));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (!this.closed) addLog('Chat', `#${this.login}: Verbindung getrennt, neuer Versuch`, false);
      this.dropConnection();
      if (!this.closed) this.scheduleReconnect('getrennt');
    };
  }
  private dropConnection() {
    this.connected = false;
    clearTimeout(this.connectTimer); clearInterval(this.pingTimer); this.pingTimer = undefined;
    this.onEvent({ type: 'state' });
  }
  /** Backoff 2 → 30 s; from 8 s on the account is dropped (a refused token would loop for ever);
   *  the third failure in a row gets a line in the chat (VPN, filtered network). */
  private scheduleReconnect(reason: string) {
    if (this.closed) return;
    this.failures++;
    if (this.failures === 3) this.system('Der Chat antwortet nicht. Prüf deine Verbindung (VPN, gefiltertes Netzwerk) oder lade den Chat neu.');
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 30);
    if (delay >= 8 && !this.readOnly) this.anonymous = true;
    addLog('Chat', `#${this.login}: Fehler ${this.failures} (${reason}), neuer Versuch in ${delay} s`, false);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay * 1000);
  }
  /** Back in the foreground: a socket iOS froze reports nothing; reconnect, or ping to find out. */
  private checkConnection() {
    if (this.closed) return;
    if (this.ws?.readyState === WebSocket.OPEN && this.connected) { this.ws.send('PING :tmi.twitch.tv'); return; }
    if (this.reconnectTimer || this.ws?.readyState === WebSocket.CONNECTING) { this.retryDelay = 2; clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    const ws = this.ws; this.ws = undefined; ws?.close();
    this.connect();
  }
  /** Replace the connection now (token refused, banned): same channel, without the account. */
  private reconnectAnonymously() {
    this.anonymous = true;
    const ws = this.ws; this.ws = undefined; ws?.close();
    this.dropConnection();
    this.connect();
  }
  private handle(line: string) {
    const m = parseIRC(line); if (!m) return;
    switch (m.command) {
      case '001': case '366': case 'ROOMSTATE':
        if (!this.connected) {
          this.connected = true; this.retryDelay = 2; this.failures = 0;
          clearTimeout(this.connectTimer);
          clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => this.ws?.send('PING :tmi.twitch.tv'), PING_EVERY);
          this.onEvent({ type: 'state' });
        }
        if (m.command === '366') this.presenceSupported = true;
        if (m.command === 'ROOMSTATE') this.roomState(m.tags);
        break;
      case 'PING': this.ws?.send(`PONG :${m.params[0] ?? 'tmi.twitch.tv'}`); break;
      case 'RECONNECT': this.ws?.close(); break;
      case 'PRIVMSG': case 'USERNOTICE': {
        const msg = fromIRC(m, this.channelId, state.account?.login);
        if (msg) { if (msg.login) this.present.add(msg.login); this.hold({ msg }); }
        break;
      }
      case '353': (m.params[m.params.length - 1] ?? '').split(' ').forEach(n => n && this.present.add(n.toLowerCase())); this.presenceSupported = true; break;
      case 'JOIN': { const who = m.prefix?.split('!')[0]; if (who) this.present.add(who); break; }
      case 'PART': { const who = m.prefix?.split('!')[0]; if (who) this.present.delete(who); break; }
      case 'CLEARCHAT': this.hold({ clear: { type: 'clear', login: m.params[1] } }); break;
      case 'CLEARMSG': this.hold({ clear: { type: 'clear', id: m.tags['target-msg-id'] } }); break;
      case 'NOTICE': this.notice(m.tags['msg-id'] ?? '', m.params[1] ?? ''); break;
      case 'USERSTATE': this.userState = m.tags; break;
    }
  }
  private roomState(t: Record<string, string>) {
    const r = this.room;
    if ('slow' in t) r.slow = Number(t.slow) || 0;
    if ('followers-only' in t) r.followers = Number(t['followers-only']);
    if ('subs-only' in t) r.subs = t['subs-only'] === '1';
    if ('emote-only' in t) r.emoteOnly = t['emote-only'] === '1';
    if ('r9k' in t) r.r9k = t.r9k === '1';
    this.onEvent({ type: 'state' });
  }
  /** Rules and modes from public GQL (ChatService.loadChatSettings): what ROOMSTATE doesn't say. */
  private async loadChatSettings() {
    const d = await gql('query($l: String!) { user(login: $l) { chatSettings { rules followersOnlyDurationMinutes isSubscribersOnlyModeEnabled isEmoteOnlyModeEnabled slowModeDurationSeconds requireVerifiedAccount isUniqueChatModeEnabled } } }', { l: this.login });
    const cs = d?.user?.chatSettings; if (!cs || this.closed) return;
    const r = this.room;
    r.rules = (cs.rules ?? []).map((x: string) => x.trim()).filter(Boolean);
    r.followers = cs.followersOnlyDurationMinutes ?? -1;
    r.subs = !!cs.isSubscribersOnlyModeEnabled; r.emoteOnly = !!cs.isEmoteOnlyModeEnabled;
    r.slow = cs.slowModeDurationSeconds ?? 0; r.r9k = !!cs.isUniqueChatModeEnabled; r.verifiedOnly = !!cs.requireVerifiedAccount;
    this.onEvent({ type: 'state' });
  }
  // NOTICE (ChatService.handleNotice): refused token → anonymous; banned → read-only without the
  // account; a refused message → German reason and the local echo taken back.
  private notice(msgId: string, text: string) {
    if (msgId === 'login_authentication_failed' || text.toLowerCase().includes('login authentication failed')) {
      addLog('Chat', 'IRC-Anmeldung abgelehnt, weiter ohne Konto', false);
      this.reconnectAnonymously();
      this.system('Im Nur-Lesen-Modus neu verbunden. Melde dich in den Einstellungen neu an.');
      return;
    }
    if (msgId === 'msg_banned') {
      if (!this.asAccount) return;
      this.removeRecentEcho();
      this.readOnly = true;
      this.system('Twitch lässt dein Konto nicht in diesen Chat (gebannt): Er läuft ohne dein Konto im Nur-Lesen-Modus weiter.');
      this.reconnectAnonymously();
      return;
    }
    const rej = rejectionText(msgId, text, Math.max(0, this.room.followers ?? 0));
    if (rej) { this.removeRecentEcho(); this.system(rej); return; }
    if (msgId === 'no_permission' || msgId === 'unrecognized_cmd') { this.system(text); return; }
    this.onEvent({ type: 'notice', text });
  }
  /** Our own line shown ahead of Twitch's answer, taken back when it was refused (< 20 s old). */
  private removeRecentEcho() {
    let i = this.messages.length - 1;
    while (i >= 0 && !(this.messages[i].id.startsWith('me-') && Date.now() - this.messages[i].ts < 20000)) i--;
    if (i < 0) return;
    this.messages = this.messages.filter((_, k) => k !== i);
    this.onEvent({ type: 'state' });
  }
  /** A grey line from the app itself, shown at once (never delayed). */
  private system(text: string) {
    this.push([{ id: `sys-${++sysSeq}`, login: '', name: '', color: '', badges: [], parts: [], text, ts: Date.now(), system: text }]);
  }
  private async loadHistory() {
    let lines: string[] = [];
    try {
      const r = await fetch(`https://recent-messages.robotty.de/api/v2/recent-messages/${this.login}?limit=60`, { signal: AbortSignal.timeout(8000) });
      lines = (await r.json()).messages ?? [];
    } catch { addLog('Chat', `#${this.login}: Chat-Verlauf nicht erreichbar`, false); return; }
    if (this.closed) return;
    const msgs: ChatMsg[] = [];
    for (const h of replayHistory(lines.map(parseIRC).filter(Boolean) as IRCMessage[])) {
      const m = fromIRC(h.irc, this.channelId, state.account?.login); if (!m) continue;
      m.history = true;
      if (h.deleted) m.deleted = true;
      msgs.push(m);
    }
    if (msgs.length) this.push(msgs, true);
  }
  /** Into `messages` (deduped, capped) and out to the panel. History is merged by time. */
  private push(batch: ChatMsg[], sortByTime = false) {
    const r = mergeMessages(this.messages, batch, this.paused);
    this.messages = sortByTime && r.fresh.length ? [...r.list].sort((a, b) => a.ts - b.ts) : r.list;
    if (r.fresh.length || !batch.length) this.onBatch(r.fresh);
  }
  private hold(item: { msg?: ChatMsg; clear?: ClearEvent }) {
    this.held.push({ at: Date.now(), ...item });
    // ponytail: oldest dropped past 2000 (a 5-min delay on a huge chat); the list keeps 600 at most.
    if (this.held.length > 2000) this.held.shift();
    this.schedule();
  }
  // Batched like the Swift ChatService (~200 ms): one render for a burst of messages.
  private schedule() { this.flushTimer ??= setTimeout(() => this.flush(), 200); }
  private flush() {
    this.flushTimer = undefined;
    const due = Date.now() - this.delay * 1000;
    let batch: ChatMsg[] = [];
    while (this.held.length && this.held[0].at <= due) {
      const h = this.held.shift()!;
      if (h.msg) batch.push(h.msg);
      else {
        if (batch.length) this.push(batch); batch = [];
        const c = h.clear!;
        this.messages.forEach(m => { if ((c.id && m.id === c.id) || (c.login && m.login === c.login) || (!c.id && !c.login)) m.deleted = true; });
        this.onEvent(c);
      }
    }
    if (batch.length) this.push(batch);
    if (this.held.length) this.schedule();
  }
  /** Sets `delay` from the player's clock (chatSync + estimator + the user's nudge). */
  applySync(p: { now: number; t: number; pdt0?: number; edge?: number; archiveStart?: number }) {
    const r = chatSync({ ...p, nudge: state.settings.chatSyncNudge, est: this.est });
    this.delay = r.delay;
    return r;
  }
  get canSend() { return !!state.account && this.connected && !this.readOnly && !this.anonymous; }
  send(text: string) {
    const acc = state.account; if (!acc || !this.ws || !this.canSend) return false;
    this.ws.send(`PRIVMSG #${this.login} :${text.replace(/[\r\n]/g, ' ')}`);
    // Twitch doesn't echo our own message: show it locally with our USERSTATE (color, badges).
    // Shown at once, never delayed (ChatService.sendMessage).
    const t = this.userState;
    this.push([{ id: `me-${Date.now()}`, login: acc.login, name: t['display-name'] || acc.name, color: readableColor(t.color || nickColor(acc.login)), userId: acc.userId,
      badges: badgesFor((t.badges || '').split(',').filter(Boolean), this.channelId), parts: buildParts(text, '', this.channelId, acc.userId), text, ts: Date.now() }]);
    return true;
  }
  close() {
    this.closed = true;
    clearTimeout(this.flushTimer); clearTimeout(this.connectTimer); clearTimeout(this.reconnectTimer); clearInterval(this.pingTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    const ws = this.ws; this.ws = undefined; ws?.close();
    this.stopEmotes?.();
  }
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
// Google answers 429 (without a CORS header, so fetch just fails) once a busy chat sends too
// much (measured in xQc's chat): on a failure pause 30 s, doubling up to 10 min; and at most
// 2 requests per second, 2 in parallel.
let tPausedUntil = 0, tBackoff = 30000, tLastStart = 0;
function pump() {
  const now = Date.now();
  if (now < tPausedUntil) { while (tQueue.length) tQueue.shift()!.done(null); return; }
  if (tRunning >= 2 || !tQueue.length) return;
  if (now - tLastStart < 500) { setTimeout(pump, 500 - (now - tLastStart)); return; }
  tLastStart = now;
  const job = tQueue.shift()!;
  tRunning++;
  fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=de&dt=t&q=' + encodeURIComponent(job.text), { signal: AbortSignal.timeout(8000) })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(j => {
      tBackoff = 30000;
      const lang = j?.[2] as string | undefined;
      const confidence = Number(j?.[6] ?? 0);
      const out = (j?.[0] ?? []).map((s: any) => s?.[0] ?? '').join('').trim();
      // Same thresholds as the Swift detector (≥ 0.5), and no "translation" that only changes
      // case or laughter ("hahaha" → "Haha", "pow pow" → "Pow Pow").
      const res = !lang || lang === 'de' || confidence < 0.5 || !out || sameWords(out, job.text) ? null : out;
      // 500 entries like ChatTranslation.swift: a long session no longer keeps every line for ever.
      if (tCache.size >= 500) tCache.delete(tCache.keys().next().value!);
      tCache.set(job.text, res); job.done(res);
    }).catch(() => {
      job.done(null);
      tPausedUntil = Date.now() + tBackoff; tBackoff = Math.min(tBackoff * 2, 600000);
    }).finally(() => { tRunning--; pump(); });
  pump();
}

// VOD chat replay (VodChatService.swift) -----------------------------------------------------------
const COMMENTS_HASH = 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a';
const commentsQuery = (videoId: string, offset: number) => `query { video(id: "${videoId.replace(/[^0-9]/g, '')}") { comments(contentOffsetSeconds: ${Math.floor(offset)}) {
  edges { node { id contentOffsetSeconds commenter { id login displayName } message { userColor userBadges { setID version } fragments { text emote { emoteID } } } } }
  pageInfo { hasNextPage } } } }`;
const LOOKAHEAD = 30, MAX_BUFFER = 1500;
export class VodChat {
  private buffer: ChatMsg[] = [];
  /** Comment id → offset; trimmed past 20 000 (long VODs) to the last 10 minutes. */
  private seen = new Map<string, number>();
  private fetchedUntil = -1;
  private hasNext = true;
  private fetching = false;
  private last = -1;
  private gen = 0;
  private retryAt = 0;
  private failures = 0;
  /** Last failure, for the panel ("Chat der Aufzeichnung nicht verfügbar"). */
  error?: string;
  constructor(private videoId: string, private channelId?: string) {}
  /** Messages due up to `t` (seconds into the VOD). Back by 2 s or ahead by 30 s restarts there. */
  async tick(t: number): Promise<{ msgs: ChatMsg[]; reset: boolean }> {
    if (!Number.isFinite(t) || t < 0) return { msgs: [], reset: false };
    let reset = false;
    if (this.last < 0 || t < this.last - 2 || t > this.last + 30) {
      this.gen++; this.buffer = []; this.seen.clear(); this.fetchedUntil = -1; this.hasNext = true;
      this.retryAt = 0; this.failures = 0; this.error = undefined; reset = true;
    }
    this.last = t;
    if (this.hasNext && !this.fetching && this.fetchedUntil < t + LOOKAHEAD && Date.now() >= this.retryAt)
      this.load(Math.max(0, Math.floor(this.fetchedUntil < 0 ? t : this.fetchedUntil)));
    const due = this.buffer.filter(m => m.offset! <= t);
    this.buffer = this.buffer.filter(m => m.offset! > t);
    return { msgs: due, reset };
  }
  private async load(offset: number) {
    this.fetching = true;
    const gen = this.gen;
    // What twitch.tv sends; if Twitch rotates the hash, the same query in plain GraphQL.
    let res = await gqlPersisted('VideoCommentsByOffsetOrCursor', { videoID: this.videoId, contentOffsetSeconds: offset }, COMMENTS_HASH);
    if (!res || res.errors?.some((e: any) => String(e.message).includes('PersistedQueryNotFound'))) {
      const d = await gql(commentsQuery(this.videoId, offset));
      res = d ? { data: d } : undefined;
    }
    if (gen !== this.gen) return;
    this.fetching = false;
    if (!res || res.errors?.length) { this.failed(res?.errors?.map((e: any) => e.message).join(' · ') || 'network'); return; }
    const comments = res.data?.video?.comments;
    if (!comments?.edges) { this.hasNext = false; return; }   // no chat for this VOD: like the site, nothing to retry
    this.failures = 0; this.retryAt = 0; this.error = undefined;
    let fresh = 0, newest = this.fetchedUntil;
    for (const e of comments.edges) {
      const n = e.node; if (!n || this.seen.has(n.id)) continue;
      const at = Number(n.contentOffsetSeconds) || 0;
      this.seen.set(n.id, at); fresh++;
      newest = Math.max(newest, at);
      const text = (n.message?.fragments ?? []).map((f: any) => f.text).join('');
      const login = n.commenter?.login ?? '', userId = n.commenter?.id ? String(n.commenter.id) : undefined;
      const parts: Part[] = [];
      for (const f of n.message?.fragments ?? []) {
        if (f.emote?.emoteID) parts.push({ t: 'emote', v: f.text, url: `https://static-cdn.jtvnw.net/emoticons/v2/${f.emote.emoteID}/default/dark/2.0` });
        else words(f.text, this.channelId, userId, parts);
      }
      this.buffer.push({ id: n.id, login, name: n.commenter?.displayName ?? login, userId, color: readableColor(n.message?.userColor || nickColor(login)),
        badges: badgesFor((n.message?.userBadges ?? []).filter((b: any) => b.setID).map((b: any) => `${b.setID}/${b.version}`), this.channelId),
        parts, text, ts: 0, offset: at });
    }
    this.buffer.sort((a, b) => a.offset! - b.offset!);
    // A page with nothing new would loop on the same position: step on a few seconds.
    this.fetchedUntil = fresh > 0 ? newest : Math.max(this.fetchedUntil, offset) + 5;
    this.hasNext = !!comments.pageInfo?.hasNextPage || fresh > 0;
    if (this.seen.size > 20000) for (const [id, at] of this.seen) if (at < this.fetchedUntil - 600) this.seen.delete(id);
    // ponytail: a chat far denser than 1500 lines per 30 s drops its furthest-ahead lines.
    if (this.buffer.length > MAX_BUFFER) { this.buffer.length = MAX_BUFFER; this.fetchedUntil = this.buffer[MAX_BUFFER - 1].offset!; }
  }
  /** One failed page: next try after 3 s, 6, 12 … up to 30 s instead of a dead chat. */
  private failed(msg: string) {
    this.fetching = false;
    this.error = msg;
    this.failures++;
    this.retryAt = Date.now() + Math.min(30, 3 * 2 ** Math.min(this.failures - 1, 4)) * 1000;
  }
}

// Bot commands (BotCommands.swift). Moobot is left out: its API only allows https://moo.bot.
export type BotCommandSet = { bot: string; commands: { name: string; response: string }[] };
const bang = (n: string) => n.startsWith('!') ? n : '!' + n;
export async function botCommands(channel: string): Promise<BotCommandSet[]> {
  const ch = encodeURIComponent(channel.toLowerCase());
  const nightbot = async () => {
    const c = await json(`https://api.nightbot.tv/1/channels/t/${ch}`); const id = c?.channel?._id; if (!id) return;
    const r = await fetch('https://api.nightbot.tv/1/commands', { headers: { 'Nightbot-Channel': id } }).then(x => x.ok ? x.json() : undefined).catch(() => undefined);
    return { bot: 'Nightbot', commands: (r?.commands ?? []).map((d: any) => ({ name: d.name, response: d.message ?? '' })) };
  };
  const se = async () => {
    const c = await json(`https://api.streamelements.com/kappa/v2/channels/${ch}`); if (!c?._id) return;
    const l = await json(`https://api.streamelements.com/kappa/v2/bot/commands/${c._id}/public`);
    return { bot: 'StreamElements', commands: (l ?? []).filter((d: any) => d.enabled !== false && d.hidden !== true).map((d: any) => ({ name: bang(d.command), response: d.reply ?? '' })) };
  };
  const fossa = async () => {
    const c = await json(`https://api.fossabot.com/v2/cached/channels/by-slug/${ch}`); const id = c?.channel?.id; if (!id) return;
    const r = await json(`https://api.fossabot.com/v2/cached/channels/${id}/commands`);
    return { bot: 'Fossabot', commands: (r?.commands ?? []).filter((d: any) => d.enabled_online !== false).map((d: any) => ({ name: bang(d.name), response: d.response ?? '' })) };
  };
  const sets = await Promise.all([nightbot(), se(), fossa()].map(p => p.catch(() => undefined)));
  return sets.filter((x): x is BotCommandSet => !!x && x.commands.length > 0)
    .map(x => ({ ...x, commands: [...x.commands].sort((a, b) => a.name.localeCompare(b.name, 'de')) }));
}
