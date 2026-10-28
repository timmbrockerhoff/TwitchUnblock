// Player (VideoPlayerView/PlayerControls), multi-live and clip feed; the chat panel is chatpanel.tsx.
// Playback is Safari's native HLS: Twitch's playlist servers refuse other sites' fetch()
// (Origin check), so hls.js/MSE and playlist rewriting are impossible; the <video> element itself
// loads them without an Origin header.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import * as tw from './twitch';
import { sortQualities, preferredQualityKey, qualityText, formatClock, formatViewers, adActive, isAdCue, adBridgePlan, type AdBridge,
  isAudioQuality, isVodInput, extractVodId, loginFromInput, isValidLogin } from './logic';
import { ChatPanel } from './chatpanel';
import { useStore, state, changed, setSetting, addHistory, setProgress, toggleFollow, recordAdStats, rankByAds } from './store';
import { nav, closePlayer, minimizePlayer, openChannel, play, type PlayerTarget, type MultiEntry } from './nav';
import { Icon, Sheet, Spinner } from './ui';
import { rewards, watchChannel, watchDrops, accountStreamURL, twitchFollowState, setTwitchFollow } from './rewards';
import { prepareUnmutedPlaylist } from './vod';
import { addLog } from './log';
import './player.css';

const SOURCE_LABEL: Record<string, string> = { as: 'Luminous Asien', al: 'Proxy Albanien', eu: 'Luminous Europa', twitch: 'Twitch offiziell', worker: 'TwitchUnblock-Worker' };
/** Within this many seconds of the live edge the player counts as "live" (PlayerControlsModel.edgeSlack). */
const EDGE_SLACK = 5;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const speedText = (r: number) => r === 1 ? 'Normal' : r.toLocaleString('de-DE') + '×';
type V = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitShowPlaybackTargetPicker?: () => void;
  webkitSetPresentationMode?: (m: string) => void; webkitSupportsPresentationMode?: (m: string) => boolean };

// Glyphs the shared Icon set lacks (SF symbols of the player sheets and tiles), 24-px grid.
const GLYPH: Record<string, string> = {
  sliders: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3zM8 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM9 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  gauge: 'M12 4a9 9 0 0 1 9 9v1h-2v-1a7 7 0 1 0-14 0v1H3v-1a9 9 0 0 1 9-9zm4.6 3.9 1.4 1.4-4.6 5.2a2 2 0 1 1-1.4-1.4z',
  bubbles: 'M2 4h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-4 3v-3H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm15 5h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1v3l-4-3h-5a1 1 0 0 1-1-1v-2h7a2 2 0 0 0 2-2z',
  expand: 'M4 4h7v2H7.4l4.3 4.3-1.4 1.4L6 7.4V11H4zm16 16h-7v-2h3.6l-4.3-4.3 1.4-1.4 4.3 4.3V13h2z',
  speaker: 'M3 9h4l5-4v14l-5-4H3zm12.5-.5a5 5 0 0 1 0 7l-1.2-1.2a3.3 3.3 0 0 0 0-4.6zm2.5-2.5a8.5 8.5 0 0 1 0 12l-1.2-1.2a6.8 6.8 0 0 0 0-9.6z',
  speakerOff: 'M3 9h4l5-4v14l-5-4H3zm12.4-.4 2.1 2 2.1-2 1.4 1.4-2.1 2 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  retry: 'M12 4a8 8 0 1 1-7.4 5h2.2A6 6 0 1 0 12 6v3L7.5 5.5 12 2z',
  megaphone: 'M3 10v4h2l5 3V7L5 10zm9-4 7-3v18l-7-3V6zm9.5 4a3.5 3.5 0 0 1 0 4v-4z',
};
const G = ({ n, size = 22 }: { n: string; size?: number }) =>
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={GLYPH[n]} fill="currentColor" /></svg>;

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
/** Resume point of a VOD: the saved position, except under 10 s or within 30 s of the end
 *  (MultiLive.startPoint, the same rule as the site) — then the start. */
const resumePoint = (saved: number | undefined, length: number) => saved != null && saved >= 10 && !(length > 0 && saved > length - 30) ? saved : undefined;

/** Re-render every `ms` while `on` (TimelineView for uptime, sleep timer, bar position). */
function useTick(ms: number, on = true) {
  const [, t] = useState(0);
  useEffect(() => { if (!on) return; const i = setInterval(() => t(x => x + 1), ms); return () => clearInterval(i); }, [ms, on]);
}

// Sleep timer: a setTimeout, not a timeupdate hook, so a paused video stops too (SleepTimerService).
let sleepAt = 0, sleepTimer: ReturnType<typeof setTimeout> | undefined;
export const sleepRemaining = () => sleepAt ? Math.max(0, sleepAt - Date.now()) : 0;
export function setSleep(min: number) {
  clearTimeout(sleepTimer); sleepAt = min > 0 ? Date.now() + min * 60000 : 0;
  if (sleepAt) sleepTimer = setTimeout(() => { sleepAt = 0; document.querySelectorAll('video').forEach(v => v.pause()); closePlayer(); }, min * 60000);
  changed();
}
const sleepLabel = () => formatClock(sleepRemaining() / 1000);

// "Querformat" button: iOS Safari has no screen.orientation.lock, so the player is turned by CSS
// (.pseudo-land). Session only; a physical rotation ends it (the real layout takes over).
let pseudoLand = false;
// Orientation alone, so an iPad in landscape gets the side-by-side layout too.
const landMQ = matchMedia('(orientation: landscape)');
landMQ.addEventListener('change', () => { pseudoLand = false; changed(); });
const togglePseudoLand = () => { pseudoLand = !pseudoLand; changed(); };
/** Landscape for gestures (pinch to fill, no pull-down): the real one or the rotated player. */
const landscapeNow = () => pseudoLand || landMQ.matches;
/** Pointer position along an element's own x axis, in [0, 1]: the rotated player maps x to the
 *  screen's y (transforms rotate hit-testing, not event coordinates). */
function localFraction(el: HTMLElement, e: { clientX: number; clientY: number }, inset = 0) {
  const r = el.getBoundingClientRect();
  const x = pseudoLand ? e.clientY - r.top : e.clientX - r.left, w = pseudoLand ? r.height : r.width;
  return Math.max(0, Math.min(1, (x - inset) / Math.max(1, w - inset * 2)));
}

/** Pull-down (PlayerPull): the player follows the finger and shrinks up to 12 %; past the
 *  threshold (15 % of its height, 80–120 px) or on a fling it reduces, otherwise it springs back. */
