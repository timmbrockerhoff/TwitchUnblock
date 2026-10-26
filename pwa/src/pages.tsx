// Screens: Home, Browse (search + categories), Category, Meine VODs, Channel page, Settings.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as tw from './twitch';
import type { ChannelBrief, Stream, Category, Vod, Clip, ChannelInfo } from './twitch';
import { formatViewers, loginFromInput, isValidLogin, isVodInput, extractVodId, clipSlugFromInput, vodStartFromInput } from './logic';
import { useStore, state, setSetting, toggleFollow, isFollowed, hideChannel, hideCategory, addSearch, clearSearchHistory,
  setAccount, removeHistory, clearHistory, exportBackup, importBackup, type HistoryEntry } from './store';
import { startDeviceLogin, pollDeviceLogin, loadAccountFollows, setChatColor, type DeviceCode } from './account';
import { play, push, openChannel, type Route } from './nav';
import { Page, AccountButton, Shelf, Empty, Spinner, StreamCard, VodCard, ClipCard, CategoryTile, Icon, Sheet, Segmented, Toggle, Select, relDate } from './ui';

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
      navigator.serviceWorker?.ready.then(r => r.showNotification(`${c.name} ist live`, { body: c.stream!.title, icon: c.avatar, tag: c.login, data: { login: c.login } }));
  }
  live.forEach(c => seenLive.add(c.login));
  followCache = list;
  return list;
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
  const load = () => {
    refreshFollows().then(setFollows);
    tw.topStreams(s.settings.topLang || undefined).then(r => r && setTop(r.streams));
  };
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
  return <Page title="Startseite" trailing={<><button class="nav-btn" onClick={load} aria-label="Aktualisieren"><Icon n="refresh" /></button><AccountButton /></>}>
    {!s.follows.length && !s.account && <div class="callout">
      <p>Folge Kanälen über das Herz auf ihrer Seite oder melde dich mit Twitch an, um deine Kanäle hier zu sehen.</p>
      <button class="btn prominent" onClick={() => push({ name: 'settings' })}>Mit Twitch anmelden</button></div>}
    {follows === undefined && (s.follows.length > 0 || s.account) && <Spinner />}
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
  const hidden = s.hiddenCategories.some(c => c.id === id);
  return <Page title={title} back trailing={<button class="nav-btn text" onClick={() => hideCategory({ id, name: title }, !hidden)}>{hidden ? 'Einblenden' : 'Ausblenden'}</button>}>
    {data && <div class="cat-head pad"><img src={data.category.boxArt.replace('{width}', '285').replace('{height}', '380')} alt="" />
      <div><div class="row-sub">{formatViewers(data.category.viewers ?? 0)} Zuschauer</div>
        <select class="inline-select" value={lang} onChange={e => setLang((e.target as HTMLSelectElement).value)}>{LANGS.map(([v, l]) => <option value={v}>{l}</option>)}</select></div></div>}
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

