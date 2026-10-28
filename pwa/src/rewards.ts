// Channel points, drops and following, with the one login (Twitch's TV client, see account.ts).
// The iOS app uses the twitch.tv session cookie plus an integrity token minted in a WebView;
// a web page can read neither. The TV client's token needs no integrity token on gql.twitch.tv
// (measured 2026-10-26: balance and drops inventory readable). Every claim is logged.
import { changed, state, followListeners } from './store';
import { refreshToken, sessionExpired } from './account';
import { TV_CLIENT_ID } from './twitch';
import { WORKER_BASES } from './vod';
import { addLog, log as applog } from './log';
import { notice, noticeDropLink } from './notices';
import { beginSession, endSession, addMinute, addGain, addChest } from './points';

const CLAIM_POINTS_HASH = '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0';
const CLAIM_DROP_HASH = 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930';
/** Twitch's analytics endpoint ("spade_url" in twitch.tv's settings.js); CORS `*`. */
const SPADE_URL = 'https://spade.twitch.tv/track';

export const rewards = {
  /** The one login (store.account), TV client. */
  get account() { return state.account; },
  balance: {} as Record<string, number>,        // channel login → points
  /** Last balance rise per channel, for the "+n" animation; cleared after 3 s. */
  lastBalanceChange: {} as Record<string, number>,
  drops: [] as DropCampaign[],                   // campaigns in progress (inventory)
  /** Every open or upcoming campaign (Drops page), empty when the TV client may not read them. */
  available: [] as DropCampaign[],
  /** Drop being credited on the channel playing now. */
  dropSession: undefined as DropSession | undefined,
};
export type TimedDrop = { id: string; name: string; required: number; current: number; claimed: boolean; instance?: string; image?: string };
export type DropCampaign = { id: string; name: string; game: string; boxArt?: string; startAt?: string; endAt: string; upcoming?: boolean;
  /** False only when a game account is needed and missing; Twitch's own (twitch.tv) links don't count (Drops.swift:438). */
  linked: boolean; linkURL?: string; drops: TimedDrop[] };
export type DropSession = { channel: string; current: number; required: number; dropId: string };

/** Rewards lines go to the app log (log.ts). */
export const log = (text: string, ok?: boolean) => addLog('Belohnungen', text, ok);