function usePull(host: { current: HTMLElement | null }) {
  const g = useRef<{ x: number; y: number; t: number; dy: number; vy: number; on: boolean }>();
  const move = (dy: number) => { const el = host.current; if (!el) return; el.style.transition = 'none'; el.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy / 500, 1) * 0.12})`; };
  const end = (dy: number, vy: number) => {
    const el = host.current; if (!el) return;
    el.style.transition = 'transform .25s ease-out'; el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; }, 250);
    if (dy > Math.min(120, Math.max(80, el.clientHeight * 0.15)) || vy > 1.5) minimizePlayer();
  };
  return {
    onTouchStart: (e: TouchEvent) => { const t = e.touches[0]; g.current = { x: t.clientX, y: t.clientY, t: Date.now(), dy: 0, vy: 0, on: false }; },
    onTouchMove: (e: TouchEvent) => {
      const s = g.current; if (!s || landscapeNow()) return;
      const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, now = Date.now();
      if (!s.on && dy > 12 && dy > Math.abs(dx)) s.on = true;
      if (!s.on) return;
      s.vy = (dy - s.dy) / Math.max(1, now - s.t); s.dy = dy; s.t = now;
      move(Math.max(0, dy));
    },
    onTouchEnd: (e: TouchEvent) => { const s = g.current; g.current = undefined; if (s?.on) { e.preventDefault(); end(s.dy, s.vy); } },
    onTouchCancel: () => { const s = g.current; g.current = undefined; if (s?.on) end(0, 0); },
  };
}

/** Ad breaks from Safari's metadata cues (EXT-X-DATERANGE): active, and the seconds left when a
 *  cue carries an end (END-DATE / DURATION). A break counts at most 200 s, and the sound comes
 *  back 5 s after the announced end at the latest (LiveDVRPlaylist's limits). */
function useAdBreak(video: { current: HTMLVideoElement | null }, on: boolean) {
  const [ad, setAd] = useState<{ left?: number } | null>(null);
  useEffect(() => {
    const v = video.current;
    if (!on || !v) return;
    const add = (e: TrackEvent) => { const tr = e.track as TextTrack; if (tr?.kind === 'metadata') tr.mode = 'hidden'; };
    v.textTracks.addEventListener('addtrack', add as any);
    let since = 0;
    const t = setInterval(() => {
      const list = Array.from(v.textTracks).filter(tr => tr.kind === 'metadata').flatMap(tr => Array.from(tr.activeCues ?? []));
      const cues = list.map(c => ({ id: c.id, start: c.startTime, value: (c as any).value }));
      let end: number | undefined;
      for (const c of list) {
        const val = (c as any).value;
        if (!isAdCue(c.id, val)) continue;
        const e = isFinite(c.endTime) && c.endTime > c.startTime ? c.endTime : val?.key === 'DURATION' && Number(val.data) > 0 ? c.startTime + Number(val.data) : undefined;
        if (e != null && (end == null || e > end)) end = e;
      }
      let active = adActive(cues);
      if (active) { since ||= Date.now(); if (Date.now() - since > 200000 || (end != null && v.currentTime > end + 5)) active = false; } else since = 0;
      const left = active && end != null ? Math.max(0, Math.ceil(end - v.currentTime)) : undefined;
      setAd(prev => active ? (prev && prev.left === left ? prev : { left }) : prev && null);
    }, 1000);
    return () => { v.textTracks.removeEventListener('addtrack', add as any); clearInterval(t); };
  }, [on]);
  return ad;
}

export function PlayerHost() {
  const s = useStore();
  const t = nav.player;
  const host = useRef<HTMLDivElement>(null);
  if (!t) return null;
  const key = JSON.stringify(t.kind === 'clips' ? { k: 'clips', i: t.index, n: t.clips.length } : t);
  const single = t.kind !== 'clips' && t.kind !== 'multi';
  const land = landMQ.matches || (single && pseudoLand);
  // The "overlay" mode of earlier versions reads as "column": the native player has no chat over the video.
  const lc = s.settings.landscapeChat === 'hidden' ? 'hidden' : 'column';
  // .land carries the landscape layout for both: one set of CSS rules instead of a media query copy.
  const cls = 'player' + (nav.playerMin ? ' mini' : '') + (s.settings.chatHidden ? ' no-chat' : '') + ' lc-' + lc
    + (land ? ' land' : '') + (single && pseudoLand ? ' pseudo-land' : '')
    // "Nur Chat" (chat sheet): live only, the video gives its height to the chat like iOS.
    + (single && t.kind === 'live' && s.settings.chatOnly && !s.settings.chatHidden ? ' chat-only' : '');
  const open = () => nav.playerMin && minimizePlayer(false);
  const style = { '--chat-w': String(s.settings.chatWidth) } as any;
  if (t.kind === 'clips') return <div class={cls} ref={host} style={style} onClick={open}><ClipFeed key={key} clips={t.clips} index={t.index} /></div>;
  if (t.kind === 'multi') return <div class={cls} ref={host} style={style} onClick={open}><MultiLive key={key} initial={t.logins} /></div>;
  return <div class={cls} ref={host} style={style}><SinglePlayer key={key} target={t} host={host} landscape={land} /></div>;
}

type Info = { title: string; sub: string; login?: string; name?: string; avatar?: string; userId?: string; viewers?: number; startedAt?: string; thumb?: string };
type Range = { start: number; end: number };

function SinglePlayer({ target, host, landscape }: { target: Exclude<PlayerTarget, { kind: 'clips' } | { kind: 'multi' }>; host: { current: HTMLDivElement | null }; landscape: boolean }) {
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
  const [sleepOpen, setSleepOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState(false);
  const [mutedRanges, setMutedRanges] = useState<Range[]>([]);
  const [vodChat, setVodChat] = useState<{ id: string; channelId?: string; offset: number; login?: string }>();
  const [clipVod, setClipVod] = useState<{ id: string; at?: number }>();
  // Live rewind: the running broadcast's recording, played natively (its seekable range is the whole broadcast).
  const [archiveId, setArchiveId] = useState<string>();
  const [inArchive, setInArchive] = useState(false);
  const inArchiveRef = useRef(false);
  inArchiveRef.current = inArchive;
  const [tryOrder, setTryOrder] = useState<tw.LiveSource[]>();
  const [notice, setNotice] = useState<string>();   // bottom capsule, 2.5 s (VideoPlayerView.noticeShown)
  const [stalled, setStalled] = useState(false);
  const liveURL = useRef('');
  const rewriteVod = useRef(false);
  const vodCreatedAt = useRef<string>();
  const preparedReleases = useRef(new Set<() => void>());
  const isLive = target.kind === 'live';
  const playing = useRef('');            // live: the source or backup player type playing now (ad bridge)
  const pull = usePull(host);
  const showNotice = (text: string) => { setNotice(text); setTimeout(() => setNotice(n => n === text ? undefined : n), 2500); };

  /** Starts a live source at the live edge, with its quality list when the master is readable. */
  const playHit = (hit: tw.LiveHit, label: string = hit.src) => {
    setSource(hit.src); playing.current = label;
    let url = hit.url, q = 'auto';
    if (hit.master) {
      const keys = sortQualities(Object.keys(hit.master.links), hit.master.variants);
      setQualities({ keys: ['auto', ...keys], links: { auto: hit.url, ...hit.master.links } });
      q = s.settings.quality === 'auto' ? 'auto' : preferredQualityKey(keys, s.settings.quality, hit.master.variants);
      url = q === 'auto' ? hit.url : hit.master.links[q];
    } else setQualities({ keys: ['auto'], links: { auto: hit.url } });
    setQuality(q); liveURL.current = url; setInArchive(false);
    setSrc(url);
  };

  const setSrc = (url: string, at?: number) => {
    const v = video.current!; v.src = url;
    if (at != null) seekWhenReady(v, at);
    start(v, () => setMutedHint(true));
  };
  const setVodSrc = async (url: string, at?: number) => {
    if (!rewriteVod.current) return setSrc(url, at);
    const prepared = await prepareUnmutedPlaylist(url, vodCreatedAt.current);
    if (!video.current) { prepared.revoke?.(); return; }
    if (prepared.revoke) preparedReleases.current.add(prepared.revoke);
    if (prepared.url !== url) {
      const fallback = () => {
        prepared.revoke?.(); if (prepared.revoke) preparedReleases.current.delete(prepared.revoke);
        setSrc(url, at);
      };
      video.current?.addEventListener('error', fallback, { once: true });
    }
    setSrc(prepared.url, at);
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
        addLog('Player', `Live ${login} über ${SOURCE_LABEL[hit.src]}`, true);
        playHit(hit);
        addHistory({ kind: 'live', id: login, title: sInfo?.title ?? '', login, name: sInfo?.name ?? login, thumb: sInfo?.thumb ?? '' });
      } else if (target.kind === 'vod') {
        const [meta, vod] = await Promise.all([tw.vodMeta(target.id), tw.vodPlayback(target.id)]);
        if (!alive) return;
        if (vod?.subOnly) { setError({ text: state.account ? 'Dieses VOD ist nur für Abonnenten des Kanals.' : 'Dieses VOD ist nur für Abonnenten. Mit Login laufen VODs von Kanälen, die du abonniert hast.' }); return; }
        if (!vod || !Object.keys(vod.links).length || meta === null) { setError({ text: 'VOD nicht gefunden.' }); return; }
        if (meta) {
          setInfo({ title: meta.title, sub: meta.createdAt ? new Date(meta.createdAt).toLocaleDateString('de-DE') : '', login: meta.login, name: meta.name, avatar: meta.avatar, userId: meta.ownerId, thumb: meta.thumb });
          setMutedRanges(meta.muted);
          addHistory({ kind: 'vod', id: target.id, title: meta.title, login: meta.login, name: meta.name, thumb: meta.thumb, length: meta.length });
        }
        const keys = sortQualities(Object.keys(vod.links), vod.variants);
        const q = preferredQualityKey(keys, s.settings.quality, vod.variants);
        setQualities({ keys, links: vod.links }); setQuality(q);
        rewriteVod.current = !!vod.recovered; vodCreatedAt.current = meta?.createdAt;
        const at = target.start ?? resumePoint(state.progress[target.id], meta?.length ?? 0);
        setVodChat({ id: target.id, channelId: meta?.ownerId, offset: at ?? 0, login: meta?.login });
        await setVodSrc(vod.links[q], at);
        if (!alive) return;
      } else if (target.kind === 'recovered') {
        const r = target.vod;
        const keys = sortQualities(Object.keys(r.links), r.variants);
        const q = preferredQualityKey(keys, s.settings.quality, r.variants);
        if (!q || !r.links[q]) { setError({ text: 'Die wiederhergestellte VOD ist nicht mehr auf dem CDN verfügbar.' }); return; }
        setInfo({ title: r.title, sub: new Date(r.startedAt).toLocaleDateString('de-DE'), login: r.login, name: r.login });
        setQualities({ keys, links: r.links }); setQuality(q);
        rewriteVod.current = true; vodCreatedAt.current = r.startedAt;
        await setVodSrc(r.links[q]);
        if (!alive) return;
      } else {
        const c = await tw.clipPlayback(target.slug);
        if (!alive) return;
        if (!c || !Object.keys(c.links).length) { setError({ text: 'Clip nicht gefunden.' }); return; }
        const keys = sortQualities(Object.keys(c.links));
        const q = preferredQualityKey(keys, s.settings.quality === 'auto' ? 'source' : s.settings.quality);
        setQualities({ keys, links: c.links }); setQuality(q);
        setInfo({ title: c.title, sub: c.name ?? '', login: c.login, name: c.name });
        setClipVod(c.vodId ? { id: c.vodId, at: c.vodOffset } : undefined);
        video.current!.loop = true;
        setSrc(c.links[q]);
        addHistory({ kind: 'clip', id: target.slug, title: c.title, login: c.login ?? '', name: c.name ?? '', thumb: '' });
      }
      setStatus(null);
    })();
    return () => { alive = false; };
  }, [tryOrder]);

  // Lock screen / Dynamic Island "Now Playing" (Media Session: what iOS shows for web media).
  useEffect(() => {
    if (!('mediaSession' in navigator) || !info.title) return;
    // Twitch avatars come in fixed sizes (…-70x70.png); live thumbnails are {width}x{height} templates.
    const avatar = (w: number) => ({ src: info.avatar!.replace(/\d+x\d+(?=\.\w+$)/, `${w}x${w}`), sizes: `${w}x${w}` });
    const thumb = (w: number, h: number) => ({ src: info.thumb!.replace('{width}', String(w)).replace('{height}', String(h)), sizes: `${w}x${h}` });
    const fixedThumb = info.thumb && !info.thumb.includes('{width}') && info.thumb.match(/(\d+x\d+)(?=\.\w+$)/);
    navigator.mediaSession.metadata = new MediaMetadata({ title: info.title, artist: info.name ?? info.login ?? '', album: info.sub,
      // Square avatar first (lock screen tile), the stream picture after it.
      artwork: [...(info.avatar ? [150, 300, 600].map(avatar) : []),
        ...(!info.thumb ? [] : fixedThumb ? [{ src: info.thumb, sizes: fixedThumb[1] }] : [[320, 180], [640, 360], [1280, 720]].map(([w, h]) => thumb(w, h)))] });
  }, [info.title, info.name, info.sub, info.avatar, info.thumb]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession, v = video.current!;
    const seek = (t: number) => { v.currentTime = Math.max(0, isFinite(v.duration) ? Math.min(v.duration, t) : t); };
    // Live: no skip buttons and no position, so iOS shows it as live. VODs/clips: ±10 s and the bar.
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => { v.play().catch(() => {}); }], ['pause', () => v.pause()],
      ['seekbackward', isLive ? null : d => seek(v.currentTime - (d.seekOffset ?? 10))],
      ['seekforward', isLive ? null : d => seek(v.currentTime + (d.seekOffset ?? 10))],
      ['seekto', isLive ? null : d => { if (d.seekTime != null) seek(d.seekTime); }],
    ];
    for (const [a, h] of handlers) try { ms.setActionHandler(a, h); } catch { /* action not supported */ }
    const pos = () => {
      try {
        if (isLive || !isFinite(v.duration) || v.duration <= 0) ms.setPositionState();
        else ms.setPositionState({ duration: v.duration, position: Math.min(v.currentTime, v.duration), playbackRate: v.playbackRate || 1 });
      } catch { /* old WebKit */ }
    };
    // iOS extrapolates the position while playing; these are the moments it jumps.
    const evs = ['loadedmetadata', 'durationchange', 'seeked', 'ratechange', 'play', 'pause'];
    evs.forEach(e => v.addEventListener(e, pos));
    pos();
    return () => {
      evs.forEach(e => v.removeEventListener(e, pos));
      for (const [a] of handlers) try { ms.setActionHandler(a, null); } catch { /* not supported */ }
      ms.metadata = null;
    };
  }, []);

  // VOD progress (saved, not rendered app-wide), stall flag for the ad gap capsule
  useEffect(() => {
    const v = video.current!;
    let last = 0;
    const tick = () => { if (target.kind === 'vod' && Math.abs(v.currentTime - last) >= 5) { last = v.currentTime; setProgress(target.id, v.currentTime); } };
    const wait = () => setStalled(true), go = () => setStalled(false);
    // Playlist "Alle abspielen": the next VOD of the queue when this one ends.
    const ended = () => { if (target.kind === 'vod' && target.queue?.length) play({ kind: 'vod', id: target.queue[0], queue: target.queue.slice(1) }); };
    v.addEventListener('timeupdate', tick); v.addEventListener('waiting', wait); v.addEventListener('playing', go); v.addEventListener('pause', go); v.addEventListener('ended', ended);
    v.playbackRate = target.kind === 'live' ? 1 : s.settings.speed;
    return () => {
      v.removeEventListener('timeupdate', tick); v.removeEventListener('waiting', wait); v.removeEventListener('playing', go); v.removeEventListener('pause', go); v.removeEventListener('ended', ended);
      if (target.kind === 'vod') setProgress(target.id, v.currentTime);
      v.removeAttribute('src'); v.load(); preparedReleases.current.forEach(release => release()); preparedReleases.current.clear();
    };
  }, []);

  // Viewers, title and category every 30 s (getStreamStats), not only when opening.
  useEffect(() => {
    if (target.kind !== 'live') return;
    const t = setInterval(async () => {
      const st = await tw.streamStats(target.login.toLowerCase());
      const x = st?.stream; if (!x) return;
      setInfo(i => ({ ...i, title: x.title, sub: x.game, viewers: x.viewers }));
      if (st.archiveId) setArchiveId(st.archiveId);
    }, 30000);
    return () => clearInterval(t);
  }, []);

  // Ad-break statistics per source: seconds watched live and breaks started.
  const ad = useAdBreak(video, isLive);
  const adOn = !!ad;
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
    if (adOn && !adRef.current && source) recordAdStats(source, 0, 1);
    adRef.current = adOn;
  }, [adOn]);

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

  // Mute for the break, then restore what it was: unmuting a video that started muted without
  // a tap makes iOS pause it (seen in the Simulator after a real pre-roll).
  const mutedBeforeAd = useRef(false);
  useEffect(() => {
    const v = video.current;
    if (!s.settings.adSwitch || !isLive || !v) return;
    if (adOn) { mutedBeforeAd.current = v.muted; v.muted = true; }
    else if (!mutedBeforeAd.current) { v.muted = false; if (v.paused) v.play().catch(() => { v.muted = true; setMutedHint(true); v.play().catch(() => {}); }); }
  }, [adOn]);

  // Channel points + drops for the account of the rewards login (rewards.ts). Only once the
  // stream really plays, so an offline or failing channel reports nothing.
  const [dropsURL, setDropsURL] = useState<string>();
  useEffect(() => {
    if (target.kind !== 'live' || !source || !rewards.account) return;
    const login = target.login.toLowerCase();
    const stopPoints = watchChannel(login);
    let alive = true;
    const stopDrops = watchDrops(login, async has => {
      if (!has || !s.settings.dropsStream) return setDropsURL(undefined);
      const url = await accountStreamURL(login);
      if (alive) setDropsURL(url);
    });
    return () => { alive = false; stopPoints(); stopDrops(); setDropsURL(undefined); };
  }, [source, rewards.account?.userId]);

  const v = video.current;
  /** Live: another variant of the same source, at the live edge. */
  const swapLive = (k: string) => { setQuality(k); liveURL.current = qualities.links[k]; if (!inArchiveRef.current) setSrc(qualities.links[k]); };
  const changeQuality = async (k: string) => {
    if (target.kind === 'live') swapLive(k);
    else { setQuality(k); await setVodSrc(qualities.links[k], v?.currentTime); }
    if (k !== 'auto' && target.kind !== 'clip') setSetting('quality', /audio/.test(k) ? 'audio' : k.toLowerCase().startsWith('source') ? 'source' : String(parseInt(k) || 'source'));
  };
  // Background (screen off, other app): a proxy stream switches to its audio-only variant — the
  // picture is not seen, the data is — and back on return. Back from the background Safari
  // resumes where it paused; more than 30 s behind the edge → jump near it (LiveLatencyController).
  const bgQuality = useRef<string>();
  useEffect(() => {
    if (!isLive) return;
    const f = () => {
      const v = video.current; if (!v || inArchiveRef.current) return;
      if (document.visibilityState === 'hidden') {
        const audio = qualities.keys.find(isAudioQuality);
        if (source && source !== 'twitch' && audio && quality !== audio && !v.paused) { bgQuality.current = quality; swapLive(audio); }
      } else if (bgQuality.current) { swapLive(bgQuality.current); bgQuality.current = undefined; }
      else if (v.seekable.length) {
        const end = v.seekable.end(v.seekable.length - 1);
        if (end - v.currentTime > 30) v.currentTime = Math.max(v.seekable.start(0), end - 6);
      }
    };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [qualities, quality, source]);
  const goLive = () => { setInArchive(false); setSrc(liveURL.current); };
  const liveTotal = () => info.startedAt ? (Date.now() - Date.parse(info.startedAt)) / 1000 : 0;
  /** Broadcast time t (seconds since the start) in the recording; near the edge → live again. */
  const seekLive = async (t: number) => {
    if (!archiveId) return;
    if (t >= liveTotal() - EDGE_SLACK) return goLive();
    if (inArchive && v) { v.currentTime = t; return; }
    const url = (await tw.vodURL(archiveId)).url;
    if (!url) return;
    setInArchive(true); setSrc(url, t);
  };
  // Ad bridge (adFreeBackupPlaylist): on a break, switch to a backup that likely has none. First
  // tokens of other player types (embed/popout/autoplay, one GQL call each), then the other
  // proxies by measured breaks. Their playlists can't be read here (no CORS), so a backup with a
  // break of its own is only noticed by its cue: the next break edge walks on (adBridgePlan).
  // Stays on the backup afterwards; the source can be changed in the gear. Mute is untouched:
  // the [ad] effect above restores it when the new stream shows no break.
  const bridge = useRef<AdBridge>();
  const bridging = useRef(false);
  const bridgeAd = async () => {
    if (target.kind !== 'live' || bridging.current || inArchiveRef.current || !playing.current) return;
    const login = target.login.toLowerCase(), types = tw.BACKUP_PLAYER_TYPES;
    const plan = adBridgePlan(bridge.current, playing.current, Date.now(), [...types, ...rankByAds(s.settings.sourceOrder.filter(x => x !== 'twitch'))]);
    bridge.current = { tried: plan.tried, at: plan.at };
    if (!plan.next.length) return;
    bridging.current = true;
    const done = (hit: tw.LiveHit, label: string, name: string) => {
      plan.tried.push(label); bridge.current = { tried: plan.tried, at: Date.now() };
      playHit(hit, label);
      addLog('Player', `Werbepause ${login}: weiter über ${name}`, true);
      showNotice(`Weiter über ${name}`);
    };
    try {
      for (const p of plan.next.filter(x => types.includes(x))) {
        plan.tried.push(p);
        const t = await tw.liveToken(login, p);
        if (!video.current) return;
        if (t) return done({ src: 'twitch', url: tw.usherLiveURL(login, t, s.settings.lowLatency) }, p, `Twitch (${p})`);
      }
      const proxies = plan.next.filter(x => !types.includes(x)) as tw.LiveSource[];
      const hit = proxies.length ? await tw.raceLive(proxies, login, s.settings.lowLatency) : undefined;
      if (!video.current) return;
      if (hit) return done(hit, hit.src, SOURCE_LABEL[hit.src]);
      plan.tried.push(...proxies);
      addLog('Player', `Werbepause ${login}: kein Ersatz-Stream erreichbar`, false);
    } finally { bridging.current = false; }
  };
  useEffect(() => { if (adOn && s.settings.adSwitch) bridgeAd(); }, [adOn]);

  const chatOpen = target.kind !== 'clip' && target.kind !== 'recovered' && (landscape ? s.settings.landscapeChat !== 'hidden' : !s.settings.chatHidden);
  const closeChat = () => landscape ? setSetting('landscapeChat', 'hidden') : setSetting('chatHidden', true);
  const shareURL = target.kind === 'live' ? `https://www.twitch.tv/${target.login}` : target.kind === 'vod' ? `https://www.twitch.tv/videos/${target.id}`
    : target.kind === 'clip' ? `https://clips.twitch.tv/${target.slug}` : undefined;
  return <>
    <div class={'stage' + (s.settings.fillScreen ? ' fill' : '')}
      // Pinch out fills the screen in landscape, pinch in shows the whole picture (fillScreen).
      {...{ ongestureend: (e: any) => { if (landscapeNow() && Math.abs(e.scale - 1) > 0.1) setSetting('fillScreen', e.scale > 1); } }}>
      <video ref={video} playsInline preload="auto" {...{ 'x-webkit-airplay': 'allow' }} poster={info.thumb?.replace('{width}', '640').replace('{height}', '360')} />
      {dropsURL && <video class="drops-stream" src={dropsURL} autoPlay muted playsInline aria-hidden="true" />}
      <Controls video={video} kind={target.kind} info={info} inArchive={inArchive} archive={!!archiveId} liveTotal={liveTotal} landscape={landscape}
        onSeekLive={seekLive} onGoLive={goLive} onSettings={() => setSettingsOpen(true)} muted={mutedRanges} pull={pull}
        onShowChat={landscape && !chatOpen && target.kind !== 'clip' && target.kind !== 'recovered' ? () => setSetting('landscapeChat', 'column') : undefined} />
      {status && !error && <div class="stage-msg"><Spinner text={status} /></div>}
      {error && <div class="stage-msg"><p>{error.text}</p>
        {error.offline && info.login && <button class="btn prominent" onClick={() => openChannel(info.login!)}>Kanalseite öffnen</button>}
        {!error.offline && target.kind === 'live' && <button class="btn bordered" onClick={() => setTryOrder([...(tryOrder ?? s.settings.sourceOrder)])}>Erneut versuchen</button>}</div>}
      {mutedHint && <button class="pill-btn unmute" onClick={() => {
        if (!v) return;
        setMutedHint(false);
        // The tap unlocks sound for this element; during a break it comes back after the ad.
        if (adOn && s.settings.adSwitch) { mutedBeforeAd.current = false; v.muted = false; v.muted = true; }
        else v.muted = false;
      }}>🔇 Ton an</button>}
      {ad && (stalled && ad.left ? <div class="ad-gap"><G n="megaphone" size={14} />Werbepause übersprungen · weiter in {ad.left} s</div>
        : <div class="ad-banner">📣 Werbepause{ad.left != null ? ` · ${ad.left} s` : ''}
          {!s.settings.adSwitch && <button class="link" onClick={bridgeAd}>Ersatz-Stream</button>}</div>)}
      {notice && <div class="stage-notice">{notice}</div>}
    </div>
    <div class="mini-bar" onClick={() => minimizePlayer(false)}>
      <span class={'mini-icon' + (error ? ' warn' : isLive ? ' live' : '')}>{status && !error ? <span class="spinner small" /> : <Icon n={error ? 'warning' : isLive ? 'antenna' : 'play'} size={16} />}</span>
      <span class="mini-title">{error ? error.text : info.title || info.name || status}</span>
      <button class="bare" onClick={e => { e.stopPropagation(); closePlayer(); }} aria-label="Schließen"><Icon n="close" size={18} /></button>
    </div>
    <div class="below">
      {chatOpen ? <>
        <div class="chat-head" {...(landscape ? {} : pull)}>
          <span class="chat-head-title">{isLive ? 'Live-Chat' : 'Chat-Wiedergabe'}</span>
          {inArchive && <button class="live-chip" onClick={goLive} aria-label="Zurück zu Live"><Icon n="antenna" size={11} />LIVE</button>}
          <button class="bare" onClick={() => setChatSettings(true)} aria-label="Chat-Einstellungen"><Icon n="gear" size={17} /></button>
          <button class="bare" onClick={closeChat} aria-label="Chat ausblenden"><Icon n="close" size={16} /></button>
        </div>
        {landscape && <ChatGrip host={host} />}
        {target.kind === 'live' && info.login && <ChatPanel login={info.login} channelId={info.userId} video={video}
          archive={inArchive && archiveId ? { id: archiveId, startedAt: info.startedAt } : undefined} showSettings={chatSettings} onShowSettings={setChatSettings} />}
        {target.kind === 'vod' && vodChat && <ChatPanel vod={vodChat} video={video} showSettings={chatSettings} onShowSettings={setChatSettings} />}
      </> : !landscape && <StreamInfo kind={target.kind} info={info} inArchive={inArchive} onGoLive={goLive} shareURL={shareURL} clipVod={clipVod}
        onOpenChat={() => setSetting('chatHidden', false)} onSleep={() => setSleepOpen(true)} />}
    </div>
    {settingsOpen && <PlayerSettings onClose={() => setSettingsOpen(false)} video={video} kind={target.kind} qualities={qualities.keys} quality={quality}
      onQuality={changeQuality} source={source} onSource={src => setTryOrder([src, ...s.settings.sourceOrder.filter(x => x !== src)])}
      landscape={landscape} onSleep={() => setSleepOpen(true)} />}
    {sleepOpen && <SleepSheet onClose={() => setSleepOpen(false)} />}
  </>;
}

