// Twitch data access, ported from Sources/Services/TwitchAPI.swift (public GQL, Helix, live sources).
// Not ported on purpose (project rule): the sub-only VOD / CDN rebuild / muted-audio code
// (workerVariants … getM3U8, VodRecoveryService, VodUnmute). VODs here use Twitch's normal token only.
import { parseMaster, type Master } from './logic';

export const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
/** Twitch's Android client id: only for page 2+ of lists, where the web id needs an integrity token. */
const GQL_NEXT_CLIENT_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp';
/** The app's own public client (the same as the iOS app); device code flow needs no secret. */
export const HELIX_CLIENT_ID = '1e68ku2ehgzy5cy0di3xvfy82sxpf6';
export const LUMINOUS_AS = ['as.luminous.dev'];
export const LUMINOUS_EU = ['eu.luminous.dev', 'eu2.luminous.dev', 'eu3.luminous.dev'];
export const TTVLOL_HOSTS = ['twitch-al.nadeko.net'];
export const LIVE_SOURCES = ['as', 'al', 'eu', 'twitch'] as const;
export type LiveSource = typeof LIVE_SOURCES[number];

export type Stream = { id: string; login: string; name: string; title: string; game: string; gameId: string;
  viewers: number; thumb: string; tags: string[]; avatar?: string; startedAt?: string };
export type Category = { id: string; name: string; boxArt: string; viewers?: number };
export type Vod = { id: string; title: string; thumb: string; publishedAt: string; length: number; login?: string; name?: string; views?: number };
export type Clip = { slug: string; title: string; thumb: string; views: number; duration: number; createdAt: string; curator?: string; login?: string; name?: string };
export type ChannelBrief = { login: string; name: string; avatar: string; stream?: Stream; lastStart?: string };

function timeout(ms: number): AbortSignal { return AbortSignal.timeout(ms); }

/** GQL with variables. Returns `data`, or undefined on network/HTTP failure. */
export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}, clientId = GQL_CLIENT_ID): Promise<T | undefined> {
  try {
    const r = await fetch('https://gql.twitch.tv/gql', { method: 'POST', signal: timeout(15000),
      headers: { 'Client-ID': clientId, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    if (!r.ok) return undefined;
    return (await r.json()).data ?? undefined;
  } catch { return undefined; }
}
/** List page: page 1 with the web id, later pages with the Android id (web id needs integrity there). */
async function gqlPage<T = any>(query: string, variables: Record<string, unknown>, after?: string) {
  return after ? gql<T>(query, { ...variables, after }, GQL_NEXT_CLIENT_ID) : gql<T>(query, variables);
}
const nextCursor = (conn: any): string | undefined =>
  conn?.pageInfo?.hasNextPage ? conn?.edges?.[conn.edges.length - 1]?.cursor || undefined : undefined;

/** Persisted query (what twitch.tv itself sends), e.g. VOD chat. */
export async function gqlPersisted(op: string, variables: Record<string, unknown>, sha256: string): Promise<any> {
  try {
    const r = await fetch('https://gql.twitch.tv/gql', { method: 'POST', signal: timeout(15000),
      headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ operationName: op, variables, extensions: { persistedQuery: { version: 1, sha256Hash: sha256 } } }]) });
    return (await r.json())[0];
  } catch { return undefined; }
}

function streamFrom(u: any, s: any): Stream {
  return { id: u.id ?? u.login, login: u.login, name: u.displayName ?? u.login, title: s.title ?? '',
    game: s.game?.displayName ?? s.game?.name ?? '', gameId: s.game?.id ?? '', viewers: s.viewersCount ?? 0,
    thumb: s.previewImageURL ?? '', tags: (s.freeformTags ?? []).map((t: any) => t.name),
    avatar: u.profileImageURL, startedAt: s.createdAt };
}
const STREAM_FIELDS = 'title viewersCount createdAt previewImageURL(width: 440, height: 248) game { id displayName } freeformTags { name }';

export async function topStreams(lang?: string, after?: string) {
  const d = await gqlPage(`query($langs: [Language!], $after: Cursor) { streams(first: 30, after: $after, options: { broadcasterLanguages: $langs }) {
    edges { cursor node { ${STREAM_FIELDS} broadcaster { id login displayName profileImageURL(width: 70) } } } pageInfo { hasNextPage } } }`,
  lang ? { langs: [lang.toUpperCase().replace('-', '_')] } : {}, after);
  if (!d?.streams) return undefined;
  return { streams: d.streams.edges.map((e: any) => streamFrom(e.node.broadcaster, e.node)) as Stream[], next: nextCursor(d.streams) };
}

