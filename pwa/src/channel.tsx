// Channel page (ChannelView.swift): YouTube-style header, underlined tabs, Twitch's content.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import * as tw from './twitch';
import type { Vod, Clip, ChannelInfo } from './twitch';
import { formatViewers, formatDuration, formatOfflineSince, formatShortDate } from './logic';
import { useStore, toggleFollow, hideChannel, isHiddenChannel, isFollowedOrPinned, addRecentChannel } from './store';
import { play } from './nav';
import { rewards, twitchFollowState, setTwitchFollow } from './rewards';
import { Page, Shelf, Empty, Spinner, ListEndNote, ClipCard, ClipCardWide, VodCard, Icon, useLongPress } from './ui';
import { loadRecoverableStreams, resolveRecoverableStream, type RecoverableStream } from './vod';
import './channel.css';

const thumbURL = (u: string, w: number, h: number) => !u || u.includes('404_processing') ? '' : u.replace('{width}', String(w)).replace('{height}', String(h));
/** Plain text with http(s) links made tappable (richText in RichText.swift, links only). */
function linkify(text: string): ComponentChildren {
  return text.split(/(https?:\/\/[^\s]+)/g).map(part => /^https?:\/\//.test(part)
    ? <a href={part} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>{part}</a> : part);
}

/** UnlistedVodCardView: a broadcast without a VOD in Twitch's list, rebuilt on tap. The web app
 *  keeps the banner/avatar as a dimmed preview under the gradient. */
export function UnlistedVodCard({ r, preview, resolving, gone, onClick, width }: {
  r: RecoverableStream; preview?: string; resolving: boolean; gone: boolean; onClick: () => void; width?: number;
}) {
  return <button class={'card' + (width ? '' : ' wide') + (gone ? ' gone' : '')} style={width ? { width } : undefined} disabled={resolving} onClick={onClick}>
    <div class="thumb unlisted">{preview && <img loading="lazy" src={preview} alt="" />}
      {resolving ? <div class="spinner" /> : <Icon n={gone ? 'octagon' : 'eyeSlash'} size={28} />}
      <span class={'badge tl ' + (gone ? 'danger' : 'accent')}>{gone ? 'Nicht mehr verfügbar' : 'Nicht gelistetes VOD'}</span>
      {r.duration > 0 && <span class="badge tr">{formatDuration(r.duration)}</span>}</div>
    <div class="card-body"><div class="card-title">{r.title || r.login}</div>
      <div class="card-sub">{[formatShortDate(r.start), r.game].filter(Boolean).join(' · ')}</div></div>
  </button>;
}
/** A playlist: the first VOD plays, the rest is the player's queue (nav.ts PlayerTarget.vod.queue). */
const playQueue = (vods: Vod[]) => vods.length && play({ kind: 'vod', id: vods[0].id, queue: vods.slice(1).map(v => v.id) });

// Kanalseite -------------------------------------------------------------------------------------
type ChannelTab = 'overview' | 'vods' | 'clips' | 'highlights' | 'playlists';
type Period = 'LAST_DAY' | 'LAST_WEEK' | 'LAST_MONTH' | 'ALL_TIME';
type Entry = { kind: 'vod'; v: Vod; at: number } | { kind: 'unlisted'; r: RecoverableStream; at: number };
const TABS: [ChannelTab, string][] = [['overview', 'Übersicht'], ['vods', 'VODs'], ['clips', 'Clips'], ['highlights', 'Highlights'], ['playlists', 'Playlists']];
const PERIODS: [Period, string][] = [['LAST_DAY', '24 Std.'], ['LAST_WEEK', '7 T'], ['LAST_MONTH', '30 T'], ['ALL_TIME', 'Alle']];

