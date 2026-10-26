// Player (VideoPlayerView/PlayerControls), chat panel (ChatView), multi-live and clip feed.
// Playback is Safari's native HLS: Twitch's playlist servers refuse other sites' fetch()
// (Origin check), so hls.js/MSE and playlist rewriting are impossible; the <video> element itself
// loads them without an Origin header.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as tw from './twitch';
import { sortQualities, preferredQualityKey, qualityText, formatClock, formatViewers, adActive } from './logic';
import { ChatClient, VodChat, loadGlobalEmotes, loadChannelEmotes, translate, wantsTranslation, isBotLine, emoteList, type ChatMsg, type RoomState } from './chat';
import { useStore, state, setSetting, addHistory, setProgress, isFollowed, toggleFollow, recordAdStats, rankByAds } from './store';
import { nav, closePlayer, minimizePlayer, openChannel, play, type PlayerTarget } from './nav';
import { Icon, Sheet, Spinner } from './ui';
import { rewards, watchChannel, channelHasDrops, accountStreamURL, checkDrops, log as rewardsLog, twitchFollowState, setTwitchFollow } from './rewards';

const SOURCE_LABEL: Record<string, string> = { as: 'Luminous Asien', al: 'Proxy Albanien', eu: 'Luminous Europa', twitch: 'Twitch offiziell' };
type V = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitShowPlaybackTargetPicker?: () => void;
  webkitSetPresentationMode?: (m: string) => void; webkitSupportsPresentationMode?: (m: string) => boolean };

/** Starts playback; without a user gesture iOS refuses sound, so it falls back to muted. */
async function start(v: HTMLVideoElement, onMuted: () => void) {
  try { await v.play(); } catch (e) {
    // After a refused play() WebKit can leave the element without a source (networkState
    // NO_SOURCE, seen after a source switch): load() restarts resource selection.
    // Only then: an unconditional load() also reset a pending resume position to 0.
    if ((e as Error).name === 'NotAllowedError') {
      v.muted = true; onMuted();
      if (v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) v.load();
      v.play().catch(() => {});
    }
  }
}
/** Seek once the position is really seekable: Safari's HLS ignores a seek at loadedmetadata
 *  (measured: a VOD resumed at 0:07 instead of 1:00:05). */
function seekWhenReady(v: HTMLVideoElement, at: number) {
  const events = ['loadedmetadata', 'canplay', 'progress', 'timeupdate'];
  const done = () => events.forEach(e => v.removeEventListener(e, check));
  const check = () => {
    if (!v.seekable.length || v.seekable.end(v.seekable.length - 1) < Math.min(at, 1)) return;
    const end = v.seekable.end(v.seekable.length - 1);
    v.currentTime = Math.min(at, end - 2);
    done();
  };
  events.forEach(e => v.addEventListener(e, check));
  setTimeout(done, 20000);
}
let sleepAt = 0;
export const sleepRemaining = () => sleepAt ? Math.max(0, sleepAt - Date.now()) : 0;

export function PlayerHost() {
  const s = useStore();
  const t = nav.player;
  if (!t) return null;
  const key = JSON.stringify(t.kind === 'clips' ? { k: 'clips', i: t.index, n: t.clips.length } : t);
  const cls = 'player' + (nav.playerMin ? ' mini' : '') + (s.settings.chatHidden ? ' no-chat' : '');
  const open = () => nav.playerMin && minimizePlayer(false);
  if (t.kind === 'clips') return <div class={cls} onClick={open}><ClipFeed key={key} clips={t.clips} index={t.index} /></div>;
  if (t.kind === 'multi') return <div class={cls} onClick={open}><MultiLive key={key} initial={t.logins} /></div>;
  return <div class={cls}><SinglePlayer key={key} target={t} /></div>;
}

type Info = { title: string; sub: string; login?: string; name?: string; avatar?: string; userId?: string; viewers?: number; startedAt?: string; thumb?: string };