/** Channels (avatar, live stream if any), 100 per request; undefined if Twitch did not answer. */
export async function channels(logins: string[]): Promise<ChannelBrief[] | undefined> {
  const chunks: string[][] = [];
  for (let i = 0; i < logins.length; i += 100) chunks.push(logins.slice(i, i + 100));
  const parts = await Promise.all(chunks.map(l => gql(`query($l: [String!]) { users(logins: $l) { id login displayName profileImageURL(width: 70)
    lastBroadcast { startedAt } stream { ${STREAM_FIELDS} } } }`, { l })));
  if (parts.some(p => !p)) return undefined;
  return parts.flatMap(p => p.users.filter(Boolean).map((u: any) => ({ login: u.login, name: u.displayName ?? u.login,
    avatar: u.profileImageURL ?? '', stream: u.stream ? streamFrom(u, u.stream) : undefined, lastStart: u.lastBroadcast?.startedAt })));
}

export async function topCategories(after?: string) {
  const d = await gqlPage(`query($after: Cursor) { games(first: 100, after: $after) {
    edges { cursor node { id displayName boxArtURL(width: 285, height: 380) viewersCount } } pageInfo { hasNextPage } } }`, {}, after);
  if (!d?.games) return undefined;
  return { categories: d.games.edges.map((e: any) => catFrom(e.node)) as Category[], next: nextCursor(d.games) };
}
const catFrom = (n: any): Category => ({ id: n.id, name: n.displayName ?? n.name, boxArt: n.boxArtURL ?? '', viewers: n.viewersCount });
export async function searchCategories(q: string): Promise<Category[]> {
  const d = await gql(`query($q: String!) { searchCategories(query: $q, first: 30) { edges { node { id displayName boxArtURL(width: 285, height: 380) viewersCount } } } }`, { q });
  const list: Category[] = (d?.searchCategories?.edges ?? []).map((e: any) => catFrom(e.node));
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  return [...list.filter(c => fold(c.name) === fold(q)), ...list.filter(c => fold(c.name) !== fold(q))];
}
export async function categoryStreams(id: string, lang?: string, after?: string) {
  const d = await gqlPage(`query($id: ID!, $langs: [Language!], $after: Cursor) { game(id: $id) { id displayName boxArtURL(width: 285, height: 380) viewersCount
    streams(first: 100, after: $after, options: { broadcasterLanguages: $langs }) {
    edges { cursor node { ${STREAM_FIELDS} broadcaster { id login displayName profileImageURL(width: 70) } } } pageInfo { hasNextPage } } } }`,
  { id, ...(lang ? { langs: [lang.toUpperCase().replace('-', '_')] } : {}) }, after);
  if (!d?.game) return undefined;
  return { category: catFrom(d.game), streams: d.game.streams.edges.map((e: any) => streamFrom(e.node.broadcaster, e.node)) as Stream[], next: nextCursor(d.game.streams) };
}

export type Suggestion = { login: string; name: string; avatar?: string; viewers?: number; game?: string };
export async function searchUsers(q: string): Promise<Suggestion[]> {
  const d = await gql(`query($q: String!) { searchUsers(userQuery: $q, first: 8) { edges { node { login displayName profileImageURL(width: 70) stream { viewersCount game { displayName } } } } } }`, { q });
  const list: Suggestion[] = (d?.searchUsers?.edges ?? []).map((e: any) => ({ login: e.node.login, name: e.node.displayName,
    avatar: e.node.profileImageURL, viewers: e.node.stream?.viewersCount, game: e.node.stream?.game?.displayName }));
  return [...list.filter(s => s.viewers != null), ...list.filter(s => s.viewers == null)];
}

export type ChannelInfo = { id: string; login: string; name: string; avatar: string; stream?: Stream; lastStart?: string;
  description: string; followers?: number; banner?: string; partner: boolean; archiveId?: string;
  socials: { name: string; title: string; url: string }[]; panels: { title: string; image?: string; link?: string; text: string }[] };