/** GQL as the TV client with the rewards token; one token refresh on 401. */
export async function gql(body: unknown, retried = false): Promise<any> {
  const a = rewards.account; if (!a) return undefined;
  const r = await fetch('https://gql.twitch.tv/gql', { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Client-ID': TV_CLIENT_ID, Authorization: `OAuth ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
  if (r?.status === 401) {
    if (!retried && await refreshToken()) return gql(body, true);
    sessionExpired();
    return undefined;
  }
  return r?.json().catch(() => undefined);
}
export const errors = (j: any) => (Array.isArray(j) ? j[0] : j)?.errors?.map((e: any) => e.message).join(' · ');

// Channel points while a live channel plays -----------------------------------------------------
/** spade URL: read from twitch.tv/<login> through the worker proxy like iOS (resolveSpadeURL), the
 *  known address as fallback. Twitch rotates it rarely; the fixed one failed silently before. */
let spadeURL: Promise<string> | undefined;
function resolveSpadeURL(login: string): Promise<string> {
  return spadeURL ??= (async () => {
    const page = `https://www.twitch.tv/${login}`;
    for (const base of WORKER_BASES) {
      try {
        const html = await fetch(`${base}/api/proxy?url=${encodeURIComponent(page)}`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.text() : '');
        const direct = html.match(/"spade_url"\s*:\s*"(https:[^"]+)"/)?.[1];
        if (direct) return direct.replaceAll('\\/', '/');
        const settings = html.match(/(https:\/\/[^"']+?\/config\/settings\.[A-Za-z0-9]+\.js)/)?.[1];
        if (!settings) continue;
        const js = await fetch(`${base}/api/proxy?url=${encodeURIComponent(settings)}`, { signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.text() : '');
        const found = js.match(/"spade_url"\s*:\s*"(https:[^"]+)"/)?.[1];
        if (found) return found.replaceAll('\\/', '/');
      } catch { /* next worker */ }
    }
    applog.debug('Belohnungen', 'spade-URL nicht lesbar, Standardadresse');
    return SPADE_URL;
  })();
}

/** Runs while the player shows `login` live: minute-watched every 60 s (what earns passive points
 *  and makes chests appear), chest check every 30 s. Returns a stop function. */
export function watchChannel(login: string): () => void {
  const a = rewards.account;
  if (!a) return () => {};
  let stopped = false, channelId = '', broadcastId = '', lastClaim = '';
  let clearDelta: ReturnType<typeof setTimeout> | undefined;
  beginSession(login);
  const info = async () => {
    const j = await gql({ query: 'query($l: String!) { user(login: $l) { id stream { id } channel { self { communityPoints { balance availableClaim { id } } } } } }', variables: { l: login } });
    const u = j?.data?.user;
    if (!u) { if (j) log(`Kanalpunkte ${login}: ${errors(j) ?? 'keine Daten'}`, false); return; }
    channelId = u.id; broadcastId = u.stream?.id ?? '';
    const cp = u.channel?.self?.communityPoints;
    if (cp == null) { log(`Kanalpunkte ${login}: Twitch liefert keinen Kontostand für dieses Token`, false); return; }
    const old = rewards.balance[login];
    const delta = old == null ? 0 : cp.balance - old;
    if (delta > 0) {
      // Only real changes are logged, not every poll.
      applog.success('Belohnungen', `Punkte bei ${login}: +${delta}`, `Kontostand ${cp.balance}`);
      addGain(delta, login);
      rewards.lastBalanceChange[login] = delta;
      clearTimeout(clearDelta); clearDelta = setTimeout(() => { delete rewards.lastBalanceChange[login]; changed(); }, 3000);
    } else if (delta < 0) applog.warn('Belohnungen', `Punkte bei ${login}: ${delta}`, `Kontostand ${cp.balance}`);
    rewards.balance[login] = cp.balance; changed();
    const claim = cp.availableClaim?.id;
    if (claim && claim !== lastClaim && state.settings.autoPoints) {
      lastClaim = claim;
      const res = await gql([{ operationName: 'ClaimCommunityPoints', variables: { input: { channelID: channelId, claimID: claim } },
        extensions: { persistedQuery: { version: 1, sha256Hash: CLAIM_POINTS_HASH } } }]);
      const err = errors(res) ?? res?.[0]?.data?.claimCommunityPoints?.error?.code;
      if (err) { log(`Truhe bei ${login} nicht eingelöst: ${err}`, false); lastClaim = ''; }
      else { log(`Truhe bei ${login} eingelöst`, true); addChest(login); setTimeout(info, 3000); }
    }
  };
  const minuteWatched = async () => {
    if (!channelId || !broadcastId) return;
    const payload = [{ event: 'minute-watched', properties: { channel_id: channelId, broadcast_id: broadcastId,
      channel: login, user_id: Number(a.userId), player: 'site', live: true } }];
    const url = await resolveSpadeURL(login);
    // A "simple" CORS request (form encoded, no custom header): no preflight needed.
    // Measured: about 2 in 7 posts fail with "Load failed" (no response); one retry after 5 s.
    const send = (retry: boolean) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(btoa(JSON.stringify(payload))) })
      .then(r => { if (r.ok) addMinute(login); else log(`Zuschau-Meldung ${login}: HTTP ${r.status}`, false); })
      .catch(() => retry ? setTimeout(() => send(false), 5000) : log(`Zuschau-Meldung ${login} fehlgeschlagen`, false));
    send(true);
  };
  info().then(() => { if (!stopped) { minuteWatched(); log(`Kanalpunkte: zuschauen bei ${login} wird gemeldet`); } });
  const t1 = setInterval(info, 30000), t2 = setInterval(minuteWatched, 60000);
  return () => { stopped = true; clearInterval(t1); clearInterval(t2); clearTimeout(clearDelta); endSession(login); };
}

// Drops -------------------------------------------------------------------------------------------
/** Campaigns of this channel the account takes part in (empty = no drops here); channel id for dropCurrentSession. */
export async function channelDrops(login: string): Promise<{ id: string; has: boolean } | undefined> {
  const j = await gql({ query: 'query($l: String!) { user(login: $l) { id channel { viewerDropCampaigns { id } } } }', variables: { l: login } });
  const u = j?.data?.user; if (!u) return undefined;
  return { id: u.id, has: (u.channel?.viewerDropCampaigns?.length ?? 0) > 0 };
}
export const channelHasDrops = async (login: string) => (await channelDrops(login))?.has ?? false;

/** Drop being credited on this channel right now (Drops.swift refreshSession). */
export async function loadDropSession(channelId: string) {
  const j = await gql({ query: 'query($c: ID!) { currentUser { dropCurrentSession(channelID: $c) { channel { displayName } currentMinutesWatched requiredMinutesWatched dropID } } }', variables: { c: channelId } });
  const s = j?.data?.currentUser?.dropCurrentSession;
  rewards.dropSession = s?.dropID ? { channel: s.channel?.displayName ?? '', current: s.currentMinutesWatched ?? 0, required: s.requiredMinutesWatched ?? 0, dropId: s.dropID } : undefined;
  changed();
}

/** Drops while `login` plays (the player starts/stops it): the channel's campaigns are re-checked
 *  every 10 min (Drops.swift:521-538), with drops the inventory + current session every 5 min.
 *  `onChange(has)` fires when the channel gains or loses drops (hidden drops stream on/off). */
export function watchDrops(login: string, onChange?: (has: boolean) => void): () => void {
  if (!rewards.account) return () => {};
  let stopped = false, has: boolean | undefined, inventory: ReturnType<typeof setInterval> | undefined, channelId = '';
  const check = async () => {
    const d = await channelDrops(login);
    if (stopped || !d) return;
    channelId = d.id;
    if (d.has !== has) {
      has = d.has; onChange?.(has);
      applog.debug('Belohnungen', `Drops bei ${login}: ${has ? 'ja' : 'nein'}`);
      clearInterval(inventory); inventory = undefined;
      if (has) { tick(); inventory = setInterval(tick, 300_000); }
      else { rewards.dropSession = undefined; changed(); }
    }
  };
  const tick = () => { checkDrops(); if (channelId) loadDropSession(channelId); };
  check();
  const campaigns = setInterval(check, 600_000);
  return () => { stopped = true; clearInterval(campaigns); clearInterval(inventory); rewards.dropSession = undefined; changed(); };
}

/** usher URL with a token issued to the account: the native player loading it counts the
 *  minutes for drops (the iOS app reads the same playlist itself, which a web page can't). */
export async function accountStreamURL(login: string): Promise<string | undefined> {
  const j = await gql({ query: `query($l: String!) { streamPlaybackAccessToken(channelName: $l,
    params: {platform: "android", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`, variables: { l: login } });
  const t = j?.data?.streamPlaybackAccessToken; if (!t) return undefined;
  const q = new URLSearchParams({ allow_source: 'false', allow_audio_only: 'true', player_backend: 'mediaplayer', sig: t.signature, token: t.value });
  return `https://usher.ttvnw.net/api/channel/hls/${login}.m3u8?${q}`;
}

const DROP_FIELDS = `id name startAt endAt accountLinkURL self { isAccountConnected } game { displayName boxArtURL(width: 144, height: 192) }
    timeBasedDrops { id name requiredMinutesWatched benefitEdges { benefit { imageAssetURL } } self { currentMinutesWatched isClaimed dropInstanceID } }`;
const campaignFrom = (c: any): DropCampaign => ({ id: c.id, name: c.name, game: c.game?.displayName ?? '', boxArt: c.game?.boxArtURL, startAt: c.startAt, endAt: c.endAt,
  upcoming: c.status === 'UPCOMING', linked: (c.self?.isAccountConnected ?? true) || (c.accountLinkURL ?? '').includes('twitch.tv'), linkURL: c.accountLinkURL,
  drops: (c.timeBasedDrops ?? []).map((d: any) => ({ id: d.id, name: d.name, required: d.requiredMinutesWatched,
    current: d.self?.currentMinutesWatched ?? 0, claimed: !!d.self?.isClaimed, instance: d.self?.dropInstanceID ?? undefined,
    image: d.benefitEdges?.[0]?.benefit?.imageAssetURL })) });

/** Once per drop and state (ready / claimed), kept across reloads (Drops.swift notify). */
const NOTIFIED_KEY = 'dropsNotified';
function notifyDrop(d: TimedDrop, game: string, claimed: boolean) {
  const mark = `${d.id}-${claimed ? 'claimed' : 'ready'}`;
  let seen: string[] = [];
  try { seen = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]'); } catch { /* fresh */ }
  if (seen.includes(mark)) return;
  try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...seen, mark].slice(-300))); } catch { /* blocked */ }
  notice({ kind: claimed ? 'dropClaimed' : 'dropReady', title: claimed ? `Drop eingelöst: ${d.name}` : `Drop bereit: ${d.name}`, body: game });
}

