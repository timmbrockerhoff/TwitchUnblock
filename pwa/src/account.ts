// Twitch login without a client secret: OAuth device code flow with Twitch's TV client (one
// login for chat, follows, channel points and drops; the iOS app's redirect page hands tokens to
// twitchunblock:// and can't be used by a web page).
import { TV_CLIENT_ID as CLIENT_ID } from './twitch';
import { state, setAccount, changed, type Account } from './store';
import { log } from './log';
import { notice } from './notices';

export const SCOPES = ['user:read:follows', 'chat:read', 'chat:edit', 'user:manage:chat_color'];

export type DeviceCode = { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number };
export async function startDeviceLogin(): Promise<DeviceCode> {
  const r = await fetch('https://id.twitch.tv/oauth2/device', { method: 'POST',
    body: new URLSearchParams({ client_id: CLIENT_ID, scopes: SCOPES.join(' ') }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** Polls until the user confirmed the code on twitch.tv/activate; resolves with the account. */
export async function pollDeviceLogin(code: DeviceCode, cancelled: () => boolean): Promise<Account | undefined> {
  const until = Date.now() + code.expires_in * 1000;
  let wait = Math.max(code.interval, 5) * 1000;
  while (Date.now() < until && !cancelled()) {
    await new Promise(r => setTimeout(r, wait));
    const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({
      client_id: CLIENT_ID, device_code: code.device_code, scopes: SCOPES.join(' '),
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) }).catch(() => undefined);
    if (!r) continue;
    const j = await r.json().catch(() => ({}));
    if (j.access_token) return accountFor(j.access_token, j.refresh_token);
    if (j.message === 'slow_down') wait += 5000;
    else if (j.message !== 'authorization_pending') throw new Error(j.message || `HTTP ${r.status}`);
  }
  return undefined;
}
async function accountFor(token: string, refresh?: string): Promise<Account | undefined> {
  const v = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } }).then(r => r.ok ? r.json() : undefined).catch(() => undefined);
  if (!v?.user_id) return undefined;
  const u = (await helix(`users?id=${v.user_id}`, token))?.data?.[0];
  return { token, refresh, login: v.login, userId: v.user_id, name: u?.display_name ?? v.login, avatar: u?.profile_image_url ?? '', scopes: v.scopes ?? [] };
}

/** Public clients refresh without a secret. Returns the new token or undefined (refresh refused). */
export async function refreshToken(): Promise<string | undefined> {
  const a = state.account; if (!a?.refresh) return undefined;
  const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(10000), body: new URLSearchParams({
    client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: a.refresh }) }).catch(() => undefined);
  const j = await r?.json().catch(() => undefined);
  if (!j?.access_token) { log.warn('AUTH', 'Token-Refresh fehlgeschlagen', r ? `HTTP ${r.status} ${j?.message ?? ''}` : 'keine Antwort'); return undefined; }
  log.success('AUTH', 'Token erneuert');
  setAccount({ ...a, token: j.access_token, refresh: j.refresh_token ?? a.refresh });
  return j.access_token;
}
/** Twitch rejected the token and the refresh failed: sign out and say so (oauthExpired in iOS). */
export function sessionExpired() {
  if (!state.account) return;
  log.warn('AUTH', `Anmeldung abgelaufen (${state.account.login})`);
  setAccount(null);
  notice({ kind: 'auth', title: 'Anmeldung abgelaufen', body: 'Bitte in den Einstellungen neu anmelden.' });
}

export async function helix(path: string, token = state.account?.token, init: RequestInit = {}): Promise<any> {
  if (!token) return undefined;
  const call = (t: string) => fetch(`https://api.twitch.tv/helix/${path}`, { ...init,
    headers: { ...(init.headers as any), Authorization: `Bearer ${t}`, 'Client-Id': CLIENT_ID } });
  let r = await call(token).catch(() => undefined);
  if (r?.status === 401 && token === state.account?.token) {
    const t = await refreshToken();
    if (!t) { sessionExpired(); return undefined; }
    r = await call(t).catch(() => undefined);
    if (r?.status === 401) { sessionExpired(); return undefined; }
  }
  if (!r?.ok) return r ? { error: r.status, ...(await r.json().catch(() => ({}))) } : undefined;
  return r.status === 204 ? {} : r.json();
}

// Twitch web's persisted "ChannelFollows" query. Helix channels/followed needs the
// user:read:follows scope, which Twitch never grants the TV client (the device endpoint accepts
// the scope, the token comes back without scopes), and raw GQL `follows` answers "service error"
// for every client id. The persisted query works with the TV token (measured 2026-10-26).
const CHANNEL_FOLLOWS_HASH = 'eecf815273d3d949e5cf0085cc5084cd8a1b5b7b6f7990cf43cb0beadf546907';
/** Why the account's follows couldn't be read (German, shown on Home), or undefined. */
export let accountFollowsError: string | undefined;

async function channelFollowsPage(cursor: string, retried = false): Promise<any> {
  const a = state.account; if (!a) return undefined;
  const r = await fetch('https://gql.twitch.tv/gql', { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Client-ID': CLIENT_ID, Authorization: `OAuth ${a.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ operationName: 'ChannelFollows', variables: { limit: 100, order: 'DESC', ...(cursor ? { cursor } : {}) },
      extensions: { persistedQuery: { version: 1, sha256Hash: CHANNEL_FOLLOWS_HASH } } }]) }).catch(() => undefined);
  if (r?.status === 401) {
    if (!retried && await refreshToken()) return channelFollowsPage(cursor, true);
    sessionExpired(); return undefined;
  }
  return (await r?.json().catch(() => undefined))?.[0];
}

/** Channels the account follows on Twitch (logins, newest first, at most 1000). */
export async function loadAccountFollows() {
  if (!state.account) return;
  const out: string[] = [];
  let cursor = '', err: string | undefined;
  do {
    const j = await channelFollowsPage(cursor);
    const f = j?.data?.user?.follows;
    if (!f) { err = j?.errors?.map((e: any) => e.message).join(' · ') || 'keine Antwort'; break; }
    out.push(...f.edges.map((e: any) => e.node?.login).filter(Boolean));
    cursor = f.pageInfo?.hasNextPage ? f.edges[f.edges.length - 1]?.cursor ?? '' : '';
  } while (cursor && out.length < 1000);
  accountFollowsError = err && `Deine Twitch-Follows konnten nicht geladen werden (${err}).`;
  if (!err) state.accountFollows = out; // a failed refresh keeps the last good list
  changed();
}

export async function setChatColor(color: string): Promise<string | undefined> {
  const a = state.account; if (!a) return 'Nicht angemeldet';
  const j = await helix(`chat/color?user_id=${a.userId}&color=${encodeURIComponent(color)}`, a.token, { method: 'PUT' });
  return j?.error ? (j.message || `Fehler ${j.error}`) : undefined;
}