const web = (s: any) => typeof s === 'string' && /^https?:\/\//i.test(s) ? s : undefined;
/** Channel page in one public query; null = channel not found, undefined = network. */
export async function channelInfo(login: string): Promise<ChannelInfo | null | undefined> {
  const d = await gql(`query($l: String!) { user(login: $l) { id login displayName profileImageURL(width: 150)
    description followers { totalCount } bannerImageURL roles { isPartner } lastBroadcast { startedAt }
    channel { socialMedias { name title url } }
    panels { type ... on DefaultPanel { title imageURL linkURL description } }
    stream { ${STREAM_FIELDS} archiveVideo { id } } } }`, { l: login.toLowerCase() });
  if (!d) return undefined;
  const u = d.user; if (!u) return null;
  return { id: u.id, login: u.login, name: u.displayName, avatar: u.profileImageURL ?? '', lastStart: u.lastBroadcast?.startedAt,
    stream: u.stream ? streamFrom(u, u.stream) : undefined, archiveId: u.stream?.archiveVideo?.id,
    description: u.description ?? '', followers: u.followers?.totalCount, banner: web(u.bannerImageURL), partner: !!u.roles?.isPartner,
    socials: (u.channel?.socialMedias ?? []).filter((s: any) => web(s.url)).map((s: any) => ({ name: s.name, title: s.title || s.name, url: s.url })),
    panels: (u.panels ?? []).filter((p: any) => p.type === 'DEFAULT' && (p.title || p.description || p.imageURL))
      .map((p: any) => ({ title: p.title ?? '', image: web(p.imageURL), link: web(p.linkURL), text: p.description ?? '' })) };
}

/** Live stats refresh (viewers, uptime, the running recording for rewind). */
export async function streamStats(login: string) {
  const d = await gql(`query($l: String!) { user(login: $l) { id profileImageURL(width: 70) displayName stream { ${STREAM_FIELDS} archiveVideo { id } } } }`, { l: login });
  if (!d) return undefined;
  return { userId: d.user?.id as string | undefined, avatar: d.user?.profileImageURL as string | undefined,
    stream: d.user?.stream ? streamFrom({ ...d.user, login }, d.user.stream) : undefined, archiveId: d.user?.stream?.archiveVideo?.id as string | undefined, exists: !!d.user };
}

export async function channelVideos(login: string, type: 'ARCHIVE' | 'HIGHLIGHT' | 'UPLOAD' = 'ARCHIVE', after?: string) {
  const d = await gqlPage(`query($l: String!, $t: BroadcastType, $after: Cursor) { user(login: $l) { login displayName videos(first: 50, after: $after, type: $t, sort: TIME) {
    edges { cursor node { id title previewThumbnailURL(width: 320, height: 180) publishedAt lengthSeconds viewCount } } pageInfo { hasNextPage } } } }`,
  { l: login.toLowerCase(), t: type }, after);
  if (!d) return undefined;
  const v = d.user?.videos;
  return { vods: (v?.edges ?? []).map((e: any) => ({ id: e.node.id, title: e.node.title ?? '', thumb: e.node.previewThumbnailURL ?? '',
    publishedAt: e.node.publishedAt ?? '', length: e.node.lengthSeconds ?? 0, views: e.node.viewCount, login: d.user.login, name: d.user.displayName })) as Vod[],
  next: nextCursor(v) };
}

export async function collections(login: string) {
  const d = await gql(`query($l: String!) { user(login: $l) { collections(first: 20) { edges { node { id title
    items(first: 50) { totalCount edges { node { ... on Video { id title lengthSeconds createdAt previewThumbnailURL(width: 320, height: 180) } } } } } } } } }`, { l: login.toLowerCase() });
  return (d?.user?.collections?.edges ?? []).map((e: any) => ({ id: e.node.id, title: e.node.title,
    vods: e.node.items.edges.map((i: any) => i.node).filter((v: any) => v?.id).map((v: any) => ({ id: v.id, title: v.title,
      thumb: v.previewThumbnailURL ?? '', publishedAt: v.createdAt, length: v.lengthSeconds ?? 0, login })) as Vod[] }))
    .filter((c: any) => c.vods.length);
}

