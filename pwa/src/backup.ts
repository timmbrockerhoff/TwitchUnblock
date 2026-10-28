// Backup file in the iOS format (Backup.swift: `twitchunblock-backup` v1), so one file moves
// between the iPhone app and the web app. Pure functions over a snapshot of the store, so they
// run in Node tests; store.ts wires them to the live state.
import type { Settings, HistoryEntry, HiddenCategory } from './store';

export const BACKUP_FORMAT = 'twitchunblock-backup';
const LEGACY_APP = 'TwitchUnblock-PWA';
const MAX_FOLLOWS = 300, MAX_CATEGORIES = 200, MAX_HIDDEN = 500, MAX_HIDDEN_CATS = 200, MAX_HISTORY = 500, MAX_PROGRESS = 500;

export type Snapshot = {
  settings: Settings; follows: string[]; accountFollows: string[];
  hiddenChannels: string[]; hiddenInfo: Record<string, { name: string; at: number }>; hiddenCategories: HiddenCategory[];
  favCategories: { id: string; name: string; boxArt: string }[]; pinned: string[];
  history: HistoryEntry[]; progress: Record<string, number>;
};
export type ImportResult = { snap: Snapshot; added: number; skipped: number };

const validLogin = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9_]{1,25}$/i.test(s);
const validCategoryId = (s: unknown): s is string => typeof s === 'string' && /^\d{1,20}$/.test(s);
const text = (v: unknown) => (typeof v === 'string' ? v : '').slice(0, 100);
const stamp = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e14 ? Math.floor(v) : 0;
const box = (v: unknown) => typeof v === 'string' && v.startsWith('https://') && v.length <= 500 ? v : '';

/** The file's JSON object. iOS reads the shared keys; `web` carries what only the web app has. */
export function buildBackup(s: Snapshot): Record<string, unknown> {
  const st = s.settings;
  const settings: Record<string, unknown> = {
    // Shared with the site and the iOS app (same names)
    lang: 'de',
    topLang: st.topLang ? st.topLang.replace('-', '_') : null,
    homeList: st.homeListLayout === 'list',
    showRecent: st.showRecentChannels,
    timestamps: st.chatTimestamps,
    keepDeleted: st.chatShowDeleted,
    loadHistory: st.chatLoadRecent,
    hideBots: st.chatHideBots,
    hideCommands: st.chatHideCommands,
    mutedWords: st.chatMutedWords,
    blockedUsers: st.chatBlockedUsers,
    highlightWords: st.chatHighlightWords,
    vodSpeed: st.speed,
    qualityPref: st.quality,
    // iOS keys the web app has a value for (the others are left out so an import never
    // overwrites an iPhone setting with a default)
    ios_autoClaimChest: st.autoPoints,
    ios_showPinned: st.showPinned,
    ios_showDropsNotice: st.showDropsNotice,
    ios_showWatchStreak: st.showStreak,
    ios_showLiveEvents: st.showEvents,
    ios_enableRaids: st.enableRaids,
    ios_lowLatency: st.lowLatency,
    ios_fillScreen: st.fillScreen,
    ios_landscapeChat: st.landscapeChat,
    ios_chatFontSize: st.chatFont,
    ios_chatSpacing: st.chatSpacing,
    ios_chatBadgeScale: st.chatBadgeScale,
    ios_chatEmoteScale: st.chatEmoteScale,
    ios_chatWidthRatio: st.chatWidth,
    ios_chatAutocomplete: st.chatAutocomplete,
    ios_preferAudioOnly: st.quality === 'audio',
  };
  return {
    format: BACKUP_FORMAT, version: 1, platform: 'web', exportedAt: new Date().toISOString(),
    follows: s.follows, accountFollows: s.accountFollows,
    followedCategories: s.favCategories.map(c => ({ id: c.id, name: c.name, box: c.boxArt })),
    hidden: {
      channels: s.hiddenChannels.map(l => ({ login: l, name: s.hiddenInfo[l]?.name ?? l, at: s.hiddenInfo[l]?.at ?? 0 })),
      categories: s.hiddenCategories.map(c => ({ id: c.id, name: c.name, box: c.box ?? '', at: c.at ?? 0 })),
    },
    settings,
    web: { settings: st, pinned: s.pinned, history: s.history, progress: s.progress },
  };
}

/** Merges a backup (iOS or earlier web format) into the snapshot: follows and hidden items are
 *  added, nothing removed, known settings taken over. undefined = not a backup file. */
