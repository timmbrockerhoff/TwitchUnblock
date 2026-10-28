// Pure logic ported from the Swift app (TwitchAPI.swift, IRCParser.swift): no DOM, no fetch,
// so `npm test` runs it under plain Node.

export type Variant = { height: number; fps: number; bandwidth: number };
export type Master = { links: Record<string, string>; variants: Record<string, Variant> };

function attr(line: string, name: string): string | undefined {
  const m = line.match(new RegExp(`[,:]${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}
function plain(line: string, name: string): string | undefined {
  const m = line.match(new RegExp(`[:,]${name}=([^,"\\s]+)`));
  return m ? m[1] : undefined;
}

/** Master playlist → quality name → media playlist URL (same naming rules as parseMaster). */
export function parseMaster(content: string, baseURL?: string): Master {
  const links: Record<string, string> = {};
  const variants: Record<string, Variant> = {};
  const lines = content.split('\n');
  // Video groups named "… (source)": some proxies call the original "1080p60" instead of "chunked".
  const sourceGroups = new Set(lines.filter(l => l.startsWith('#EXT-X-MEDIA') && l.toLowerCase().includes('(source)'))
    .map(l => attr(l, 'GROUP-ID')).filter(Boolean));
  // IVS multi-encoding marks every variant "source": only a lone video one counts as Source.
  const isIVSSource = (l: string) => attr(l, 'IVS-VARIANT-SOURCE') === 'source' && l.includes('RESOLUTION=');
  const singleIVS = lines.filter(l => l.startsWith('#EXT-X-STREAM-INF') && isIVSSource(l)).length === 1;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) return;
    let q = 'unknown';
    const name = attr(line, 'VIDEO') ?? attr(line, 'STABLE-VARIANT-ID') ?? attr(line, 'IVS-NAME');
    if (name) q = name === 'chunked' || sourceGroups.has(name) || (singleIVS && isIVSSource(line)) ? 'Source' : name;
    else { const r = line.match(/RESOLUTION=(\d+x\d+)/); if (r) q = r[1]; }
    const next = (lines[i + 1] ?? '').trim();
    if (!next || next.startsWith('#')) return;
    links[q] = next.startsWith('http') || !baseURL ? next : new URL(next, baseURL).href;
    const res = plain(line, 'RESOLUTION');
    variants[q] = {
      height: res ? Number(res.split('x')[1]) || 0 : 0,
      fps: Number(plain(line, 'FRAME-RATE') ?? 0) || 0,
      bandwidth: Number(plain(line, 'BANDWIDTH') ?? 0) || 0,
    };
  });
  return { links, variants };
}

export const isSourceQuality = (k: string) => ['source', 'chunked'].includes(k.toLowerCase());
export const isAudioQuality = (k: string) => k.toLowerCase().includes('audio');
const isAuto = (k: string) => k.toLowerCase() === 'auto';
function nameHeight(k: string): number | undefined {
  const r = k.match(/\d+x(\d+)/); if (r) return Number(r[1]);
  const p = k.match(/(\d+)(?=p)/); return p ? Number(p[1]) : undefined;
}
export function qualityHeight(k: string, keys: string[], v: Record<string, Variant> = {}): number {
  if (isAudioQuality(k)) return 0;
  if (v[k]?.height) return v[k].height;
  const h = nameHeight(k); if (h) return h;
  if (!isSourceQuality(k)) return 0;
  const best = Math.max(0, ...keys.filter(x => !isSourceQuality(x)).map(x => nameHeight(x) ?? 0));
  if (!best) return 1080;
  return [360, 480, 720, 1080, 1440, 2160].find(x => x > best) ?? best;
}
function qualityFPS(k: string, v: Record<string, Variant>): number {
  if (v[k]?.fps) return v[k].fps;
  const m = k.match(/p(\d+)/); return m ? Number(m[1]) : 0;
}
/** Source first, then Auto, then highest to lowest (smoother first), audio last. */
export function sortQualities(keys: string[], v: Record<string, Variant> = {}): string[] {
  const group = (k: string) => isSourceQuality(k) ? 0 : isAuto(k) ? 1 : isAudioQuality(k) ? 3 : 2;
  return [...keys].sort((a, b) => group(a) - group(b)
    || qualityHeight(b, keys, v) - qualityHeight(a, keys, v)
    || qualityFPS(b, v) - qualityFPS(a, v) || (a < b ? -1 : a > b ? 1 : 0));
}
/** Quality to start for a preference ("source", "1080" … "160", "audio", "auto"). */
export function preferredQualityKey(keys: string[], pref: string, v: Record<string, Variant> = {}): string {
  if (pref === 'auto' && keys.some(isAuto)) return keys.find(isAuto)!;
  const h = (k: string) => qualityHeight(k, keys, v);
  const video = keys.filter(k => !isAudioQuality(k) && !isAuto(k))
    .sort((a, b) => h(b) - h(a) || qualityFPS(b, v) - qualityFPS(a, v));
  const audio = keys.find(isAudioQuality);
  const fallback = video[0] ?? audio ?? keys[0] ?? '';
  if (pref === 'audio') return audio ?? video[video.length - 1] ?? fallback;
  const want = Number(pref);
  if (want) return video.find(k => h(k) === want) ?? video.find(k => h(k) < want) ?? video[video.length - 1] ?? fallback;
  return video.find(isSourceQuality) ?? fallback;
}
export function qualityText(k: string): string {
  if (isSourceQuality(k)) return 'Source';
  if (isAuto(k)) return 'Automatisch';
  if (isAudioQuality(k)) return 'Nur Audio';
  if (k.endsWith('p30')) return k.slice(0, -2);
  if (/^\d+x\d+$/.test(k)) return `${nameHeight(k)}p`;
  return k;
}

// Input helpers (search field, shared links)
const sitePaths = new Set(['videos', 'directory', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops',
  'search', 'downloads', 'jobs', 'p', 'collections', 'moderator', 'popout', 'embed', 'login', 'signup', 'logout', 'payments']);
export function loginFromInput(input: string): string {
  let login = (input.trim().split(' ')[0] ?? '').toLowerCase();
  const m = login.match(/twitch\.tv\/([a-z0-9_]{1,25})/);
  if (!/(^|[/.])clips\.twitch\.tv\//.test(login) && m && !sitePaths.has(m[1])) login = m[1];
  return login.replace(/^@/, '');
}
export const isValidLogin = (l: string) => /^[a-z0-9_]{1,25}$/.test(l);
export function isVodInput(input: string): boolean {
  const t = input.trim();
  return t.toLowerCase().includes('/videos/') || /^\d{8,}$/.test(t);
}
export const extractVodId = (input: string) => input.match(/\d{8,}/)?.[0];
export function clipSlugFromInput(input: string): string | undefined {
  return input.trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:clips\.twitch\.tv\/|twitch\.tv\/[a-z0-9_]+\/clip\/)([A-Za-z0-9_-]{3,100})/i)?.[1];
}
/** "?t=1h2m3s" / "&t=3723s" → seconds. */
export function vodStartFromInput(input: string): number | undefined {
  const raw = input.match(/[?&]t=([^&#\s]+)/)?.[1];
  const m = raw?.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (!m) return undefined;
  const s = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return s > 0 ? s : undefined;
}

/** "12.8k" like the iOS app (no thousands separator, no million step). */
export const formatViewers = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
export function formatClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
/** "1h 23min" / "23min" (TwitchAPI.formatDuration). */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? `${h}h ${m}min` : `${m}min`;
}
/** "0:28": clips last a minute at most, formatDuration would say "0min". */
export function formatClipDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Short date of a VOD card, "21.10.26" (DateFormatter .short in German). */
export function formatShortDate(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? (iso ?? '').slice(0, 10) : new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
/** "13 T · 21. Okt." since the last live (offlineLabel): span in T/h/min, then the date, with the
 *  year when it is not the current one. Empty for an unknown or future date. */
export function formatOfflineSince(iso?: string, now = Date.now()): string {
  const end = iso ? Date.parse(iso) : NaN;
  const diff = (now - end) / 1000;
  if (Number.isNaN(end) || diff <= 0) return '';
  const days = Math.floor(diff / 86400), hours = Math.floor(diff / 3600), minutes = Math.floor(diff / 60);
  const span = days > 0 ? `${days} T` : hours > 0 ? `${hours} h` : `${minutes} min`;
  const d = new Date(end), sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${span} · ${d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}

// IRC
export type IRCMessage = { tags: Record<string, string>; prefix?: string; command: string; params: string[] };
const tagUnescape = (v: string) => v.replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', r: '\r', n: '\n', '\\': '\\' } as Record<string, string>)[c] ?? c);
export function parseIRC(raw: string): IRCMessage | undefined {
  let rest = raw;
  const tags: Record<string, string> = {};
  let prefix: string | undefined;
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' '); if (sp < 0) return undefined;
    for (const pair of rest.slice(1, sp).split(';')) {
      const eq = pair.indexOf('=');
      tags[eq < 0 ? pair : pair.slice(0, eq)] = eq < 0 ? '' : tagUnescape(pair.slice(eq + 1));
    }
    rest = rest.slice(sp + 1).trimStart();
  }
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp < 0 ? undefined : sp);
    rest = sp < 0 ? '' : rest.slice(sp + 1).trimStart();
  }
  const trail = rest.indexOf(' :');
  const head = (trail < 0 ? rest : rest.slice(0, trail)).split(' ').filter(Boolean);
  const command = head.shift();
  if (!command) return undefined;
  if (trail >= 0) head.push(rest.slice(trail + 2));
  return { tags, prefix, command, params: head };
}
/** "25:0-4,6-10/1902:12-16" → sorted [id, start, end) in UTF-16 indices. Twitch counts code points. */
export function parseEmoteRanges(raw: string, text: string): [string, number, number][] {
  if (!raw) return [];
  const cps = Array.from(text);
  const offsets: number[] = []; // code point index → UTF-16 index
  let u = 0; for (const c of cps) { offsets.push(u); u += c.length; } offsets.push(u);
  const out: [string, number, number][] = [];
  for (const part of raw.split('/')) {
    const [id, ranges] = part.split(':');
    if (!id || !ranges) continue;
    for (const r of ranges.split(',')) {
      const [s, e] = r.split('-').map(Number);
      if (Number.isInteger(s) && Number.isInteger(e) && s >= 0 && s <= e && e < cps.length) out.push([id, offsets[s], offsets[e + 1]]);
    }
  }
  return out.sort((a, b) => a[1] - b[1]);
}
/** Nick colors too dark for a dark background get mixed towards white (Color.readableChat). */
export function readableColor(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex || '#a970ff';
  let [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum < 0.45) { const f = Math.min(1, (0.45 - lum) / 0.45 + 0.15); r += (1 - r) * f; g += (1 - g) * f; b += (1 - b) * f; }
  return '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
/** An ad break is running when the latest-starting ad marker started after the latest
 *  "live" stream-source marker. Safari keeps DATERANGE cues without END-DATE active forever
 *  (endTime null), so the pre-roll's "Amazon" cue stays active next to the later "live" one. */
export function adActive(cues: { id: string; start: number; value: unknown }[]): boolean {
  let lastAd = -1, lastLive = -1;
  for (const c of cues) {
    const v = c.value as { key?: string; data?: unknown } | undefined;
    if (v?.key === 'X-TV-TWITCH-STREAM-SOURCE' && v.data === 'live') lastLive = Math.max(lastLive, c.start);
    else if (isAdCue(c.id, c.value)) lastAd = Math.max(lastAd, c.start);
  }
  return lastAd >= 0 && lastAd > lastLive;
}
/** A stitched-ad marker in a metadata cue (EXT-X-DATERANGE as exposed by Safari's native HLS). */
export function isAdCue(id: string, value: unknown): boolean {
  const s = (id + ' ' + JSON.stringify(value ?? '')).toLowerCase();
  if (s.includes('stitched-ad') || s.includes('x-tv-twitch-ad')) return true;
  const v = value as { key?: string; data?: unknown } | undefined;
  return v?.key === 'X-TV-TWITCH-STREAM-SOURCE' && typeof v.data === 'string' && v.data !== 'live';
}

/** Live sources measured 20+ minutes first, by ad breaks per hour; unchanged until two are
 *  measured (LiveAdStats.ranked). `stats`: source → [breaks, seconds watched].
 *  ponytail: old measurements never decay; clear "liveAdStats" if the proxies change a lot. */
export function rankSources<T extends string>(sources: T[], stats: Record<string, [number, number]>): T[] {
  const rated = sources.filter(s => (stats[s]?.[1] ?? 0) >= 1200).map(s => [s, stats[s][0] / (stats[s][1] / 3600)] as const);
  if (rated.length < 2) return sources;
  const first = [...rated].sort((a, b) => a[1] - b[1]).map(r => r[0]);
  return [...first, ...sources.filter(s => !first.includes(s))];
}

/** Backups for a live ad break, in `candidates` order, minus what this break already tried.
 *  A break that starts within `window` s of the last switch counts as the same one (the backup's
 *  own pre-roll, or a break 1–3 min long): its tried list carries over, so the player walks on
 *  and never flips back to where it came from. `current`: what plays now (source or player type). */
export type AdBridge = { tried: string[]; at: number };
export function adBridgePlan(prev: AdBridge | undefined, current: string, now: number, candidates: string[], window = 300): AdBridge & { next: string[] } {
  const same = prev && now - prev.at < window * 1000;
  const tried = same ? [...new Set([...prev.tried, current])] : [current];
  return { tried, at: same ? prev.at : now, next: candidates.filter(c => !tried.includes(c)) };
}

/** Smoothed distance to the live edge (LiveSyncEstimator in LiveLatency.swift): `latency` =
 *  now − segment date of the playing position, `behind` = seekable end − position. The edge's
 *  age (latency − behind) is sampled over 60 s; its 10th percentile stands in for the fixed
 *  "−6 s" guess once 6 samples are in. One odd sample (ad cue date, clock jump) is ignored. */
export class LiveSyncEstimator {
  private samples: { at: number; edge: number }[] = [];
  reset() { this.samples = []; }
  get ready() { return this.samples.length >= 6; }
  offset(latency: number | undefined, behind: number, now = Date.now()): number {
    if (!Number.isFinite(behind)) return 0;
    if (latency == null || !Number.isFinite(latency) || latency <= 0) return Math.max(0, behind);
    const edge = latency - behind;
    if (edge > -5 && edge < 120) this.samples.push({ at: now, edge });
    this.samples = this.samples.filter(s => now - s.at <= 60000);
    if (this.samples.length < 6) return Math.max(0, behind);
    const sorted = this.samples.map(s => s.edge).sort((a, b) => a - b);
    return Math.max(0, latency - sorted[Math.floor(sorted.length / 10)]);
  }
}

/** Live chat sync (MainTabView.chatDelay): seconds to hold live chat so it matches the picture,
 *  or `replay` when the picture is over 5 min behind and the recording plays (VOD chat instead).
 *  `t`: currentTime; `pdt0`: date (ms) of media time 0 from the playlist's PROGRAM-DATE-TIME
 *  (Safari's getStartDate); `edge`: seekable end; `archiveStart`: broadcast start while the
 *  recording plays (its offset 0). Other viewers run ~6 s behind real time themselves; `est`
 *  measures that instead once it has enough samples. `nudge`: the user's ±20 s trim. */
export function chatSync(p: { now: number; t: number; pdt0?: number; edge?: number; archiveStart?: number; nudge?: number; est?: LiveSyncEstimator }): { delay: number; replay: boolean } {
  const ok = (x?: number): x is number => x != null && Number.isFinite(x);
  const nudge = p.nudge ?? 0;
  if (ok(p.archiveStart)) {
    const lag = (p.now - p.archiveStart) / 1000 - p.t;
    return lag > 300 ? { delay: 0, replay: true } : { delay: Math.max(0, lag - 6 + nudge), replay: false };
  }
  const behind = ok(p.edge) ? Math.max(0, p.edge - p.t) : 0;
  const lag = ok(p.pdt0) ? (p.now - p.pdt0) / 1000 - p.t : NaN;
  const smoothed = p.est?.offset(ok(lag) ? lag : undefined, behind, p.now);
  // Less than the distance to the edge is impossible (device clock running late): use the edge.
  const delay = p.est?.ready && smoothed != null ? smoothed : ok(lag) && lag >= behind - 0.5 ? lag - 6 : behind;
  return { delay: Math.min(300, Math.max(0, delay + nudge)), replay: false };
}

// Chat rules (ChatService.swift, AppStore.swift) ------------------------------------------------
/** Twitch's refusal (NOTICE msg-id) → German line; `followersMinutes` fills "{d}". */
const REJECTIONS: Record<string, string> = {
  msg_followersonly: 'Nachricht nicht gesendet: Nur Follower des Kanals können chatten. Folge ihm, um mitzumachen.',
  msg_followersonly_zero: 'Nachricht nicht gesendet: Nur Follower des Kanals können chatten. Folge ihm, um mitzumachen.',
  msg_followersonly_followed: 'Nachricht nicht gesendet: Du musst dem Kanal seit {d} folgen, um zu chatten.',
  msg_subsonly: 'Nachricht nicht gesendet: Der Chat ist nur für Abonnenten.',
  msg_emoteonly: 'Nachricht nicht gesendet: Nur Emotes sind erlaubt.', msg_emotesonly: 'Nachricht nicht gesendet: Nur Emotes sind erlaubt.',
  msg_slowmode: 'Nachricht nicht gesendet: Langsamer Modus, warte etwas zwischen den Nachrichten.',
  msg_r9k: 'Nachricht nicht gesendet: Modus für einzigartige Nachrichten, diese wurde schon gepostet.',
  msg_duplicate: 'Nachricht nicht gesendet: identisch mit deiner vorherigen.',
  msg_verified_email: 'Nachricht nicht gesendet: Dieser Kanal verlangt ein verifiziertes Konto (E-Mail oder Telefon).',
  msg_requires_verified_phone_number: 'Nachricht nicht gesendet: Dieser Kanal verlangt ein verifiziertes Konto (E-Mail oder Telefon).',
  msg_timedout: 'Nachricht nicht gesendet: Du hast in diesem Chat einen Timeout.',
  msg_rejected: 'Nachricht von der automatischen Moderation des Kanals zurückgehalten.',
  msg_rejected_mandatory: 'Nachricht von der automatischen Moderation des Kanals zurückgehalten.',
  msg_ratelimit: 'Nachricht nicht gesendet: zu viele Nachrichten auf einmal, warte etwas.',
  msg_channel_suspended: 'Nachricht nicht gesendet: Dieser Chat ist nicht verfügbar.',
  msg_suspended: 'Nachricht nicht gesendet: Dieser Chat ist nicht verfügbar.',
};
export function rejectionText(msgId: string, text: string, followersMinutes = 0): string | undefined {
  const t = REJECTIONS[msgId] ?? (msgId.startsWith('msg_') ? 'Nachricht nicht gesendet: {t}' : undefined);
  return t?.replace('{d}', followersMinutes > 0 ? followerDuration(followersMinutes) : '').replace('{t}', text);
}
/** "Follower seit …" (ChatRoomModes.duration, abbreviated, two units at most). */
export function followerDuration(minutes: number): string {
  const d = Math.floor(minutes / 1440), h = Math.floor(minutes % 1440 / 60), m = minutes % 60;
  const parts = minutes >= 1440 ? [d && `${d} ${d === 1 ? 'Tag' : 'Tage'}`, h && `${h} Std.`]
    : minutes >= 60 ? [h && `${h} Std.`, m && `${m} Min.`] : [`${minutes} Min.`];
  return parts.filter(Boolean).join(' ');
}

export const KNOWN_BOTS = new Set(['nightbot', 'streamelements', 'moobot', 'fossabot', 'streamlabs', 'wizebot', 'soundalerts', 'sery_bot',
  'botisimo', 'own3d', 'kofistreambot', 'pokemoncommunitygame', 'deepbot', 'coebot', 'phantombot', 'creatisbot', 'blerp']);
export type ChatFilters = { me?: string; blockedUsers: string[]; mutedWords: string[]; hideBots: boolean; hideCommands: boolean; highlightWords: string[] };
/** AppStore.isChatFiltered: own lines never hidden; blocked, bots, "!commands", muted words. */
export function chatHidden(login: string, text: string, f: ChatFilters): boolean {
  const l = login.toLowerCase();
  if (!l || l === f.me?.toLowerCase()) return false;
  if (f.blockedUsers.includes(l)) return true;
  if (f.hideBots && KNOWN_BOTS.has(l)) return true;
  if (f.hideCommands && text.startsWith('!')) return true;
  const low = text.toLowerCase();
  return f.mutedWords.some(w => w && low.includes(w.toLowerCase()));
}
/** ChatMessage.mentions: "@me" / bare "me" / a highlight word as a whole word (not own lines). */
export function chatMentions(login: string, text: string, me: string | undefined, words: string[]): { mention: boolean; highlighted: boolean } {
  const m = (me ?? '').toLowerCase();
  if (m && login.toLowerCase() === m) return { mention: false, highlighted: false };
  let mention = false, highlighted = false;
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const w = raw.replace(/^[@.,!?:;]+|[@.,!?:;]+$/g, '');
    if (m && w === m) mention = true;
    else if (words.includes(w)) highlighted = true;
  }
  return { mention, highlighted };
}

