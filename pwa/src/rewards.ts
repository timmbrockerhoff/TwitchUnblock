// Channel points, drops and following, with the one login (Twitch's TV client, see account.ts).
// The iOS app uses the twitch.tv session cookie plus an integrity token minted in a WebView;
// a web page can read neither. The TV client's token needs no integrity token on gql.twitch.tv
// (measured 2026-10-26: balance and drops inventory readable). Every claim is logged.
import { changed, state, setAccount } from './store';
import { refreshToken } from './account';
import { TV_CLIENT_ID } from './twitch';

const CLAIM_POINTS_HASH = '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0';
const CLAIM_DROP_HASH = 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930';
/** Twitch's analytics endpoint ("spade_url" in twitch.tv's settings.js); CORS `*`. */
const SPADE_URL = 'https://spade.twitch.tv/track';

export type RewardLog = { at: number; text: string; ok?: boolean };
export const rewards = {
  /** The one login (store.account), TV client. */
  get account() { return state.account; },
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

/** GQL as the TV client with the rewards token; one token refresh on 401. */
export async function gql(body: unknown, retried = false): Promise<any> {
  const a = rewards.account; if (!a) return undefined;
  const r = await fetch('https://gql.twitch.tv/gql', { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Client-ID': TV_CLIENT_ID, Authorization: `OAuth ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
  if (r?.status === 401 && !retried) {
    if (await refreshToken()) return gql(body, true);
    log('Anmeldung abgelaufen – bitte neu anmelden', false);
    setAccount(null);
    return undefined;
  }
  return r?.json().catch(() => undefined);
}
export const errors = (j: any) => (Array.isArray(j) ? j[0] : j)?.errors?.map((e: any) => e.message).join(' · ');

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
    // Measured: about 2 in 7 posts fail with "Load failed" (no response); one retry after 5 s.
    const send = (retry: boolean) => fetch(SPADE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(btoa(JSON.stringify(payload))) })
      .then(r => { if (!r.ok) log(`Zuschau-Meldung ${login}: HTTP ${r.status}`, false); })
      .catch(() => retry ? setTimeout(() => send(false), 5000) : log(`Zuschau-Meldung ${login} fehlgeschlagen`, false));
    send(true);
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
    const payload = res?.[0]?.data?.claimDropRewards;
    if (err) { log(`Drop „${d.name}“ nicht eingelöst: ${err}`, false); claiming.delete(d.instance); }
    // Measured: with an unlinked game account Twitch answers ELIGIBLE_FOR_ALL but keeps the drop
    // unclaimed; it can only be claimed after linking.
    else if (payload?.isUserAccountConnected === false) log(`Drop „${d.name}“ (${c.game}) wartet: Spielkonto nicht verknüpft`, false);
    else { log(`Drop „${d.name}“ (${c.game}) eingelöst (${payload?.status ?? 'ok'})`, true); d.claimed = true; changed(); }
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