export function mergeBackup(snap: Snapshot, defaults: Settings, raw: unknown): ImportResult | undefined {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') return undefined;
  const legacy = root.app === LEGACY_APP;
  if (root.format !== BACKUP_FORMAT && !legacy) return undefined;
  const s: Snapshot = { ...snap, settings: { ...snap.settings }, hiddenInfo: { ...snap.hiddenInfo }, progress: { ...snap.progress } };
  const arr = (v: unknown): any[] => Array.isArray(v) ? v : [];

  // Follows: appended, 300 at most on this device (the ones already here all stay).
  const incoming = [...arr(root.follows), ...arr(root.accountFollows)].filter(validLogin).map(l => l.toLowerCase());
  const follows = [...s.follows];
  let fresh = 0;
  for (const l of incoming) if (!follows.includes(l)) { follows.push(l); fresh++; }
  const before = s.follows.length;
  s.follows = follows.slice(0, Math.max(MAX_FOLLOWS, before));
  const added = s.follows.length - before, skipped = fresh - added;

  const cats = [...s.favCategories];
  for (const c of arr(root.followedCategories)) {
    if (!validCategoryId(c?.id) || typeof c.name !== 'string' || cats.some(x => x.id === c.id)) continue;
    cats.push({ id: c.id, name: c.name, boxArt: typeof c.box === 'string' ? c.box : '' });
  }
  s.favCategories = cats.slice(0, MAX_CATEGORIES);

  // Hidden: valid entries added, the most recent hide wins for one already here.
  const chans = new Map(s.hiddenChannels.map(l => [l, { login: l, name: s.hiddenInfo[l]?.name ?? l, at: s.hiddenInfo[l]?.at ?? 0 }]));
  const hiddenIn = legacy ? arr(root.hiddenChannels).map(l => ({ login: l })) : arr(root.hidden?.channels);
  for (const e of hiddenIn) {
    if (!validLogin(e?.login)) continue;
    const l = e.login.toLowerCase(), item = { login: l, name: text(e.name) || l, at: stamp(e.at) };
    const old = chans.get(l);
    if (old && old.at >= item.at) continue;
    chans.set(l, item);
  }
  const chanList = [...chans.values()].sort((a, b) => b.at - a.at).slice(0, MAX_HIDDEN);
  s.hiddenChannels = chanList.map(c => c.login);
  s.hiddenInfo = Object.fromEntries(chanList.map(c => [c.login, { name: c.name, at: c.at }]));
  const hcats = new Map(s.hiddenCategories.map(c => [c.id, { ...c, box: c.box ?? '', at: c.at ?? 0 }]));
  for (const e of legacy ? arr(root.hiddenCategories) : arr(root.hidden?.categories)) {
    if (!validCategoryId(e?.id)) continue;
    const item = { id: e.id, name: text(e.name), box: box(e.box), at: stamp(e.at) };
    const old = hcats.get(e.id);
    if (old && old.at >= item.at) continue;
    hcats.set(e.id, item);
  }
  s.hiddenCategories = [...hcats.values()].sort((a, b) => b.at - a.at).slice(0, MAX_HIDDEN_CATS);

  // Web-only data (own export, or the earlier web format): pins, history, positions.
  const web = legacy ? root : root.web ?? {};
  s.pinned = [...new Set([...s.pinned, ...arr(web.pinned).filter(validLogin).map((l: string) => l.toLowerCase())])];
  const hist = new Map(s.history.map(h => [`${h.kind}/${h.id}`, h]));
  for (const h of arr(web.history)) {
    if (!h || !['vod', 'live', 'clip'].includes(h.kind) || typeof h.id !== 'string') continue;
    const key = `${h.kind}/${h.id}`, old = hist.get(key);
    if (old && old.at >= stamp(h.at)) continue;
    hist.set(key, { kind: h.kind, id: h.id, title: text(h.title), login: text(h.login), name: text(h.name), thumb: typeof h.thumb === 'string' ? h.thumb : '',
      length: typeof h.length === 'number' ? h.length : undefined, at: stamp(h.at) });
  }
  s.history = [...hist.values()].sort((a, b) => b.at - a.at).slice(0, MAX_HISTORY);
  if (web.progress && typeof web.progress === 'object') {
    for (const [id, sec] of Object.entries(web.progress as Record<string, unknown>)) {
      if (!/^\d{1,20}$/.test(id) || typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) continue;
      s.progress[id] = Math.max(s.progress[id] ?? 0, Math.floor(sec));
    }
    const keys = Object.keys(s.progress);
    if (keys.length > MAX_PROGRESS) s.progress = Object.fromEntries(keys.sort((a, b) => Number(b) - Number(a)).slice(0, MAX_PROGRESS).map(k => [k, s.progress[k]]));
  }

  // The web app's own settings come back exactly (every key with the type of its default).
  if (web.settings && typeof web.settings === 'object') {
    for (const [k, v] of Object.entries(web.settings as Record<string, unknown>)) {
      if (k in defaults && typeof v === typeof (defaults as any)[k] && Array.isArray(v) === Array.isArray((defaults as any)[k])) (s.settings as any)[k] = v;
    }
  }
  // Shared iOS keys, validated like Backup.importData.
  const ios = root.settings && typeof root.settings === 'object' && !legacy ? root.settings as Record<string, unknown> : {};
  const bool = (k: string, apply: (v: boolean) => void) => { if (typeof ios[k] === 'boolean') apply(ios[k] as boolean); };
  const num = (k: string, lo: number, hi: number, apply: (v: number) => void) => {
    const v = ios[k]; if (typeof v === 'number' && Number.isFinite(v)) apply(Math.min(hi, Math.max(lo, v)));
  };
  const words = (k: string, max: number, apply: (v: string[]) => void) => {
    if (Array.isArray(ios[k])) apply((ios[k] as unknown[]).filter((w): w is string => typeof w === 'string').map(w => w.toLowerCase()).slice(0, max));
  };
  if (ios.topLang === null) s.settings.topLang = '';
  else if (typeof ios.topLang === 'string') s.settings.topLang = ios.topLang.toLowerCase().replace('_', '-');
  bool('homeList', v => { s.settings.homeListLayout = v ? 'list' : 'grid'; });
  bool('showRecent', v => { s.settings.showRecentChannels = v; });
  bool('timestamps', v => { s.settings.chatTimestamps = v; });
  bool('keepDeleted', v => { s.settings.chatShowDeleted = v; });
  bool('loadHistory', v => { s.settings.chatLoadRecent = v; });
  bool('hideBots', v => { s.settings.chatHideBots = v; });
  bool('hideCommands', v => { s.settings.chatHideCommands = v; });
  words('mutedWords', 50, v => { s.settings.chatMutedWords = v; });
  words('blockedUsers', 500, v => { s.settings.chatBlockedUsers = v; });
  words('highlightWords', 30, v => { s.settings.chatHighlightWords = v; });
  num('vodSpeed', 0.25, 2, v => { s.settings.speed = v; });
  bool('ios_autoClaimChest', v => { s.settings.autoPoints = v; });
  bool('ios_showPinned', v => { s.settings.showPinned = v; });
  bool('ios_showDropsNotice', v => { s.settings.showDropsNotice = v; });
  bool('ios_showWatchStreak', v => { s.settings.showStreak = v; });
  bool('ios_showLiveEvents', v => { s.settings.showEvents = v; });
  bool('ios_enableRaids', v => { s.settings.enableRaids = v; });
  bool('ios_lowLatency', v => { s.settings.lowLatency = v; });
  bool('ios_fillScreen', v => { s.settings.fillScreen = v; });
  if (['column', 'overlay', 'hidden'].includes(ios.ios_landscapeChat as string)) s.settings.landscapeChat = ios.ios_landscapeChat as Settings['landscapeChat'];
  num('ios_chatFontSize', 10, 24, v => { s.settings.chatFont = v; });
  num('ios_chatSpacing', 0, 8, v => { s.settings.chatSpacing = v; });
  num('ios_chatBadgeScale', 0.7, 1.5, v => { s.settings.chatBadgeScale = v; });
  num('ios_chatEmoteScale', 0.7, 1.5, v => { s.settings.chatEmoteScale = v; });
  num('ios_chatWidthRatio', 0.2, 0.6, v => { s.settings.chatWidth = v; });
  bool('ios_chatAutocomplete', v => { s.settings.chatAutocomplete = v; });
  // Preferred quality: a height off the steps takes the nearest one, "source" above 1080.
  const q = ios.qualityPref;
  if (typeof q === 'string') {
    if (['auto', 'source', '1080', '720', '480', '360', '160', 'audio'].includes(q)) s.settings.quality = q;
    else if (/^\d+$/.test(q)) { const h = Number(q); s.settings.quality = h > 1080 ? 'source' : String([1080, 720, 480, 360, 160].reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a)); }
  } else if (typeof ios.ios_preferAudioOnly === 'boolean') {
    if (ios.ios_preferAudioOnly) s.settings.quality = 'audio'; else if (s.settings.quality === 'audio') s.settings.quality = 'source';
  }
  return { snap: s, added, skipped };
}