/** Recent-messages replay (ChatService.loadRecentMessages): moderation lines in the list apply
 *  to the lines before them (`rm-deleted`, CLEARCHAT on a login, CLEARMSG on an id); the result
 *  is chronological by `tmi-sent-ts`. */
export function replayHistory(lines: IRCMessage[]): { irc: IRCMessage; deleted: boolean }[] {
  const out: { irc: IRCMessage; deleted: boolean }[] = [];
  for (const irc of lines) {
    if (irc.command === 'PRIVMSG' || irc.command === 'USERNOTICE') out.push({ irc, deleted: irc.tags['rm-deleted'] === '1' });
    else if (irc.command === 'CLEARCHAT') {
      const who = (irc.params[1] ?? '').toLowerCase();
      for (const o of out) if (!who || (o.irc.prefix?.split('!')[0] ?? o.irc.tags.login) === who) o.deleted = true;
    } else if (irc.command === 'CLEARMSG') {
      const id = irc.tags['target-msg-id'];
      for (const o of out) if (id && o.irc.tags.id === id) o.deleted = true;
    }
  }
  return out.sort((a, b) => Number(a.irc.tags['tmi-sent-ts'] ?? 0) - Number(b.irc.tags['tmi-sent-ts'] ?? 0));
}

/** Dedupe by id and cap (ChatService: 200 lines, 600 while the reader scrolled up). Returns the
 *  new list and the lines that were really new. */
