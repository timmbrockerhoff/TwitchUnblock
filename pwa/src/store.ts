// App state: settings (localStorage), follows/hidden/account (localStorage), watch history and
// VOD progress (IndexedDB). A tiny observable replaces the Swift AppStore's @Published fields.
import { get, set } from 'idb-keyval';
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
  topLang: string;                    // "" = world
  notifyLive: boolean;
  speed: number;
  autoPoints: boolean;                // claim channel point chests (rewards.ts)
  autoDrops: boolean;                 // claim finished drops
  dropsStream: boolean;               // hidden account stream so drop minutes count
};
const defaults: Settings = {
  accent: '#9146ff', sourceOrder: ['as', 'al', 'eu', 'twitch'], quality: 'source', lowLatency: true, adSwitch: true,
  chatFont: 15, chatTimestamps: false, chatShowDeleted: false, chatHideBots: false, chatTranslate: true, chatHidden: false,
  topLang: (navigator.language || 'de').slice(0, 2), notifyLive: false, speed: 1, autoPoints: true, autoDrops: true, dropsStream: true,
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
  searchHistory: loadArr<string>('searchHistory'),
  account: (() => { try { return JSON.parse(localStorage.getItem('account') || 'null') as Account | null; } catch { return null; } })(),
  accountFollows: [] as string[],
  history: [] as HistoryEntry[],
  progress: {} as Record<string, number>,             // vod id → seconds
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
}
export function applyAccent() { document.documentElement.style.setProperty('--accent', state.settings.accent); }

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
export function addSearch(q: string) {
  state.searchHistory = [q, ...state.searchHistory.filter(x => x !== q)].slice(0, 15);
  persist('searchHistory');
}
export function clearSearchHistory() { state.searchHistory = []; persist('searchHistory'); }
export function setAccount(a: Account | null) {
  state.account = a;
  if (a) localStorage.setItem('account', JSON.stringify(a)); else { localStorage.removeItem('account'); state.accountFollows = []; }
  changed();
}

// History and progress: IndexedDB, written at most every few seconds (the Swift app saves debounced too).
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { set('history', state.history).catch(() => {}); set('progress', state.progress).catch(() => {}); }, 2000);
}
export async function loadDB() {
  try {
    state.history = (await get('history')) ?? [];
    state.progress = (await get('progress')) ?? {};
  } catch { /* private mode without IndexedDB: history stays in memory */ }
  changed();
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { clearTimeout(saveTimer); set('history', state.history).catch(() => {}); set('progress', state.progress).catch(() => {}); }
});

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
    saveSoon(); applyAccent(); changed();
    return true;
  } catch { return false; }
}
