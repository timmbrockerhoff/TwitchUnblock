// Channel points and drops, claimed automatically (ChannelPointsService.swift, Drops.swift).
// The iOS app uses the twitch.tv session cookie plus an integrity token minted in a WebView;
// a web page can read neither. Instead: a second device-code login with Twitch's own TV client
// id (accepted by id.twitch.tv and gql.twitch.tv from any origin, measured 2026-10-26), the
// same route as open-source points/drops miners. Whether Twitch accepts the claim mutations
// with that token is only verifiable with a real login: every step is logged for that.
import { changed, state } from './store';

export const TV_CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
const CLAIM_POINTS_HASH = '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0';
const CLAIM_DROP_HASH = 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930';
/** Twitch's analytics endpoint ("spade_url" in twitch.tv's settings.js); CORS `*`. */
const SPADE_URL = 'https://spade.twitch.tv/track';

export type Rewards = { token: string; refresh?: string; userId: string; login: string };
export type RewardLog = { at: number; text: string; ok?: boolean };
export const rewards = {
  account: (() => { try { return JSON.parse(localStorage.getItem('rewardsAccount') || 'null') as Rewards | null; } catch { return null; } })(),
  log: [] as RewardLog[],
  balance: {} as Record<string, number>,        // channel login → points
  drops: [] as DropCampaign[],
};
export type TimedDrop = { id: string; name: string; required: number; current: number; claimed: boolean; instance?: string; image?: string };
export type DropCampaign = { id: string; name: string; game: string; endAt: string; linked: boolean; linkURL?: string; drops: TimedDrop[] };

export function log(text: string, ok?: boolean) {
  rewards.log = [{ at: Date.now(), text, ok }, ...rewards.log].slice(0, 60);
  changed();
}
export function setRewardsAccount(a: Rewards | null) {
  rewards.account = a;
  if (a) localStorage.setItem('rewardsAccount', JSON.stringify(a)); else localStorage.removeItem('rewardsAccount');
  changed();
}