/** Landscape: the chat column's width follows a grip on its left edge (0.20–0.60 of the player). */
function ChatGrip({ host }: { host: { current: HTMLElement | null } }) {
  const [drag, setDrag] = useState(false);
  const ratio = useRef(state.settings.chatWidth);
  const move = (e: PointerEvent) => {
    const el = host.current; if (!drag || !el) return;
    ratio.current = Math.max(0.2, Math.min(0.6, 1 - localFraction(el, e)));
    el.style.setProperty('--chat-w', String(ratio.current));
  };
  return <div class={'chat-grip' + (drag ? ' on' : '')} onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); }}
    onPointerMove={move} onPointerUp={() => { setDrag(false); setSetting('chatWidth', Math.round(ratio.current * 100) / 100); }} onPointerCancel={() => setDrag(false)}><i /></div>;
}

/** PlayerFollowButton: on Twitch with a login (state read first), else only in this app. */
function FollowButton({ login }: { login: string }) {
  const s = useStore();
  const [twf, setTwf] = useState<{ id: string; following: boolean }>();
  useEffect(() => { setTwf(undefined); if (rewards.account) twitchFollowState(login).then(st => st && setTwf(st)); }, [login, rewards.account?.userId]);
  const following = twf ? twf.following : s.follows.includes(login) || s.accountFollows.includes(login);
  const toggle = async () => {
    if (twf) { const err = await setTwitchFollow(twf.id, login, !twf.following); if (!err) setTwf({ id: twf.id, following: !twf.following }); }
    else toggleFollow(login);
  };
  return <button class={'btn small ' + (following ? 'grey' : 'prominent')} onClick={toggle}><Icon n={following ? 'check' : 'heart'} size={16} /> {following ? 'Folge ich' : 'Folgen'}</button>;
}

