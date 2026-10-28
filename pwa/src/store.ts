// App state, all in localStorage (history ≤ 500 entries is ~150 KB). History and progress were
// in IndexedDB first, but in the Simulator IndexedDB hung after Safari was killed and every
// later write was lost without an error; localStorage is synchronous and can't hang.
// A tiny observable replaces the Swift AppStore's @Published fields.
import { get } from 'idb-keyval';
import { rankSources, isValidLogin } from './logic';
import { useEffect, useState } from 'preact/hooks';
import type { LiveSource } from './twitch';
import { buildBackup, mergeBackup, type Snapshot } from './backup';

export type Settings = {
  accent: string;
  sourceOrder: LiveSource[];         // live source order, first = tried first
  quality: string;                    // "auto" | "source" | "1080" … | "audio"
  lowLatency: boolean;
  adSwitch: boolean;                  // on a detected ad break: mute + try an ad-free backup
  chatFont: number;
  chatTimestamps: boolean;
  chatShowDeleted: boolean;
  chatHideBots: boolean;
  chatTranslate: boolean;
  chatHidden: boolean;
  landscapeChat: 'column' | 'overlay' | 'hidden'; // landscape: beside the video, over it (translucent), or closed
  topLang: string;                    // "" = world
  notifyLive: boolean;
  speed: number;
  adRanking: boolean;                 // order proxies by measured ad breaks (rankByAds)
  fillScreen: boolean;                // landscape: video fills the area (pinch out), cropped
  autoPoints: boolean;                // claim channel point chests (rewards.ts)
  autoDrops: boolean;                 // claim finished drops
  dropsStream: boolean;               // hidden account stream so drop minutes count
  appIcon: string;                    // Home Screen icon variant, '' = default (ICONS)
  // Shared contract for the iOS parity work (AppStore.swift names): chat behaviour, chat sizes,
  // notice toggles, home/browse options. Owned here so every screen uses the same keys.
  chatLoadRecent: boolean;            // load recent messages (robotty) on open
  chatAutocomplete: boolean;          // emote / @mention completion chips
  chatHideCommands: boolean;          // "!commands" separate from bots, like iOS
  chatMutedWords: string[];
  chatBlockedUsers: string[];         // logins hidden in chat (≤ 500)
  chatHighlightWords: string[];
  chatSyncNudge: number;              // manual ±20 s trim on the chat delay
  chatSpacing: number;                // row spacing 0–8 px
  chatBadgeScale: number;             // 0.7–1.5
  chatEmoteScale: number;             // 0.7–1.5
  chatWidth: number;                  // landscape chat column 0.20–0.60
  chatOnly: boolean;                  // "Nur Chat": video hidden, chat full height
  showPinned: boolean;
  showDropsNotice: boolean;
  showStreak: boolean;
  showEvents: boolean;                // polls + predictions
  enableRaids: boolean;
  multiLiveChat: boolean;
  homeListLayout: 'grid' | 'list';    // "Alle" lists on Home
  showRecentChannels: boolean;        // "Zuletzt angesehen" chips in search
  categoryLang: string;               // language filter on category pages, '' = all
};
export const defaults: Settings = {
  accent: '#9146ff', sourceOrder: ['as', 'al', 'eu', 'twitch'], quality: 'source', lowLatency: true, adSwitch: true,
  chatFont: 13, chatTimestamps: true, chatShowDeleted: false, chatHideBots: false, chatTranslate: true, chatHidden: false, landscapeChat: 'column',
  topLang: (navigator.language || 'de').slice(0, 2), notifyLive: false, speed: 1, autoPoints: true, autoDrops: true, dropsStream: true, adRanking: true, fillScreen: false, appIcon: '',
  chatLoadRecent: true, chatAutocomplete: true, chatHideCommands: false, chatMutedWords: [], chatBlockedUsers: [], chatHighlightWords: [],
  chatSyncNudge: 0, chatSpacing: 4, chatBadgeScale: 1, chatEmoteScale: 1, chatWidth: 0.32, chatOnly: false,
  showPinned: true, showDropsNotice: true, showStreak: true, showEvents: true, enableRaids: true, multiLiveChat: false,
  homeListLayout: 'grid', showRecentChannels: true, categoryLang: '',
};
export type Account = { token: string; refresh?: string; login: string; userId: string; name: string; avatar: string; scopes: string[] };
export type HistoryEntry = { kind: 'vod' | 'live' | 'clip'; id: string; title: string; login: string; name: string; thumb: string; length?: number; at: number };
/** Hidden category (HiddenContent.swift): `box` empty when hidden from a live card, `at` in ms. */
export type HiddenCategory = { id: string; name: string; box?: string; at?: number };

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback as any, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}
function loadArr<T>(key: string): T[] { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function loadObj<T extends object>(key: string): T { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {} as T; } }

