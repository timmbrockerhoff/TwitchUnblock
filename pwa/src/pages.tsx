// Screens: Home, Browse (search + categories), Category, Meine VODs, Channel page, Settings.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as tw from './twitch';
import type { ChannelBrief, Stream, Category, Vod, Clip, ChannelInfo } from './twitch';
import { formatViewers, formatDuration, formatOfflineSince, loginFromInput, isValidLogin, isVodInput, extractVodId, clipSlugFromInput, vodStartFromInput } from './logic';
import { useStore, state, setSetting, toggleFollow, isFollowed, hideChannel, hideCategory, toggleFavCategory, adStatsFor, isPinned,
  addRecentChannel, removeRecentChannel, clearRecentChannels,
  setAccount, removeHistory, clearHistory, exportBackup, importBackup, ICONS, iconURL, type HistoryEntry } from './store';
import { startDeviceLogin, pollDeviceLogin, loadAccountFollows, accountFollowsError, setChatColor, type DeviceCode } from './account';
import { play, push, openChannel, type Route } from './nav';
import { rewards, checkDrops, log as rewardsLog, twitchFollowState, setTwitchFollow, loadFollowedGames, setTwitchGameFollow } from './rewards';
import { Page, AccountButton, Shelf, ShelfMenu, Empty, Spinner, LoadMore, ListEndNote, Chip, HiddenFooter, StreamCard, StreamRow, VodCard, ResumeVodCard, ShelfClipCard,
  ClipCard, CategoryTile, OfflineAvatar, pinMenuItem, sortPinnedFirst, useLongPress, Icon, Sheet, Segmented, Toggle, Select, relDate, vodThumb, type CardFlags, type MenuItem } from './ui';
import { logs, clearLogs, logLine } from './log';
import { loadRecoverableStreams, resolveRecoverableStream, type RecoverableStream } from './vod';
import { PushSettings } from './push';
import { ChannelPage } from './channel';
import { Settings, LogsPage } from './settings';
export { ChannelPage, Settings, LogsPage };

// Followed channels (local + account), refreshed every 2 minutes while the app is open.
let followCache: ChannelBrief[] | undefined;
const seenLive = new Set<string>();
async function refreshFollows(): Promise<ChannelBrief[] | undefined> {
  // Followed channels are never hidden (AppStore rule): no hiddenChannels filter here.
  const logins = [...new Set([...state.follows, ...state.accountFollows])];
  const list = await tw.channels(logins);
  if (!list) return followCache;
  // Live notification while the app runs (no push server: see LIMITATIONS.md).
  const live = list.filter(c => c.stream);
  if (followCache && state.settings.notifyLive && 'Notification' in window && Notification.permission === 'granted') {
    for (const c of live) if (!seenLive.has(c.login))
      notify(`${c.name} ist live`, { body: c.stream!.title, icon: c.avatar, tag: c.login, data: { login: c.login } });
  }
  live.forEach(c => seenLive.add(c.login));
  followCache = list;
  return list;
}

/** Service-worker notification where it exists (iOS WebKit in the Simulator reported
 *  registration.showNotification as undefined), else the plain constructor. */
async function notify(title: string, opts: NotificationOptions & { data: { login: string } }) {
  const reg = await navigator.serviceWorker?.ready.catch(() => undefined);
  if (typeof reg?.showNotification === 'function') return reg.showNotification(title, opts);
  const n = new Notification(title, opts);
  n.onclick = () => { focus(); play({ kind: 'live', login: opts.data.login }); };
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): [T | undefined, boolean, () => void] {
  const [v, setV] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => { let alive = true; setLoading(true); fn().then(r => { if (alive) { setV(r); setLoading(false); } }); return () => { alive = false; }; }, [...deps, n]);
  return [v, loading, () => setN(x => x + 1)];
}