export async function clips(login: string, period: 'LAST_DAY' | 'LAST_WEEK' | 'LAST_MONTH' | 'ALL_TIME', after?: string) {
  const d = await gqlPage(`query($l: String!, $p: ClipsPeriod, $after: Cursor) { user(login: $l) { login displayName
    clips(first: 50, after: $after, criteria: { period: $p, sort: VIEWS_DESC }) {
    edges { cursor node { slug title viewCount durationSeconds createdAt thumbnailURL(width: 480, height: 272) curator { displayName } } } pageInfo { hasNextPage } } } }`,
  { l: login.toLowerCase(), p: period }, after);
  if (!d) return undefined;
  const c = d.user?.clips;
  return { clips: (c?.edges ?? []).map((e: any) => ({ slug: e.node.slug, title: e.node.title ?? '', thumb: e.node.thumbnailURL ?? '',
    views: e.node.viewCount ?? 0, duration: e.node.durationSeconds ?? 0, createdAt: e.node.createdAt ?? '',
    curator: e.node.curator?.displayName, login: d.user.login, name: d.user.displayName })) as Clip[], next: nextCursor(c) };
}

/** Signed MP4 links of a clip (played directly by <video>) and its source VOD. */
export async function clipPlayback(slug: string) {
  const d = await gql(`query($s: ID!) { clip(slug: $s) { title broadcaster { login displayName } video { id } videoOffsetSeconds
    playbackAccessToken(params: { platform: "web", playerType: "site", playerBackend: "mediaplayer" }) { signature value }
    videoQualities { quality frameRate sourceURL } } }`, { s: slug });
  const c = d?.clip; if (!c?.playbackAccessToken) return undefined;
  const links: Record<string, string> = {};
  for (const q of c.videoQualities ?? []) {
    if (!q.sourceURL?.startsWith('https://')) continue;
    const label = `${q.quality}p${q.frameRate >= 50 ? Math.round(q.frameRate) : ''}`;
    links[label] = q.sourceURL + (q.sourceURL.includes('?') ? '&' : '?') +
      `sig=${c.playbackAccessToken.signature}&token=${encodeURIComponent(c.playbackAccessToken.value)}`;
  }
  return { links, title: c.title as string, login: c.broadcaster?.login as string | undefined,
    name: c.broadcaster?.displayName as string | undefined, vodId: c.video?.id as string | undefined, vodOffset: c.videoOffsetSeconds as number | undefined };
}

export async function vodMeta(id: string) {
  const d = await gql(`query($id: ID!) { video(id: $id) { title lengthSeconds viewCount createdAt previewThumbnailURL(width: 320, height: 180)
    owner { id login displayName profileImageURL(width: 70) }
    moments(first: 50, momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { positionMilliseconds durationMilliseconds description } } } } }`, { id });
  const v = d?.video; if (!v) return d ? null : undefined;
  const chapters = (v.moments?.edges ?? []).map((e: any) => ({ start: e.node.positionMilliseconds / 1000,
    duration: e.node.durationMilliseconds / 1000, title: e.node.description ?? '' })).sort((a: any, b: any) => a.start - b.start);
  return { title: v.title ?? '', length: v.lengthSeconds ?? 0, views: v.viewCount ?? 0, createdAt: v.createdAt as string, thumb: v.previewThumbnailURL ?? '',
    login: v.owner?.login ?? '', name: v.owner?.displayName ?? '', ownerId: v.owner?.id as string | undefined, avatar: v.owner?.profileImageURL as string | undefined,
    chapters: chapters.length > 1 ? chapters as { start: number; duration: number; title: string }[] : [] };
}

// Playback ------------------------------------------------------------------------------------
type Token = { value: string; signature: string };
export async function liveToken(login: string, playerType = 'site'): Promise<Token | undefined> {
  const d = await gql(`query($l: String!, $p: String!) { streamPlaybackAccessToken(channelName: $l,
    params: {platform: "web", playerBackend: "mediaplayer", playerType: $p}) { value signature } }`, { l: login, p: playerType });
  return d?.streamPlaybackAccessToken ?? undefined;
}
export function usherLiveURL(login: string, t: Token, lowLatency: boolean) {
  const q = new URLSearchParams({ allow_source: 'true', allow_audio_only: 'true', allow_spectre: 'true',
    fast_bread: String(lowLatency), low_latency: String(lowLatency), player_backend: 'mediaplayer',
    playlist_include_framerate: 'true', segment_preference: '4', p: String(Math.floor(Math.random() * 1e6)), sig: t.signature, token: t.value });
  return `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?${q}`;
}
/** A VOD through Twitch's normal token; sub-only VODs are refused by Twitch (403), as on twitch.tv. */
export async function vodURL(id: string): Promise<string | undefined> {
  const d = await gql(`query($id: ID!) { videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`, { id });
  const t = d?.videoPlaybackAccessToken; if (!t) return undefined;
  const auth = JSON.parse(t.value)?.authorization;
  if (auth?.forbidden) return undefined;
  const q = new URLSearchParams({ allow_source: 'true', allow_audio_only: 'true', player_backend: 'mediaplayer',
    playlist_include_framerate: 'true', p: String(Math.floor(Math.random() * 1e6)), sig: t.signature, token: t.value });
  return `https://usher.ttvnw.net/vod/${id}.m3u8?${q}`;
}

