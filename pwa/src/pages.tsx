// Screens: Home, Browse (search + categories), Category, Meine VODs, Channel page, Settings.
import { useEffect, useMemo, useState } from 'preact/hooks';
import * as tw from './twitch';
import type { ChannelBrief, Stream, Category, Clip } from './twitch';
import { formatViewers, loginFromInput, isValidLogin, isVodInput, extractVodId, clipSlugFromInput, vodStartFromInput } from './logic';
import { useStore, state, setSetting, hideCategory, addSearch, clearSearchHistory, toggleFavCategory, removeHistory, type HistoryEntry } from './store';
import { loadAccountFollows, accountFollowsError } from './account';
import { play, push, openChannel, type Route } from './nav';
import { loadFollowedGames, setTwitchGameFollow } from './rewards';
import { Page, AccountButton, Shelf, Empty, Spinner, StreamCard, VodCard, ClipCard, CategoryTile, Icon, Segmented, relDate } from './ui';
import { ChannelPage } from './channel';
import { Settings, LogsPage } from './settings';
export { ChannelPage, Settings, LogsPage };

const LANGS: [string, string][] = [['', 'Weltweit'], ['de', 'Deutsch'], ['en', 'Englisch'], ['fr', 'Französisch'], ['es', 'Spanisch'],
  ['pt', 'Portugiesisch'], ['it', 'Italienisch'], ['ru', 'Russisch'], ['ja', 'Japanisch'], ['ko', 'Koreanisch'], ['tr', 'Türkisch'], ['pl', 'Polnisch']];