// Language of the top lists (TopLanguage.swift): Helix codes, device language, German names.
const TOP_CODES = ['ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no',
  'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'th', 'tl', 'tr', 'uk', 'vi', 'zh', 'zh-hk'];
export function langName(code: string): string {
  try {
    const n = new Intl.DisplayNames(['de'], { type: 'language' }).of(code === 'zh-hk' ? 'zh-HK' : code) ?? code.toUpperCase();
    return n[0].toUpperCase() + n.slice(1);
  } catch { return code.toUpperCase(); }
}
export function deviceLang(): string {
  for (const raw of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const tag = raw.toLowerCase();
    if (/^zh-(hk|mo|hant)/.test(tag)) return 'zh-hk';
    const base = tag.split('-')[0];
    const code = ({ nb: 'no', nn: 'no', fil: 'tl' } as Record<string, string>)[base] ?? base;
    if (TOP_CODES.includes(code)) return code;
  }
  return 'en';
}

// Startseite --------------------------------------------------------------------------------------
export function Home() {
  const s = useStore();
  const [follows, setFollows] = useState(followCache);
  const [failed, setFailed] = useState(false);
  const [top, setTop] = useState<Stream[]>();
  const [clips, setClips] = useState<Clip[]>();
  const [clipChannel, setClipChannel] = useState('');
  const key = [...s.follows, ...s.accountFollows].join(',') + s.hiddenChannels.join(',');
  const load = () => Promise.all([
    refreshFollows().then(r => { setFollows(r); setFailed(r === undefined); }),
    tw.topStreams(s.settings.topLang || undefined).then(r => r && setTop(r.streams)),
  ]);
  useEffect(() => { if (s.account) loadAccountFollows(); }, [s.account?.userId]);
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, [key, s.settings.topLang]);
  // "Clips deiner Kanäle": every clip of the last 24 h of followed channels, newest first, 8 channels at a time.
  useEffect(() => {
    const logins = [...new Set([...s.follows, ...s.accountFollows])].slice(0, 8);
    if (!logins.length) { setClips([]); return; }
    Promise.all(logins.map(l => tw.clips(l, 'LAST_DAY'))).then(r => setClips(r.flatMap(x => x?.clips ?? [])
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))));
  }, [key]);
  const hasFollows = s.follows.length > 0 || !!s.account;
  const live = sortPinnedFirst((follows ?? []).filter(c => c.stream).sort((a, b) => b.stream!.viewers - a.stream!.viewers));
  const offline = sortPinnedFirst((follows ?? []).filter(c => !c.stream));
  const resume = continueWatching(10);
  // Hidden channels and categories are left out and the shelf filled up to 20 (HiddenContent.fill).
  const topVisible = (top ?? []).filter(t => !s.hiddenChannels.includes(t.login) && !s.hiddenCategories.some(c => c.id === t.gameId)).slice(0, 20);
  const local = s.settings.topLang || deviceLang(); // the setting's language, else the device's (TopLanguage.resolved)
  const clipChannels = [...new Map((clips ?? []).map(c => [c.login ?? '', c.name ?? c.login ?? ''])).entries()]
    .filter(([l]) => l).sort((a, b) => a[1].localeCompare(b[1], 'de', { sensitivity: 'base' }));
  const shownClips = clipChannel ? (clips ?? []).filter(c => c.login === clipChannel) : clips ?? [];
  // Account follows still loading: no "nobody live" verdict yet.
  const waiting = follows === undefined || (!!s.account && !s.accountFollows.length && !accountFollowsError && !s.follows.length);
  return <Page title="Startseite" onRefresh={load} trailing={<AccountButton />}>
    {!hasFollows && <div class="login-card"><Icon n="personPlus" size={28} /><div>
      <b>Melde dich an, um deine Lieblingskanäle zu finden.</b>
      <p>Optional: für deine Twitch-Follows, den Chat und Kanalpunkte. Alles andere funktioniert ohne Konto.</p>
      <button class="btn prominent" onClick={() => push({ name: 'settings' })}>Mit Twitch anmelden</button></div></div>}
    {s.account && accountFollowsError && <p class="hint pad">{accountFollowsError}</p>}
    {hasFollows && (live.length > 0
      ? <Shelf title="Jetzt live · Du folgst" onAll={() => push({ name: 'list', kind: 'live' })}>
          {live.map(c => <StreamCard s={{ ...c.stream!, avatar: c.avatar }} width={300} pinnable />)}</Shelf>
      : <section class="shelf"><div class="shelf-head"><h2>Jetzt live</h2></div>
          {waiting && !failed ? <Spinner /> : <p class="hint pad" style={{ fontSize: 15, margin: 0 }}>{failed ? 'Fehler beim Laden der Daten.' : 'Keiner deiner Kanäle ist live'}</p>}</section>)}
    {resume.length > 0 && <Shelf title="Ansehen fortsetzen">{resume.map(h => <ResumeVodCard h={h} />)}</Shelf>}
    {clips && clips.length > 0 && <Shelf title="Clips deiner Kanäle"
      menu={<ShelfMenu value={clipChannel} onChange={setClipChannel} options={[['', 'Alle Kanäle'], ...clipChannels]} />}>
      {shownClips.length ? shownClips.map((c, i) => <ShelfClipCard c={c} onClick={() => play({ kind: 'clips', clips: shownClips, index: i })} />)
        : <p class="hint" style={{ fontSize: 15, margin: 0 }}>Keine Clips in diesem Zeitraum</p>}</Shelf>}
    {(!top || topVisible.length > 0) && <Shelf title="Top-Streams" onAll={() => push({ name: 'list', kind: 'top' })}
      menu={<ShelfMenu value={s.settings.topLang && local} onChange={v => setSetting('topLang', v)} options={[[local, langName(local)], ['', 'Weltweit']]} />}>
      {top ? topVisible.map(t => <StreamCard s={t} width={240} hideable />) : <Spinner />}</Shelf>}
    {offline.length > 0 && <Shelf title={`Offline · ${offline.length}`} onAll={() => push({ name: 'list', kind: 'offline' })}>
      {offline.map(c => <OfflineAvatar c={c} />)}</Shelf>}
  </Page>;
}
/** Started VODs (over a minute, not finished), newest first. */
function continueWatching(limit: number): HistoryEntry[] {
  return state.history.filter(h => h.kind === 'vod' && (state.progress[h.id] ?? 0) > 60 && (!h.length || state.progress[h.id] < h.length * 0.95)).slice(0, limit);
}