/** Portrait with the chat closed (MainTabView.streamInfo): title, grey details, channel with the
 *  follow capsule, action chips, and the card that opens the chat. */
function StreamInfo({ kind, info, inArchive, onGoLive, shareURL, clipVod, onOpenChat, onSleep }: {
  kind: string; info: Info; inArchive: boolean; onGoLive: () => void; shareURL?: string; clipVod?: { id: string; at?: number }; onOpenChat: () => void; onSleep: () => void }) {
  const live = kind === 'live';
  useTick(1000, live || sleepRemaining() > 0);
  const uptime = live && info.startedAt ? formatClock((Date.now() - Date.parse(info.startedAt)) / 1000) : '';
  const dropLink = live ? rewards.drops.find(c => !c.linked && c.linkURL) : undefined;
  const open = () => info.login && openChannel(info.login);
  return <div class="sinfo">
    <h2 class="sinfo-title">{info.title}</h2>
    {(live || info.sub) && <div class="sinfo-detail">
      {live && info.viewers != null && `${formatViewers(info.viewers)} Zuschauer · `}{uptime && <><span class="dot live" /> {uptime}</>}{info.sub && `${uptime ? ' · ' : ''}${info.sub}`}</div>}
    <div class="sinfo-ch">
      {info.avatar ? <img class="avatar" src={info.avatar} alt="" onClick={open} /> : <span class="avatar" onClick={open}><Icon n="person" size={40} /></span>}
      <span class="sinfo-name" onClick={open}>{info.name ?? info.login}</span>
      {info.login && <FollowButton login={info.login} />}
    </div>
    <div class="chip-row">
      {dropLink && <a class="chip warn" href={dropLink.linkURL} target="_blank" rel="noopener noreferrer"><Icon n="link" size={14} />Drops verknüpfen</a>}
      {live && info.login && <button class="chip" onClick={() => play({ kind: 'multi', logins: [info.login!] })}><Icon n="grid" size={14} />Multi-Live</button>}
      {shareURL && 'share' in navigator && <button class="chip" onClick={() => navigator.share({ url: shareURL }).catch(() => {})}><Icon n="share" size={14} />Teilen</button>}
      {inArchive && <button class="chip" onClick={onGoLive}><Icon n="antenna" size={14} />Zurück zu Live</button>}
      {sleepRemaining() > 0 && <button class="chip" onClick={onSleep}><Icon n="moon" size={14} />{sleepLabel()}</button>}
      {clipVod && <button class="chip" onClick={() => play({ kind: 'vod', id: clipVod.id, start: clipVod.at })}><Icon n="play" size={14} />Ganzes VOD ab hier</button>}
    </div>
    {(live || kind === 'vod') && <button class="chat-card" onClick={onOpenChat}><G n="bubbles" size={24} />
      <span><b>{live ? 'Live-Chat' : 'Chat-Wiedergabe'}</b><small>Zum Öffnen tippen</small></span><Icon n="right" size={14} /></button>}
  </div>;
}

