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

export const formatViewers = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} Mio.`
  : n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n);
export function formatClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
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