const claiming = new Set<string>();
/** Reads the inventory and claims finished drops (every 5 min while watching, on app start/foreground).
 *  A claim is verified by reading the inventory again (Twitch can say "eligible" and give nothing
 *  to an unlinked account), `verifyOnly` is that second read. */
export async function checkDrops(manual = false, verifyOnly = false) {
  if (!rewards.account) return;
  const j = await gql({ query: `query { currentUser { inventory { dropCampaignsInProgress { ${DROP_FIELDS} } } } }` });
  const list = j?.data?.currentUser?.inventory?.dropCampaignsInProgress;
  if (!list) { log(`Drops-Inventar nicht lesbar${errors(j) ? ': ' + errors(j) : ''}`, false); return; }
  rewards.drops = list.map(campaignFrom).sort((a: DropCampaign, b: DropCampaign) => Date.parse(a.endAt) - Date.parse(b.endAt));
  changed();
  if (manual) log(`Drops geprüft: ${rewards.drops.length} Kampagnen`);
  if (verifyOnly) return;
  for (const c of rewards.drops) if (!c.linked && c.linkURL && c.drops.some(d => !d.claimed))
    noticeDropLink(c.id, { kind: 'dropLink', title: 'Spielkonto verknüpfen', body: `${c.game}: Drops brauchen ein verknüpftes Konto. Tippen zum Verknüpfen.`, url: c.linkURL });
  let claimedSome = false;
  for (const c of rewards.drops) for (const d of c.drops) {
    if (d.claimed || !d.instance || d.current < d.required || claiming.has(d.instance) || !c.linked) continue;
    // Without auto-claim the drop only gets announced, once per drop.
    if (!state.settings.autoDrops) { notifyDrop(d, c.game, false); continue; }
    claiming.add(d.instance);
    const res = await gql([{ operationName: 'DropsPage_ClaimDropRewards', variables: { input: { dropInstanceID: d.instance } },
      extensions: { persistedQuery: { version: 1, sha256Hash: CLAIM_DROP_HASH } } }]);
    const err = errors(res);
    const payload = res?.[0]?.data?.claimDropRewards;
    if (err) { log(`Drop „${d.name}“ nicht eingelöst: ${err}`, false); claiming.delete(d.instance); }
    // Measured: with an unlinked game account Twitch answers ELIGIBLE_FOR_ALL but keeps the drop
    // unclaimed; it can only be claimed after linking.
    else if (payload?.isUserAccountConnected === false) {
      log(`Drop „${d.name}“ (${c.game}) wartet: Spielkonto nicht verknüpft`, false);
      if (c.linkURL) noticeDropLink(c.id, { kind: 'dropLink', title: 'Spielkonto verknüpfen', body: `Drop „${d.name}“ (${c.game}) wartet. Tippen zum Verknüpfen.`, url: c.linkURL });
    }
    else {
      log(`Drop „${d.name}“ (${c.game}) eingelöst (${payload?.status ?? 'ok'})`, true); d.claimed = true; claimedSome = true; changed();
      notifyDrop(d, c.game, true);
    }
  }
  if (claimedSome) await checkDrops(false, true);
}