/** "Alle" lists of the home shelves: grid of cards or rows (homeListLayout), Top with language chips. */
export function FullList({ kind }: { kind: 'live' | 'offline' | 'top' }) {
  const s = useStore();
  const [top, setTop] = useState<Stream[]>();
  const [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [follows, setFollows] = useState(followCache);
  const [failed, setFailed] = useState(false);
  // Local language or the world, a choice of this page like HomeView.topLang; the language itself is the setting.
  const [world, setWorld] = useState(s.settings.topLang === '');
  const local = s.settings.topLang || deviceLang();
  const lang = world ? undefined : local;
  useEffect(() => {
    if (kind === 'top') { setTop(undefined); setRefused(false); tw.topStreams(lang).then(r => { setTop(r?.streams ?? []); setNext(r?.next); setRefused(!r); }); }
    else refreshFollows().then(r => { setFollows(r); setFailed(r === undefined); });
  }, [kind, lang]);
  const more = async () => {
    setBusy(true);
    const r = await tw.topStreams(lang, next);
    if (r) { setTop(t => [...(t ?? []), ...r.streams.filter(x => !t?.some(y => y.login === x.login))]); setNext(r.next); } else setRefused(true);
    setBusy(false);
  };
  const list = s.settings.homeListLayout === 'list';
  const streams = (items: Stream[], flags: CardFlags) => list
    ? <div class="list">{items.map(x => <StreamRow s={x} {...flags} />)}</div>
    : <div class="grid2">{items.map(x => <StreamCard s={x} wide {...flags} />)}</div>;
  const toggle = kind !== 'offline' && <button class="nav-btn" aria-label={list ? 'Als Raster anzeigen' : 'Als Liste anzeigen'}
    onClick={() => setSetting('homeListLayout', list ? 'grid' : 'list')}><Icon n={list ? 'grid' : 'list'} /></button>;
  const live = sortPinnedFirst((follows ?? []).filter(c => c.stream).map(c => ({ ...c.stream!, avatar: c.avatar })));
  const offline = sortPinnedFirst((follows ?? []).filter(c => !c.stream));
  const noFollows = !s.account && !s.follows.length;
  const title = kind === 'live' ? 'Du folgst' : kind === 'offline' ? 'Offline' : 'Top-Streams';
  return <Page title={title} back large={false} trailing={toggle}>
    {kind === 'live' && (noFollows ? <Empty icon="heart" title="Kanälen ohne Konto folgen" text="Öffne eine Kanalseite und tippe auf „Folgen“: Der Kanal erscheint hier, sobald er live geht." />
      : follows === undefined && !failed ? <Spinner />
      : failed ? <Empty icon="warning" title="Fehler beim Laden der Daten." />
      : live.length ? streams(live, { pinnable: true })
      : <Empty icon="moon" title="Keiner deiner Kanäle ist live" text="Schau dir in der Zwischenzeit die Top-Streams oder die Kategorien an."
          action={offline.length ? `Offline-Kanäle ansehen · ${offline.length}` : undefined} onAction={() => push({ name: 'list', kind: 'offline' })} />)}
    {kind === 'offline' && (follows === undefined && !failed ? <Spinner />
      : failed ? <Empty icon="warning" title="Fehler beim Laden der Daten." />
      : offline.length ? <><h2 class="section-title">Offline · {offline.length}</h2><div class="list">{offline.map(c => <OfflineRow c={c} />)}</div></>
      : live.length ? <Empty icon="antenna" title="Alle deine gefolgten Kanäle sind live!" />
      : <Empty icon="heart" title="Kanälen ohne Konto folgen" text="Öffne eine Kanalseite und tippe auf „Folgen“: Der Kanal erscheint hier, sobald er live geht." />)}
    {kind === 'top' && <>
      <div class="chip-row"><Chip on={!world} onClick={() => setWorld(false)}>{langName(local)}</Chip><Chip on={world} onClick={() => setWorld(true)}>Weltweit</Chip></div>
      {!top ? <Spinner /> : !top.length ? <Empty icon="antenna" title="Gerade sind keine Kanäle live." /> : (() => {
        const shown = top.filter(t => !s.hiddenChannels.includes(t.login) && !s.hiddenCategories.some(c => c.id === t.gameId));
        return <>
          {shown.length ? streams(shown, { hideable: true }) : <Empty icon="antenna" title="Gerade sind keine Kanäle live." />}
          <HiddenFooter count={top.length - shown.length} />
          {next ? <LoadMore busy={busy} onClick={more} /> : refused && <ListEndNote text="Twitch liefert den Rest gerade nicht." />}
        </>;
      })()}
    </>}
  </Page>;
}
/** Offline "Alle" row: dimmed avatar, pin mark, "13 T · 21. Okt.", chevron; long press pins. */
function OfflineRow({ c }: { c: ChannelBrief }) {
  const lp = useLongPress(() => [pinMenuItem(c.login)]);
  const since = formatOfflineSince(c.lastStart);
  return <button class="offline-row" onClick={() => openChannel(c.login)} {...lp}>
    <img class="avatar sm" src={c.avatar} alt="" />
    <div><span class="row-name">{isPinned(c.login) && <Icon n="pin" size={10} />}{c.name}</span>{since && <span class="row-sub">{since}</span>}</div>
    <Icon n="right" size={14} />
  </button>;
}

// Durchsuchen ------------------------------------------------------------------------------------
const myCategories = (s: typeof state) => [...s.favCategories, ...s.accountCategories.filter(a => !s.favCategories.some(f => f.id === a.id))];
export function Browse() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(false); // search mode: field focused or text typed, ended by "Abbrechen"
  const [users, setUsers] = useState<tw.Suggestion[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [top, setTop] = useState<Category[]>();
  const [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const loadTop = () => { setTop(undefined); setFailed(false); return tw.topCategories().then(r => { setTop(r?.categories ?? []); setNext(r?.next); setFailed(!r); }); };
  useEffect(() => { loadTop(); }, []);
  useEffect(() => { if (s.account) loadFollowedGames(); }, [s.account?.userId]);
  const myCats = myCategories(s);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || isVodInput(t) || clipSlugFromInput(t)) { setUsers([]); setCats([]); return; }
    const h = setTimeout(() => { tw.searchUsers(t).then(setUsers); tw.searchCategories(t).then(setCats); }, 300);
    return () => clearTimeout(h);
  }, [q]);
  const open = (login: string) => { addRecentChannel(login); openChannel(login); };
  const submit = (e: Event) => {
    e.preventDefault();
    const t = q.trim(); if (!t) return;
    const slug = clipSlugFromInput(t);
    if (slug) return play({ kind: 'clip', slug });
    if (isVodInput(t)) { const id = extractVodId(t); if (id) return play({ kind: 'vod', id, start: vodStartFromInput(t) }); }
    const login = loginFromInput(t);
    if (isValidLogin(login)) open(login);
  };
  const cancel = () => { setQ(''); setActive(false); input.current?.blur(); };
  const more = async () => {
    setBusy(true);
    const r = await tw.topCategories(next);
    if (r) { setTop(t => [...(t ?? []), ...r.categories.filter(c => !t?.some(x => x.id === c.id))]); setNext(r.next); } else setRefused(true);
    setBusy(false);
  };
  const t = q.trim(), isClip = !!clipSlugFromInput(t), isVod = isVodInput(t);
  const searching = active || t !== '';
  const visibleTop = (top ?? []).filter(c => !s.hiddenCategories.some(h => h.id === c.id));
  return <Page title="Durchsuchen" trailing={<AccountButton />}>
    <form class="search" onSubmit={submit}>
      <input ref={input} type="search" placeholder="Kanäle, Kategorien oder Links" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)}
        onFocus={() => setActive(true)} onBlur={() => { if (!q.trim()) setTimeout(() => setActive(false), 150); }}
        autocapitalize="off" autocorrect="off" spellcheck={false} enterkeyhint="search" />
      {searching && <button type="button" class="search-cancel" onClick={cancel}>Abbrechen</button>}
    </form>
    {searching ? <>
      {t && <button class="hint-line" onClick={submit}><Icon n={isClip ? 'scissors' : isVod ? 'playRect' : 'person'} size={12} />
        {isClip ? 'Öffnet diesen Clip' : isVod ? 'Öffnet dieses VOD' : 'Sucht diesen Kanal'}</button>}
      {!isVod && users.length > 0 && <div class="suggest">{users.slice(0, 5).map(u =>
        <button class="suggest-row" onClick={() => open(u.login)}>
          <img class={'avatar xs' + (u.viewers != null ? ' live-ring' : '')} src={u.avatar} alt="" />
          <div><span class="name">{u.name}{s.hiddenChannels.includes(u.login) && <Icon n="eyeSlash" size={11} />}</span>
            {u.viewers != null && <span class="live-line"><span class="live-tag">LIVE</span>{formatViewers(u.viewers)}{u.game ? ` · ${u.game}` : ''}</span>}</div>
          <Icon n="arrowUpLeft" size={12} />
        </button>)}</div>}
      {cats.length > 0 && <Shelf title="Kategorien">{cats.slice(0, 12).map(c => <CategoryTile c={c} hideable />)}</Shelf>}
      {!users.length && s.settings.showRecentChannels && s.recentChannels.length > 0 && <section>
        <div class="section-head"><h2 class="section-title">Zuletzt angesehen</h2><button class="link danger" onClick={clearRecentChannels}>Löschen</button></div>
        <div class="recent">{s.recentChannels.map(l => <span class="recent-chip" role="button" onClick={() => open(l)}>{l}
          <button class="x" aria-label="Entfernen" onClick={e => { e.stopPropagation(); removeRecentChannel(l); }}><Icon n="close" size={10} /></button></span>)}</div>
      </section>}
    </> : <>
      {myCats.length > 0 && <Shelf title="Deine Kategorien" onAll={() => push({ name: 'category', id: '', title: 'Deine Kategorien' })}>{myCats.map(c => <CategoryTile c={c} />)}</Shelf>}
      <h2 class="section-title">Kategorien</h2>
      {!top ? <Spinner /> : failed ? <Empty icon="warning" title="Fehler beim Laden der Daten." action="Erneut versuchen" onAction={loadTop} /> : <>
        <div class="cat-grid">{visibleTop.map(c => <CategoryTile c={c} hideable />)}</div>
        <HiddenFooter count={top.length - visibleTop.length} />
        {next ? <LoadMore busy={busy} onClick={more} /> : refused && <ListEndNote text={s.account ? 'Twitch liefert den Rest gerade nicht.' : 'Twitch lädt ohne Konto gerade nicht mehr. Melde dich mit Twitch an, um mehr zu sehen.'} />}
      </>}
    </>}
  </Page>;
}