// Our own controls (YouTube-style overlay from PlayerControls.swift) ----------------------------------
function Controls({ video, kind, info, inArchive, archive, liveTotal, landscape, onSeekLive, onGoLive, onSettings, onShowChat, muted, pull }: {
  video: { current: V | null }; kind: string; info: Info; inArchive: boolean; archive: boolean; liveTotal: () => number; landscape: boolean;
  onSeekLive: (t: number) => void; onGoLive: () => void; onSettings: () => void; onShowChat?: () => void; muted: Range[]; pull: ReturnType<typeof usePull> }) {
  const [shown, setShown] = useState(true);
  const [drag, setDrag] = useState<number | null>(null);
  const [flash, setFlash] = useState<number>(0);
  const [buffering, setBuffering] = useState(false);
  const hideT = useRef<ReturnType<typeof setTimeout>>();
  const flashT = useRef<ReturnType<typeof setTimeout>>();
  const lastTap = useRef({ t: 0, side: 0 });
  const v = video.current;
  useTick(500);
  const show = () => { setShown(true); clearTimeout(hideT.current); hideT.current = setTimeout(() => { if (video.current && !video.current.paused) setShown(false); }, 3000); };
  useEffect(show, []);
  useEffect(() => {
    const el = video.current; if (!el) return;
    const wait = () => setBuffering(true), go = () => setBuffering(false), paused = () => { setBuffering(false); show(); };
    el.addEventListener('waiting', wait); el.addEventListener('playing', go); el.addEventListener('pause', paused);
    return () => { el.removeEventListener('waiting', wait); el.removeEventListener('playing', go); el.removeEventListener('pause', paused); };
  }, []);
  const live = kind === 'live';
  const total = live ? liveTotal() : (v && isFinite(v.duration) ? v.duration : 0);
  const seekable = v?.seekable.length ? { s: v.seekable.start(0), e: v.seekable.end(v.seekable.length - 1) } : undefined;
  const cur = v?.currentTime ?? 0;
  // Live without its recording: the bar spans what Safari keeps seekable (a few minutes).
  const noArchive = live && !archive;
  const behind = !live ? 0 : inArchive ? Math.max(0, total - cur) : noArchive && seekable ? Math.max(0, seekable.e - cur) : 0;
  const atEdge = live && behind < EDGE_SLACK;
  const pos = live ? total - behind : cur;
  const span = noArchive ? (seekable ? seekable.e - seekable.s : 0) : total;
  const current = span > 0 ? (noArchive ? (cur - seekable!.s) / span : pos / total) : 0;
  const fraction = Math.max(0, Math.min(1, drag ?? current));
  const seekTo = (f: number) => {
    if (!v) return;
    if (!live) v.currentTime = f * total;
    else if (noArchive) { if (seekable) v.currentTime = seekable.s + f * span; }
    else if (f * total >= total - EDGE_SLACK) onGoLive(); else onSeekLive(f * total);
    show();
  };
  const seekBy = (d: number) => {
    if (!v) return;
    if (!live) v.currentTime = Math.max(0, Math.min(total, cur + d));
    else if (noArchive) { if (seekable) v.currentTime = Math.max(seekable.s, Math.min(seekable.e, cur + d)); }
    else onSeekLive(pos + d);
    show();
  };
  const doFlash = (side: number) => { setFlash(side); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(0), 700); };
  // One tap toggles the controls at once; a second one within 300 ms on the same half skips 10 s.
  const tap = (side: number) => {
    const now = Date.now();
    if (now - lastTap.current.t < 300 && lastTap.current.side === side) {
      lastTap.current.t = 0;
      if (side > 0 && atEdge) return;
      seekBy(side * 10); doFlash(side); return;
    }
    lastTap.current = { t: now, side };
    shown ? setShown(false) : show();
  };
  const pip = () => { if (!v) return; if (v.webkitSupportsPresentationMode?.('picture-in-picture')) v.webkitSetPresentationMode!('picture-in-picture'); else (v as any).requestPictureInPicture?.(); };
  // Hidden where iOS has no picture-in-picture (the Simulator's Safari reports none).
  const canPip = !!v && (v.webkitSupportsPresentationMode?.('picture-in-picture') || document.pictureInPictureEnabled);
  const bubble = (f: number) => live ? (f >= 0.995 ? 'Live' : formatClock(noArchive ? total - span * (1 - f) : f * total)) : formatClock(f * total);
  const inset = landscape ? 28 : 18;
  const paused = !v || v.paused;
  const uptime = live && info.startedAt ? formatClock(liveTotal()) : '';
  return <div class={'controls' + (shown ? ' on' : '')}>
    <button class="tapzone l" aria-label="Steuerung" onClick={() => tap(-1)} {...pull} /><button class="tapzone r" aria-label="Steuerung" onClick={() => tap(1)} {...pull} />
    {flash !== 0 && <div class={'flash ' + (flash < 0 ? 'l' : 'r')}><Icon n={flash < 0 ? 'rew' : 'fwd'} size={26} /><span>10 Sekunden</span></div>}
    <div class="ctl">
      <div class="ctl-top">
        <button class="bare" onClick={() => minimizePlayer()} aria-label="Minimieren"><Icon n="down" size={18} /></button>
        {landscape && info.name && <button class="ctl-title" onClick={() => info.login && openChannel(info.login)}>
          <b>{info.name}</b>
          {live && <span>{uptime && <><i class="dot live" /> {uptime}</>}{info.viewers != null && <> <Icon n="eye" size={11} /> {formatViewers(info.viewers)}</>}</span>}</button>}
        {!landscape && <span class="ctl-spacer" />}
        {onShowChat && <button class="bare" onClick={onShowChat} aria-label="Chat einblenden"><G n="bubbles" size={18} /></button>}
        <button class="bare" onClick={() => v?.webkitShowPlaybackTargetPicker?.()} aria-label="AirPlay"><Icon n="airplay" size={18} /></button>
        {canPip && <button class="bare" onClick={pip} aria-label="Bild in Bild"><Icon n="pip" size={18} /></button>}
        <button class="bare" onClick={onSettings} aria-label="Einstellungen"><Icon n="gear" size={18} /></button>
      </div>
      <div class="ctl-mid">
        <button class="glass" onClick={() => seekBy(-10)} aria-label="10 Sekunden zurück"><Icon n="rew" size={18} /></button>
        {buffering && !paused ? <span class="glass big"><span class="spinner" /></span>
          : <button class="glass big" onClick={() => { if (!v) return; v.paused ? v.play() : v.pause(); show(); }} aria-label="Wiedergabe/Pause"><Icon n={paused ? 'play' : 'pause'} size={24} /></button>}
        <button class="glass" disabled={atEdge} onClick={() => seekBy(10)} aria-label="10 Sekunden vor"><Icon n="fwd" size={18} /></button>
      </div>
      <div class="ctl-bottom">
        <span class="time">
          {live ? <>
            {!atEdge && <><span>{formatClock(pos)}</span><span class="dim"> / {formatClock(total)}</span></>}
            <button class={'live-chip' + (atEdge ? ' edge' : '')} onClick={() => !atEdge && onGoLive()} aria-label={atEdge ? 'Live' : 'Zurück zu Live'}><i /> Live</button>
          </> : <><span>{formatClock(pos)}</span><span class="dim"> / {formatClock(total)}</span></>}
        </span>
        {/* One button, like rotatePlayer: landscape in the app (CSS rotation). In a real landscape the layout is already there. */}
        {(pseudoLand || !landMQ.matches) && <button class="bare" onClick={() => { togglePseudoLand(); show(); }} aria-label={pseudoLand ? 'Hochformat' : 'Querformat'}>
          <Icon n={pseudoLand ? 'arrowUpLeft' : 'full'} size={17} /></button>}
      </div>
    </div>
    {(span > 0 || live) && <div class={'scrub' + (shown || drag != null ? ' on' : '') + (drag != null ? ' drag' : '') + (live ? ' live' : '')}
      style={{ '--inset': `${shown || drag != null ? inset : 0}px` } as any}
      onPointerDown={e => { if (!shown) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(localFraction(e.currentTarget as HTMLElement, e, inset)); show(); }}
      onPointerMove={e => { if (drag != null) setDrag(localFraction(e.currentTarget as HTMLElement, e, inset)); }}
      onPointerUp={e => { if (drag != null) { seekTo(localFraction(e.currentTarget as HTMLElement, e, inset)); setDrag(null); } }}
      onPointerCancel={() => setDrag(null)}>
      <div class="track">
        {!live && total > 0 && muted.map(m => <i class="mute" style={{ left: `${m.start / total * 100}%`, width: `${(m.end - m.start) / total * 100}%` }} />)}
        <div class="fill" style={{ width: `${fraction * 100}%` }} />
        <div class="knob" style={{ left: `${fraction * 100}%` }} />
        {drag != null && <div class="bubble" style={{ left: `${fraction * 100}%` }}>{bubble(drag)}</div>}
      </div>
    </div>}
  </div>;
}

/** PlayerSettingsSheet: no title bar, as tall as its rows (76 + 52 × n), icon rows with the value
 *  in grey; quality/speed/source open a checked list that closes on pick. */