function SinglePlayer({ target }: { target: Exclude<PlayerTarget, { kind: 'clips' } | { kind: 'multi' }> }) {
  const s = useStore();
  const video = useRef<V>(null);
  const [info, setInfo] = useState<Info>({ title: '', sub: '' });
  const [status, setStatus] = useState<string | null>('Wird geladen …');
  const [error, setError] = useState<{ text: string; offline?: boolean } | null>(null);
  const [qualities, setQualities] = useState<{ keys: string[]; links: Record<string, string> }>({ keys: [], links: {} });
  const [quality, setQuality] = useState('auto');
  const [source, setSource] = useState<string>();
  const [mutedHint, setMutedHint] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapters, setChapters] = useState<{ start: number; title: string }[]>([]);
  const [vodChat, setVodChat] = useState<{ id: string; channelId?: string; offset: number }>();
  // Live rewind: the running broadcast's recording, played natively (its seekable range is the whole broadcast).
  const [archiveId, setArchiveId] = useState<string>();
  const [inArchive, setInArchive] = useState(false);
  const inArchiveRef = useRef(false);
  inArchiveRef.current = inArchive;
  const [ad, setAd] = useState(false);
  const [tryOrder, setTryOrder] = useState<tw.LiveSource[]>();
  const liveURL = useRef('');
  const pull = useRef<{ x: number; y: number }>();
  const isLive = target.kind === 'live';

  const setSrc = (url: string, at?: number) => {
    const v = video.current!; v.src = url;
    if (at != null) seekWhenReady(v, at);
    start(v, () => setMutedHint(true));
  };

  // Resolve and start --------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    setError(null); setStatus('Wird geladen …');
    (async () => {
      if (target.kind === 'live') {
        const login = target.login.toLowerCase();
        const st = await tw.streamStats(login);
        if (!alive) return;
        if (st && !st.exists) { setError({ text: 'Streamer nicht gefunden.' }); return; }
        if (st && !st.stream) { setError({ text: 'Der Stream ist offline.', offline: true }); setInfo({ title: login, sub: '', login }); return; }
        const sInfo = st?.stream;
        setInfo({ title: sInfo?.title ?? login, sub: sInfo?.game ?? '', login, name: sInfo?.name, avatar: st?.avatar, userId: st?.userId,
          viewers: sInfo?.viewers, startedAt: sInfo?.startedAt, thumb: sInfo?.thumb });
        setArchiveId(st?.archiveId);
        // Automatic order: proxies by measured ad breaks, official Twitch stays where it is.
        const ranked = (o: tw.LiveSource[]) => {
          const proxies = rankByAds(o.filter(x => x !== 'twitch'));
          return o.map(x => x === 'twitch' ? x : proxies.shift()!);
        };
        const order = tryOrder ?? (s.settings.adRanking ? ranked(s.settings.sourceOrder) : s.settings.sourceOrder);
        const hit = await tw.raceLive(order, login, s.settings.lowLatency, src => alive && setStatus(`Quelle: ${SOURCE_LABEL[src]} …`), !!tryOrder);
        if (!alive) return;
        if (!hit) { setError({ text: st ? 'Keine Quelle hat für diesen Livestream geantwortet.' : 'Netzwerkfehler.' }); return; }
        setSource(hit.src);
        let url = hit.url, q = 'auto';
        if (hit.master) {
          const keys = sortQualities(Object.keys(hit.master.links), hit.master.variants);
          setQualities({ keys: ['auto', ...keys], links: { auto: hit.url, ...hit.master.links } });
          q = s.settings.quality === 'auto' ? 'auto' : preferredQualityKey(keys, s.settings.quality, hit.master.variants);
          url = q === 'auto' ? hit.url : hit.master.links[q];
        } else setQualities({ keys: ['auto'], links: { auto: hit.url } });
        setQuality(q); liveURL.current = url; setInArchive(false);
        setSrc(url);
        addHistory({ kind: 'live', id: login, title: sInfo?.title ?? '', login, name: sInfo?.name ?? login, thumb: sInfo?.thumb ?? '' });
      } else if (target.kind === 'vod') {
        const [meta, url] = await Promise.all([tw.vodMeta(target.id), tw.vodURL(target.id)]);
        if (!alive) return;
        if (!url || meta === null) { setError({ text: 'VOD nicht gefunden oder nur für Abonnenten.' }); return; }
        if (meta) {
          setInfo({ title: meta.title, sub: meta.createdAt ? new Date(meta.createdAt).toLocaleDateString('de-DE') : '', login: meta.login, name: meta.name, avatar: meta.avatar, userId: meta.ownerId, thumb: meta.thumb });
          setChapters(meta.chapters);
          addHistory({ kind: 'vod', id: target.id, title: meta.title, login: meta.login, name: meta.name, thumb: meta.thumb, length: meta.length });
        }
        setQualities({ keys: ['auto'], links: { auto: url } });
        const saved = state.progress[target.id];
        const at = target.start ?? (saved && meta && saved < meta.length * 0.95 ? saved : undefined);
        setVodChat({ id: target.id, channelId: meta?.ownerId, offset: at ?? 0 });
        setSrc(url, at);
      } else {
        const c = await tw.clipPlayback(target.slug);
        if (!alive) return;
        if (!c || !Object.keys(c.links).length) { setError({ text: 'Clip nicht gefunden.' }); return; }
        const keys = sortQualities(Object.keys(c.links));
        const q = preferredQualityKey(keys, s.settings.quality === 'auto' ? 'source' : s.settings.quality);
        setQualities({ keys, links: c.links }); setQuality(q);
        setInfo({ title: c.title, sub: c.name ?? '', login: c.login, name: c.name });
        (window as any).__clipVod = c.vodId ? { id: c.vodId, at: c.vodOffset } : undefined;
        video.current!.loop = true;
        setSrc(c.links[q]);
        addHistory({ kind: 'clip', id: target.slug, title: c.title, login: c.login ?? '', name: c.name ?? '', thumb: '' });
      }
      setStatus(null);
    })();
    return () => { alive = false; };
  }, [tryOrder]);

  // Lock screen / Control Center metadata
  useEffect(() => {
    if (!('mediaSession' in navigator) || !info.title) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: info.title, artist: info.name ?? info.sub,
      artwork: info.avatar ? [{ src: info.avatar, sizes: '150x150' }] : [] });
  }, [info.title]);

  // VOD progress (saved, not rendered app-wide), sleep timer
  useEffect(() => {
    const v = video.current!;
    let last = 0;
    const tick = () => {
      if (target.kind === 'vod' && Math.abs(v.currentTime - last) >= 5) { last = v.currentTime; setProgress(target.id, v.currentTime); }
      if (sleepAt && Date.now() >= sleepAt) { sleepAt = 0; v.pause(); closePlayer(); }
    };
    v.addEventListener('timeupdate', tick);
    v.playbackRate = target.kind === 'live' ? 1 : s.settings.speed;
    return () => { v.removeEventListener('timeupdate', tick); if (target.kind === 'vod') setProgress(target.id, v.currentTime); v.removeAttribute('src'); v.load(); };
  }, []);

  // Viewers, title and category every minute (getStreamStats), not only when opening.
  useEffect(() => {
    if (target.kind !== 'live') return;
    const t = setInterval(async () => {
      const st = await tw.streamStats(target.login.toLowerCase());
      const x = st?.stream; if (!x) return;
      setInfo(i => ({ ...i, title: x.title, sub: x.game, viewers: x.viewers }));
      if (st.archiveId) setArchiveId(st.archiveId);
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // Ad-break statistics per source: seconds watched live and breaks started.
  const adRef = useRef(false);
  useEffect(() => {
    if (target.kind !== 'live' || !source) return;
    const t = setInterval(() => {
      const v = video.current;
      if (v && !v.paused && !inArchiveRef.current) recordAdStats(source, 10, 0);
    }, 10000);
    return () => clearInterval(t);
  }, [source]);
  useEffect(() => {
    if (ad && !adRef.current && source) recordAdStats(source, 0, 1);
    adRef.current = ad;
  }, [ad]);

  // Closing iOS's fullscreen player pauses the video ~0.3 s later (measured in the Simulator);
  // if it was playing, carry on.
  useEffect(() => {
    const v = video.current!;
    const onEnd = () => {
      if (v.paused) return;
      const resume = () => { v.removeEventListener('pause', resume); v.play().catch(() => {}); };
      v.addEventListener('pause', resume);
      setTimeout(() => v.removeEventListener('pause', resume), 1500);
    };
    v.addEventListener('webkitendfullscreen', onEnd);
    return () => v.removeEventListener('webkitendfullscreen', onEnd);
  }, []);

  // Ad breaks: Safari exposes EXT-X-DATERANGE as metadata cues (see adActive).
  useEffect(() => {
    if (!isLive) return;
    const v = video.current!;
    const add = (e: TrackEvent) => { const tr = e.track as TextTrack; if (tr?.kind === 'metadata') tr.mode = 'hidden'; };
    v.textTracks.addEventListener('addtrack', add as any);
    const t = setInterval(() => {
      const cues = Array.from(v.textTracks).filter(tr => tr.kind === 'metadata')
        .flatMap(tr => Array.from(tr.activeCues ?? [])).map(c => ({ id: c.id, start: c.startTime, value: (c as any).value }));
      setAd(adActive(cues));
    }, 1000);
    return () => { v.textTracks.removeEventListener('addtrack', add as any); clearInterval(t); };
  }, []);
  // Mute for the break, then restore what it was: unmuting a video that started muted without
  // a tap makes iOS pause it (seen in the Simulator after a real pre-roll).
  const mutedBeforeAd = useRef(false);
  useEffect(() => {
    const v = video.current;
    if (!s.settings.adSwitch || !isLive || !v) return;
    if (ad) { mutedBeforeAd.current = v.muted; v.muted = true; }
    else if (!mutedBeforeAd.current) { v.muted = false; if (v.paused) v.play().catch(() => { v.muted = true; setMutedHint(true); v.play().catch(() => {}); }); }
  }, [ad]);

  // Channel points + drops for the account of the rewards login (rewards.ts). Only once the
  // stream really plays, so an offline or failing channel reports nothing.
  const [dropsURL, setDropsURL] = useState<string>();
  useEffect(() => {
    if (target.kind !== 'live' || !source || !rewards.account) return;
    const login = target.login.toLowerCase();
    const stop = watchChannel(login);
    let alive = true, timer: ReturnType<typeof setInterval> | undefined;
    channelHasDrops(login).then(async has => {
      if (!alive || !has) return;
      rewardsLog(`Drops auf ${login}: Fortschritt läuft`);
      if (s.settings.dropsStream) setDropsURL(await accountStreamURL(login));
      checkDrops();
      timer = setInterval(() => checkDrops(), 300000);
    });
    return () => { alive = false; stop(); clearInterval(timer); setDropsURL(undefined); };
  }, [source, rewards.account?.userId]);

  const v = video.current;
  const changeQuality = (k: string) => {
    setQuality(k);
    if (target.kind === 'live') liveURL.current = qualities.links[k];
    const at = target.kind === 'live' ? undefined : v?.currentTime;
    if (!inArchive) setSrc(qualities.links[k], at);
    if (k !== 'auto' && target.kind !== 'clip') setSetting('quality', /audio/.test(k) ? 'audio' : k.toLowerCase().startsWith('source') ? 'source' : String(parseInt(k) || 'source'));
  };
  const goLive = () => { setInArchive(false); setSrc(liveURL.current); };
  const seekLive = async (t: number) => {
    if (!archiveId) { if (v && v.seekable.length) v.currentTime = Math.max(v.seekable.start(0), Math.min(v.seekable.end(0), v.currentTime + (t - liveTotal()))); return; }
    if (t >= liveTotal() - 5) return goLive();
    if (inArchive && v) { v.currentTime = t; return; }
    const url = await tw.vodURL(archiveId);
    if (!url) return;
    setInArchive(true); setSrc(url, t);
  };
  const liveTotal = () => info.startedAt ? (Date.now() - Date.parse(info.startedAt)) / 1000 : 0;
  const backupSource = async () => {
    // Ad-free attempt: tokens of other player types (embed/popout/autoplay) often carry no ad break.
    for (const p of tw.BACKUP_PLAYER_TYPES) {
      const t = await tw.liveToken(info.login!, p);
      if (t) { const url = tw.usherLiveURL(info.login!, t, s.settings.lowLatency); liveURL.current = url; setSource('twitch'); setQualities({ keys: ['auto'], links: { auto: url } }); setQuality('auto'); setSrc(url); return; }
    }
  };

  return <>
    <div class={'stage' + (s.settings.fillScreen ? ' fill' : '')}
      // Pinch out fills the screen in landscape, pinch in shows the whole picture (fillScreen).
      {...{ ongestureend: (e: any) => { if (matchMedia('(orientation: landscape)').matches && Math.abs(e.scale - 1) > 0.1) setSetting('fillScreen', e.scale > 1); } }}
      onTouchStart={e => { pull.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={e => {
        const p = pull.current; pull.current = undefined;
        if (!p || matchMedia('(orientation: landscape)').matches) return;
        const dx = e.changedTouches[0].clientX - p.x, dy = e.changedTouches[0].clientY - p.y;
        if (dy > 90 && Math.abs(dx) < 60) minimizePlayer();
      }}>
      <video ref={video} playsInline preload="auto" {...{ 'x-webkit-airplay': 'allow' }} poster={info.thumb?.replace('{width}', '640').replace('{height}', '360')} />
      {dropsURL && <video class="drops-stream" src={dropsURL} autoPlay muted playsInline aria-hidden="true" />}
      <Controls video={video} kind={target.kind} info={info} inArchive={inArchive} archive={!!archiveId} liveTotal={liveTotal}
        onSeekLive={seekLive} onGoLive={goLive} onSettings={() => setSettingsOpen(true)} chapters={chapters} />
      {status && !error && <div class="stage-msg"><Spinner text={status} /></div>}
      {error && <div class="stage-msg"><p>{error.text}</p>
        {error.offline && info.login && <button class="btn prominent" onClick={() => openChannel(info.login!)}>Kanalseite öffnen</button>}
        {!error.offline && target.kind === 'live' && <button class="btn bordered" onClick={() => setTryOrder([...(tryOrder ?? s.settings.sourceOrder)])}>Erneut versuchen</button>}</div>}
      {mutedHint && <button class="pill-btn unmute" onClick={() => {
        if (!v) return;
        setMutedHint(false);
        // The tap unlocks sound for this element; during a break it comes back after the ad.
        if (ad && s.settings.adSwitch) { mutedBeforeAd.current = false; v.muted = false; v.muted = true; }
        else v.muted = false;
      }}>🔇 Ton an</button>}
      {ad && <div class="ad-banner">Werbepause · Ton aus{source !== 'twitch' || <button class="link" onClick={backupSource}>Ersatz-Stream</button>}</div>}
    </div>
    <div class="mini-bar" onClick={() => minimizePlayer(false)}>
      <div class="mini-text"><div class="card-title">{info.name ?? info.title}</div><div class="card-sub">{info.title}</div></div>
      <button class="nav-btn" onClick={e => { e.stopPropagation(); v && (v.paused ? v.play() : v.pause()); }} aria-label="Wiedergabe"><Icon n="pause" /></button>
      <button class="nav-btn" onClick={e => { e.stopPropagation(); closePlayer(); }} aria-label="Schließen"><Icon n="close" /></button>
    </div>
    <div class="below">
      <div class="info-row">
        {info.avatar && <img class="avatar sm" src={info.avatar} alt="" onClick={() => info.login && openChannel(info.login)} />}
        <div class="info-text" onClick={() => info.login && openChannel(info.login)}>
          <div class="card-title">{info.title}</div>
          <div class="card-sub">{[info.name, info.sub, info.viewers != null ? formatViewers(info.viewers) + ' Zuschauer' : '', source ? SOURCE_LABEL[source] : ''].filter(Boolean).join(' · ')}</div>
        </div>
        {info.login && rewards.balance[info.login] != null && <span class="points" title="Kanalpunkte">◆ {formatViewers(rewards.balance[info.login])}</span>}
        {info.login && <button class={'nav-btn' + (isFollowed(info.login) ? ' accent' : ' muted')} aria-label="Folgen" onClick={async () => {
          // With the TV login the heart follows on Twitch, otherwise locally.
          const st = rewards.account && await twitchFollowState(info.login!);
          if (st) await setTwitchFollow(st.id, info.login!, !st.following); else toggleFollow(info.login!);
        }}><Icon n="heart" /></button>}
      </div>
      {target.kind === 'clip' && (window as any).__clipVod && <button class="btn bordered small pad-x" onClick={() => play({ kind: 'vod', id: (window as any).__clipVod.id, start: (window as any).__clipVod.at })}>Zur VOD</button>}
      {!s.settings.chatHidden && target.kind === 'live' && info.login && <ChatPanel login={info.login} channelId={info.userId} />}
      {!s.settings.chatHidden && target.kind === 'vod' && vodChat && <ChatPanel vod={vodChat} video={video} />}
    </div>
    {settingsOpen && <PlayerSettings onClose={() => setSettingsOpen(false)} video={video} kind={target.kind} qualities={qualities.keys} quality={quality}
      onQuality={changeQuality} source={source} onSource={src => { setTryOrder([src, ...s.settings.sourceOrder.filter(x => x !== src)]); setSettingsOpen(false); }}
      chapters={chapters} login={info.login} />}
  </>;
}

// Our own controls (YouTube-style overlay from PlayerControls.swift) ----------------------------------
function Controls({ video, kind, info, inArchive, archive, liveTotal, onSeekLive, onGoLive, onSettings, chapters }: {
  video: { current: V | null }; kind: string; info: Info; inArchive: boolean; archive: boolean; liveTotal: () => number;
  onSeekLive: (t: number) => void; onGoLive: () => void; onSettings: () => void; chapters: { start: number; title: string }[] }) {
  const [shown, setShown] = useState(true);
  const [, tick] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const hideT = useRef<ReturnType<typeof setTimeout>>();
  const lastTap = useRef(0);
  const v = video.current;
  useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  const show = () => { setShown(true); clearTimeout(hideT.current); hideT.current = setTimeout(() => { if (video.current && !video.current.paused) setShown(false); }, 3000); };
  useEffect(show, []);
  const live = kind === 'live';
  const total = live ? liveTotal() : (v && isFinite(v.duration) ? v.duration : 0);
  const pos = drag ?? (live ? (inArchive ? v?.currentTime ?? 0 : total) : v?.currentTime ?? 0);
  const atEdge = live && !inArchive;
  const seekBy = (d: number) => { if (!v) return; if (live) onSeekLive(pos + d); else v.currentTime = Math.max(0, Math.min(total, v.currentTime + d)); show(); };
  const tap = (e: MouseEvent, side: number) => {
    const now = Date.now();
    if (now - lastTap.current < 300) { seekBy(side * 10); lastTap.current = 0; return; } // double tap ±10 s
    lastTap.current = now;
    setTimeout(() => { if (lastTap.current === now) { shown ? setShown(false) : show(); } }, 300);
    e.stopPropagation();
  };
  const commit = (t: number) => { setDrag(null); if (live) onSeekLive(t); else if (v) v.currentTime = t; show(); };
  const pip = () => { if (!v) return; if (v.webkitSupportsPresentationMode?.('picture-in-picture')) v.webkitSetPresentationMode!('picture-in-picture'); else (v as any).requestPictureInPicture?.(); };
  const canSeek = !live || archive || (v?.seekable.length ?? 0) > 0;
  // Hidden where iOS has no picture-in-picture (the Simulator's Safari reports none).
  const canPip = !!v && (v.webkitSupportsPresentationMode?.('picture-in-picture') || document.pictureInPictureEnabled);
  return <div class={'controls' + (shown ? ' on' : '')}>
    <button class="tapzone l" aria-label="Steuerung" onClick={e => tap(e, -1)} /><button class="tapzone r" aria-label="Steuerung" onClick={e => tap(e, 1)} />
    {shown && <>
      <div class="ctl-top">
        <button class="glass" onClick={() => minimizePlayer()} aria-label="Minimieren"><Icon n="down" /></button>
        <div class="ctl-title">{info.name && <b>{info.name}</b>}{live && info.startedAt && <span> · {formatClock(liveTotal())}</span>}</div>
        <button class="glass" onClick={() => v?.webkitShowPlaybackTargetPicker?.()} aria-label="AirPlay"><Icon n="airplay" /></button>
        {canPip && <button class="glass" onClick={pip} aria-label="Bild in Bild"><Icon n="pip" /></button>}
        <button class="glass" onClick={onSettings} aria-label="Einstellungen"><Icon n="gear" /></button>
      </div>
      <div class="ctl-mid">
        {canSeek && <button class="glass big" onClick={() => seekBy(-10)} aria-label="10 Sekunden zurück"><Icon n="rew" size={28} /></button>}
        <button class="glass big" onClick={() => { if (!v) return; v.paused ? v.play() : v.pause(); show(); }} aria-label="Wiedergabe/Pause"><Icon n={v?.paused ? 'play' : 'pause'} size={32} /></button>
        {canSeek && <button class="glass big" onClick={() => seekBy(10)} aria-label="10 Sekunden vor"><Icon n="fwd" size={28} /></button>}
      </div>
      <div class="ctl-bottom">
        <span class="time">{live ? (atEdge ? <button class="live-dot on" onClick={onGoLive}>● Live</button>
          : <>{formatClock(pos)} / {formatClock(total)} · <button class="live-dot" onClick={onGoLive}>● Live</button></>)
          : `${formatClock(pos)} / ${formatClock(total)}`}</span>
        <button class="glass" onClick={() => v?.webkitEnterFullscreen ? v.webkitEnterFullscreen() : v?.requestFullscreen?.()} aria-label="Vollbild"><Icon n="full" /></button>
      </div>
    </>}
    {total > 0 && canSeek && (live ? archive : true) && <div class={'scrub' + (shown ? ' on' : '')}>
      {chapters.map(c => <i style={{ left: `${c.start / total * 100}%` }} />)}
      <input type="range" min={0} max={total} step={1} value={pos} aria-label="Position"
        onInput={e => { setDrag(Number((e.target as HTMLInputElement).value)); show(); }}
        onChange={e => commit(Number((e.target as HTMLInputElement).value))} />
    </div>}
  </div>;
}

function PlayerSettings({ onClose, video, kind, qualities, quality, onQuality, source, onSource, chapters, login }: {
  onClose: () => void; video: { current: V | null }; kind: string; qualities: string[]; quality: string; onQuality: (q: string) => void;
  source?: string; onSource: (s: tw.LiveSource) => void; chapters: { start: number; title: string }[]; login?: string }) {
  const s = useStore();
  const v = video.current;
  const [, re] = useState(0);
  const setSleep = (min: number) => { sleepAt = min ? Date.now() + min * 60000 : 0; re(x => x + 1); };
  return <Sheet title="Einstellungen" onClose={onClose}>
    <div class="group">
      <label class="row"><span>Qualität</span><select value={quality} onChange={e => onQuality((e.target as HTMLSelectElement).value)}>
        {qualities.map(k => <option value={k}>{qualityText(k)}</option>)}</select></label>
      {kind === 'live' && qualities.length <= 1 && <p class="hint">Bei „Twitch offiziell“ wählt der iPhone-Player die Qualität selbst: Twitch lässt fremde Seiten die Qualitätsliste nicht lesen.</p>}
      {kind === 'live' && <label class="row"><span>Quelle</span><select value={source} onChange={e => onSource((e.target as HTMLSelectElement).value as tw.LiveSource)}>
        {tw.LIVE_SOURCES.map(x => <option value={x}>{SOURCE_LABEL[x]}</option>)}</select></label>}
      {kind !== 'live' && v && <label class="row"><span>Geschwindigkeit</span><select value={String(v.playbackRate)} onChange={e => { const r = Number((e.target as HTMLSelectElement).value); v.playbackRate = r; setSetting('speed', r); }}>
        {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(r => <option value={String(r)}>{r === 1 ? 'Normal' : r + '×'}</option>)}</select></label>}
      {kind !== 'clip' && <label class="row"><span>Chat</span><input type="checkbox" class="switch" checked={!s.settings.chatHidden} onChange={e => setSetting('chatHidden', !(e.target as HTMLInputElement).checked)} /></label>}
      <label class="row"><span>Schlaf-Timer{sleepRemaining() ? ` (noch ${Math.ceil(sleepRemaining() / 60000)} min)` : ''}</span>
        <select value="" onChange={e => setSleep(Number((e.target as HTMLSelectElement).value))}>
          <option value="">{sleepRemaining() ? 'Aktiv' : 'Aus'}</option>{[0, 15, 30, 45, 60, 90, 120].map(m => <option value={m}>{m ? `${m} min` : 'Aus'}</option>)}</select></label>
    </div>
    {chapters.length > 0 && <><h3 class="section-title">Kapitel</h3><div class="group">{chapters.map(c =>
      <button class="row" onClick={() => { if (v) v.currentTime = c.start; onClose(); }}><span>{c.title}</span><span class="row-sub">{formatClock(c.start)}</span></button>)}</div></>}
    {login && <div class="group">
      <button class="row accent" onClick={() => { onClose(); openChannel(login); }}>Kanalseite öffnen</button>
      {kind === 'live' && <button class="row accent" onClick={() => { onClose(); play({ kind: 'multi', logins: [login] }); }}>Multi-Live mit diesem Kanal</button>}
      <button class="row accent" onClick={() => navigator.share?.({ url: `https://www.twitch.tv/${login}` }).catch(() => {})}>Teilen</button>
    </div>}
  </Sheet>;
}

// Chat panel ------------------------------------------------------------------------------------
function ChatPanel({ login, channelId, vod, video }: { login?: string; channelId?: string; vod?: { id: string; channelId?: string; offset: number }; video?: { current: V | null } }) {
  const s = useStore();
  const list = useRef<HTMLDivElement>(null);
  const msgs = useRef<ChatMsg[]>([]);
  const [, render] = useState(0);
  const [follow, setFollow] = useState(true);
  const [room, setRoom] = useState<RoomState>({});
  const [conn, setConn] = useState(false);
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [card, setCard] = useState<{ login: string } | { emote: string; url: string }>();
  const client = useRef<ChatClient>();
  const cid = channelId ?? vod?.channelId;
  const add = (batch: ChatMsg[]) => {
    msgs.current = [...msgs.current, ...batch].slice(-250);
    render(x => x + 1);
    if (state.settings.chatTranslate) for (const m of batch) if (wantsTranslation(m))
      translate(m.parts.filter(p => p.t === 'text').map(p => p.v).join(' ').replace(/\s+/g, ' ').trim()).then(tr => { if (tr) { m.translation = tr; render(x => x + 1); } });
  };
  useEffect(() => { loadGlobalEmotes().then(() => render(x => x + 1)); }, []);
  useEffect(() => { if (cid && (login || vod)) loadChannelEmotes(cid, login ?? '').then(() => render(x => x + 1)); }, [cid]);
  useEffect(() => {
    if (!login) return;
    const c = new ChatClient(login, channelId, add, e => {
      if (e.type === 'clear') { msgs.current.forEach(m => { if ((e.id && m.id === e.id) || (e.login && m.login === e.login) || (!e.id && !e.login)) m.deleted = true; }); render(x => x + 1); }
      else if (e.type === 'notice') setNotice(e.text);
      else { setRoom({ ...c.room }); setConn(c.connected); }
    });
    client.current = c;
    return () => c.close();
  }, [login, channelId, s.account?.token]);
  useEffect(() => {
    if (!vod || !video) return;
    const chat = new VodChat(vod.id, vod.channelId);
    const t = setInterval(async () => {
      const v = video.current; if (!v) return;
      const { msgs: due, reset } = await chat.tick(v.currentTime);
      if (reset) msgs.current = [];
      if (due.length || reset) add(due);
    }, 1000);
    return () => clearInterval(t);
  }, [vod?.id]);
  useEffect(() => { if (follow && list.current) list.current.scrollTop = list.current.scrollHeight; });
  const shown = msgs.current.filter(m => (s.settings.chatShowDeleted || !m.deleted) && !(s.settings.chatHideBots && isBotLine(m)));
  const modes = [room.slow ? `Slow-Modus ${room.slow} s` : '', room.followers != null && room.followers >= 0 ? 'Nur Follower' : '', room.subs ? 'Nur Abonnenten' : '',
    room.emoteOnly ? 'Nur Emotes' : '', login && !conn ? 'Verbinde …' : ''].filter(Boolean).join(' · ');
  const send = (e: Event) => { e.preventDefault(); if (text.trim() && client.current?.send(text.trim())) setText(''); };
  return <div class="chat" style={{ fontSize: s.settings.chatFont + 'px' }}>
    <div class="chat-list" ref={list} onScroll={e => { const el = e.target as HTMLDivElement; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }}>
      {shown.map(m => <div class={'msg' + (m.mention ? ' mention' : '') + (m.deleted ? ' deleted' : '') + (m.system ? ' system' : '') + (m.history ? ' old' : '')}>
        {m.system && <div class="sys">{m.system}</div>}
        {s.settings.chatTimestamps && <span class="ts">{m.offset != null ? formatClock(m.offset) : new Date(m.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} </span>}
        {m.badges.map(b => <img class="badge-img" src={b.url} alt={b.title} title={b.title} />)}
        {(m.parts.length > 0 || !m.system) && <b style={{ color: m.color }} onClick={() => setCard({ login: m.login })}>{m.name}</b>}{m.parts.length > 0 && (m.action ? ' ' : ': ')}
        <span style={m.action ? { color: m.color, fontStyle: 'italic' } : undefined}>{m.parts.map(p => p.t === 'emote' ? <img class="emote" src={p.url} alt={p.v} title={p.v} onClick={() => setCard({ emote: p.v, url: p.url })} />
          : p.t === 'link' ? <a href={p.v.startsWith('http') ? p.v : 'https://' + p.v} target="_blank" rel="noopener noreferrer">{p.v}</a>
          : p.t === 'mention' ? <b>{p.v}</b> : p.v)}</span>
        {m.translation && <div class="tr">🌐 {m.translation}</div>}
      </div>)}
    </div>
    {!follow && <button class="pill-btn jump" onClick={() => { setFollow(true); if (list.current) list.current.scrollTop = list.current.scrollHeight; }}>Zu neuen Nachrichten</button>}
    {(modes || notice) && <div class="info-line">{[modes, notice].filter(Boolean).join(' · ')}</div>}
    {login && (client.current?.canSend || s.account ? <form class="chat-input" onSubmit={send}>
      <button type="button" class="nav-btn" onClick={() => setPicker(!picker)} aria-label="Emotes"><Icon n="smile" /></button>
      <input value={text} onInput={e => setText((e.target as HTMLInputElement).value)} placeholder="Chatten …" maxLength={500} enterkeyhint="send" />
      {text && <button class="nav-btn accent" aria-label="Senden"><Icon n="send" /></button>}
    </form> : <div class="info-line">Zum Chatten in den Einstellungen mit Twitch anmelden.</div>)}
    {card && ('login' in card
      ? <UserCard login={card.login} msgs={msgs.current.filter(m => m.login === card.login)} onClose={() => setCard(undefined)} />
      : <Sheet title={card.emote} onClose={() => setCard(undefined)}><div class="emote-info">
          <img src={card.url.replace(/\/2x(\.webp)?$/, '/4x$1').replace('/2.0', '/3.0')} alt={card.emote} />
          <p class="row-sub">{emoteSource(card.url)}</p></div></Sheet>)}
    {picker && <div class="emote-picker">{emoteList(cid).slice(0, 400).map(e => <button onClick={() => setText(t => (t ? t + ' ' : '') + e.name + ' ')}><img src={e.url} alt={e.name} title={e.name} loading="lazy" /></button>)}</div>}
  </div>;
}

// Multi-live --------------------------------------------------------------------------------------
function MultiLive({ initial }: { initial: string[] }) {
  const [logins, setLogins] = useState(initial);
  const [active, setActive] = useState(initial[0]);
  const [adding, setAdding] = useState(false);
  return <div class="multi">
    <div class="multi-top">
      <button class="glass" onClick={() => minimizePlayer()} aria-label="Minimieren"><Icon n="down" /></button>
      <b>Multi-Live</b>
      {logins.length < 4 && <button class="glass" onClick={() => setAdding(true)} aria-label="Kanal hinzufügen">＋</button>}
      <button class="glass" onClick={closePlayer} aria-label="Schließen"><Icon n="close" /></button>
    </div>
    <div class={'multi-grid n' + logins.length}>
      {logins.map(l => <MultiCell key={l} login={l} active={l === active} onTap={() => setActive(l)} onRemove={() => { const n = logins.filter(x => x !== l); setLogins(n); if (active === l) setActive(n[0]); if (!n.length) closePlayer(); }} />)}
    </div>
    <p class="hint pad">Tippe ein Bild an, um seinen Ton zu hören. iOS spielt immer nur einen Stream mit Ton ab.</p>
    {active && <ChatPanel login={active} />}
    {adding && <AddChannelSheet exclude={logins} onPick={l => { setLogins([...logins, l]); setAdding(false); }} onClose={() => setAdding(false)} />}
  </div>;
}
function MultiCell({ login, active, onTap, onRemove }: { login: string; active: boolean; onTap: () => void; onRemove: () => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState<string | null>('Wird geladen …');
  useEffect(() => {
    let alive = true;
    tw.raceLive(state.settings.sourceOrder, login, state.settings.lowLatency).then(hit => {
      if (!alive || !v.current) return;
      if (!hit) { setMsg('Offline oder keine Quelle'); return; }
      // Lower quality for the grid: four 1080p streams overload a phone.
      const url = hit.master ? hit.master.links[preferredQualityKey(Object.keys(hit.master.links), '480', hit.master.variants)] : hit.url;
      v.current.muted = true; v.current.src = url; v.current.play().catch(() => {}); setMsg(null);
    });
    return () => { alive = false; };
  }, [login]);
  // iOS pauses the audible video when another one gets sound (measured): the cell that loses the
  // sound is muted and started again.
  useEffect(() => {
    const el = v.current; if (!el) return;
    el.muted = !active;
    el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
    if (!active) setTimeout(() => { if (el.paused) el.play().catch(() => {}); }, 500);
  }, [active]);
  return <div class={'cell' + (active ? ' active' : '')} onClick={onTap} role="button" aria-label={`Ton von ${login}`}>
    <video ref={v} playsInline muted />
    <span class="cell-name">{login}{active ? ' 🔊' : ''}</span>
    {msg && <span class="cell-msg">{msg}</span>}
    <button class="cell-x" onClick={e => { e.stopPropagation(); onRemove(); }} aria-label="Entfernen"><Icon n="close" size={14} /></button>
  </div>;
}
function AddChannelSheet({ exclude, onPick, onClose }: { exclude: string[]; onPick: (l: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [live, setLive] = useState<tw.ChannelBrief[]>();
  useEffect(() => { tw.channels([...new Set([...state.follows, ...state.accountFollows])]).then(l => setLive((l ?? []).filter(c => c.stream && !exclude.includes(c.login)))); }, []);
  return <Sheet title="Kanal hinzufügen" onClose={onClose}>
    <form class="search" onSubmit={e => { e.preventDefault(); if (q.trim()) onPick(q.trim().toLowerCase()); }}>
      <input placeholder="Kanalname" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} autocapitalize="off" /></form>
    {!live ? <Spinner /> : <div class="list">{live.map(c => <button class="list-row" onClick={() => onPick(c.login)}>
      <img class="avatar sm" src={c.avatar} alt="" /><div><div>{c.name}</div><div class="row-sub">{c.stream!.game} · {formatViewers(c.stream!.viewers)}</div></div></button>)}</div>}
  </Sheet>;
}

// Clip feed (ClipFeedView: vertical, one looping player at a time) ---------------------------------
function ClipFeed({ clips, index }: { clips: tw.Clip[]; index: number }) {
  const [cur, setCur] = useState(index);
  const feed = useRef<HTMLDivElement>(null);
  // One <video> for the whole feed: iOS allows sound per element once it played from a tap, so a
  // fresh element per clip would start every following clip muted.
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);
  const [vod, setVod] = useState<{ id: string; at?: number }>();
  useEffect(() => { feed.current?.children[index]?.scrollIntoView(); }, []);
  useEffect(() => {
    let alive = true; setReady(false);
    const c = clips[cur];
    tw.clipPlayback(c.slug).then(p => {
      if (!alive || !p || !video.current) return;
      const keys = Object.keys(p.links);
      video.current.src = p.links[preferredQualityKey(keys, state.settings.quality === 'auto' ? 'source' : state.settings.quality)];
      start(video.current, () => setMuted(true));
      setVod(p.vodId ? { id: p.vodId, at: p.vodOffset } : undefined);
      addHistory({ kind: 'clip', id: c.slug, title: c.title, login: c.login ?? '', name: c.name ?? '', thumb: c.thumb });
    });
    return () => { alive = false; };
  }, [cur]);
  const onScroll = () => { const el = feed.current!; const i = Math.round(el.scrollTop / el.clientHeight); if (i !== cur && clips[i]) { setCur(i); setReady(false); } };
  const toggle = () => { const v = video.current; if (v) v.paused ? v.play() : v.pause(); };
  return <div class="clipfeed">
    <video ref={video} class={'feed-video' + (ready ? ' on' : '')} loop playsInline onPlaying={() => setReady(true)} />
    <div class="clipfeed-top"><button class="glass" onClick={() => minimizePlayer()} aria-label="Minimieren"><Icon n="down" /></button>
      <button class="glass" onClick={closePlayer} aria-label="Schließen"><Icon n="close" /></button></div>
    {muted && <button class="pill-btn unmute" onClick={() => { video.current!.muted = false; setMuted(false); }}>🔇 Ton an</button>}
    <div class="feed" ref={feed} onScroll={onScroll}>
      {clips.map((c, i) => <div class="feed-item" onClick={toggle}>
        <img src={c.thumb} alt="" />
        <div class="feed-info"><b onClick={e => { e.stopPropagation(); c.login && openChannel(c.login); }}>{c.name}</b><div>{c.title}</div>
          <div class="row-sub">{formatViewers(c.views)} Aufrufe{c.curator ? ` · geclippt von ${c.curator}` : ''}</div>
          {i === cur && vod && <button class="btn bordered small" onClick={e => { e.stopPropagation(); play({ kind: 'vod', id: vod.id, start: vod.at }); }}>Zur VOD</button>}</div>
      </div>)}
    </div>
  </div>;
}

const emoteSource = (url: string) => url.includes('7tv') ? '7TV' : url.includes('betterttv') ? 'BetterTTV' : url.includes('frankerfacez') ? 'FrankerFaceZ' : 'Twitch';

/** User card (MessageSheet.swift): profile from public GQL plus this person's lines in the chat. */
function UserCard({ login, msgs, onClose }: { login: string; msgs: ChatMsg[]; onClose: () => void }) {
  const [u, setU] = useState<any>();
  useEffect(() => { tw.gql('query($l: String!) { user(login: $l) { displayName profileImageURL(width: 150) createdAt followers { totalCount } description stream { id } } }', { l: login }).then(d => setU(d?.user ?? null)); }, [login]);
  return <Sheet title={u?.displayName ?? login} onClose={onClose}>
    <div class="user-card">
      {u === undefined ? <Spinner /> : u === null ? <p class="hint pad">Konto nicht gefunden.</p> : <div class="ch-head">
        <img class={'avatar xl' + (u.stream ? ' live-ring' : '')} src={u.profileImageURL} alt="" />
        <div><div class="card-title">{u.displayName}</div>
          <div class="row-sub">@{login}{u.followers ? ` · ${formatViewers(u.followers.totalCount)} Follower` : ''}</div>
          <div class="row-sub">Konto seit {new Date(u.createdAt).toLocaleDateString('de-DE')}</div></div></div>}
      {u?.description && <p class="hint pad">{u.description}</p>}
      <div class="pad"><button class="btn bordered small" onClick={() => { onClose(); openChannel(login); }}>Kanalseite öffnen</button></div>
      <h3 class="section-title">Nachrichten in diesem Chat</h3>
      <div class="chat-list pad">{msgs.length ? msgs.slice(-30).map(m => <div class="msg">{m.parts.map(p => p.t === 'emote' ? <img class="emote" src={p.url} alt={p.v} /> : p.v)}</div>)
        : <p class="hint">Keine.</p>}</div>
    </div>
  </Sheet>;
}