export const state = {
  settings: load<Settings>('settings', defaults),
  follows: loadArr<string>('follows'),                // local follows (no account needed)
  hiddenChannels: loadArr<string>('hiddenChannels'),  // logins, newest first (≤ 500)
  hiddenInfo: loadObj<Record<string, { name: string; at: number }>>('hiddenInfo'), // display name + when, for the backup
  hiddenCategories: loadArr<HiddenCategory>('hiddenCategories'),
  favCategories: loadArr<{ id: string; name: string; boxArt: string }>('favCategories'), // "Deine Kategorien", local
  searchHistory: loadArr<string>('searchHistory'),
  pinned: loadArr<string>('pinned'),                  // streamers pinned to the front of follow lists
  recentChannels: loadArr<string>('recentChannels'),  // last opened channel pages (≤ 10), "Zuletzt angesehen"
  account: (() => {
    try {
      // The earlier second login (TV client, "rewardsAccount") becomes the one login.
      const tv = JSON.parse(localStorage.getItem('rewardsAccount') || 'null');
      if (tv) {
        const a: Account = { token: tv.token, refresh: tv.refresh, login: tv.login, userId: tv.userId, name: tv.login, avatar: '', scopes: [] };
        localStorage.setItem('account', JSON.stringify(a)); localStorage.removeItem('rewardsAccount');
        return a;
      }
      return JSON.parse(localStorage.getItem('account') || 'null') as Account | null;
    } catch { return null; }
  })(),
  accountFollows: [] as string[],
  accountCategories: [] as { id: string; name: string; boxArt: string }[], // followed on Twitch (rewards.ts)
  history: loadArr<HistoryEntry>('history'),
  progress: loadObj<Record<string, number>>('progress'), // vod id → seconds
};

const listeners = new Set<() => void>();
let version = 0;
export function changed() { version++; listeners.forEach(l => l()); }
/** Re-render on any state change. */
export function useStore() {
  const [, setV] = useState(version);
  useEffect(() => { const l = () => setV(version); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return state;
}
/** Called after a local follow/unfollow (follows.ts reloads the live list 1.5 s later). */
export const followListeners = new Set<() => void>();

export function persist(key: keyof typeof state) {
  try { localStorage.setItem(key, JSON.stringify(state[key])); } catch { /* storage full or blocked: keep in memory */ }
  changed();
}
export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  state.settings = { ...state.settings, [k]: v };
  persist('settings');
  if (k === 'accent') applyAccent();
  if (k === 'appIcon') applyIcon();
}
export function applyAccent() { document.documentElement.style.setProperty('--accent', state.settings.accent); }
// Same variants as the iOS app (assets/icons). A web app can't change its installed icon: iOS reads
// the apple-touch-icon only when "Zum Home-Bildschirm" is tapped, so the link must be right by then.
export const ICONS: [string, string][] = [['', 'Klassisch'], ['purple', 'Lila'], ['night', 'Nacht'], ['light', 'Hell'], ['contrast', 'Kontrast'], ['neon', 'Neon']];
export const iconURL = (id: string) => `./icons/${id || 'icon'}-180.png`;
export function applyIcon() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (link) link.href = iconURL(state.settings.appIcon);
}