async function fetchMaster(url: string, ms: number, init: RequestInit = {}): Promise<(Master & { url: string }) | undefined> {
  try {
    const r = await fetch(url, { ...init, signal: timeout(ms) });
    if (!r.ok) return undefined;
    const body = await r.text();
    if (!body.includes('#EXT-X-STREAM-INF')) return undefined;
    const m = parseMaster(body, url);
    return Object.keys(m.links).length ? { ...m, url } : undefined;
  } catch { return undefined; }
}
const firstOf = <T>(ps: Promise<T | undefined>[]) => new Promise<T | undefined>(resolve => {
  let left = ps.length; if (!left) resolve(undefined);
  for (const p of ps) p.then(v => { if (v) resolve(v); else if (--left === 0) resolve(undefined); });
});

/** `url`: the master for the native player ("Automatisch"); `master`: its qualities when readable. */
export type LiveHit = { src: LiveSource; master?: Master; url: string };
/** One source. Proxies return a readable master (quality list); official Twitch only a URL for
 *  the native player: usher sends no CORS header to other sites, so its master can't be read. */
async function attempt(src: LiveSource, login: string, lowLatency: boolean): Promise<LiveHit | undefined> {
  const q = `allow_source=true&allow_audio_only=true&fast_bread=${lowLatency}`;
  if (src === 'as' || src === 'eu') {
    const hosts = src === 'as' ? LUMINOUS_AS : LUMINOUS_EU;
    const m = await firstOf(hosts.map(h => fetchMaster(`https://${h}/live/${login}?${q}`, 8000)));
    return m && { src, master: m, url: m.url };
  }
  if (src === 'al') {
    for (const h of TTVLOL_HOSTS) {
      // The X-Donate-To header of the Swift app is left out: a custom header forces a CORS
      // preflight, and the proxy doesn't need it.
      const m = await fetchMaster(`https://${h}/playlist/${login}.m3u8%3F${encodeURIComponent(q)}`, 10000);
      if (m) return { src, master: m, url: m.url };
    }
    return undefined;
  }
  const t = await liveToken(login);
  return t && { src, url: usherLiveURL(login, t, lowLatency) };
}

/** Staggered race over the sources (raceLiveSources): the next one starts when the previous failed
 *  or after 1.5 s; the first answer wins. Official Twitch (with ads) only after all before it failed. */
/** `firstAlone`: a source picked in the player gets its full time before the others start. */
export function raceLive(steps: LiveSource[], login: string, lowLatency: boolean, onSource?: (s: LiveSource) => void, firstAlone = false): Promise<LiveHit | undefined> {
  return new Promise(resolve => {
    let next = 0, running = 0, done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (done || next >= steps.length) return;
      const src = steps[next++]; running++; onSource?.(src);
      clearTimeout(timer);
      if (next < steps.length && steps[next] !== 'twitch' && !(firstAlone && next === 1)) timer = setTimeout(start, 1500);
      attempt(src, login, lowLatency).then(hit => {
        running--;
        if (done) return;
        if (hit) { done = true; clearTimeout(timer); resolve(hit); return; }
        if (running === 0) { if (next >= steps.length) { done = true; resolve(undefined); } else start(); }
      });
    };
    if (!steps.length) resolve(undefined); else start();
  });
}

/** Player types whose tokens often carry no stitched ad while "site" shows a break. */
export const BACKUP_PLAYER_TYPES = ['embed', 'popout', 'autoplay'];

/** Recent chat lines (robotty, public), shown when joining like on the iPhone. */
export async function recentMessages(login: string): Promise<string[]> {
  try {
    const r = await fetch(`https://recent-messages.robotty.de/api/v2/recent-messages/${login}?limit=100`, { signal: timeout(8000) });
    return (await r.json()).messages ?? [];
  } catch { return []; }
}
