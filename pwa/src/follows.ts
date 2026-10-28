// Followed channels (local + account) with their live state, polled independently of the mounted
// screen (HomeView.swift:92-109): every 3 min, on return to the foreground after 60 s, 1.5 s
// after a follow change. The account's follows are re-read every time (changed on the PC → shows
// up here). Live notifications while the app runs (no push server). Clips of every followed
// channel, 8 channels at a time.
import { useStore, state, changed, followListeners } from './store';
import * as tw from './twitch';
import type { ChannelBrief, Clip } from './twitch';
import { loadAccountFollows } from './account';
import { play } from './nav';
import { log } from './log';

export const follows = {
  /** undefined until the first answer; a failed refresh keeps the last list. */
  list: undefined as ChannelBrief[] | undefined,
  loading: false,
  lastLoad: 0,
  /** "Clips deiner Kanäle": all followed channels, last 24 h, newest first; by login for a picker. */
  clips: undefined as Clip[] | undefined,
  clipsByLogin: {} as Record<string, Clip[]>,
  clipsLoading: false,
};
/** Re-render on changes; returns the module state. */
export function useFollows() { useStore(); return follows; }

export const followedLogins = () => [...new Set([...state.follows, ...state.accountFollows].map(l => l.toLowerCase()))];

const seenLive = new Set<string>();
let inflight: Promise<ChannelBrief[] | undefined> | undefined;
/** Reloads account follows and the live state of every followed channel. One request at a time. */
export function refreshFollows(): Promise<ChannelBrief[] | undefined> {
  if (inflight) return inflight;
  follows.loading = true; changed();
  inflight = (async () => {
    const t0 = Date.now();
    if (state.account) await loadAccountFollows();
    const logins = followedLogins();
    const list = logins.length ? await tw.channels(logins) : [];
    follows.lastLoad = Date.now();
    if (!list) { log.warn('Follows', 'Live-Status nicht lesbar, alte Liste bleibt'); return follows.list; }
    const live = list.filter(c => c.stream);
    log.debug('Follows', `${logins.length} Kanäle, ${live.length} live`, `${Date.now() - t0} ms`);
    // Live notification while the app runs (no push server: see LIMITATIONS.md). Not on the
    // first answer: everything already live would fire at once.
    if (follows.list && state.settings.notifyLive && 'Notification' in window && Notification.permission === 'granted') {
      for (const c of live) if (!seenLive.has(c.login))
        notify(`${c.name} ist live`, { body: c.stream!.title, icon: c.avatar, tag: c.login, data: { login: c.login } });
    }
    seenLive.clear(); live.forEach(c => seenLive.add(c.login)); // a channel that went offline notifies again next time
    follows.list = list;
    return list;
  })().finally(() => { inflight = undefined; follows.loading = false; changed(); });
  return inflight;
}

/** Service-worker notification where it exists (iOS WebKit in the Simulator reported
 *  registration.showNotification as undefined), else the plain constructor. */
async function notify(title: string, opts: NotificationOptions & { data: { login: string } }) {
  const reg = await navigator.serviceWorker?.ready.catch(() => undefined);
  if (typeof reg?.showNotification === 'function') return reg.showNotification(title, opts);
  const n = new Notification(title, opts);
  n.onclick = () => { focus(); play({ kind: 'live', login: opts.data.login }); };
}

let clipsInflight: Promise<Clip[]> | undefined;
/** Every clip of the last 24 h of every followed channel (HomeView.followedClips), 8 channels at a
 *  time so hundreds of follows don't flood the connection; newest first, no duplicates. */
export function loadFollowClips(): Promise<Clip[]> {
  if (clipsInflight) return clipsInflight;
  follows.clipsLoading = true; changed();
  clipsInflight = (async () => {
    const logins = followedLogins();
    const byLogin: Record<string, Clip[]> = {};
    for (let i = 0; i < logins.length; i += 8) {
      const chunk = logins.slice(i, i + 8);
      const parts = await Promise.all(chunk.map(l => tw.clips(l, 'LAST_DAY')));
      parts.forEach((r, j) => { if (r?.clips.length) byLogin[chunk[j]] = [...r.clips].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); });
    }
    const seen = new Set<string>();
    const all = Object.values(byLogin).flat().filter(c => !seen.has(c.slug) && seen.add(c.slug))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    follows.clipsByLogin = byLogin; follows.clips = all;
    return all;
  })().finally(() => { clipsInflight = undefined; follows.clipsLoading = false; changed(); });
  return clipsInflight;
}

// Foreground refresh batch (ForegroundRefresh in TwitchUnblockApp.swift): one batch at a time,
// at most one start per 30 s; a batch stuck longer than 120 s no longer blocks.
let batchStart = 0, batchRunning = false;
export function foregroundRefresh(jobs: (() => Promise<unknown>)[]) {
  const elapsed = Date.now() - batchStart;
  if (elapsed < 30_000 || (batchRunning && elapsed < 120_000)) return;
  const started = batchStart = Date.now(); batchRunning = true;
  Promise.allSettled(jobs.map(j => j())).then(() => { if (batchStart === started) batchRunning = false; });
}

let started = false;
/** Called once from main.tsx. */
export function startFollowPolling(onForeground: () => (() => Promise<unknown>)[] = () => []) {
  if (started) return; started = true;
  refreshFollows();
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - follows.lastLoad >= 170_000) refreshFollows(); }, 180_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const stale = Date.now() - follows.lastLoad > 60_000;
    foregroundRefresh([...(stale ? [refreshFollows] : []), ...onForeground()]);
  });
  // Follow/unfollow or login: Twitch needs a moment before the list reflects it.
  let t: ReturnType<typeof setTimeout> | undefined;
  followListeners.add(() => { clearTimeout(t); t = setTimeout(() => { refreshFollows(); if (follows.clips) loadFollowClips(); }, 1500); });
}