// Kanalseite -------------------------------------------------------------------------------------
type ChannelTab = 'overview' | 'vods' | 'clips' | 'highlights' | 'playlists';
export function ChannelPage({ login }: { login: string }) {
  const s = useStore();
  const [info, setInfo] = useState<ChannelInfo | null>();
  const [tab, setTab] = useState<ChannelTab>('overview');
  const [open, setOpen] = useState(false);
  const [vods, setVods] = useState<{ vods: Vod[]; next?: string }>();
  const [highlights, setHighlights] = useState<Vod[]>();
  const [clipList, setClipList] = useState<Clip[]>();
  const [period, setPeriod] = useState<'LAST_DAY' | 'LAST_WEEK' | 'LAST_MONTH' | 'ALL_TIME'>('LAST_WEEK');
  const [playlists, setPlaylists] = useState<{ id: string; title: string; vods: Vod[] }[]>();
  const [filter, setFilter] = useState('');
  useEffect(() => {
    setInfo(undefined); setVods(undefined); setHighlights(undefined); setPlaylists(undefined);
    tw.channelInfo(login).then(i => setInfo(i ?? (i === null ? null : undefined)));
    tw.channelVideos(login).then(setVods);
    tw.channelVideos(login, 'HIGHLIGHT').then(r => setHighlights(r?.vods ?? []));
  }, [login]);
  useEffect(() => { setClipList(undefined); tw.clips(login, period).then(r => setClipList(r?.clips ?? [])); }, [login, period]);
  useEffect(() => { if (tab === 'playlists' && !playlists) tw.collections(login).then(setPlaylists); }, [tab]);
  if (info === null) return <Page title={login} back><Empty title="Streamer nicht gefunden" /></Page>;
  if (!info) return <Page title={login} back><Spinner /></Page>;
  const followedOnTwitch = s.accountFollows.includes(login);
  const share = () => navigator.share?.({ title: info.name, url: `https://www.twitch.tv/${login}` }).catch(() => {});
  const moreVods = () => vods?.next && tw.channelVideos(login, 'ARCHIVE', vods.next).then(r => r && setVods({ vods: [...vods.vods, ...r.vods], next: r.next }));
  const clipsOf = clipList ?? [];
  const latest = vods?.vods[0];
  const shownVods = (vods?.vods ?? []).filter(v => !filter || v.title.toLowerCase().includes(filter.toLowerCase()));
  return <Page title={info.name} back large={false} trailing={<button class="nav-btn" onClick={share} aria-label="Teilen"><Icon n="share" /></button>}>
    {info.banner && <img class="banner" src={info.banner} alt="" />}
    <div class="ch-head">
      <img class={'avatar xl' + (info.stream ? ' live-ring' : '')} src={info.avatar} alt="" />
      <div>
        <h1 class="ch-name">{info.name}{info.partner && <span class="partner" title="Partner"><Icon n="check" size={14} /></span>}</h1>
        <div class="row-sub">@{info.login}{info.followers != null ? ` · ${formatViewers(info.followers)} Follower` : ''}</div>
        <div class="row-sub">{info.stream ? <><span class="dot live" /> LIVE</> : info.lastStart ? 'Offline · zuletzt live ' + relDate(info.lastStart) : 'Offline'}</div>
      </div>
    </div>
    {info.description && <p class={'ch-desc pad' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>{info.description}{!open && <span class="link"> …mehr</span>}</p>}
    {open && <div class="pad">
      {info.socials.map(x => <a class="list-row" href={x.url} target="_blank" rel="noopener">{x.title}</a>)}
      {info.panels.map(p => <div class="panel">{p.title && <h4>{p.title}</h4>}{p.image && (p.link ? <a href={p.link} target="_blank" rel="noopener"><img src={p.image} alt="" /></a> : <img src={p.image} alt="" />)}<p>{p.text}</p></div>)}
      <button class="link" onClick={() => setOpen(false)}>Weniger anzeigen</button></div>}
    {!open && info.socials.length > 0 && <button class="link pad" onClick={() => setOpen(true)}>{info.socials[0].title}{info.socials.length > 1 ? ` und ${info.socials.length - 1} weitere Links` : ''}</button>}
    <div class="ch-actions pad">
      <button class={'btn ' + (isFollowed(login) ? 'bordered' : 'prominent')} disabled={followedOnTwitch && !s.follows.includes(login)}
        onClick={() => toggleFollow(login)}><Icon n="heart" size={18} /> {followedOnTwitch ? 'Folgst du (Twitch)' : s.follows.includes(login) ? 'Gefolgt' : 'Folgen'}</button>
      <button class="btn bordered" onClick={() => play({ kind: 'multi', logins: [login] })}><Icon n="grid" size={18} /> Multi-Live</button>
      <button class="btn bordered" onClick={() => hideChannel(login, !s.hiddenChannels.includes(login))}>{s.hiddenChannels.includes(login) ? 'Einblenden' : 'Ausblenden'}</button>
    </div>
    {followedOnTwitch && <p class="hint pad">Twitch-Follows lassen sich im Web nur lesen: Folgen/Entfolgen auf Twitch braucht ein Integritäts-Token, das nur twitch.tv selbst erzeugen kann.</p>}
    <div class="tabs">{([['overview', 'Übersicht'], ['vods', 'VODs'], ['clips', 'Clips'], ['highlights', 'Highlights'], ['playlists', 'Playlists']] as [ChannelTab, string][])
      .map(([k, l]) => <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === 'overview' && <>
      {info.stream ? <div class="pad"><StreamCard s={{ ...info.stream, avatar: info.avatar }} wide /></div> : latest ? <div class="pad"><VodCard v={latest} wide /></div> : null}
      {vods && vods.vods.length > 1 && <Shelf title="VODs" onAll={() => setTab('vods')}>{vods.vods.slice(0, 12).map(v => <VodCard v={v} />)}</Shelf>}
      {clipsOf.length > 0 && <Shelf title="Clips der Woche" onAll={() => setTab('clips')}>{clipsOf.slice(0, 12).map((c, i) => <ClipCard c={c} onClick={() => play({ kind: 'clips', clips: clipsOf, index: i })} />)}</Shelf>}
      {highlights && highlights.length > 0 && <Shelf title="Highlights" onAll={() => setTab('highlights')}>{highlights.slice(0, 12).map(v => <VodCard v={v} />)}</Shelf>}
      {!vods && <Spinner />}
      {vods && !vods.vods.length && !info.stream && <Empty title="Keine VODs gefunden." />}
    </>}
    {tab === 'vods' && <>
      <form class="search" onSubmit={e => e.preventDefault()}><input type="search" placeholder="VODs filtern" value={filter} onInput={e => setFilter((e.target as HTMLInputElement).value)} /></form>
      <div class="grid">{shownVods.map(v => <VodCard v={v} wide />)}</div>
      {!vods ? <Spinner /> : !vods.vods.length && <Empty title="Keine VODs gefunden." />}
      {vods?.next && !filter && <button class="btn wide" onClick={moreVods}>Mehr laden</button>}
    </>}
    {tab === 'clips' && <>
      <div class="pad"><Segmented value={period} onChange={setPeriod} options={[['LAST_DAY', '24 Std.'], ['LAST_WEEK', '7 Tage'], ['LAST_MONTH', '30 Tage'], ['ALL_TIME', 'Alle']]} /></div>
      {!clipList ? <Spinner /> : !clipsOf.length ? <Empty title="Keine Clips" /> :
        <div class="clip-grid">{clipsOf.map((c, i) => <ClipCard c={c} onClick={() => play({ kind: 'clips', clips: clipsOf, index: i })} />)}</div>}
    </>}
    {tab === 'highlights' && (!highlights ? <Spinner /> : highlights.length ? <div class="grid">{highlights.map(v => <VodCard v={v} wide />)}</div> : <Empty title="Keine Highlights" />)}
    {tab === 'playlists' && (!playlists ? <Spinner /> : playlists.length ? playlists.map(p => <Shelf title={p.title}>{p.vods.map(v => <VodCard v={v} />)}</Shelf>) : <Empty title="Keine Playlists" />)}
  </Page>;
}

// Einstellungen ----------------------------------------------------------------------------------
const SOURCE_NAMES: Record<tw.LiveSource, string> = { as: 'Luminous Asien', al: 'Proxy Albanien (TTV.LOL)', eu: 'Luminous Europa', twitch: 'Twitch offiziell (mit Werbung)' };
export function Settings() {
  const s = useStore();
  const st = s.settings;
  const [login, setLogin] = useState(false);
  const [color, setColor] = useState('#9146ff');
  const [colorMsg, setColorMsg] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const move = (i: number, d: number) => {
    const o = [...st.sourceOrder]; const j = i + d; if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; setSetting('sourceOrder', o);
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportBackup()], { type: 'application/json' }));
    a.download = `TwitchUnblock-Backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  };
  const notify = async (on: boolean) => {
    if (on && 'Notification' in window) { const p = await Notification.requestPermission(); if (p !== 'granted') return; }
    setSetting('notifyLive', on);
  };
  return <Page title="Einstellungen" back>
    <h2 class="section-title">Konto</h2>
    <div class="group">
      {s.account ? <>
        <div class="row"><div class="acc"><img class="avatar sm" src={s.account.avatar} alt="" /><div><div>{s.account.name}</div><div class="row-sub">Verbunden · {s.accountFollows.length} Twitch-Follows</div></div></div></div>
        <button class="row danger" onClick={() => confirm('Möchtest du dich wirklich abmelden?') && setAccount(null)}>Abmelden</button>
      </> : <button class="row accent" onClick={() => setLogin(true)}>Mit Twitch anmelden</button>}
    </div>
    <p class="hint pad">Anmeldung per Gerätecode auf twitch.tv/activate: kein Passwort in dieser App, kein Server. Damit: Twitch-Follows, Chatten, Namensfarbe.</p>

    <h2 class="section-title">Videoplayer</h2>
    <div class="group">
      <Select label="Bevorzugte Qualität" value={st.quality} onChange={v => setSetting('quality', v)}
        options={[['auto', 'Automatisch'], ['source', 'Source'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p'], ['160', '160p'], ['audio', 'Nur Audio']]} />
      <Toggle label="Niedrige Latenz" value={st.lowLatency} onChange={v => setSetting('lowLatency', v)} />
      <Toggle label="Werbepausen erkennen" sub="Ton aus und Hinweis, sobald Twitch eine Werbepause meldet" value={st.adSwitch} onChange={v => setSetting('adSwitch', v)} />
    </div>
    <h2 class="section-title">Reihenfolge der Live-Quellen</h2>
    <div class="group">{st.sourceOrder.map((src, i) => <div class="row"><span>{i + 1}. {SOURCE_NAMES[src]}</span>
      <span><button class="nav-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Nach oben">↑</button><button class="nav-btn" disabled={i === st.sourceOrder.length - 1} onClick={() => move(i, 1)} aria-label="Nach unten">↓</button></span></div>)}</div>
    <p class="hint pad">Die Proxys werden zeitversetzt parallel probiert, Twitch offiziell erst, wenn alle davor gescheitert sind. Nur bei den Proxys gibt es eine Qualitätsauswahl (siehe Info).</p>

    <h2 class="section-title">Chat</h2>
    <div class="group">
      <Select label="Schriftgröße" value={st.chatFont} onChange={v => setSetting('chatFont', v)} options={[[13, 'Klein'], [15, 'Normal'], [17, 'Groß'], [20, 'Sehr groß']]} />
      <Toggle label="Zeitstempel" value={st.chatTimestamps} onChange={v => setSetting('chatTimestamps', v)} />
      <Toggle label="Gelöschte Nachrichten zeigen" value={st.chatShowDeleted} onChange={v => setSetting('chatShowDeleted', v)} />
      <Toggle label="Bots und !Befehle ausblenden" value={st.chatHideBots} onChange={v => setSetting('chatHideBots', v)} />
      <Toggle label="Automatisch übersetzen" sub="Fremdsprachige Nachrichten ins Deutsche (Google-Übersetzer)" value={st.chatTranslate} onChange={v => setSetting('chatTranslate', v)} />
    </div>
    {s.account && <><div class="group"><div class="row"><span>Namensfarbe</span><span><input type="color" value={color} onInput={e => setColor((e.target as HTMLInputElement).value)} />
      <button class="btn small" onClick={async () => setColorMsg((await setChatColor(color)) ?? 'Gespeichert')}>Setzen</button></span></div></div>
      {colorMsg && <p class="hint pad">{colorMsg}</p>}</>}

    <h2 class="section-title">Darstellung</h2>
    <div class="group"><div class="row"><span>Akzentfarbe</span><span class="swatches">{['#9146ff', '#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#64d2ff'].map(c =>
      <button class={'swatch' + (st.accent === c ? ' on' : '')} style={{ background: c }} onClick={() => setSetting('accent', c)} aria-label={c} />)}</span></div></div>

    <h2 class="section-title">Mitteilungen</h2>
    <div class="group"><Toggle label="Live-Mitteilungen" sub="Nur solange die App geöffnet ist und nur als Home-Bildschirm-App" value={st.notifyLive} onChange={notify} /></div>

    {(s.hiddenChannels.length > 0 || s.hiddenCategories.length > 0) && <><h2 class="section-title">Ausgeblendet</h2>
      <div class="group">{s.hiddenChannels.map(l => <div class="row"><span>{l}</span><button class="link" onClick={() => hideChannel(l, false)}>Einblenden</button></div>)}
        {s.hiddenCategories.map(c => <div class="row"><span>{c.name}</span><button class="link" onClick={() => hideCategory(c, false)}>Einblenden</button></div>)}</div></>}

    <h2 class="section-title">Daten</h2>
    <div class="group">
      <button class="row accent" onClick={download}>Sicherung exportieren</button>
      <button class="row accent" onClick={() => file.current?.click()}>Sicherung importieren</button>
      <button class="row danger" onClick={() => confirm('Verlauf und Fortschritt löschen?') && clearHistory()}>Verlauf löschen</button>
    </div>
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={async e => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      setImportMsg(importBackup(await f.text()) ? 'Sicherung geladen.' : 'Keine gültige Sicherungsdatei.');
    }} />
    {importMsg && <p class="hint pad">{importMsg}</p>}

    <h2 class="section-title">Info</h2>
    <div class="group about">
      <div class="row"><span>Version</span><span class="row-sub">Web {__APP_VERSION__}</span></div>
      <a class="row" href="https://github.com/timmbrockerhoff/TwitchUnblock" target="_blank" rel="noopener">Quellcode (GitHub)</a>
      <a class="row" href="https://github.com/MXFia19/TwitchUnblock" target="_blank" rel="noopener">Original-App von MXFia19 (MIT-Lizenz)</a>
      <a class="row" href="https://github.com/timmbrockerhoff/TwitchUnblock/blob/pwa/pwa/LIMITATIONS.md" target="_blank" rel="noopener">Was die Web-App nicht kann</a>
    </div>
    <p class="hint pad">Basiert auf TwitchUnblock von MXFia19 (MIT-Lizenz). Nicht mit Twitch verbunden.</p>
    {login && <LoginSheet onClose={() => setLogin(false)} />}
  </Page>;
}

function LoginSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<DeviceCode>();
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    startDeviceLogin().then(async c => {
      setCode(c);
      const acc = await pollDeviceLogin(c, () => cancelled);
      if (cancelled) return;
      if (acc) { setAccount(acc); loadAccountFollows(); onClose(); } else setErr('Der Code ist abgelaufen. Bitte erneut versuchen.');
    }).catch(e => setErr('Anmeldung fehlgeschlagen: ' + e.message));
    return () => { cancelled = true; };
  }, []);
  return <Sheet title="Mit Twitch anmelden" onClose={onClose}>
    {err ? <p class="error">{err}</p> : !code ? <Spinner /> : <div class="login">
      <p>Öffne twitch.tv/activate, melde dich dort an und gib diesen Code ein:</p>
      <div class="code" onClick={() => navigator.clipboard?.writeText(code.user_code)}>{code.user_code}</div>
      <a class="btn prominent wide" href={code.verification_uri} target="_blank" rel="noopener">twitch.tv/activate öffnen</a>
      <p class="hint">Warte auf Bestätigung … Danach kehrst du einfach hierher zurück.</p>
    </div>}
  </Sheet>;
}

export function RoutePage({ r }: { r: Route }) {
  switch (r.name) {
    case 'channel': return <ChannelPage login={r.login} />;
    case 'category': return <CategoryPage id={r.id} title={r.title} />;
    case 'list': return <FullList kind={r.kind} />;
    case 'settings': return <Settings />;
    default: return null;
  }
}
