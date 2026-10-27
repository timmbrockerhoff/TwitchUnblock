// Channel page (ChannelView.swift counterpart).
import { useEffect, useRef, useState } from 'preact/hooks';
import * as tw from './twitch';
import type { Vod, Clip, ChannelInfo } from './twitch';
import { formatViewers } from './logic';
import { useStore, toggleFollow, isFollowed, hideChannel } from './store';
import { play } from './nav';
import { rewards, twitchFollowState, setTwitchFollow } from './rewards';
import { Page, Shelf, Empty, Spinner, StreamCard, VodCard, ClipCard, Icon, Segmented, relDate } from './ui';
import { loadRecoverableStreams, resolveRecoverableStream, type RecoverableStream } from './vod';

type ChannelTab = 'overview' | 'vods' | 'clips' | 'highlights' | 'playlists';
export function ChannelPage({ login }: { login: string }) {
  const s = useStore();
  const loginRef = useRef(login);
  loginRef.current = login;
  const [info, setInfo] = useState<ChannelInfo | null>();
  const [tab, setTab] = useState<ChannelTab>('overview');
  const [open, setOpen] = useState(false);
  const [vods, setVods] = useState<{ vods: Vod[]; next?: string }>();
  const [highlights, setHighlights] = useState<Vod[]>();
  const [clipList, setClipList] = useState<Clip[]>();
  const [period, setPeriod] = useState<'LAST_DAY' | 'LAST_WEEK' | 'LAST_MONTH' | 'ALL_TIME'>('LAST_WEEK');
  const [playlists, setPlaylists] = useState<{ id: string; title: string; vods: Vod[] }[]>();
  const [filter, setFilter] = useState('');
  const [recovery, setRecovery] = useState<{ streams: RecoverableStream[]; unavailable: boolean }>();
  const [resolving, setResolving] = useState<string>();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [twf, setTwf] = useState<{ id: string; following: boolean; busy?: boolean; err?: string }>();
  const [twfFailed, setTwfFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setInfo(undefined); setVods(undefined); setHighlights(undefined); setPlaylists(undefined); setRecovery(undefined); setGone(new Set()); setResolving(undefined);
    tw.channelInfo(login).then(i => alive && setInfo(i ?? (i === null ? null : undefined)));
    tw.channelVideos(login).then(r => alive && setVods(r));
    tw.channelVideos(login, 'HIGHLIGHT').then(r => alive && setHighlights(r?.vods ?? []));
    loadRecoverableStreams(login).then(r => alive && setRecovery(r));
    return () => { alive = false; };
  }, [login]);
  useEffect(() => { setClipList(undefined); tw.clips(login, period).then(r => setClipList(r?.clips ?? [])); }, [login, period]);
  useEffect(() => { if (tab === 'playlists' && !playlists) tw.collections(login).then(setPlaylists); }, [tab]);
  useEffect(() => {
    setTwf(undefined); setTwfFailed(false);
    if (rewards.account) twitchFollowState(login).then(st => st ? setTwf(st) : setTwfFailed(true));
  }, [login, rewards.account?.userId]);
  if (info === null) return <Page title={login} back><Empty title="Streamer nicht gefunden" /></Page>;
  if (!info) return <Page title={login} back><Spinner /></Page>;
  const followedOnTwitch = s.accountFollows.includes(login);
  const toggleTwitch = async () => {
    if (!twf || twf.busy) return;
    setTwf({ ...twf, busy: true });
    const err = await setTwitchFollow(twf.id, login, !twf.following);
    setTwf(err ? { ...twf, busy: false, err } : { id: twf.id, following: !twf.following });
  };
  const share = () => navigator.share?.({ title: info.name, url: `https://www.twitch.tv/${login}` }).catch(() => {});
  const moreVods = () => vods?.next && tw.channelVideos(login, 'ARCHIVE', vods.next).then(r => r && setVods({ vods: [...vods.vods, ...r.vods], next: r.next }));
  const clipsOf = clipList ?? [];
  const latest = vods?.vods[0];
  const shownVods = (vods?.vods ?? []).filter(v => !filter || v.title.toLowerCase().includes(filter.toLowerCase()));
  const unlisted = (recovery?.streams ?? []).filter(r => {
    if (filter && !`${r.title} ${r.game}`.toLowerCase().includes(filter.toLowerCase())) return false;
    const start = Date.parse(r.start), window = 15 * 60_000;
    if (info.stream?.startedAt && Math.abs(Date.parse(info.stream.startedAt) - start) < window) return false;
    return !(vods?.vods ?? []).some(v => v.thumb.includes(`_${r.streamID}_`) || Math.abs(Date.parse(v.publishedAt) - start) < window);
  });
  const recover = async (r: RecoverableStream) => {
    if (resolving) return;
    setResolving(r.streamID); setGone(x => { const n = new Set(x); n.delete(r.streamID); return n; });
    const vod = await resolveRecoverableStream(r);
    if (loginRef.current.toLowerCase() !== r.login) return;
    setResolving(undefined);
    if (vod) play({ kind: 'recovered', vod });
    else setGone(x => new Set(x).add(r.streamID));
  };
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
      {twf ? <button class={'btn ' + (twf.following ? 'bordered' : 'prominent')} disabled={twf.busy} onClick={toggleTwitch}>
          <Icon n="heart" size={18} /> {twf.busy ? '…' : twf.following ? 'Gefolgt (Twitch)' : 'Auf Twitch folgen'}</button>
        : <button class={'btn ' + (isFollowed(login) ? 'bordered' : 'prominent')} disabled={followedOnTwitch && !s.follows.includes(login)}
          onClick={() => toggleFollow(login)}><Icon n="heart" size={18} /> {followedOnTwitch ? 'Folgst du (Twitch)' : s.follows.includes(login) ? 'Gefolgt' : 'Folgen'}</button>}
      {twf && s.follows.includes(login) && <button class="btn bordered" onClick={() => toggleFollow(login)}>Lokal entfolgen</button>}
      <button class="btn bordered" onClick={() => play({ kind: 'multi', logins: [login] })}><Icon n="grid" size={18} /> Multi-Live</button>
      <button class="btn bordered" onClick={() => hideChannel(login, !s.hiddenChannels.includes(login))}>{s.hiddenChannels.includes(login) ? 'Einblenden' : 'Ausblenden'}</button>
    </div>
    {twf?.err && <p class="hint pad error">Twitch hat abgelehnt: {twf.err}</p>}
    {twfFailed && <p class="hint pad error">Twitch-Folgestatus nicht lesbar, der Knopf folgt deshalb nur in dieser App. Bitte in den Einstellungen ab- und wieder anmelden.</p>}
    {!rewards.account && <p class="hint pad">Ohne Login folgst du nur in dieser App. Mit Login (Einstellungen → Mit Twitch anmelden) folgst du auf Twitch.</p>}
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
      {!vods ? <Spinner /> : !vods.vods.length && !unlisted.length && <Empty title="Keine VODs gefunden." />}
      {vods?.next && !filter && <button class="btn wide" onClick={moreVods}>Mehr laden</button>}
      {unlisted.length > 0 && <section><h2 class="section-title">Nicht gelistete VODs</h2>
        <p class="hint pad">Gelöschte oder versteckte Übertragungen lassen sich öffnen, solange Twitch ihre Videosegmente noch ausliefert.</p>
        <div class="grid">{unlisted.map(r => <VodCard wide v={{
          id: r.streamID, title: r.title || 'Nicht gelistete VOD', thumb: info.banner || info.avatar, publishedAt: r.start,
          length: r.duration, views: r.maxViews, login: r.login, name: info.name,
        }} onClick={() => recover(r)} disabled={!!resolving}
          status={resolving === r.streamID ? 'Suche …' : gone.has(r.streamID) ? 'Nicht verfügbar' : undefined}
          statusError={gone.has(r.streamID)} />)}</div></section>}
      {recovery?.unavailable && <p class="hint pad">Die Quelle für nicht gelistete VODs ist gerade nicht erreichbar.</p>}
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