export function mergeMessages<T extends { id: string }>(list: T[], batch: T[], paused = false): { list: T[]; fresh: T[] } {
  const ids = new Set(list.map(m => m.id));
  const fresh = batch.filter(m => !ids.has(m.id) && (ids.add(m.id), true));
  const cap = paused ? 600 : 200;
  const all = fresh.length ? [...list, ...fresh] : list;
  return { list: all.length > cap ? all.slice(-cap) : all, fresh };
}

// Hype train (LiveEventsService.swift): what Twitch's GQL says, then the transitions between
// two reads (kickoff after an approach, departed, level done, ended) as timed flashes.
export type HypeFlash = { k: 'kickoff' } | { k: 'departed' } | { k: 'levelDone'; n: number } | { k: 'ended'; level: number; percent: number };
export type LiveHype = {
  id: string; phase: 'approaching' | 'running'; variant: 'regular' | 'golden' | 'treasure';
  level: number; percent: number; left: number; bigGoal: boolean; endsAt?: number;
  flash?: HypeFlash; flashUntil?: number; pendingLevelDone?: number;
};
const variantOf = (d: any): LiveHype['variant'] => d?.isGoldenKappaTrain ? 'golden' : d?.isTreasureTrain ? 'treasure' : 'regular';
/** `ht` = user.channel.hypeTrain. The running train if its deadline is ahead, else the approach. */
export function readHype(ht: any, now: number): LiveHype | undefined {
  const ex = ht?.execution;
  if (ex && ex.endedAt == null) {
    const pr = ex.progress, goal = pr?.goal ?? 0, level = pr?.level?.value ?? 1;
    // `total`/`level.goal` run over all levels: only `progression` (or the difference) is this level's.
    let done = pr?.progression;
    if (done == null && pr?.total != null && pr?.level?.goal != null) done = pr.total - (pr.level.goal - goal);
    const ends = typeof pr?.remainingSeconds === 'number' ? now + pr.remainingSeconds * 1000 : ex.expiresAt ? Date.parse(ex.expiresAt) : undefined;
    if (ends == null || ends > now) return { id: ex.id ?? '', phase: 'running', variant: variantOf(ex), level,
      percent: goal > 0 ? Math.min(1, Math.max(0, (done ?? 0) / goal)) : 0, left: 1, bigGoal: false, endsAt: ends };
  }
  const ap = ht?.approaching;
  if (ap) {
    const goal = ap.goal ?? 0, big = goal > 5, steps: any[] = ap.eventsRemaining ?? [], joined = (ap.participants ?? []).length;
    const counts = steps.map(s => s.events).filter((n: number) => n > 0);
    const fewest = counts.length ? Math.min(...counts) : undefined;
    const step = steps.find(s => s.events === (big ? 2 : 1)) ?? steps.find(s => s.events === fewest);
    const ends = typeof step?.secondsRemaining === 'number' ? now + step.secondsRemaining * 1000 : ap.expiresAt ? Date.parse(ap.expiresAt) : undefined;
    if (ends == null || ends > now) return { id: ap.id ?? '', phase: 'approaching', variant: variantOf(ap), level: 1, percent: 0,
      left: fewest ?? Math.max(1, goal - joined), bigGoal: big, endsAt: ends };
  }
  return undefined;
}
/** Next shown state from the previous one and a fresh read (`undefined` = no train). */
export function applyHype(prev: LiveHype | undefined, read: LiveHype | undefined, now: number): LiveHype | undefined {
  if (!read) {
    if (!prev || prev.flash?.k === 'ended') return prev;
    // Gone at its deadline after level 1: COMPLETED. Otherwise Twitch shows nothing.
    if (prev.phase === 'running' && prev.level >= 2 && prev.endsAt != null && now >= prev.endsAt - 3000)
      return { ...prev, endsAt: undefined, flash: { k: 'ended', level: prev.level, percent: Math.floor(prev.percent * 100) }, flashUntil: now + 15000 };
    return undefined;
  }
  const next = { ...read };
  if (next.phase === 'running') {
    if (prev?.phase === 'running' && prev.id === next.id) {
      const up = next.level > prev.level;
      if (prev.flash?.k === 'ended') {
        if (up) { next.flash = { k: 'levelDone', n: prev.level }; next.flashUntil = now + 4000; }
      } else if (prev.flash && (prev.flashUntil ?? 0) > now) {
        if (up && prev.flash.k === 'levelDone') { next.flash = { k: 'levelDone', n: prev.level }; next.flashUntil = now + 4000; }
        else {
          // Kickoff/departed still showing: the finished level waits for it.
          next.flash = prev.flash; next.flashUntil = prev.flashUntil;
          next.pendingLevelDone = up ? prev.level : prev.pendingLevelDone;
          if (prev.flash.k === 'kickoff') next.bigGoal = prev.bigGoal;
        }
      } else {
        const n = up ? prev.level : prev.pendingLevelDone;
        if (n != null) { next.flash = { k: 'levelDone', n }; next.flashUntil = now + 4000; }
      }
    } else {
      const fromApproach = prev?.phase === 'approaching';
      next.flash = { k: fromApproach ? 'kickoff' : 'departed' };
      next.flashUntil = now + (fromApproach ? 1500 : 10000);
      if (fromApproach && prev) next.bigGoal = prev.bigGoal;
    }
  }
  return next;
}
/** The current flash ran out: kickoff → departed (10 s), departed → pending level, ended → gone. */
export function endHypeFlash(h: LiveHype, now: number): LiveHype | undefined {
  const f = h.flash; if (!f) return h;
  if (f.k === 'kickoff') return { ...h, flash: { k: 'departed' }, flashUntil: now + 10000 };
  if (f.k === 'ended') return undefined;
  if (f.k === 'departed' && h.pendingLevelDone != null) return { ...h, flash: { k: 'levelDone', n: h.pendingLevelDone }, flashUntil: now + 4000, pendingLevelDone: undefined };
  return { ...h, flash: undefined, flashUntil: undefined };
}