/** Route "category" with an empty id = the "Deine Kategorien" grid (no route of its own in nav.ts). */
export function CategoryPage({ id, title }: { id: string; title: string }) {
  return id ? <CategoryStreams id={id} title={title} /> : <MyCategories />;
}
function MyCategories() {
  const s = useStore();
  const list = myCategories(s);
  return <Page title="Deine Kategorien" back large={false}>
    {list.length ? <div class="cat-grid">{list.map(c => <CategoryTile c={c} />)}</div>
      : <Empty icon="heart" title="Keine gefolgten Kategorien" text={s.account ? 'Folge Kategorien auf Twitch oder öffne eine Kategorie und tippe auf „Folgen“.' : 'Öffne eine Kategorie und tippe auf „Folgen“: Sie erscheint dann hier.'} />}
  </Page>;
}
type StreamSort = 'desc' | 'asc' | 'name';
const SORTS: [StreamSort, string][] = [['desc', 'Meiste Zuschauer'], ['asc', 'Wenigste Zuschauer'], ['name', 'Name (A → Z)']];
function CategoryStreams({ id, title }: { id: string; title: string }) {
  const s = useStore();
  const lang = s.settings.categoryLang;
  const [sort, setSort] = useState<StreamSort>('desc');
  const [data, setData] = useState<{ category: Category; streams: Stream[]; next?: string }>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const load = () => { setData(undefined); setFailed(false); setRefused(false); return tw.categoryStreams(id, lang || undefined).then(r => { setData(r); setFailed(!r); }); };
  useEffect(() => { load(); }, [id, lang]);
  const more = async () => {
    if (!data?.next) return;
    setBusy(true);
    const r = await tw.categoryStreams(id, lang || undefined, data.next);
    if (r) setData({ ...r, streams: [...data.streams, ...r.streams.filter(x => !data.streams.some(y => y.login === x.login))] }); else setRefused(true);
    setBusy(false);
  };
  // Logged in, the heart follows on Twitch (like channels); without login or when Twitch's list can't
  // be read it stays local, a failed follow falls back to local with a hint.
  const [twc, setTwc] = useState<{ failed?: boolean; busy?: boolean; err?: string }>({});
  useEffect(() => { setTwc({}); if (s.account) loadFollowedGames().then(ok => !ok && setTwc({ failed: true })); }, [id, s.account?.userId]);
  const hidden = s.hiddenCategories.some(c => c.id === id);
  const local = s.favCategories.some(c => c.id === id), onTwitch = s.accountCategories.some(c => c.id === id);
  const fav = local || onTwitch;
  const name = data?.category.name ?? title;
  const toggleFav = async () => {
    if (fav && !confirm(`${name} entfolgen?`)) return;
    const c = { id, name, boxArt: data?.category.boxArt ?? '' };
    if (local) toggleFavCategory(c);
    if (!s.account || twc.failed || twc.busy || (local && !onTwitch)) { if (!local) toggleFavCategory(c); return; }
    setTwc({ busy: true });
    const err = await setTwitchGameFollow(c, !onTwitch);
    if (err && !onTwitch) toggleFavCategory(c);
    setTwc({ err });
  };
  const device = deviceLang();
  const others = TOP_CODES.filter(c => c !== device).map(c => [c, langName(c)] as [string, string]).sort((a, b) => a[1].localeCompare(b[1], 'de'));
  const shown = (() => {
    const list = (data?.streams ?? []).filter(x => !s.hiddenChannels.includes(x.login));
    return sort === 'desc' ? [...list].sort((a, b) => b.viewers - a.viewers) : sort === 'asc' ? [...list].sort((a, b) => a.viewers - b.viewers)
      : [...list].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  })();
  return <Page title={title} back large={false} trailing={<>
    {!fav && !hidden && <button class="nav-btn" aria-label="Diese Kategorie ausblenden" onClick={() => hideCategory({ id, name })}><Icon n="eyeSlash" /></button>}
    <button class={'nav-btn' + (fav ? ' danger' : '')} aria-label={fav ? 'Folge ich' : 'Folgen'} disabled={twc.busy} onClick={toggleFav}><Icon n={fav ? 'heart' : 'heartOutline'} /></button></>}>
    {hidden && !fav && <div class="cat-strip"><button class="chip" onClick={() => hideCategory({ id, name }, false)}><Icon n="eye" size={14} />Ausgeblendet · Wieder anzeigen</button></div>}
    {twc.err && <p class="hint pad error">Twitch hat abgelehnt ({twc.err}), {onTwitch ? 'du folgst der Kategorie dort weiter' : 'die Kategorie ist nur in dieser App gemerkt'}.</p>}
    {twc.failed && <p class="hint pad error">Gefolgte Kategorien von Twitch nicht lesbar, das Herz merkt die Kategorie deshalb nur in dieser App.</p>}
    <div class="chip-row">
      <label class={'chip menu' + (lang ? ' on' : '')}><Icon n="globe" size={13} />{lang ? langName(lang) : 'Alle Sprachen'}<Icon n="down" size={10} />
        <select value={lang} onChange={e => setSetting('categoryLang', (e.target as HTMLSelectElement).value)}>
          <option value="">Alle Sprachen</option><option value={device}>{langName(device)}</option><option disabled>──────</option>
          {others.map(([c, n]) => <option value={c}>{n}</option>)}</select></label>
      {SORTS.map(([v, l]) => <Chip on={sort === v} onClick={() => setSort(v)}>{l}</Chip>)}
    </div>
    {!data ? (failed ? <Empty icon="warning" title="Fehler beim Laden der Daten." action="Erneut versuchen" onAction={load} /> : <Spinner />)
      : !shown.length ? <Empty icon="antenna" title="Gerade sind keine Kanäle live." />
      : <div class="grid2">{shown.map(x => <StreamCard s={x} wide hideable hideCategory={false} />)}</div>}
    {data && <HiddenFooter count={data.streams.length - shown.length} />}
    {data?.next ? <LoadMore busy={busy} onClick={more} /> : refused && <ListEndNote text="Twitch liefert den Rest gerade nicht." />}
  </Page>;
}