function PlayerSettings({ onClose, video, kind, qualities, quality, onQuality, source, onSource, landscape, onSleep }: {
  onClose: () => void; video: { current: V | null }; kind: string; qualities: string[]; quality: string; onQuality: (q: string) => void;
  source?: string; onSource: (s: tw.LiveSource) => void; landscape: boolean; onSleep: () => void }) {
  const s = useStore();
  const v = video.current;
  const [page, setPage] = useState<'quality' | 'source' | 'speed'>();
  const rate = v?.playbackRate ?? s.settings.speed;
  const chatOn = landscape ? s.settings.landscapeChat !== 'hidden' : !s.settings.chatHidden;
  const setChat = (on: boolean) => landscape ? setSetting('landscapeChat', on ? 'column' : 'hidden') : setSetting('chatHidden', !on);
  const rows = (qualities.length ? 1 : 0) + 1 + (kind !== 'clip' ? 1 : 0) + 1; // quality, source|speed, chat, sleep
  const row = (icon: ComponentChildren, title: string, value: string | undefined, onClick: () => void) =>
    <button class="row" onClick={onClick}><span class="lbl">{icon}{title}</span><span class="val">{value}</span></button>;
  const list = <T extends string>(title: string, values: [T, string][], selected: string | undefined, pick: (v: T) => void) => <>
    <div class="psheet-nav"><button class="bare" onClick={() => setPage(undefined)} aria-label="Zurück"><Icon n="back" size={20} /></button><b>{title}</b><span /></div>
    <div class="group">{values.map(([val, label]) => <button class="row" onClick={() => { pick(val); onClose(); }}>
      <span>{label}</span>{val === selected && <span class="check"><Icon n="check" size={18} /></span>}</button>)}</div></>;
  return <div class="sheet-backdrop" onClick={onClose}>
    <div class="sheet psheet" role="dialog" aria-label="Einstellungen" onClick={e => e.stopPropagation()} style={page ? undefined : { minHeight: 76 + 52 * rows }}>
      <div class="grabber" />
      <div class="sheet-body">
        {page === 'quality' ? list('Qualität', qualities.map(k => [k, qualityText(k)] as [string, string]), quality, onQuality)
          : page === 'source' ? list('Quelle', tw.LIVE_SOURCES.map(x => [x, SOURCE_LABEL[x]] as [tw.LiveSource, string]), source, onSource)
          : page === 'speed' ? list('Geschwindigkeit', SPEEDS.map(r => [String(r), speedText(r)] as [string, string]), String(rate), r => { if (v) v.playbackRate = +r; setSetting('speed', +r); })
          : <>
            <div class="group">
              {qualities.length > 0 && row(<G n="sliders" size={20} />, 'Qualität', qualityText(quality), () => setPage('quality'))}
              {kind === 'live' && row(<Icon n="antenna" size={20} />, 'Quelle', source && SOURCE_LABEL[source], () => setPage('source'))}
              {kind !== 'live' && row(<G n="gauge" size={20} />, 'Geschwindigkeit', speedText(rate), () => setPage('speed'))}
              {kind !== 'clip' && <label class="row"><span class="lbl"><G n="bubbles" size={20} />Chat</span>
                <input type="checkbox" class="switch" checked={chatOn} onChange={e => setChat((e.target as HTMLInputElement).checked)} /></label>}
              {row(<Icon n="moon" size={20} />, 'Sleep-Timer', sleepRemaining() ? sleepLabel() : undefined, () => { onClose(); onSleep(); })}
            </div>
            {kind === 'live' && qualities.length <= 1 && <p class="hint">Bei „Twitch offiziell“ wählt der iPhone-Player die Qualität selbst: Twitch lässt fremde Seiten die Qualitätsliste nicht lesen.</p>}
          </>}
      </div>
    </div>
  </div>;
}

/** SleepTimerSheet: preset capsules, a custom duration (1–720 min), the time left while running. */
function SleepSheet({ onClose }: { onClose: () => void }) {
  const active = sleepRemaining() > 0;
  useTick(1000, active);
  const [custom, setCustom] = useState('');
  const m = parseInt(custom), ok = m >= 1 && m <= 720;
  return <Sheet title="Sleep-Timer" onClose={onClose}>
    <div class="sleep">
      {active ? <div class="sleep-big"><span>Verbleibende Zeit</span><b>{sleepLabel()}</b></div>
        : <p class="hint">Stoppt die Wiedergabe, wenn die Zeit abgelaufen ist.</p>}
      <div class="sleep-grid">{[15, 30, 45, 60, 90, 120].map(x => <button class="btn small" onClick={() => setSleep(x)}>{x === 60 ? '1 h' : x === 120 ? '2 h' : `${x} min`}</button>)}</div>
      <form class="sleep-custom" onSubmit={e => { e.preventDefault(); if (ok) { setSleep(m); setCustom(''); } }}>
        <input type="number" inputMode="numeric" min={1} max={720} placeholder="Dauer" value={custom} onInput={e => setCustom((e.target as HTMLInputElement).value)} />
        <span>min</span><button class="btn small prominent" disabled={!ok}>Starten</button>
      </form>
      {active && <div class="sleep-actions">
        <button class="btn small" onClick={() => setSleep(sleepRemaining() / 60000 + 15)}>+15 min</button>
        <button class="btn small danger" onClick={() => { setSleep(0); onClose(); }}>Abbrechen</button></div>}
    </div>
  </Sheet>;
}