/** Every open or upcoming campaign of every game (ViewerDropsDashboard). twitch.tv guards this field
 *  with the integrity token; if the TV client may not read it the list stays empty, quietly. */
export async function loadDropCampaigns() {
  if (!rewards.account) return;
  const j = await gql({ query: `query { currentUser { dropCampaigns { status ${DROP_FIELDS} } } }` });
  const list = j?.data?.currentUser?.dropCampaigns;
  if (!Array.isArray(list)) { applog.debug('Belohnungen', 'Offene Kampagnen nicht lesbar', errors(j)); return; }
  rewards.available = list.map(campaignFrom).filter((c: DropCampaign) => !c.endAt || Date.parse(c.endAt) > Date.now())
    .sort((a: DropCampaign, b: DropCampaign) => Number(a.upcoming) - Number(b.upcoming) || a.game.localeCompare(b.game, 'de', { sensitivity: 'base' }));
  applog.debug('Belohnungen', `${rewards.available.length} offene Kampagnen`);
  changed();
}

// Following on Twitch -----------------------------------------------------------------------------
// gql.twitch.tv answers followUser for the web client id with "failed integrity check", for the TV
// client id only with "unauthenticated" (measured 2026-10-26): with the TV login it needs no
// integrity token, like the TV app itself.
/** Whether the TV-login account follows `login` on Twitch; undefined without login or on error. */
export async function twitchFollowState(login: string): Promise<{ id: string; following: boolean } | undefined> {
  if (!rewards.account) return undefined;
  const j = await gql({ query: 'query($l: String!) { user(login: $l) { id self { follower { followedAt } } } }', variables: { l: login } });
  const u = j?.data?.user; if (!u) return undefined;
  return { id: u.id, following: !!u.self?.follower };
}
/** Follows or unfollows on Twitch. Returns an error text, or undefined on success. */
export async function setTwitchFollow(channelId: string, login: string, follow: boolean): Promise<string | undefined> {
  const j = await gql(follow
    ? { query: 'mutation($i: FollowUserInput!) { followUser(input: $i) { follow { user { id } } error { code } } }', variables: { i: { targetID: channelId, disableNotifications: false } } }
    : { query: 'mutation($i: UnfollowUserInput!) { unfollowUser(input: $i) { follow { user { id } } } }', variables: { i: { targetID: channelId } } });
  const err = errors(j) ?? j?.data?.followUser?.error?.code;
  if (!j) return 'Keine Antwort von Twitch';
  if (err) { log(`${follow ? 'Folgen' : 'Entfolgen'} ${login}: ${err}`, false); return err; }
  log(`${follow ? 'Folgst jetzt' : 'Entfolgt'}: ${login}`, true);
  // Keep the home lists in step without waiting for the next read; follows.ts reloads 1.5 s later.
  state.accountFollows = follow ? [...new Set([...state.accountFollows, login])] : state.accountFollows.filter(l => l !== login);
  changed();
  followListeners.forEach(f => f());
  return undefined;
}

