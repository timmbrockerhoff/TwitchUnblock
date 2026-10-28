// Navigation: one stack per tab (like MainTabView's NavigationStack per tab) and the player on top.
// Browser history mirrors pushes so the back gesture/button pops.
import { changed } from './store';
import type { Clip } from './twitch';
import type { RecoveredVod } from './vod';

export type Tab = 'home' | 'browse' | 'library';
export type Route =
  | { name: 'root' }
  | { name: 'channel'; login: string }
  | { name: 'category'; id: string; title: string }
  | { name: 'list'; kind: 'live' | 'offline' | 'top' }
  | { name: 'settings' }
  | { name: 'logs' };
export type PlayerTarget =
  | { kind: 'live'; login: string }
  | { kind: 'vod'; id: string; start?: number; queue?: string[] } // queue: VOD ids that follow ("Alle abspielen")
  | { kind: 'recovered'; vod: RecoveredVod }
  | { kind: 'clip'; slug: string }
  | { kind: 'clips'; clips: Clip[]; index: number }
  | { kind: 'multi'; logins: MultiEntry[] };
/** Multi-live tile: a channel's live, or a VOD by id. */
export type MultiEntry = string | { vod: string };

export const nav = {
  tab: 'home' as Tab,
  stacks: { home: [{ name: 'root' }], browse: [{ name: 'root' }], library: [{ name: 'root' }] } as Record<Tab, Route[]>,
  player: null as PlayerTarget | null,
  playerMin: false,
};
const top = () => nav.stacks[nav.tab];
export const current = () => top()[top().length - 1];

export function push(r: Route) {
  top().push(r);
  history.pushState({ depth: top().length }, '');
  changed(); scrollTo(0, 0);
}
export function pop() { if (top().length > 1) history.back(); }
export function setTab(t: Tab) {
  if (nav.tab === t) nav.stacks[t] = [{ name: 'root' }]; // tap on the active tab: back to its root
  nav.tab = t;
  if (nav.player) nav.playerMin = true;
  changed(); scrollTo(0, 0);
}
export function play(t: PlayerTarget) {
  nav.player = t; nav.playerMin = false;
  history.pushState({ player: true }, '');
  changed();
}
export function closePlayer() { nav.player = null; nav.playerMin = false; changed(); }
export function minimizePlayer(min = true) { nav.playerMin = min; changed(); }
/** Channel page on the current tab; reduces the player first (openChannelPage). */
export function openChannel(login: string) {
  if (nav.player) nav.playerMin = true;
  push({ name: 'channel', login });
}
addEventListener('popstate', () => {
  if (nav.player && !nav.playerMin) { nav.playerMin = true; changed(); return; }
  if (top().length > 1) { top().pop(); changed(); }
});