// Login ----------------------------------------------------------------------------------------
export async function startRewardsLogin() {
  const r = await fetch('https://id.twitch.tv/oauth2/device', { method: 'POST', body: new URLSearchParams({ client_id: TV_CLIENT_ID, scopes: '' }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }>;
}
export async function pollRewardsLogin(code: { device_code: string; interval: number; expires_in: number }, cancelled: () => boolean): Promise<Rewards | undefined> {
  const until = Date.now() + code.expires_in * 1000;
  let wait = Math.max(code.interval, 5) * 1000;
  while (Date.now() < until && !cancelled()) {
    await new Promise(r => setTimeout(r, wait));
    const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({
      client_id: TV_CLIENT_ID, device_code: code.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) }).catch(() => undefined);
    const j = await r?.json().catch(() => ({})) ?? {};
    if (j.access_token) {
      const v = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${j.access_token}` } }).then(x => x.json()).catch(() => undefined);
      if (!v?.user_id) throw new Error('Token ungültig');
      return { token: j.access_token, refresh: j.refresh_token, userId: v.user_id, login: v.login };
    }
    if (j.message === 'slow_down') wait += 5000;
    else if (r && j.message !== 'authorization_pending') throw new Error(j.message || `HTTP ${r.status}`);
  }
  return undefined;
}
async function refresh(): Promise<boolean> {
  const a = rewards.account; if (!a?.refresh) return false;
  const j = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({
    client_id: TV_CLIENT_ID, grant_type: 'refresh_token', refresh_token: a.refresh }) }).then(r => r.json()).catch(() => undefined);
  if (!j?.access_token) return false;
  setRewardsAccount({ ...a, token: j.access_token, refresh: j.refresh_token ?? a.refresh });
  return true;
}

/** GQL as the TV client with the rewards token; one token refresh on 401. */
async function gql(body: unknown, retried = false): Promise<any> {
  const a = rewards.account; if (!a) return undefined;
  const r = await fetch('https://gql.twitch.tv/gql', { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Client-ID': TV_CLIENT_ID, Authorization: `OAuth ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
  if (r?.status === 401 && !retried) {
    if (await refresh()) return gql(body, true);
    log('Anmeldung für Kanalpunkte/Drops abgelaufen – bitte neu anmelden', false);
    setRewardsAccount(null);
    return undefined;
  }
  return r?.json().catch(() => undefined);
}
const errors = (j: any) => (Array.isArray(j) ? j[0] : j)?.errors?.map((e: any) => e.message).join(' · ');

// Channel points while a live channel plays -----------------------------------------------------
/** Runs while the player shows `login` live: minute-watched every 60 s (what earns passive points
 *  and makes chests appear), chest check every 30 s. Returns a stop function. */
export function watchChannel(login: string): () => void {
  const a = rewards.account;
  if (!a) return () => {};
  let stopped = false, channelId = '', broadcastId = '', lastClaim = '';
  const info = async () => {
    const j = await gql({ query: 'query($l: String!) { user(login: $l) { id stream { id } channel { self { communityPoints { balance availableClaim { id } } } } } }', variables: { l: login } });
    const u = j?.data?.user;
    if (!u) { if (j) log(`Kanalpunkte ${login}: ${errors(j) ?? 'keine Daten'}`, false); return; }
    channelId = u.id; broadcastId = u.stream?.id ?? '';
    const cp = u.channel?.self?.communityPoints;
    if (cp == null) { log(`Kanalpunkte ${login}: Twitch liefert keinen Kontostand für dieses Token`, false); return; }
    rewards.balance[login] = cp.balance; changed();
    const claim = cp.availableClaim?.id;
    if (claim && claim !== lastClaim && state.settings.autoPoints) {
      lastClaim = claim;
      const res = await gql([{ operationName: 'ClaimCommunityPoints', variables: { input: { channelID: channelId, claimID: claim } },
        extensions: { persistedQuery: { version: 1, sha256Hash: CLAIM_POINTS_HASH } } }]);
      const err = errors(res) ?? res?.[0]?.data?.claimCommunityPoints?.error?.code;
      if (err) { log(`Truhe bei ${login} nicht eingelöst: ${err}`, false); lastClaim = ''; }
      else { log(`Truhe bei ${login} eingelöst`, true); setTimeout(info, 3000); }
    }
  };
  const minuteWatched = () => {
    if (!channelId || !broadcastId) return;
    const payload = [{ event: 'minute-watched', properties: { channel_id: channelId, broadcast_id: broadcastId,
      channel: login, user_id: Number(a.userId), player: 'site', live: true } }];
    // A "simple" CORS request (form encoded, no custom header): no preflight needed.
    fetch(SPADE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(btoa(JSON.stringify(payload))) })
      .then(r => { if (!r.ok) log(`Zuschau-Meldung ${login}: HTTP ${r.status}`, false); })
      .catch(() => log(`Zuschau-Meldung ${login} fehlgeschlagen`, false));
  };
  info().then(() => { if (!stopped) { minuteWatched(); log(`Kanalpunkte: zuschauen bei ${login} wird gemeldet`); } });
  const t1 = setInterval(info, 30000), t2 = setInterval(minuteWatched, 60000);
  return () => { stopped = true; clearInterval(t1); clearInterval(t2); };
}

// Drops -------------------------------------------------------------------------------------------
/** Campaigns of this channel the account takes part in (empty = no drops here). */
export async function channelHasDrops(login: string): Promise<boolean> {
  const j = await gql({ query: 'query($l: String!) { user(login: $l) { channel { viewerDropCampaigns { id } } } }', variables: { l: login } });
  return (j?.data?.user?.channel?.viewerDropCampaigns?.length ?? 0) > 0;
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

let claiming = new Set<string>();
/** Reads the inventory and claims finished drops (every 5 min while watching, on app start/foreground). */
export async function checkDrops(manual = false) {
  if (!rewards.account) return;
  const j = await gql({ query: `query { currentUser { inventory { dropCampaignsInProgress {
    id name endAt accountLinkURL self { isAccountConnected } game { displayName }
    timeBasedDrops { id name requiredMinutesWatched benefitEdges { benefit { imageAssetURL } }
      self { currentMinutesWatched isClaimed dropInstanceID } } } } } }` });
  const list = j?.data?.currentUser?.inventory?.dropCampaignsInProgress;
  if (!list) { log(`Drops-Inventar nicht lesbar${errors(j) ? ': ' + errors(j) : ''}`, false); return; }
  rewards.drops = list.map((c: any) => ({ id: c.id, name: c.name, game: c.game?.displayName ?? '', endAt: c.endAt,
    linked: c.self?.isAccountConnected ?? true, linkURL: c.accountLinkURL,
    drops: (c.timeBasedDrops ?? []).map((d: any) => ({ id: d.id, name: d.name, required: d.requiredMinutesWatched,
      current: d.self?.currentMinutesWatched ?? 0, claimed: !!d.self?.isClaimed, instance: d.self?.dropInstanceID ?? undefined,
      image: d.benefitEdges?.[0]?.benefit?.imageAssetURL })) }));
  changed();
  if (manual) log(`Drops geprüft: ${rewards.drops.length} Kampagnen`);
  if (!state.settings.autoDrops) return;
  for (const c of rewards.drops) for (const d of c.drops) {
    if (d.claimed || !d.instance || d.current < d.required || claiming.has(d.instance)) continue;
    claiming.add(d.instance);
    const res = await gql([{ operationName: 'DropsPage_ClaimDropRewards', variables: { input: { dropInstanceID: d.instance } },
      extensions: { persistedQuery: { version: 1, sha256Hash: CLAIM_DROP_HASH } } }]);
    const err = errors(res);
    if (err) { log(`Drop „${d.name}“ nicht eingelöst: ${err}`, false); claiming.delete(d.instance); }
    else { log(`Drop „${d.name}“ (${c.game}) eingelöst`, true); d.claimed = true; changed(); }
  }
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
  // Keep the home lists in step without waiting for the next Helix read.
  state.accountFollows = follow ? [...new Set([...state.accountFollows, login])] : state.accountFollows.filter(l => l !== login);
  changed();
  return undefined;
}