// Followed channels (local + account), refreshed every 2 minutes while the app is open.
let followCache: ChannelBrief[] | undefined;
const seenLive = new Set<string>();
async function refreshFollows(): Promise<ChannelBrief[] | undefined> {
  const logins = [...new Set([...state.follows, ...state.accountFollows])].filter(l => !state.hiddenChannels.includes(l));
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

// Startseite --------------------------------------------------------------------------------------
export function Home() {
  const s = useStore();
  const [follows, setFollows] = useState(followCache);
  const [top, setTop] = useState<Stream[]>();
  const [clips, setClips] = useState<Clip[]>();
  const key = [...s.follows, ...s.accountFollows].join(',') + s.hiddenChannels.join(',');
  const load = () => Promise.all([
    refreshFollows().then(setFollows),
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
  const live = (follows ?? []).filter(c => c.stream).sort((a, b) => b.stream!.viewers - a.stream!.viewers);
  const offline = (follows ?? []).filter(c => !c.stream);
  const resume = continueWatching();
  const topVisible = (top ?? []).filter(t => !s.hiddenChannels.includes(t.login) && !s.hiddenCategories.some(c => c.id === t.gameId));
  return <Page title="Startseite" onRefresh={load} trailing={<AccountButton />}>
    {!s.follows.length && !s.account && <div class="callout">
      <p>Folge Kanälen über das Herz auf ihrer Seite oder melde dich mit Twitch an, um deine Kanäle hier zu sehen.</p>
      <button class="btn prominent" onClick={() => push({ name: 'settings' })}>Mit Twitch anmelden</button></div>}
    {follows === undefined && (s.follows.length > 0 || s.account) && <Spinner />}
    {s.account && accountFollowsError && <p class="hint pad">{accountFollowsError}</p>}
    {live.length > 0 && <Shelf title="Jetzt live · Du folgst" onAll={() => push({ name: 'list', kind: 'live' })}>
      {live.map(c => <StreamCard s={{ ...c.stream!, avatar: c.avatar }} />)}</Shelf>}
    {follows && live.length === 0 && (s.follows.length > 0 || s.accountFollows.length > 0) && <p class="hint pad">Gerade ist keiner deiner Kanäle live.</p>}
    {resume.length > 0 && <Shelf title="Ansehen fortsetzen">{resume.map(h => <VodCard v={{ id: h.id, title: h.title, thumb: h.thumb, publishedAt: '', length: h.length ?? 0, name: h.name }} />)}</Shelf>}
    {clips && clips.length > 0 && <Shelf title="Clips deiner Kanäle">
      {clips.slice(0, 30).map((c, i) => <ClipCard c={c} onClick={() => play({ kind: 'clips', clips, index: i })} />)}</Shelf>}
    <section class="shelf">
      <div class="shelf-head"><h2>Top-Streams</h2>
        <select class="inline-select" value={s.settings.topLang} onChange={e => setSetting('topLang', (e.target as HTMLSelectElement).value)}>
          {LANGS.map(([v, l]) => <option value={v}>{l}</option>)}</select>
        <button class="link" onClick={() => push({ name: 'list', kind: 'top' })}>Alle</button></div>
      <div class="shelf-row">{top ? topVisible.map(t => <StreamCard s={t} />) : <Spinner />}</div>
    </section>
    {offline.length > 0 && <Shelf title="Offline" onAll={() => push({ name: 'list', kind: 'offline' })}>
      {offline.map(c => <button class="avatar-tile" onClick={() => openChannel(c.login)}><img class="avatar lg" src={c.avatar} alt="" /><span>{c.name}</span></button>)}</Shelf>}
  </Page>;
}
function continueWatching(): HistoryEntry[] {
  return state.history.filter(h => h.kind === 'vod' && (state.progress[h.id] ?? 0) > 60 && (!h.length || state.progress[h.id] < h.length * 0.95)).slice(0, 20);
}

/** "Alle" lists of the home shelves, as a grid. */
export function FullList({ kind }: { kind: 'live' | 'offline' | 'top' }) {
  const s = useStore();
  const [top, setTop] = useState<Stream[]>([]);
  const [next, setNext] = useState<string>();
  const [follows, setFollows] = useState(followCache);
  useEffect(() => {
    if (kind === 'top') tw.topStreams(s.settings.topLang || undefined).then(r => { if (r) { setTop(r.streams); setNext(r.next); } });
    else refreshFollows().then(setFollows);
  }, [kind]);
  const more = () => tw.topStreams(s.settings.topLang || undefined, next).then(r => { if (r) { setTop(t => [...t, ...r.streams.filter(x => !t.some(y => y.login === x.login))]); setNext(r.next); } });
  const title = kind === 'live' ? 'Jetzt live' : kind === 'offline' ? 'Offline' : 'Top-Streams';
  return <Page title={title} back>
    <div class="grid">
      {kind === 'top' && top.filter(t => !s.hiddenChannels.includes(t.login)).map(t => <StreamCard s={t} wide />)}
      {kind === 'live' && (follows ?? []).filter(c => c.stream).map(c => <StreamCard s={{ ...c.stream!, avatar: c.avatar }} wide />)}
    </div>
    {kind === 'offline' && <div class="list">{(follows ?? []).filter(c => !c.stream).map(c =>
      <button class="list-row" onClick={() => openChannel(c.login)}><img class="avatar sm" src={c.avatar} alt="" /><div><div>{c.name}</div>
        <div class="row-sub">{c.lastStart ? 'Zuletzt live ' + relDate(c.lastStart) : 'Offline'}</div></div></button>)}</div>}
    {kind === 'top' && next && <button class="btn wide" onClick={more}>Mehr laden</button>}
  </Page>;
}

// Durchsuchen ------------------------------------------------------------------------------------
export function Browse() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<tw.Suggestion[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [top, setTop] = useState<Category[]>();
  const [next, setNext] = useState<string>();
  useEffect(() => { tw.topCategories().then(r => { if (r) { setTop(r.categories); setNext(r.next); } }); }, []);
  useEffect(() => { if (s.account) loadFollowedGames(); }, [s.account?.userId]);
  const myCats = [...s.favCategories, ...s.accountCategories.filter(a => !s.favCategories.some(f => f.id === a.id))];
  useEffect(() => {
    const t = q.trim();
    if (!t || isVodInput(t) || clipSlugFromInput(t)) { setUsers([]); setCats([]); return; }
    const h = setTimeout(() => { tw.searchUsers(t).then(setUsers); tw.searchCategories(t).then(setCats); }, 250);
    return () => clearTimeout(h);
  }, [q]);
  const submit = (e: Event) => {
    e.preventDefault();
    const t = q.trim(); if (!t) return;
    addSearch(t);
    const slug = clipSlugFromInput(t);
    if (slug) return play({ kind: 'clip', slug });
    if (isVodInput(t)) { const id = extractVodId(t); if (id) return play({ kind: 'vod', id, start: vodStartFromInput(t) }); }
    const login = loginFromInput(t);
    if (isValidLogin(login)) openChannel(login);
  };
  const more = () => tw.topCategories(next).then(r => { if (r) { setTop(t => [...(t ?? []), ...r.categories]); setNext(r.next); } });
  const visibleTop = (top ?? []).filter(c => !s.hiddenCategories.some(h => h.id === c.id));
  return <Page title="Durchsuchen" trailing={<AccountButton />}>
    <form class="search" onSubmit={submit}>
      <input type="search" placeholder="Kanäle, Kategorien, Links" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)}
        autocapitalize="off" autocorrect="off" spellcheck={false} enterkeyhint="search" />
    </form>
    {q.trim() ? <>
      {isVodInput(q) && <button class="list-row" onClick={submit}><Icon n="play" /><div>VOD {extractVodId(q)} öffnen</div></button>}
      {clipSlugFromInput(q) && <button class="list-row" onClick={submit}><Icon n="play" /><div>Clip öffnen</div></button>}
      <div class="list">{users.map(u => <button class="list-row" onClick={() => { addSearch(q.trim()); openChannel(u.login); }}>
        <img class="avatar sm" src={u.avatar} alt="" /><div><div>{u.name}</div>
          <div class="row-sub">{u.viewers != null ? <><span class="dot live" /> Live · {u.game} · {formatViewers(u.viewers)}</> : '@' + u.login}</div></div></button>)}</div>
      {cats.length > 0 && <Shelf title="Kategorien">{cats.map(c => <CategoryTile c={c} />)}</Shelf>}
      {!users.length && !cats.length && isValidLogin(loginFromInput(q)) && <button class="list-row" onClick={submit}><Icon n="browse" /><div>Kanal „{loginFromInput(q)}“ öffnen</div></button>}
    </> : <>
      {s.searchHistory.length > 0 && <div class="chips pad">{s.searchHistory.map(h => <button class="chip" onClick={() => setQ(h)}>{h}</button>)}
        <button class="chip ghost" onClick={clearSearchHistory}>Verlauf löschen</button></div>}
      {myCats.length > 0 && <Shelf title="Deine Kategorien">{myCats.map(c => <CategoryTile c={c} />)}</Shelf>}
      <h2 class="section-title">Top-Kategorien</h2>
      {top ? <div class="cat-grid">{visibleTop.map(c => <CategoryTile c={c} />)}</div> : <Spinner />}
      {next && <button class="btn wide" onClick={more}>Mehr laden</button>}
    </>}
  </Page>;
}

export function CategoryPage({ id, title }: { id: string; title: string }) {
  const s = useStore();
  const [lang, setLang] = useState('');
  const [data, setData] = useState<{ category: Category; streams: Stream[]; next?: string }>();
  useEffect(() => { setData(undefined); tw.categoryStreams(id, lang || undefined).then(setData); }, [id, lang]);
  const more = () => data?.next && tw.categoryStreams(id, lang || undefined, data.next).then(r => r && setData({ ...r, streams: [...data.streams, ...r.streams] }));
  // Logged in, the heart follows on Twitch (like channels); without login or when Twitch's list can't
  // be read it stays local, a failed follow falls back to local with a hint.
  const [twc, setTwc] = useState<{ failed?: boolean; busy?: boolean; err?: string }>({});
  useEffect(() => { setTwc({}); if (s.account) loadFollowedGames().then(ok => !ok && setTwc({ failed: true })); }, [id, s.account?.userId]);
  const hidden = s.hiddenCategories.some(c => c.id === id);
  const local = s.favCategories.some(c => c.id === id), onTwitch = s.accountCategories.some(c => c.id === id);
  const fav = local || onTwitch;
  const toggleFav = async () => {
    const c = { id, name: data?.category.name ?? title, boxArt: data?.category.boxArt ?? '' };
    if (local) toggleFavCategory(c);
    if (!s.account || twc.failed || twc.busy || (local && !onTwitch)) { if (!local) toggleFavCategory(c); return; }
    setTwc({ busy: true });
    const err = await setTwitchGameFollow(c, !onTwitch);
    if (err && !onTwitch) toggleFavCategory(c);
    setTwc({ err });
  };
  return <Page title={title} back trailing={<>
    <button class={'nav-btn' + (fav ? '' : ' muted')} aria-label={fav ? 'Nicht mehr folgen' : 'Folgen'} disabled={twc.busy}
      onClick={toggleFav}><Icon n="heart" /></button>
    <button class="nav-btn text" onClick={() => hideCategory({ id, name: title }, !hidden)}>{hidden ? 'Einblenden' : 'Ausblenden'}</button></>}>
    {data && <div class="cat-head pad"><img src={data.category.boxArt.replace('{width}', '285').replace('{height}', '380')} alt="" />
      <div><div class="row-sub">{formatViewers(data.category.viewers ?? 0)} Zuschauer</div>
        <select class="inline-select" value={lang} onChange={e => setLang((e.target as HTMLSelectElement).value)}>{LANGS.map(([v, l]) => <option value={v}>{l}</option>)}</select></div></div>}
    {twc.err && <p class="hint pad error">Twitch hat abgelehnt ({twc.err}), {onTwitch ? 'du folgst der Kategorie dort weiter' : 'die Kategorie ist nur in dieser App gemerkt'}.</p>}
    {twc.failed && <p class="hint pad error">Gefolgte Kategorien von Twitch nicht lesbar, das Herz merkt die Kategorie deshalb nur in dieser App.</p>}
    {!data ? <Spinner /> : <div class="grid">{data.streams.filter(x => !s.hiddenChannels.includes(x.login)).map(x => <StreamCard s={x} wide />)}</div>}
    {data?.next && <button class="btn wide" onClick={more}>Mehr laden</button>}
  </Page>;
}

// Meine VODs -------------------------------------------------------------------------------------
export function Library() {
  const s = useStore();
  const [edit, setEdit] = useState(false);
  const groups = useMemo(() => {
    const now = new Date(), day = 86400000;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const out: [string, HistoryEntry[]][] = [['Heute', []], ['Gestern', []], ['Diese Woche', []], ['Früher', []]];
    for (const h of s.history) out[h.at >= today ? 0 : h.at >= today - day ? 1 : h.at >= today - 6 * day ? 2 : 3][1].push(h);
    return out.filter(g => g[1].length);
  }, [s.history]);
  const resume = continueWatching();
  const open = (h: HistoryEntry) => h.kind === 'vod' ? play({ kind: 'vod', id: h.id }) : h.kind === 'clip' ? play({ kind: 'clip', slug: h.id }) : play({ kind: 'live', login: h.login });
  return <Page title="Meine VODs" trailing={<>{s.history.length > 0 && <button class="nav-btn text" onClick={() => setEdit(!edit)}>{edit ? 'Fertig' : 'Bearbeiten'}</button>}<AccountButton /></>}>
    {resume.length > 0 && <Shelf title="Ansehen fortsetzen">{resume.map(h => <VodCard v={{ id: h.id, title: h.title, thumb: h.thumb, publishedAt: '', length: h.length ?? 0, name: h.name }} />)}</Shelf>}
    <p class="hint pad">Downloads gibt es in der Web-App nicht: Twitch erlaubt fremden Seiten nicht, VOD-Playlists zu lesen (siehe Einstellungen → Info).</p>
    {!s.history.length && <Empty title="Noch nichts angesehen" text="Angesehene VODs, Clips und Livestreams erscheinen hier." />}
    {groups.map(([title, items]) => <section><h2 class="section-title">{title}</h2><div class="list">
      {items.map(h => <div class="list-row">
        <button class="hist" onClick={() => open(h)}><img class="hist-thumb" src={h.thumb.replace('{width}', '320').replace('{height}', '180')} alt="" />
          <div><div class="card-title">{h.title || h.name}</div><div class="row-sub">{h.kind === 'live' ? 'Live · ' : h.kind === 'clip' ? 'Clip · ' : ''}{h.name}</div>
            {h.kind === 'vod' && h.length && state.progress[h.id] ? <div class="progress inline"><div style={{ width: `${Math.min(100, state.progress[h.id] / h.length * 100)}%` }} /></div> : null}</div></button>
        {edit && <button class="nav-btn danger" onClick={() => removeHistory(h.kind, h.id)} aria-label="Entfernen"><Icon n="close" size={18} /></button>}
      </div>)}</div></section>)}
  </Page>;
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