export function ChannelPage({ login }: { login: string }) {
  const s = useStore();
  const loginRef = useRef(login);
  loginRef.current = login;
  const [info, setInfo] = useState<ChannelInfo | null>();
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  const [tab, setTab] = useState<ChannelTab>('overview');
  const [open, setOpen] = useState(false);
  const [headerOn, setHeaderOn] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [filter, setFilter] = useState('');
  const [vods, setVods] = useState<{ vods: Vod[]; next?: string }>();
  const vodsRef = useRef(vods);
  vodsRef.current = vods;
  const [vodsFailed, setVodsFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [vodsRefused, setVodsRefused] = useState(false);
  const [highlights, setHighlights] = useState<Vod[]>();
  const [clipList, setClipList] = useState<{ clips: Clip[]; next?: string }>();
  const [moreClips, setMoreClips] = useState(false);
  const [clipsRefused, setClipsRefused] = useState(false);
  const [period, setPeriod] = useState<Period>('LAST_WEEK');
  const [playlists, setPlaylists] = useState<{ id: string; title: string; vods: Vod[] }[]>();
  const [recovery, setRecovery] = useState<{ streams: RecoverableStream[]; unavailable: boolean }>();
  const [resolving, setResolving] = useState<string>();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [twf, setTwf] = useState<{ id: string; following: boolean; busy?: boolean; err?: string }>();
  const headerRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // Long press on the header (the iOS contextMenu): multi-live, hide/unhide (never for followed or pinned).
  const press = useLongPress(() => {
    const hidden = isHiddenChannel(login);
    return [{ label: 'Multi-Live', icon: 'grid', onSelect: () => play({ kind: 'multi', logins: [login] }) },
      ...(!isFollowedOrPinned(login) ? [{ label: hidden ? 'Wieder anzeigen' : 'Diesen Kanal ausblenden', icon: hidden ? 'eye' : 'eyeSlash', danger: !hidden,
        onSelect: () => { hideChannel(login, !hidden, info?.name); } }] : [])];
  });

  const loadVods = () => {
    setVods(undefined); setVodsFailed(false); setMoreFailed(false); setVodsRefused(false);
    tw.channelVideos(login).then(r => { if (loginRef.current !== login) return; if (r) setVods(r); else setVodsFailed(true); });
  };
  useEffect(() => {
    let alive = true;
    setInfo(undefined); setFailed(false); setHighlights(undefined); setPlaylists(undefined); setRecovery(undefined);
    setGone(new Set()); setResolving(undefined); setTab('overview'); setOpen(false); setShowFilter(false); setFilter('');
    addRecentChannel(login);
    tw.channelInfo(login).then(i => { if (!alive) return; if (i === undefined) setFailed(true); else setInfo(i); });
    loadVods();
    tw.channelVideos(login, 'HIGHLIGHT').then(r => alive && setHighlights(r?.vods ?? []));
    loadRecoverableStreams(login).then(r => alive && setRecovery(r));
    return () => { alive = false; };
  }, [login, tries]);
  useEffect(() => { setClipList(undefined); setClipsRefused(false); tw.clips(login, period).then(r => loginRef.current === login && setClipList(r ?? { clips: [] })); }, [login, period]);
  useEffect(() => { if (tab === 'playlists' && !playlists) tw.collections(login).then(setPlaylists); }, [tab, login]);
  useEffect(() => {
    setTwf(undefined);
    if (rewards.account) twitchFollowState(login).then(st => loginRef.current === login && st && setTwf(st));
  }, [login, rewards.account?.userId]);
  // The floating "Weniger anzeigen" shows while the opened header is on screen.
  useEffect(() => {
    const el = headerRef.current; if (!el || !open) return;
    const o = new IntersectionObserver(([e]) => setHeaderOn(e.isIntersecting));
    o.observe(el);
    return () => o.disconnect();
  }, [open, info]);

  const kw = filter.trim().toLowerCase();
  const moreVods = async () => {
    const cur = vodsRef.current;
    if (!cur?.next || loadingRef.current) return;
    loadingRef.current = true; setLoadingMore(true); setMoreFailed(false);
    const r = await tw.channelVideos(login, 'ARCHIVE', cur.next);
    loadingRef.current = false;
    if (loginRef.current !== login) return;
    setLoadingMore(false);
    if (!r) { setMoreFailed(true); return; }
    if (r.refused) { setVodsRefused(true); const end = { ...cur, next: undefined }; vodsRef.current = end; setVods(end); return; }
    const known = new Set(cur.vods.map(v => v.id));
    const fresh = r.vods.filter(v => !known.has(v.id));
    const next = { vods: [...cur.vods, ...fresh], next: fresh.length ? r.next : undefined };
    vodsRef.current = next; setVods(next);
  };
  // The filter only sees loaded VODs: up to 5 more pages per tap until one brings a new match.
  const searchOlder = async () => {
    const count = () => (vodsRef.current?.vods ?? []).filter(v => v.title.toLowerCase().includes(kw)).length;
    const before = count();
    for (let i = 0; i < 5 && vodsRef.current?.next; i++) {
      await moreVods();
      if (loginRef.current !== login || count() > before) break;
    }
  };
  // Infinite scroll: the next page when the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || tab !== 'vods' || !vods?.next || kw || loadingMore || moreFailed) return;
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) moreVods(); });
    o.observe(el);
    return () => o.disconnect();
  }, [tab, vods?.next, kw, loadingMore, moreFailed]);

  if (failed) return <Page title="" back large={false}><Empty title="Fehler beim Laden der Daten.">
    <button class="btn small" onClick={() => setTries(t => t + 1)}>Erneut versuchen</button></Empty></Page>;
  if (info === null) return <Page title="" back large={false}><Empty title="Streamer nicht gefunden." /></Page>;
  if (!info) return <Page title="" back large={false}><Spinner /></Page>;

  const isLive = !!info.stream;
  // Follow: on Twitch with a login (state read), else only in this app.
  const local = s.follows.includes(login), onTwitchList = s.accountFollows.includes(login);
  const following = twf ? twf.following : local || onTwitchList;
  const canToggle = twf ? !twf.busy : !(onTwitchList && !local);
  const toggle = async () => {
    if (!canToggle) return;
    if (following && !confirm(`${login} entfolgen?`)) return;
    if (twf) {
      setTwf({ ...twf, busy: true });
      const err = await setTwitchFollow(twf.id, login, !twf.following);
      setTwf(err ? { ...twf, busy: false, err } : { id: twf.id, following: !twf.following });
      if (!err && !twf.following) hideChannel(login, false);
    } else {
      toggleFollow(login);
      if (!local) hideChannel(login, false);
    }
  };
  const share = () => {
    const url = `https://www.twitch.tv/${login}`;
    if (navigator.share) navigator.share({ title: info.name, url }).catch(() => {});
    else navigator.clipboard?.writeText(url);
  };
  const scrollTop = () => { headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => setOpen(false), 300); };

  const first = vods?.vods[0];
  const offlineSince = isLive ? '' : formatOfflineSince(info.lastEnd ?? info.lastStart);

  // Broadcasts without a VOD in Twitch's list: skipped when a VOD covers them (stream id in the
  // thumbnail, or same start), when it is the running live, or when older than the loaded list.
  const unlisted = (recovery?.streams ?? []).filter(r => {
    if (kw && !r.title.toLowerCase().includes(kw)) return false;
    const start = Date.parse(r.start), window = 15 * 60_000;
    if (info.stream?.startedAt && Math.abs(Date.parse(info.stream.startedAt) - start) < window) return false;
    const list = vods?.vods ?? [];
    if (list.some(v => v.thumb.includes(`_${r.streamID}_`) || Math.abs(Date.parse(v.publishedAt) - start) < window)) return false;
    if (vods?.next) { const oldest = Math.min(...list.map(v => Date.parse(v.publishedAt)).filter(x => !isNaN(x))); if (start < oldest - window) return false; }
    return true;
  });
  const entries: Entry[] = useMemo(() => [
    ...(vods?.vods ?? []).filter(v => !kw || v.title.toLowerCase().includes(kw)).map(v => ({ kind: 'vod', v, at: Date.parse(v.publishedAt) || 0 } as Entry)),
    ...unlisted.map(r => ({ kind: 'unlisted', r, at: Date.parse(r.start) } as Entry)),
  ].sort((a, b) => b.at - a.at), [vods, kw, recovery, info]);
  const recover = async (r: RecoverableStream) => {
    if (resolving) return;
    setResolving(r.streamID); setGone(x => { const n = new Set(x); n.delete(r.streamID); return n; });
    const vod = await resolveRecoverableStream(r);
    if (loginRef.current.toLowerCase() !== r.login) return;
    setResolving(undefined);
    if (vod) play({ kind: 'recovered', vod }); else setGone(x => new Set(x).add(r.streamID));
  };
  const entryCard = (e: Entry, width?: number) => e.kind === 'vod' ? <VodCard v={e.v} width={width} wide={!width} noName />
    : <UnlistedVodCard r={e.r} preview={info.banner || info.avatar} resolving={resolving === e.r.streamID} gone={gone.has(e.r.streamID)} onClick={() => recover(e.r)} width={width} />;
  const clips = clipList?.clips ?? [];
  const playClip = (i: number) => play({ kind: 'clips', clips, index: i });
  const loadMoreClips = async () => {
    if (!clipList?.next || moreClips) return;
    setMoreClips(true);
    const r = await tw.clips(login, period, clipList.next);
    setMoreClips(false);
    if (loginRef.current !== login || !r) return;
    if (r.refused) { setClipsRefused(true); setClipList({ clips }); return; }
    const known = new Set(clips.map(c => c.slug));
    setClipList({ clips: [...clips, ...r.clips.filter(c => !known.has(c.slug))], next: r.next });
  };
  const featured = isLive ? undefined : first?.id;
  const shelfVods = entries.filter(e => e.kind !== 'vod' || e.v.id !== featured).slice(0, 12);
  const flat = info.description.replace(/\n/g, ' ');
  const short = flat.length > 80 ? flat.slice(0, 80) : flat;
  const hasAbout = !!info.description || info.socials.length > 0;

  return <Page title="" back large={false} trailing={<button class="nav-btn" aria-label="Stichwort (z. B.: Horror)"
      onClick={() => { if (showFilter) { setShowFilter(false); setFilter(''); } else { setShowFilter(true); setTab('vods'); } }}>
      <Icon n={showFilter ? 'close' : 'browse'} /></button>}>
    <div ref={headerRef} class="ch-header">
      {info.banner && <img class="ch-banner" src={info.banner} alt="" />}
      <div class="ch-head" {...press}>
        <img class={'ch-avatar' + (isLive ? ' live' : '')} src={info.avatar} alt="" />
        <div class="ch-head-text">
          <h1 class="ch-name"><span>{info.name}</span>{info.partner && <Icon n="seal" size={18} />}</h1>
          <div class="ch-login">@{info.login}</div>
          <div class="ch-status">
            {info.followers != null && <><span>{formatViewers(info.followers)} Follower</span><span>·</span></>}
            {isLive ? <><span class="dot live" /><span class="live">LIVE</span></> : offlineSince && <span>Offline seit: {offlineSince}</span>}
          </div>
        </div>
      </div>
      {hasAbout && (open ? <div class="ch-open">
        {info.description && <div class="text" onClick={() => setOpen(false)}>{linkify(info.description)}</div>}
        {info.socials.map(x => <a class="ch-social" href={x.url} target="_blank" rel="noopener"><Icon n="link" size={18} />{x.title}</a>)}
        {info.panels.map(p => <div class="ch-panel">
          {p.image && (p.link ? <a href={p.link} target="_blank" rel="noopener"><img src={p.image} alt="" /></a> : <img src={p.image} alt="" />)}
          {p.title && <h4>{p.title}</h4>}{p.text && <p>{linkify(p.text)}</p>}</div>)}
        <button class="ch-less" onClick={() => setOpen(false)}>Weniger anzeigen</button>
      </div> : <button class="ch-about" onClick={() => setOpen(true)}>
        {info.description && <div class="ch-desc-short">{short}<b> …mehr</b></div>}
        {info.socials.length > 0 && <div class="ch-links"><Icon n="link" size={18} />
          {info.socials.length > 1 ? `${info.socials[0].title} und ${info.socials.length - 1} weitere Links` : info.socials[0].title}</div>}
      </button>)}
      <div class="ch-actions">
        <button class={'btn small ' + (following ? 'grey' : 'prominent')} disabled={!canToggle} onClick={toggle}>
          <Icon n={following ? 'check' : 'heart'} size={16} /> {following ? 'Folge ich' : 'Folgen'}</button>
        <button class="btn small grey" onClick={share}><Icon n="share" size={16} /> Teilen</button>
      </div>
      {twf?.err && <p class="hint pad error">Twitch hat diese Folgen-Änderung nicht übernommen.</p>}
    </div>
    {open && headerOn && <button class="ch-less-float" onClick={scrollTop}><Icon n="down" size={16} /> Weniger anzeigen</button>}

    <div class="ch-tabs">{TABS.map(([k, l]) => <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    <div class="ch-body">
      {tab === 'overview' && <>
        {isLive ? <button class="ch-live" onClick={() => play({ kind: 'live', login })}>
          <div class="ch-live-thumb"><img src={thumbURL(info.stream!.thumb, 640, 360)} alt="" /><span class="live-on">JETZT LIVE</span></div>
          <div class="ch-live-title">{info.stream!.title}</div>
          <div class="ch-live-meta">{[info.stream!.viewers > 0 ? `${formatViewers(info.stream!.viewers)} Zuschauer` : '', info.stream!.game].filter(Boolean).join(' · ')}</div>
        </button> : first ? <div class="ch-col"><VodCard v={first} wide noName /></div> : null}
        {shelfVods.length > 0 && <Shelf title="VODs" onAll={() => setTab('vods')}>{shelfVods.map(e => entryCard(e, 220))}</Shelf>}
        {clips.length > 0 && <Shelf title="Clips" onAll={() => setTab('clips')}>{clips.slice(0, 12).map((c, i) => <ClipCard c={c} onClick={() => playClip(i)} />)}</Shelf>}
        {highlights && highlights.length > 0 && <Shelf title="Highlights" onAll={() => setTab('highlights')}>{highlights.slice(0, 12).map(v => <VodCard v={v} width={220} noName />)}</Shelf>}
        {playlists && playlists.length > 0 && <Shelf title="Playlists" onAll={() => setTab('playlists')}>
          {playlists.map(p => <VodCard v={{ ...p.vods[0], title: p.title }} width={220} noName onClick={() => playQueue(p.vods)} />)}</Shelf>}
        {!vods && !vodsFailed && <Spinner />}
        {vodsFailed && <Empty title="Fehler beim Laden der Daten."><button class="btn small" onClick={loadVods}>Erneut versuchen</button></Empty>}
        {vods && !vods.vods.length && !clips.length && !highlights?.length && !isLive && <Empty title="Keine VODs gefunden." />}
      </>}
      {tab === 'vods' && <>
        {showFilter && <form class="search" onSubmit={e => e.preventDefault()}>
          <input type="search" placeholder="Stichwort (z. B.: Horror)" value={filter} onInput={e => setFilter((e.target as HTMLInputElement).value)} autofocus /></form>}
        {!vods && !vodsFailed ? <Spinner />
          : vodsFailed ? <Empty title="Fehler beim Laden der Daten."><button class="btn small" onClick={loadVods}>Erneut versuchen</button></Empty>
          : !entries.length ? <Empty title={kw ? 'Kein Ergebnis' : 'Keine VODs gefunden.'} />
          : <div class="ch-col">{entries.map(e => entryCard(e))}</div>}
        <div ref={sentinel} />
        {loadingMore && <Spinner />}
        {moreFailed && !loadingMore && <button class="btn wide" onClick={moreVods}>Mehr laden</button>}
        {kw && vods?.next && !loadingMore && <button class="btn wide" onClick={searchOlder}>Ältere VODs suchen</button>}
        {vodsRefused && <ListEndNote text="Twitch liefert den Rest gerade nicht." />}
        {recovery?.unavailable && <p class="hint pad">Die Quelle für nicht gelistete VODs ist gerade nicht erreichbar.</p>}
      </>}
      {tab === 'clips' && <>
        <div class="ch-chips">{PERIODS.map(([k, l]) => <button class={'chip small' + (period === k ? ' on' : '')} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        {!clipList ? <Spinner /> : !clips.length ? <Empty title="Keine Clips in diesem Zeitraum" />
          : <div class="ch-clipgrid">{clips.map((c, i) => <ClipCardWide c={c} onClick={() => playClip(i)} />)}</div>}
        {clipList?.next ? <button class="btn wide" disabled={moreClips} onClick={loadMoreClips}>{moreClips ? '…' : 'Mehr laden'}</button>
          : clipsRefused && <ListEndNote text="Twitch liefert den Rest gerade nicht." />}
      </>}
      {tab === 'highlights' && (!highlights ? <Spinner /> : !highlights.length ? <Empty title="Keine Highlights" />
        : <div class="ch-col">{highlights.map(v => <VodCard v={v} wide noName />)}</div>)}
      {tab === 'playlists' && (!playlists ? <Spinner /> : !playlists.length ? <Empty title="Keine Playlists" />
        : playlists.map(p => <section>
          <div class="ch-pl-head"><div><div class="ch-pl-title">{p.title}</div><div class="ch-pl-meta">{p.vods.length} Video(s)</div></div>
            <button class="chip small" onClick={() => playQueue(p.vods)}><Icon n="play" size={14} /> Alle abspielen</button></div>
          <div class="shelf-row">{p.vods.map(v => <VodCard v={v} width={200} noName />)}</div>
        </section>))}
    </div>
  </Page>;
}