// Meine VODs -------------------------------------------------------------------------------------
export function Library() {
  const s = useStore();
  const vods = s.history.filter(h => h.kind === 'vod');
  // Days of watching; "Diese Woche" is the calendar week (Monday start), like Calendar.weekOfYear.
  const groups = useMemo(() => {
    const now = new Date(), day = 86400000;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = today - ((now.getDay() + 6) % 7) * day;
    const out: [string, HistoryEntry[]][] = [['Heute', []], ['Gestern', []], ['Diese Woche', []], ['Früher', []]];
    for (const h of vods) out[h.at >= today ? 0 : h.at >= today - day ? 1 : h.at >= weekStart ? 2 : 3][1].push(h);
    return out.filter(g => g[1].length);
  }, [s.history]);
  const resume = continueWatching(15);
  return <Page title="Meine VODs" trailing={<AccountButton />}>
    {!vods.length ? <Empty icon="film" title="Noch kein VOD in deinem Verlauf." text="VODs, die du abspielst, erscheinen hier und laufen dort weiter, wo du aufgehört hast." /> : <>
      {resume.length > 0 && <Shelf title="Ansehen fortsetzen">{resume.map(h => <ResumeVodCard h={h} />)}</Shelf>}
      <div class="section-head"><h2 class="section-title">Verlauf</h2><button class="link danger" onClick={() => confirm('Verlauf löschen?') && clearHistory()}>Löschen</button></div>
      {groups.map(([title, items]) => <section><div class="group-label">{title}</div>{items.map(h => <VodRow h={h} />)}</section>)}
    </>}
  </Page>;
}
/** LibraryView.row: thumb 116×65 with the watched bar, title, streamer, clock "12min / 3h 10min"; long press = menu. */
function VodRow({ h }: { h: HistoryEntry }) {
  const lp = useLongPress((): MenuItem[] => [
    { label: 'Zum Multi-Live hinzufügen', icon: 'grid', onSelect: () => play({ kind: 'multi', logins: [h.login] }) },
    { label: 'Aus dem Verlauf entfernen', icon: 'trash', danger: true, onSelect: () => removeHistory('vod', h.id) }]);
  const p = state.progress[h.id];
  return <button class="vod-row" onClick={() => play({ kind: 'vod', id: h.id })} {...lp}>
    <div class="thumb"><img loading="lazy" src={vodThumb(h)} alt="" />
      {p > 1 && h.length ? <div class="progress"><div style={{ width: `${Math.min(100, p / h.length * 100)}%` }} /></div> : null}</div>
    <div class="row-body"><div class="card-title">{h.title || h.name}</div>{h.name && <span class="streamer">{h.name}</span>}
      <div class="meta-line">{h.length ? <span><Icon n="clock" size={11} />{formatDuration(p ?? 0)} / {formatDuration(h.length)}</span> : null}</div></div>
  </button>;
}

export function RoutePage({ r }: { r: Route }) {
  switch (r.name) {
    case 'channel': return <ChannelPage login={r.login} />;
    case 'category': return <CategoryPage id={r.id} title={r.title} />;
    case 'list': return <FullList kind={r.kind} />;
    case 'settings': return <Settings />;
    case 'logs': return <LogsPage />;
    default: return null;
  }
}