// Follows, pins ------------------------------------------------------------------------------------
export const isFollowed = (login: string) => state.follows.includes(login) || state.accountFollows.includes(login);
export function toggleFollow(login: string) {
  const l = login.toLowerCase();
  if (state.follows.includes(l)) state.follows = state.follows.filter(x => x !== l);
  else { state.follows = [l, ...state.follows]; unhideChannel(l); } // a followed channel is never hidden
  persist('follows');
  followListeners.forEach(f => f());
}
export const isPinned = (login: string) => state.pinned.includes(login.toLowerCase());
export function togglePin(login: string) {
  const l = login.toLowerCase();
  state.pinned = isPinned(l) ? state.pinned.filter(x => x !== l) : [...state.pinned, l]; // in the order pinned, like iOS
  persist('pinned');
}
/** Followed (account or local) or pinned: never hidden from any list. */
export const isFollowedOrPinned = (login: string) => { const l = login.toLowerCase(); return isFollowed(l) || isPinned(l); };
/** Pinned streamers first (in pin order), the rest in the order given (HomeView.swift:223-240). */
export function sortPinnedFirst<T>(items: T[], login: (t: T) => string): T[] {
  const rank = (t: T) => { const i = state.pinned.indexOf(login(t).toLowerCase()); return i < 0 ? Infinity : i; };
  return items.map((t, i) => ({ t, i, r: rank(t) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.t);
}

// Hidden channels / categories (HiddenContent.swift) ------------------------------------------------
const HIDDEN_MAX = 500, HIDDEN_CAT_MAX = 200;
/** Hidden and not followed/pinned (a follow overrides an older hide, like showsChannel in iOS). */
export const isHiddenChannel = (login: string) => { const l = login.toLowerCase(); return state.hiddenChannels.includes(l) && !isFollowedOrPinned(l); };
export const followsCategory = (id: string) => !!id && (state.favCategories.some(c => c.id === id) || state.accountCategories.some(c => c.id === id));
export const isHiddenCategory = (id: string) => !!id && state.hiddenCategories.some(c => c.id === id) && !followsCategory(id);
/** Hides (or unhides) a channel. Returns false when nothing changed: a followed or pinned
 *  channel is never hidden (hideChannel in AppStore.swift), invalid logins are ignored. */
export function hideChannel(login: string, hide = true, name = ''): boolean {
  const l = login.toLowerCase();
  if (!isValidLogin(l)) return false;
  if (!hide) return unhideChannel(l);
  if (isFollowedOrPinned(l)) return false;
  state.hiddenChannels = [l, ...state.hiddenChannels.filter(x => x !== l)].slice(0, HIDDEN_MAX);
  state.hiddenInfo = { ...state.hiddenInfo, [l]: { name: (name || l).slice(0, 100), at: Date.now() } };
  for (const k of Object.keys(state.hiddenInfo)) if (!state.hiddenChannels.includes(k)) delete state.hiddenInfo[k];
  persist('hiddenInfo'); persist('hiddenChannels');
  return true;
}
export function unhideChannel(login: string): boolean {
  const l = login.toLowerCase();
  if (!state.hiddenChannels.includes(l)) return false;
  state.hiddenChannels = state.hiddenChannels.filter(x => x !== l);
  delete state.hiddenInfo[l];
  persist('hiddenInfo'); persist('hiddenChannels');
  return true;
}
/** Same rules for categories: numeric id, followed ones never hidden, 200 at most. */
export function hideCategory(c: { id: string; name: string; box?: string; boxArt?: string }, hide = true): boolean {
  if (!/^\d{1,20}$/.test(c.id)) return false;
  if (!hide) {
    if (!state.hiddenCategories.some(x => x.id === c.id)) return false;
    state.hiddenCategories = state.hiddenCategories.filter(x => x.id !== c.id);
  } else {
    if (followsCategory(c.id)) return false;
    const box = c.box ?? c.boxArt ?? '';
    state.hiddenCategories = [{ id: c.id, name: c.name.slice(0, 100), box: box.startsWith('https://') ? box : '', at: Date.now() },
      ...state.hiddenCategories.filter(x => x.id !== c.id)].slice(0, HIDDEN_CAT_MAX);
  }
  persist('hiddenCategories');
  return true;
}
export function unhideAll() { state.hiddenChannels = []; state.hiddenInfo = {}; state.hiddenCategories = []; persist('hiddenInfo'); persist('hiddenChannels'); persist('hiddenCategories'); }
export function toggleFavCategory(c: { id: string; name: string; boxArt: string }) {
  state.favCategories = state.favCategories.some(x => x.id === c.id) ? state.favCategories.filter(x => x.id !== c.id) : [...state.favCategories, c];
  persist('favCategories');
}

/** Ad breaks seen per live source and how long it played (LiveAdStats in the Swift app). */
type AdStats = Record<string, [number, number]>; // source → [breaks, seconds watched]
const adStats: AdStats = loadObj<AdStats>('liveAdStats');
let adStatsSaved = 0;
export function recordAdStats(source: string, seconds: number, breaks: number) {
  const v = adStats[source] ?? [0, 0];
  v[0] += breaks; v[1] += seconds; adStats[source] = v;
  // Written at most once a minute (called every 10 s while a live stream plays).
  if (breaks || Date.now() - adStatsSaved > 60000) { adStatsSaved = Date.now(); try { localStorage.setItem('liveAdStats', JSON.stringify(adStats)); } catch {} }
}
export const adStatsFor = (source: string) => adStats[source];
export const rankByAds = <T extends string>(sources: T[]) => rankSources(sources, adStats);

export function addSearch(q: string) {
  state.searchHistory = [q, ...state.searchHistory.filter(x => x !== q)].slice(0, 15);
  persist('searchHistory');
}
export function clearSearchHistory() { state.searchHistory = []; persist('searchHistory'); }
export function addRecentChannel(login: string) {
  state.recentChannels = [login, ...state.recentChannels.filter(l => l !== login)].slice(0, 10);
  persist('recentChannels');
}
export function removeRecentChannel(login: string) { state.recentChannels = state.recentChannels.filter(l => l !== login); persist('recentChannels'); }
export function clearRecentChannels() { state.recentChannels = []; persist('recentChannels'); }
export function setAccount(a: Account | null) {
  state.account = a;
  if (a) localStorage.setItem('account', JSON.stringify(a)); else { localStorage.removeItem('account'); state.accountFollows = []; state.accountCategories = []; }
  changed();
}

// History and progress -------------------------------------------------------------------------------
// History is written 2 s after a change; playback positions at most every 30 s (AppStore.swift
// progressSaveDelay), plus a flush when the page is hidden or unloaded.
const PROGRESS_MAX = 500, PROGRESS_SAVE_MS = 30000;
let historyTimer: ReturnType<typeof setTimeout> | undefined, progressTimer: ReturnType<typeof setTimeout> | undefined;
let progressDirty = false;
function saveHistory() { clearTimeout(historyTimer); historyTimer = undefined; try { localStorage.setItem('history', JSON.stringify(state.history)); } catch { /* full or blocked */ } }
function saveProgress() {
  clearTimeout(progressTimer); progressTimer = undefined;
  if (!progressDirty) return;
  progressDirty = false;
  try { localStorage.setItem('progress', JSON.stringify(state.progress)); } catch { /* full or blocked */ }
  changed(); // views catch up with the positions advanced in memory
}
export function saveNow() { saveHistory(); saveProgress(); }
function historySoon() { clearTimeout(historyTimer); historyTimer = setTimeout(saveHistory, 2000); }
function progressSoon() { progressDirty = true; if (!progressTimer) progressTimer = setTimeout(saveProgress, PROGRESS_SAVE_MS); }
/** Keeps the 500 most recent VODs (ids grow with time), like cappedProgress in iOS. */
export function capProgress(p: Record<string, number>, max = PROGRESS_MAX): Record<string, number> {
  const keys = Object.keys(p);
  if (keys.length <= max) return p;
  return Object.fromEntries(keys.sort((a, b) => Number(b) - Number(a)).slice(0, max).map(k => [k, p[k]]));
}
/** One-time move of history/progress from the IndexedDB of the first web version (2 s limit). */
export async function loadDB() {
  if (localStorage.getItem('history') !== null) return;
  const timeout = new Promise<undefined>(r => setTimeout(() => r(undefined), 2000));
  try {
    const [h, p] = await Promise.race([Promise.all([get('history'), get('progress')]), timeout.then(() => [undefined, undefined])]);
    if (h?.length) state.history = h;
    if (p) state.progress = p;
  } catch { /* no IndexedDB */ }
  progressDirty = true; saveNow(); changed();
}
export function addHistory(e: Omit<HistoryEntry, 'at'>) {
  state.history = [{ ...e, at: Date.now() }, ...state.history.filter(h => !(h.kind === e.kind && h.id === e.id))].slice(0, 500);
  historySoon(); changed();
}
export function removeHistory(kind: string, id: string) {
  state.history = state.history.filter(h => !(h.kind === kind && h.id === id));
  if (kind === 'vod') { delete state.progress[id]; progressDirty = true; saveProgress(); }
  historySoon(); changed();
}
export function clearHistory() { state.history = []; state.progress = {}; progressDirty = true; saveNow(); changed(); }
/** The player calls this on every timeupdate: steps under 5 s are dropped, normal playback stays
 *  in memory (no app-wide redraw), a new VOD or a jump publishes at once (setVodProgress in iOS). */
export function setProgress(id: string, sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return;
  const old = state.progress[id];
  if (old != null && Math.abs(sec - old) < 5) return;
  state.progress[id] = Math.floor(sec);
  if (old == null || sec < old || sec - old >= 60) {
    if (Object.keys(state.progress).length > PROGRESS_MAX) state.progress = capProgress(state.progress);
    changed();
  }
  progressSoon();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
addEventListener('pagehide', saveNow);

// Backup (Settings → Daten): iOS format `twitchunblock-backup`, import merges (backup.ts).
const snapshot = (): Snapshot => ({ settings: state.settings, follows: state.follows, accountFollows: state.accountFollows,
  hiddenChannels: state.hiddenChannels, hiddenInfo: state.hiddenInfo, hiddenCategories: state.hiddenCategories,
  favCategories: state.favCategories, pinned: state.pinned, history: state.history, progress: state.progress });
export const backupFileName = () => `twitchunblock-${new Date().toISOString().slice(0, 10)}.json`;
export function exportBackup(): string { return JSON.stringify(buildBackup(snapshot()), null, 1); }
/** Merges the file into the state; false when it is not a backup. `added`/`skipped` = follows. */
export function importBackup(text: string): { added: number; skipped: number } | false {
  if (text.length > 2_000_000) return false;
  let raw: unknown; try { raw = JSON.parse(text); } catch { return false; }
  const r = mergeBackup(snapshot(), defaults, raw);
  if (!r) return false;
  Object.assign(state, r.snap);
  (['settings', 'follows', 'hiddenChannels', 'hiddenInfo', 'hiddenCategories', 'favCategories', 'pinned'] as const).forEach(persist);
  progressDirty = true; saveNow(); applyAccent(); applyIcon(); changed();
  followListeners.forEach(f => f());
  return { added: r.added, skipped: r.skipped };
}
