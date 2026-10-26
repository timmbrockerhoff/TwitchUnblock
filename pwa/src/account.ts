// Twitch login without a client secret: OAuth device code flow with the app's public client
// (the browser can't use the iOS app's redirect page, which hands the token to twitchunblock://).
import { HELIX_CLIENT_ID } from './twitch';
import { state, setAccount, changed, type Account } from './store';

export const SCOPES = ['user:read:follows', 'chat:read', 'chat:edit', 'user:manage:chat_color'];

export type DeviceCode = { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number };
export async function startDeviceLogin(): Promise<DeviceCode> {
  const r = await fetch('https://id.twitch.tv/oauth2/device', { method: 'POST',
    body: new URLSearchParams({ client_id: HELIX_CLIENT_ID, scopes: SCOPES.join(' ') }) });
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
      client_id: HELIX_CLIENT_ID, device_code: code.device_code, scopes: SCOPES.join(' '),
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

/** Public clients refresh without a secret. Returns the new token or undefined (signed out). */
async function refreshToken(): Promise<string | undefined> {
  const a = state.account; if (!a?.refresh) return undefined;
  const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({
    client_id: HELIX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: a.refresh }) }).catch(() => undefined);
  const j = await r?.json().catch(() => undefined);
  if (!j?.access_token) return undefined;
  setAccount({ ...a, token: j.access_token, refresh: j.refresh_token ?? a.refresh });
  return j.access_token;
}

export async function helix(path: string, token = state.account?.token, init: RequestInit = {}): Promise<any> {
  if (!token) return undefined;
  const call = (t: string) => fetch(`https://api.twitch.tv/helix/${path}`, { ...init,
    headers: { ...(init.headers as any), Authorization: `Bearer ${t}`, 'Client-Id': HELIX_CLIENT_ID } });
  let r = await call(token).catch(() => undefined);
  if (r?.status === 401 && token === state.account?.token) {
    const t = await refreshToken();
    if (!t) { setAccount(null); return undefined; }
    r = await call(t).catch(() => undefined);
  }
  if (!r?.ok) return r ? { error: r.status, ...(await r.json().catch(() => ({}))) } : undefined;
  return r.status === 204 ? {} : r.json();
}

/** Channels the account follows on Twitch (read-only: Helix has no follow/unfollow any more). */
export async function loadAccountFollows() {
  const a = state.account; if (!a) return;
  const out: string[] = [];
  let cursor = '';
  do {
    const j = await helix(`channels/followed?user_id=${a.userId}&first=100${cursor ? '&after=' + cursor : ''}`);
    if (!j?.data) break;
    out.push(...j.data.map((f: any) => f.broadcaster_login));
    cursor = j.pagination?.cursor ?? '';
  } while (cursor && out.length < 1000);
  state.accountFollows = out;
  changed();
}

export async function setChatColor(color: string): Promise<string | undefined> {
  const a = state.account; if (!a) return 'Nicht angemeldet';
  const j = await helix(`chat/color?user_id=${a.userId}&color=${encodeURIComponent(color)}`, a.token, { method: 'PUT' });
  return j?.error ? (j.message || `Fehler ${j.error}`) : undefined;
}