// Followed categories on Twitch -------------------------------------------------------------------
// currentUser.followedGames reads with the TV token (measured 2026-10-27). followGame/unfollowGame
// answered an invalid id with "service error", not "unauthenticated", so they likely work too.
type FavCat = { id: string; name: string; boxArt: string };
/** Loads the account's followed categories into state.accountCategories; false on error. */
export async function loadFollowedGames(): Promise<boolean> {
  if (!rewards.account) return false;
  const j = await gql({ query: '{ currentUser { followedGames(first: 100, type: ALL) { nodes { id displayName boxArtURL(width: 570, height: 760) } } } }' });
  const nodes = j?.data?.currentUser?.followedGames?.nodes;
  if (!Array.isArray(nodes)) { log(`Gefolgte Kategorien: ${errors(j) ?? 'keine Antwort'}`, false); return false; }
  state.accountCategories = nodes.filter(Boolean).map((n: any): FavCat => ({ id: n.id, name: n.displayName, boxArt: n.boxArtURL ?? '' }));
  changed();
  return true;
}
/** Follows or unfollows a category on Twitch. Returns an error text, or undefined on success. */
export async function setTwitchGameFollow(c: FavCat, follow: boolean): Promise<string | undefined> {
  const j = await gql(follow
    ? { query: 'mutation($i: FollowGameInput!) { followGame(input: $i) { game { id } } }', variables: { i: { gameID: c.id } } }
    : { query: 'mutation($i: UnfollowGameInput!) { unfollowGame(input: $i) { game { id } } }', variables: { i: { gameID: c.id } } });
  if (!j) return 'Keine Antwort von Twitch';
  const err = errors(j);
  if (err) { log(`Kategorie ${follow ? 'folgen' : 'entfolgen'} ${c.name}: ${err}`, false); return err; }
  log(`${follow ? 'Folgst jetzt Kategorie' : 'Kategorie entfolgt'}: ${c.name}`, true);
  state.accountCategories = follow ? [...state.accountCategories.filter(x => x.id !== c.id), c] : state.accountCategories.filter(x => x.id !== c.id);
  changed();
  return undefined;
}