// Multi-live (MultiLiveView: up to four tiles, live and VODs mixed, sound from one) -----------------
const entryId = (e: MultiEntry) => typeof e === 'string' ? e : 'vod:' + e.vod;
type TileInfo = { login: string; channelId?: string; vod?: string; video: { current: HTMLVideoElement | null } };
function MultiLive({ initial }: { initial: MultiEntry[] }) {
  const s = useStore();
  const [entries, setEntries] = useState(initial);
  const [active, setActive] = useState(entryId(initial[0]));
  const [adding, setAdding] = useState(false);
  const [infos, setInfos] = useState<Record<string, TileInfo>>({});
  // Chat only beside the mosaic on wide screens (horizontalSizeClass regular), switched in the header.
  const wide = matchMedia('(min-width: 700px)').matches;
  const chat = wide && s.settings.multiLiveChat ? infos[active] : undefined;
  const remove = (id: string) => {
    const n = entries.filter(e => entryId(e) !== id); setEntries(n);
    if (active === id && n.length) setActive(entryId(n[0]));
    if (!n.length) closePlayer();
  };
  return <div class="multi">
    <div class="multi-top">
      <div class="multi-title"><b>Multi-Live</b><span>Tippe auf ein Video, um es zu hören</span></div>
      {wide && <button class={'glass sm' + (s.settings.multiLiveChat ? ' accent' : '')} onClick={() => setSetting('multiLiveChat', !s.settings.multiLiveChat)} aria-label="Chat"><G n="bubbles" size={18} /></button>}
      {entries.length < 4 && <button class="glass sm" onClick={() => setAdding(true)} aria-label="Hinzufügen"><G n="plus" size={18} /></button>}
      <button class="glass sm" onClick={closePlayer} aria-label="Schließen"><Icon n="close" size={18} /></button>
    </div>
    <div class="multi-body">
      <div class={'multi-grid n' + entries.length}>
        {entries.map(e => { const id = entryId(e); return <MultiTile key={id} entry={e} count={entries.length} audible={id === active} onTap={() => setActive(id)}
          onRemove={() => remove(id)} onInfo={i => setInfos(o => ({ ...o, [id]: i }))} />; })}
      </div>
      {chat && (chat.vod ? <ChatPanel key={active} vod={{ id: chat.vod, channelId: chat.channelId, offset: 0 }} video={chat.video} />
        : <ChatPanel key={active} login={chat.login} channelId={chat.channelId} />)}
    </div>
    {adding && <AddSheet exclude={entries} onPick={e => { setEntries([...entries, e]); setAdding(false); }} onClose={() => setAdding(false)} />}
  </div>;
}
type Phase = 'loading' | 'playing' | 'offline' | 'failed' | 'ended';
function MultiTile({ entry, count, audible, onTap, onRemove, onInfo }: {
  entry: MultiEntry; count: number; audible: boolean; onTap: () => void; onRemove: () => void; onInfo: (i: TileInfo) => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const vod = typeof entry === 'string' ? undefined : entry.vod;
  const login = typeof entry === 'string' ? entry : '';
  const [phase, setPhase] = useState<Phase>('loading');
  const [name, setName] = useState(typeof entry === 'string' ? entry : 'VOD ' + entry.vod);
  const [paused, setPaused] = useState(false);   // VOD paused by the user: nothing restarts it
  const [tries, setTries] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const restarts = useRef(0);
  useTick(1000, !!vod && audible);
  const ad = useAdBreak(v, !vod);
  // Quality that fits several tiles: 1080p alone, 720p for two, 480p beyond — capped by the preference.
  const pick = (links: Record<string, string>, variants: Record<string, any> = {}) => {
    const rule = count <= 1 ? 1080 : count === 2 ? 720 : 480, pref = parseInt(state.settings.quality);
    const keys = sortQualities(Object.keys(links).filter(k => !isAudioQuality(k)), variants);
    return links[preferredQualityKey(keys.length ? keys : Object.keys(links), String(isNaN(pref) ? rule : Math.min(pref, rule)), variants)];
  };
  useEffect(() => {
    let alive = true; setPhase('loading');
    (async () => {
      const el = v.current!;
      if (vod) {
        const [meta, p] = await Promise.all([tw.vodMeta(vod), tw.vodPlayback(vod)]);
        if (!alive) return;
        if (!p || !Object.keys(p.links).length) { setPhase('failed'); return; }
        if (meta) {
          setName(meta.name || meta.login); onInfo({ login: meta.login, channelId: meta.ownerId, vod, video: v });
          if (!restarts.current) addHistory({ kind: 'vod', id: vod, title: meta.title, login: meta.login, name: meta.name, thumb: meta.thumb, length: meta.length });
        }
        el.src = pick(p.links, p.variants);
        const from = resumePoint(state.progress[vod], meta?.length ?? 0);
        if (from) seekWhenReady(el, from);
      } else {
        const order = state.settings.adRanking ? [...rankByAds(state.settings.sourceOrder.filter(x => x !== 'twitch')), ...state.settings.sourceOrder.filter(x => x === 'twitch')] : state.settings.sourceOrder;
        const hit = await tw.raceLive(order, login, state.settings.lowLatency);
        if (!alive) return;
        if (!hit) { const st = await tw.streamStats(login); if (alive) setPhase(st && (!st.exists || !st.stream) ? 'offline' : 'failed'); return; }
        onInfo({ login, video: v });
        tw.streamStats(login).then(st => { if (alive && st?.stream) { setName(st.stream.name); onInfo({ login, channelId: st.userId, video: v }); } });
        el.src = hit.master ? pick(hit.master.links, hit.master.variants) : hit.url;
      }
      el.muted = !audible;
      el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
      setPhase('playing');
    })();
    return () => { alive = false; };
  }, [tries]);
  // Ended VOD; a failed stream restarts up to three times (interrupted), then "Erneut versuchen".
  useEffect(() => {
    const el = v.current; if (!el) return;
    const ended = () => { if (vod) { setPhase('ended'); setProgress(vod, 0); } };
    const error = () => { if (++restarts.current <= 3) setTimeout(() => setTries(t => t + 1), 4000); else setPhase('failed'); };
    el.addEventListener('ended', ended); el.addEventListener('error', error);
    const save = vod ? setInterval(() => { if (el.currentTime > 0) setProgress(vod, el.currentTime); }, 30000) : undefined;
    return () => { el.removeEventListener('ended', ended); el.removeEventListener('error', error); clearInterval(save); if (vod && el.currentTime > 0) setProgress(vod, el.currentTime); el.removeAttribute('src'); el.load(); };
  }, []);
  // iOS pauses the audible video when another one gets sound (measured): the cell that loses the
  // sound is muted and started again.
  useEffect(() => {
    const el = v.current; if (!el || phase !== 'playing') return;
    el.muted = !audible;
    if (paused) return;
    el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
    if (!audible) setTimeout(() => { if (el.paused && !paused) el.play().catch(() => {}); }, 500);
  }, [audible, phase]);
  const el = v.current;
  const dur = el && isFinite(el.duration) ? el.duration : 0;
  const posShown = scrub ?? (el?.currentTime ?? 0);
  const retry = () => { restarts.current = 0; setPaused(false); setTries(t => t + 1); };
  const togglePlay = () => { if (!el) return; if (phase === 'ended') { el.currentTime = 0; setPhase('playing'); } if (el.paused) { setPaused(false); el.play().catch(() => {}); } else { setPaused(true); el.pause(); } };
  const watch = () => play(vod ? { kind: 'vod', id: vod, start: el?.currentTime } : { kind: 'live', login });
  const btn = (label: string, icon: ComponentChildren, action: () => void) => <button class="chip" onClick={e => { e.stopPropagation(); action(); }}>{icon}{label}</button>;
  return <div class={'tile' + (audible ? ' on' : '')} onClick={onTap} role="button" aria-label={`Ton von ${name}`}>
    <video ref={v} playsInline muted />
    {phase === 'loading' && <div class="tile-state"><span class="spinner" /></div>}
    {(phase === 'offline' || phase === 'failed') && <div class="tile-state">
      <p>{vod ? 'Dieses VOD konnte nicht abgespielt werden' : phase === 'offline' ? 'Offline oder nicht gefunden' : 'Dieser Stream konnte nicht gestartet werden'}</p>
      {btn('Erneut versuchen', <G n="retry" size={14} />, retry)}</div>}
    {phase === 'ended' && <div class="tile-state dim"><p>Ende des VODs</p>{btn('Erneut ansehen', <G n="retry" size={14} />, togglePlay)}</div>}
    {phase === 'playing' && vod && paused && !audible && <div class="tile-state"><span class="glass"><Icon n="pause" size={18} /></span></div>}
    {ad && <div class="ad-banner tile-ad">📣 Werbepause{ad.left != null ? ` · ${ad.left} s` : ''}</div>}
    <div class="tile-bar">
      <G n={audible ? 'speaker' : 'speakerOff'} size={12} />
      {vod && <span class="vod-badge">VOD</span>}
      <span class="tile-name">{name}</span>
      <button class="tile-btn" onClick={e => { e.stopPropagation(); watch(); }} aria-label="Im Player öffnen"><G n="expand" size={12} /></button>
      <button class="tile-btn" onClick={e => { e.stopPropagation(); onRemove(); }} aria-label="Entfernen"><Icon n="close" size={12} /></button>
    </div>
    {vod && phase !== 'loading' && (audible ? <div class="tile-ctl" onClick={e => e.stopPropagation()}>
      <button class="bare" onClick={() => { if (el) el.currentTime = Math.max(0, el.currentTime - 10); }} aria-label="10 Sekunden zurück"><Icon n="rew" size={16} /></button>
      <button class="bare" onClick={togglePlay} aria-label="Wiedergabe/Pause"><Icon n={phase === 'ended' || paused || el?.paused ? 'play' : 'pause'} size={16} /></button>
      <button class="bare" onClick={() => { if (el) el.currentTime = Math.min(dur || Infinity, el.currentTime + 10); }} aria-label="10 Sekunden vor"><Icon n="fwd" size={16} /></button>
      <input type="range" min={0} max={dur || 1} step={1} value={Math.min(posShown, dur || 1)} disabled={!dur} aria-label="Position"
        onInput={e => setScrub(Number((e.target as HTMLInputElement).value))}
        onChange={e => { if (el) el.currentTime = Number((e.target as HTMLInputElement).value); setScrub(null); if (phase === 'ended') setPhase('playing'); }} />
      <span class="tile-time">{formatClock(posShown)} / {formatClock(dur)}</span>
    </div> : dur > 0 && <div class="tile-line"><div style={{ width: `${Math.min(100, posShown / dur * 100)}%` }} /></div>)}
  </div>;
}
function AddSheet({ exclude, onPick, onClose }: { exclude: MultiEntry[]; onPick: (e: MultiEntry) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [live, setLive] = useState<tw.ChannelBrief[]>();
  const logins = exclude.filter((e): e is string => typeof e === 'string');
  useEffect(() => { tw.channels([...new Set([...state.follows, ...state.accountFollows])]).then(l => setLive((l ?? []).filter(c => c.stream && !logins.includes(c.login)))); }, []);
  const submit = (e: Event) => {
    e.preventDefault();
    const raw = q.trim(); if (!raw) return;
    if (isVodInput(raw)) { const id = extractVodId(raw); if (id) onPick({ vod: id }); else setErr('Ungültiger VOD-Link oder ungültige VOD-ID.'); return; }
    const login = loginFromInput(raw);
    if (isValidLogin(login)) onPick(login); else setErr('Nicht gefunden.');
  };
  return <Sheet title="Kanal oder VOD hinzufügen" onClose={onClose}>
    <form class="search" onSubmit={submit}>
      <input placeholder="Kanal, VOD-Link oder VOD-ID" value={q} onInput={e => { setQ((e.target as HTMLInputElement).value); setErr(''); }} autocapitalize="off" /></form>
    {err && <p class="hint pad">{err}</p>}
    {!live ? <Spinner /> : <div class="list">{live.map(c => <button class="list-row" onClick={() => onPick(c.login)}>
      <img class="avatar sm" src={c.avatar} alt="" /><div><div>{c.name}</div><div class="row-sub">{c.stream!.game} · {formatViewers(c.stream!.viewers)}</div></div></button>)}</div>}
  </Sheet>;
}

// Clip feed (ClipFeedView: vertical, one player at a time, the neighbour preloaded) -----------------
const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
/** "vor 2 Tagen" */
function relTime(iso: string) {
  const d = (Date.parse(iso) - Date.now()) / 1000, a = Math.abs(d);
  return a < 3600 ? rtf.format(Math.round(d / 60), 'minute') : a < 86400 ? rtf.format(Math.round(d / 3600), 'hour')
    : a < 86400 * 30 ? rtf.format(Math.round(d / 86400), 'day') : a < 86400 * 365 ? rtf.format(Math.round(d / 2592000), 'month') : rtf.format(Math.round(d / 31536000), 'year');
}
type ClipSrc = { url: string; vod?: { id: string; at?: number } };
/** ClipFeedView: one clip per page, paged by our own touch handling (like ScrollView .paging).
 *  Native scroll-snap lost swipes to Safari's own scrolling (page bounce, toolbar), so the feed
 *  takes every touch itself (`touch-action: none`) and decides: vertical drag = page, left edge
 *  = close, hold = 2×, tap = pause. */
function ClipFeed({ clips, index }: { clips: tw.Clip[]; index: number }) {
  const [cur, setCur] = useState(index);
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  // Two <video>s: one plays, the other preloads a neighbour; each sits on the page of its clip,
  // so a swipe drags the next clip's first frame in instead of a still thumbnail.
  const vids = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const [vidAt, setVidAt] = useState<[number, number]>([-1, -1]);
  const [frame, setFrame] = useState<[boolean, boolean]>([false, false]);
  const slot = cur % 2;
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fast, setFast] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [vod, setVod] = useState<ClipSrc['vod']>();
  const [frac, setFrac] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [dragX, setDragX] = useState(0);
  const srcs = useRef(new Map<string, Promise<ClipSrc | undefined>>());
  const chromeT = useRef<ReturnType<typeof setTimeout>>();
  const pressT = useRef<ReturnType<typeof setTimeout>>();
  const wheelAt = useRef(0);
  const g = useRef<{ x: number; y: number; t0: number; t: number; dy: number; vy: number; mode?: 'page' | 'edge' | 'none'; edge: boolean; fast: boolean }>();
  const landscape = landMQ.matches;
  const resolve = (c: tw.Clip) => {
    let p = srcs.current.get(c.slug);
    if (!p) {
      p = tw.clipPlayback(c.slug).then(r => r && Object.keys(r.links).length ? { url: r.links[preferredQualityKey(Object.keys(r.links), state.settings.quality === 'auto' ? 'source' : state.settings.quality)],
        vod: r.vodId ? { id: r.vodId, at: r.vodOffset } : undefined } : undefined);
      srcs.current.set(c.slug, p);
    }
    return p;
  };
  const showChrome = () => { setChrome(true); clearTimeout(chromeT.current); if (landMQ.matches) chromeT.current = setTimeout(() => setChrome(false), 3000); };
  useEffect(() => { showChrome(); return () => { clearTimeout(chromeT.current); clearTimeout(pressT.current); }; }, []);

  // The track sits at page `cur`; `dy` follows the finger, `animate` eases into place (0.35 s like iOS).
  const place = (dy = 0, animate = false) => {
    const el = track.current; if (!el) return;
    el.style.transition = animate ? 'transform .35s cubic-bezier(.25, .8, .25, 1)' : 'none';
    el.style.transform = `translate3d(0, calc(${-cur * 100}% + ${dy}px), 0)`;
  };
  useLayoutEffect(() => place(0, true), [cur]);
  useLayoutEffect(() => place(0, false), []);
  const go = (i: number) => { if (clips[i] && i !== cur) setCur(i); else place(0, true); };

  useEffect(() => {
    let alive = true; setPaused(false); setFast(false); setFrac(0);
    const c = clips[cur], el = vids[slot].current!, other = vids[1 - slot].current!;
    other.pause(); other.playbackRate = 1;
    resolve(c).then(p => {
      if (!alive || !p) return;
      if (el.src !== p.url) { setFrame(f => (f[slot] = false, [...f] as [boolean, boolean])); el.src = p.url; }
      setVidAt(a => (a[slot] = cur, [...a] as [number, number]));
      el.playbackRate = 1; el.currentTime = 0; el.muted = muted;
      start(el, () => setMuted(true));
      setVod(p.vod);
      addHistory({ kind: 'clip', id: c.slug, title: c.title, login: c.login ?? '', name: c.name ?? '', thumb: c.thumb });
    });
    // The neighbour the next swipe most likely goes to: the following clip, else the previous one.
    const ni = clips[cur + 1] ? cur + 1 : cur - 1;
    if (clips[ni]) resolve(clips[ni]).then(p => {
      if (!alive || !p) return;
      if (other.src !== p.url) { setFrame(f => (f[1 - slot] = false, [...f] as [boolean, boolean])); other.src = p.url; other.load(); }
      setVidAt(a => (a[1 - slot] = ni, [...a] as [number, number]));
    });
    return () => { alive = false; el.pause(); };
  }, [cur]);
  useEffect(() => () => vids.forEach(r => { r.current?.removeAttribute('src'); r.current?.load(); }), []);

  /** End of a clip: the next one, or this one again when it was the last. */
  const ended = () => { const el = vids[slot].current!; if (clips[cur + 1]) go(cur + 1); else { el.currentTime = 0; el.play().catch(() => {}); } };
  const cv = () => vids[slot].current!;
  const toggle = () => { const el = cv(); if (el.paused) { el.play().catch(() => {}); setPaused(false); } else { el.pause(); setPaused(true); } };
  const tap = () => { if (landMQ.matches && !chrome) { showChrome(); return; } toggle(); showChrome(); };
  const setFastOn = (on: boolean) => { const el = cv(); el.playbackRate = on ? 2 : 1; setFast(on); };
  const setMute = (m: boolean) => { vids.forEach(r => { if (r.current) r.current.muted = m; }); setMuted(m); };
  const unmute = () => {
    setMute(false);
    // The other element plays from this tap too, so the next clip may start with sound.
    const o = vids[1 - slot].current; o?.play().then(() => o.pause()).catch(() => {});
  };
  const scrubTo = (e: PointerEvent) => { const f = localFraction(e.currentTarget as HTMLElement, e); setDrag(f); const el = cv(); if (isFinite(el.duration)) el.currentTime = f * el.duration; };

  // One gesture handler for the whole feed. Buttons and the progress line keep their own touches.
  const own = (e: TouchEvent) => !(e.target as HTMLElement).closest('button, a, .clip-line');
  const onStart = (e: TouchEvent) => {
    if (e.touches.length > 1 || !own(e)) { g.current = undefined; return; }
    const t = e.touches[0], now = Date.now();
    g.current = { x: t.clientX, y: t.clientY, t0: now, t: now, dy: 0, vy: 0, edge: t.clientX < 24, fast: false };
    clearTimeout(pressT.current);
    // Held ≥ 0.35 s without moving: 2× while the finger stays (onLongPressGesture minimumDuration 0.35).
    pressT.current = setTimeout(() => { const s = g.current; if (s && !s.mode && !cv().paused) { s.fast = true; setFastOn(true); } }, 350);
  };
  const onMove = (e: TouchEvent) => {
    const s = g.current; if (!s) return;
    e.preventDefault();
    const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, now = Date.now();
    if (s.fast) return;
    if (!s.mode) {
      if (Math.hypot(dx, dy) < 10) return;
      clearTimeout(pressT.current);
      s.mode = s.edge && dx > Math.abs(dy) ? 'edge' : Math.abs(dy) >= Math.abs(dx) ? 'page' : 'none';
    }
    if (s.mode === 'page') {
      s.vy = (dy - s.dy) / Math.max(1, now - s.t); s.dy = dy; s.t = now;
      // Rubber band past the first and last clip.
      const end = (dy > 0 && !clips[cur - 1]) || (dy < 0 && !clips[cur + 1]);
      place(end ? dy / 3 : dy);
    } else if (s.mode === 'edge') {
      s.vy = (dx - s.dy) / Math.max(1, now - s.t); s.dy = dx; s.t = now;
      setDragX(Math.max(0, dx));
    }
  };
  const onEnd = (e: TouchEvent) => {
    const s = g.current; g.current = undefined; clearTimeout(pressT.current);
    if (!s) return;
    e.preventDefault(); // no synthetic click on top of our own tap
    if (s.fast) { setFastOn(false); return; }
    if (s.mode === 'page') {
      const h = root.current?.clientHeight ?? innerHeight;
      if (s.dy < -h * 0.2 || s.vy < -0.5) go(cur + 1);
      else if (s.dy > h * 0.2 || s.vy > 0.5) go(cur - 1);
      else place(0, true);
    } else if (s.mode === 'edge') {
      const w = root.current?.clientWidth ?? innerWidth;
      if (s.dy > w / 3 || s.vy > 1) { setDragX(w); setTimeout(closePlayer, 200); } else setDragX(0);
    } else if (!s.mode && Date.now() - s.t0 < 500) tap();
  };
  const onCancel = () => { const s = g.current; g.current = undefined; clearTimeout(pressT.current); if (s?.fast) setFastOn(false); if (s?.mode === 'page') place(0, true); if (s?.mode === 'edge') setDragX(0); };
  // Mouse wheel and arrow keys page too (desktop, iPad keyboard).
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (Math.abs(e.deltaY) < 20 || Date.now() - wheelAt.current < 500) return;
    wheelAt.current = Date.now(); go(cur + (e.deltaY > 0 ? 1 : -1));
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowDown') go(cur + 1); else if (e.key === 'ArrowUp') go(cur - 1); else if (e.key === ' ') { e.preventDefault(); toggle(); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [cur]);

  const pages = clips.map((k, i) => ({ k, i })).filter(({ i }) => Math.abs(i - cur) <= 2);
  return <div class={'clipfeed' + (chrome ? ' chrome' : '')} ref={root}
    style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: g.current?.mode === 'edge' ? 'none' : 'transform .2s' }}
    onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onCancel} onWheel={onWheel}
    onClick={e => { if (!(e.target as HTMLElement).closest('button, a, .clip-line')) tap(); }}
    onContextMenu={e => e.preventDefault()}>
    <div class="feed-track" ref={track}>
      {pages.map(({ k, i }) => <div class="feed-page" key={k.slug} style={{ top: `${i * 100}%` }}>
        <img src={k.thumb} alt="" draggable={false} />
        {i === cur && <div class="feed-bottom">
          <div class="feed-row">
            <div class="feed-info">
              <button class="feed-name" onClick={() => k.login && openChannel(k.login)}>{k.name}</button>
              <div class="feed-title">{k.title}</div>
              <div class="feed-meta">{[relTime(k.createdAt), k.curator && `von ${k.curator}`, k.views ? `${formatViewers(k.views)} Aufrufe` : ''].filter(Boolean).join(' · ')}</div>
              {vod && <button class="feed-vod" onClick={() => play({ kind: 'vod', id: vod.id, start: vod.at })}><Icon n="play" size={13} />Ganzes VOD ab hier</button>}
            </div>
            <button class="feed-share" onClick={() => navigator.share?.({ url: `https://clips.twitch.tv/${k.slug}` }).catch(() => {})} aria-label="Teilen"><Icon n="share" size={18} /></button>
          </div>
          <div class={'clip-line' + (drag != null ? ' drag' : '')} onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); scrubTo(e); }}
            onPointerMove={e => { if (drag != null) scrubTo(e); }} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
            <div style={{ width: `${(drag ?? frac) * 100}%` }} /></div>
        </div>}
      </div>)}
      {vids.map((r, si) => <video key={si} ref={r} class={'feed-video' + (frame[si] && vidAt[si] >= 0 ? ' on' : '')} playsInline preload="auto"
        style={{ top: `${Math.max(0, vidAt[si]) * 100}%` }} disablePictureInPicture {...{ 'x-webkit-airplay': 'deny' }}
        onLoadedData={() => setFrame(f => (f[si] = true, [...f] as [boolean, boolean]))}
        onEnded={() => si === slot && ended()}
        onTimeUpdate={e => { if (si === slot && drag == null) { const el = e.currentTarget as HTMLVideoElement; if (isFinite(el.duration) && el.duration > 0) setFrac(el.currentTime / el.duration); } }} />)}
    </div>
    {paused && <div class="feed-pause"><Icon n="play" size={60} /></div>}
    <div class="clipfeed-top">
      <button class="feed-btn" onClick={closePlayer} aria-label="Schließen"><Icon n="close" size={20} /></button>
      <div class="feed-center">
        {fast ? <div class="fast-label"><Icon n="fwd" size={14} /> 2×</div>
          : muted ? <button class="pill-btn unmute" onClick={unmute}>🔇 Ton an</button> : null}
      </div>
      <button class="feed-btn" onClick={() => { muted ? unmute() : setMute(true); showChrome(); }} aria-label={muted ? 'Ton an' : 'Ton aus'}><G n={muted ? 'speakerOff' : 'speaker'} size={20} /></button>
    </div>
  </div>;
}
