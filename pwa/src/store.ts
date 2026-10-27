// App state, all in localStorage (history ≤ 500 entries is ~150 KB). History and progress were
// in IndexedDB first, but in the Simulator IndexedDB hung after Safari was killed and every
// later write was lost without an error; localStorage is synchronous and can't hang.
// A tiny observable replaces the Swift AppStore's @Published fields.
import { get } from 'idb-keyval';
import { rankSources } from './logic';
import { useEffect, useState } from 'preact/hooks';
import type { LiveSource } from './twitch';

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
const defaults: Settings = {
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

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback as any, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}
function loadArr<T>(key: string): T[] { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }

export const state = {
  settings: load<Settings>('settings', defaults),
  follows: loadArr<string>('follows'),                // local follows (no account needed)
  hiddenChannels: loadArr<string>('hiddenChannels'),
  hiddenCategories: loadArr<{ id: string; name: string }>('hiddenCategories'),
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
  progress: (() => { try { return JSON.parse(localStorage.getItem('progress') || '{}') as Record<string, number>; } catch { return {}; } })(), // vod id → seconds
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

function persist(key: keyof typeof state) {
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

export const isFollowed = (login: string) => state.follows.includes(login) || state.accountFollows.includes(login);
export function toggleFollow(login: string) {
  state.follows = state.follows.includes(login) ? state.follows.filter(l => l !== login) : [...state.follows, login];
  persist('follows');
}
export function hideChannel(login: string, hide = true) {
  state.hiddenChannels = hide ? [...new Set([...state.hiddenChannels, login])] : state.hiddenChannels.filter(l => l !== login);
  persist('hiddenChannels');
}
export function hideCategory(c: { id: string; name: string }, hide = true) {
  state.hiddenCategories = hide ? [...state.hiddenCategories.filter(x => x.id !== c.id), c] : state.hiddenCategories.filter(x => x.id !== c.id);
  persist('hiddenCategories');
}
export function toggleFavCategory(c: { id: string; name: string; boxArt: string }) {
  state.favCategories = state.favCategories.some(x => x.id === c.id) ? state.favCategories.filter(x => x.id !== c.id) : [...state.favCategories, c];
  persist('favCategories');
}

/** Ad breaks seen per live source and how long it played (LiveAdStats in the Swift app). */
type AdStats = Record<string, [number, number]>; // source → [breaks, seconds watched]
const adStats: AdStats = (() => { try { return JSON.parse(localStorage.getItem('liveAdStats') || '{}'); } catch { return {}; } })();
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
export const isPinned = (login: string) => state.pinned.includes(login);
export function togglePin(login: string) {
  state.pinned = isPinned(login) ? state.pinned.filter(l => l !== login) : [login, ...state.pinned];
  persist('pinned');
}
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

// History and progress: written at most every 2 s (the Swift app saves debounced too).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem('history', JSON.stringify(state.history)); localStorage.setItem('progress', JSON.stringify(state.progress)); } catch { /* full or blocked */ }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 2000); }
/** One-time move of history/progress from the IndexedDB of the first web version (2 s limit). */
export async function loadDB() {
  if (localStorage.getItem('history') !== null) return;
  const timeout = new Promise<undefined>(r => setTimeout(() => r(undefined), 2000));
  try {
    const [h, p] = await Promise.race([Promise.all([get('history'), get('progress')]), timeout.then(() => [undefined, undefined])]);
    if (h?.length) state.history = h;
    if (p) state.progress = p;
  } catch { /* no IndexedDB */ }
  saveNow(); changed();
}
export function addHistory(e: Omit<HistoryEntry, 'at'>) {
  state.history = [{ ...e, at: Date.now() }, ...state.history.filter(h => !(h.kind === e.kind && h.id === e.id))].slice(0, 500);
  saveSoon(); changed();
}
export function removeHistory(kind: string, id: string) {
  state.history = state.history.filter(h => !(h.kind === kind && h.id === id));
  if (kind === 'vod') delete state.progress[id];
  saveSoon(); changed();
}
export function clearHistory() { state.history = []; state.progress = {}; saveSoon(); changed(); }
/** Progress isn't app-wide reactive per tick (same fix as the Swift app): only saved. */
export function setProgress(id: string, sec: number) { state.progress[id] = Math.floor(sec); saveSoon(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
addEventListener('pagehide', saveNow);

/** Backup file (Settings → Daten): everything except the login. */
export function exportBackup(): string {
  const { settings, follows, hiddenChannels, hiddenCategories, history, progress } = state;
  return JSON.stringify({ app: 'TwitchUnblock-PWA', v: 1, settings, follows, hiddenChannels, hiddenCategories, history, progress }, null, 1);
}
export function importBackup(text: string): boolean {
  try {
    const b = JSON.parse(text);
    if (b.app !== 'TwitchUnblock-PWA') return false;
    state.settings = { ...defaults, ...b.settings };
    state.follows = b.follows ?? []; state.hiddenChannels = b.hiddenChannels ?? []; state.hiddenCategories = b.hiddenCategories ?? [];
    state.history = b.history ?? []; state.progress = b.progress ?? {};
    (['settings', 'follows', 'hiddenChannels', 'hiddenCategories'] as const).forEach(k => localStorage.setItem(k, JSON.stringify(state[k])));
    saveNow(); applyAccent(); applyIcon(); changed();
    return true;
  } catch { return false; }
}
