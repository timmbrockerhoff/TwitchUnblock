// Channel page (ChannelView.swift): YouTube-style header, underlined tabs, Twitch's content.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import * as tw from './twitch';
import type { Vod, Clip, ChannelInfo } from './twitch';
import { formatViewers, formatDuration } from './logic';
import { useStore, state, toggleFollow, hideChannel, addRecentChannel } from './store';
import { play, nav } from './nav';
import { rewards, twitchFollowState, setTwitchFollow } from './rewards';
import { Page, Shelf, Empty, Spinner, ClipCard, Icon } from './ui';
import { loadRecoverableStreams, resolveRecoverableStream, type RecoverableStream } from './vod';
import './channel.css';

// Icons ui.tsx lacks (SF Symbols the iOS screens use). Shared with settings.tsx.
const extra: Record<string, string> = {
  seal: 'M12 1.5l2.4 1.9 3-.3 1.2 2.8 2.8 1.2-.3 3 1.9 2.4-1.9 2.4.3 3-2.8 1.2-1.2 2.8-3-.3L12 22.5l-2.4-1.9-3 .3-1.2-2.8-2.8-1.2.3-3L1 12l1.9-2.4-.3-3 2.8-1.2 1.2-2.8 3 .3zm-1.4 13.6 5.8-5.8-1.4-1.4-4.4 4.4-2.2-2.2L7 11.5z',
  eye: 'M12 5c5 0 8.8 3.3 10.5 7-1.7 3.7-5.5 7-10.5 7S3.2 15.7 1.5 12C3.2 8.3 7 5 12 5zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  eyeslash: 'M3 4.4 4.4 3l16.6 16.6-1.4 1.4-3.2-3.2A11 11 0 0 1 12 19C7 19 3.2 15.7 1.5 12A12 12 0 0 1 6 6.9zm4.5 4.5A4.5 4.5 0 0 0 13.8 16.1l-1.6-1.6a2.5 2.5 0 0 1-3.2-3.2zM12 5c5 0 8.8 3.3 10.5 7a12 12 0 0 1-3 4.1l-1.5-1.5A9.6 9.6 0 0 0 20.3 12 9.8 9.8 0 0 0 12 7a9 9 0 0 0-2 .2L8.3 5.5A11 11 0 0 1 12 5z',
  octagon: 'M7.8 2h8.4L22 7.8v8.4L16.2 22H7.8L2 16.2V7.8zM9.4 8 8 9.4l2.6 2.6L8 14.6 9.4 16l2.6-2.6 2.6 2.6 1.4-1.4-2.6-2.6L16 9.4 14.6 8 12 10.6z',
  playrect: 'M3 5h18v14H3zm7 3v8l6-4z',
  bubbles: 'M2 3h13v10H7l-4 3v-3H2zm15 5h5v10h-1v3l-4-3H9v-3h8z',
  box: 'M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.2 6.5 3.3L12 10.8 5.5 7.5zM5 9.3l6 3v7.2l-6-3zm14 0v7.2l-6 3v-7.2z',
  target: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  flask: 'M9 2h6v2h-1v5.5l5.5 9.5A2 2 0 0 1 17.8 22H6.2a2 2 0 0 1-1.7-3L10 9.5V4H9z',
  info: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8h2v7h-2zm0-3.5h2v2h-2z',
  chevron: 'M9 5l7 7-7 7-1.4-1.4L13.2 12 7.6 6.4z',
  checkcircle: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.5 13.6 6.6-6.6-1.4-1.4-5.2 5.2-2.6-2.6L6.5 11.6z',
  circle: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  swap: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM9 7l-4 3.5L9 14v-2.5h6v-2H9zm6 3v2.5h-6v2h6V17l4-3.5z',
  palette: 'M12 2a10 10 0 0 0 0 20c1.4 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a5 5 0 0 0 5-5c0-4.7-4.5-8.5-10-8.5zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  chart: 'M3 12h4v9H3zm7-7h4v16h-4zm7 4h4v12h-4z',
  backup: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM9 6 5.5 10h2.5v5h2v-5h2.5zm6 12 3.5-4H16V9h-2v5h-2.5z',
  download: 'M12 16l4.5-4.5-1.4-1.4L13 12.2V3h-2v9.2L8.9 10.1 7.5 11.5zM5 10h3v2H6v8h12v-8h-2v-2h3v12H5z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zm-3 5h12l-1 13H7zm3 2v9h2v-9zm4 0v9h2v-9z',
  terminal: 'M3 4h18v16H3zm2 2v12h14V6zm2 2 3 3-3 3-1.2-1.2L7.6 11 5.8 9.2zm5 5h5v2h-5z',
  arrowupright: 'M7 7h10v10h-2V10.4L6.4 19 5 17.6 13.6 9H7z',
  bell: 'M12 2a1.5 1.5 0 0 1 1.5 1.5V4a6 6 0 0 1 4.5 5.8V15l2 2v1H4v-1l2-2V9.8A6 6 0 0 1 10.5 4v-.5A1.5 1.5 0 0 1 12 2zm-2 18h4a2 2 0 0 1-4 0z',
  film: 'M4 3h16v18H4zm2 2v2h2V5zm0 4v2h2V9zm0 4v2h2v-2zm0 4v2h2v-2zm10-12v2h2V5zm0 4v2h2V9zm0 4v2h2v-2zm0 4v2h2v-2zM9 5v14h6V5z',
  textsize: 'M3 5h10v2H9v12H7V7H3zm11 5h7v2h-2.5v7h-2v-7H14z',
  translate: 'M4 4h8v2H9.6a9 9 0 0 1-1.8 4.3A9 9 0 0 0 11 12l-.6 2a11 11 0 0 1-3.9-2.3A11 11 0 0 1 2.6 14L2 12a9 9 0 0 0 3.2-2.1A9 9 0 0 1 3.5 6H4zm1.6 2a7 7 0 0 0 1.4 3 7 7 0 0 0 1.4-3zM15 9h2l4 11h-2l-1-3h-4l-1 3h-2zm1 2.6L14.6 15h2.8z',
  up: 'M4.9 15.5 12 8.4l7.1 7.1-1.4 1.4L12 11.2l-5.7 5.7z',
};
export function XIcon({ n, size = 22 }: { n: string; size?: number }) {
  return <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={extra[n]} fill="currentColor" fill-rule="evenodd" /></svg>;
}

/** "21.10.26" (cardShortDateFormatter). */
export const shortDate = (iso?: string) => iso && !isNaN(Date.parse(iso))
  ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
/** "13 T · 21. Okt." (offlineLabel in TwitchAPI.swift); '' when `end` is not in the past. */
export function formatOfflineSince(end: number, now = Date.now()): string {
  const diff = (now - end) / 1000;
  if (!(diff > 0)) return '';
  const d = Math.floor(diff / 86400), h = Math.floor(diff / 3600), m = Math.floor(diff / 60);
  const span = d > 0 ? `${d} T` : h > 0 ? `${h} h` : `${m} min`;
  const e = new Date(end), sameYear = e.getFullYear() === new Date(now).getFullYear();
  return `${span} · ${e.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}
const thumbURL = (u: string, w: number, h: number) => !u || u.includes('404_processing') ? '' : u.replace('{width}', String(w)).replace('{height}', String(h));
/** Plain text with http(s) links made tappable (richText in RichText.swift, links only). */
function linkify(text: string): ComponentChildren {
  return text.split(/(https?:\/\/[^\s]+)/g).map(part => /^https?:\/\//.test(part)
    ? <a href={part} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>{part}</a> : part);
}

// Context menu: iOS `.contextMenu` stand-in, opened by a long press (500 ms) or a right click.
export type MenuItem = { label: string; icon?: ComponentChildren; danger?: boolean; onSelect: () => void };
export function useLongPress(open: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<[number, number]>();
  const fired = useRef(false);
  const clear = () => { clearTimeout(timer.current); start.current = undefined; };
  return {
    onPointerDown: (e: PointerEvent) => {
      clear(); fired.current = false; start.current = [e.clientX, e.clientY];
      timer.current = setTimeout(() => { fired.current = true; open(); }, 500);
    },
    onPointerMove: (e: PointerEvent) => { if (start.current && Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 10) clear(); },
    onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear,
    onContextMenu: (e: Event) => { e.preventDefault(); clear(); fired.current = true; open(); },
    // The tap that ends a long press must not also activate the card.
    onClickCapture: (e: Event) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } },
  };
}
export function ContextMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return <div class="cmenu-backdrop" onClick={onClose}>
    <div class="cmenu" role="menu" onClick={e => e.stopPropagation()}>
      {items.map(i => <button class={'cmenu-item' + (i.danger ? ' danger' : '')} role="menuitem" onClick={() => { onClose(); i.onSelect(); }}>
        <span>{i.label}</span>{i.icon}</button>)}
    </div>
  </div>;
}

// Cards ------------------------------------------------------------------------------------------
/** VodCardView: card surface, duration top right, 3 px progress bar, title (2 lines) + short date. */
export function VodTile({ v, onClick, width }: { v: Vod; onClick?: () => void; width?: number }) {
  const p = v.length ? (state.progress[v.id] ?? 0) / v.length : 0;
  const src = thumbURL(v.thumb, 320, 180);
  return <button class="vtile" style={width ? { width } : undefined} onClick={onClick ?? (() => play({ kind: 'vod', id: v.id }))}>
    <div class="vtile-thumb">{src && <img loading="lazy" src={src} alt="" />}
      <span class="vbadge tr">{formatDuration(v.length)}</span>
      {p > 0.01 && <div class="vbar"><div style={{ width: `${Math.min(100, p * 100)}%` }} /></div>}</div>
    <div class="vtile-info"><div class="vtile-title">{v.title}</div><div class="vtile-meta">{shortDate(v.publishedAt)}</div></div>
  </button>;
}
/** UnlistedVodCardView: a broadcast without a VOD in Twitch's list, rebuilt on tap. The web app
 *  keeps the banner/avatar as a dimmed preview under the gradient. */
export function UnlistedVodCard({ r, preview, resolving, gone, onClick, width }: {
  r: RecoverableStream; preview?: string; resolving: boolean; gone: boolean; onClick: () => void; width?: number;
}) {
  return <button class={'vtile' + (gone ? ' gone' : '')} style={width ? { width } : undefined} disabled={resolving} onClick={onClick}>
    <div class="vtile-thumb unlisted">{preview && <img loading="lazy" src={preview} alt="" />}
      {resolving ? <div class="spinner" /> : <XIcon n={gone ? 'octagon' : 'eyeslash'} size={28} />}
      <span class={'vbadge tl ' + (gone ? 'danger' : 'accent')}>{gone ? 'Nicht mehr verfügbar' : 'Nicht gelistetes VOD'}</span>
      {r.duration > 0 && <span class="vbadge tr">{formatDuration(r.duration)}</span>}</div>
    <div class="vtile-info"><div class="vtile-title">{r.title || r.login}</div>
      <div class="vtile-meta">{[shortDate(r.start), r.game].filter(Boolean).join(' · ')}</div></div>
  </button>;
}
/** ClipCardView (16:9): eye + views top left, "0:28" bottom right, "date · curator". Local
 *  fallback until ui.tsx exports it. */
export function ClipCardWide({ c, onClick }: { c: Clip; onClick: () => void }) {
  const d = Math.max(0, Math.round(c.duration));
  return <button class="vtile" onClick={onClick}>
    <div class="vtile-thumb"><img loading="lazy" src={c.thumb} alt="" />
      <span class="vbadge tl"><XIcon n="eye" size={10} />{formatViewers(c.views)}</span>
      <span class="vbadge br">{Math.floor(d / 60)}:{String(d % 60).padStart(2, '0')}</span></div>
    <div class="vtile-info"><div class="vtile-title">{c.title}</div>
      <div class="vtile-meta">{[shortDate(c.createdAt), c.curator].filter(Boolean).join(' · ')}</div></div>
  </button>;
}

// Playlist queue: nav.ts has no queue target, so the next video starts when the player's <video>
// ends (capture: `ended` does not bubble) and the player still shows the queued one.
let queue: Vod[] = [], queued = '';
function playQueue(vods: Vod[]) {
  if (!vods.length) return;
  queue = vods.slice(1); queued = vods[0].id;
  play({ kind: 'vod', id: vods[0].id });
}
document.addEventListener('ended', e => {
  if ((e.target as HTMLElement).tagName !== 'VIDEO' || nav.player?.kind !== 'vod' || nav.player.id !== queued) return;
  const next = queue.shift();
  if (next) { queued = next.id; play({ kind: 'vod', id: next.id }); }
}, true);

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
  const [highlights, setHighlights] = useState<Vod[]>();
  const [clipList, setClipList] = useState<{ clips: Clip[]; next?: string }>();
  const [moreClips, setMoreClips] = useState(false);
  const [period, setPeriod] = useState<Period>('LAST_WEEK');
  const [playlists, setPlaylists] = useState<{ id: string; title: string; vods: Vod[] }[]>();
  const [recovery, setRecovery] = useState<{ streams: RecoverableStream[]; unavailable: boolean }>();
  const [resolving, setResolving] = useState<string>();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [twf, setTwf] = useState<{ id: string; following: boolean; busy?: boolean; err?: string }>();
  const [menu, setMenu] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const press = useLongPress(() => setMenu(true));

  const loadVods = () => {
    setVods(undefined); setVodsFailed(false); setMoreFailed(false);
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
  useEffect(() => { setClipList(undefined); tw.clips(login, period).then(r => loginRef.current === login && setClipList(r ?? { clips: [] })); }, [login, period]);
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
  const hidden = s.hiddenChannels.includes(login);
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

  // Last live end: the newest VOD's end, or the last broadcast start when newer (a live without VOD).
  const first = vods?.vods[0];
  const vodEnd = first ? Date.parse(first.publishedAt) + first.length * 1000 : NaN;
  const lastEnd = Math.max(isNaN(vodEnd) ? 0 : vodEnd, info.lastStart ? Date.parse(info.lastStart) : 0);
  const offlineSince = !isLive && lastEnd ? formatOfflineSince(lastEnd) : '';

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
  const entryCard = (e: Entry, width?: number) => e.kind === 'vod' ? <VodTile v={e.v} width={width} />
    : <UnlistedVodCard r={e.r} preview={info.banner || info.avatar} resolving={resolving === e.r.streamID} gone={gone.has(e.r.streamID)} onClick={() => recover(e.r)} width={width} />;
  const clips = clipList?.clips ?? [];
  const playClip = (i: number) => play({ kind: 'clips', clips, index: i });
  const loadMoreClips = async () => {
    if (!clipList?.next || moreClips) return;
    setMoreClips(true);
    const r = await tw.clips(login, period, clipList.next);
    setMoreClips(false);
    if (loginRef.current !== login || !r) return;
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
          <h1 class="ch-name"><span>{info.name}</span>{info.partner && <XIcon n="seal" size={18} />}</h1>
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
    {menu && <ContextMenu onClose={() => setMenu(false)} items={[
      { label: 'Multi-Live', icon: <Icon n="grid" size={18} />, onSelect: () => play({ kind: 'multi', logins: [login] }) },
      { label: hidden ? 'Wieder anzeigen' : 'Diesen Kanal ausblenden', icon: <XIcon n={hidden ? 'eye' : 'eyeslash'} size={18} />, danger: !hidden, onSelect: () => hideChannel(login, !hidden) },
    ]} />}

    <div class="ch-tabs">{TABS.map(([k, l]) => <button class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
    <div class="ch-body">
      {tab === 'overview' && <>
        {isLive ? <button class="ch-live" onClick={() => play({ kind: 'live', login })}>
          <div class="ch-live-thumb"><img src={thumbURL(info.stream!.thumb, 640, 360)} alt="" /><span class="live-on">JETZT LIVE</span></div>
          <div class="ch-live-title">{info.stream!.title}</div>
          <div class="ch-live-meta">{[info.stream!.viewers > 0 ? `${formatViewers(info.stream!.viewers)} Zuschauer` : '', info.stream!.game].filter(Boolean).join(' · ')}</div>
        </button> : first ? <div class="ch-col"><VodTile v={first} /></div> : null}
        {shelfVods.length > 0 && <Shelf title="VODs" onAll={() => setTab('vods')}>{shelfVods.map(e => entryCard(e, 220))}</Shelf>}
        {clips.length > 0 && <Shelf title="Clips" onAll={() => setTab('clips')}>{clips.slice(0, 12).map((c, i) => <ClipCard c={c} onClick={() => playClip(i)} />)}</Shelf>}
        {highlights && highlights.length > 0 && <Shelf title="Highlights" onAll={() => setTab('highlights')}>{highlights.slice(0, 12).map(v => <VodTile v={v} width={220} />)}</Shelf>}
        {playlists && playlists.length > 0 && <Shelf title="Playlists" onAll={() => setTab('playlists')}>
          {playlists.map(p => <VodTile v={{ ...p.vods[0], title: p.title }} width={220} onClick={() => playQueue(p.vods)} />)}</Shelf>}
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
        {recovery?.unavailable && <p class="hint pad">Die Quelle für nicht gelistete VODs ist gerade nicht erreichbar.</p>}
      </>}
      {tab === 'clips' && <>
        <div class="ch-chips">{PERIODS.map(([k, l]) => <button class={'chip small' + (period === k ? ' on' : '')} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        {!clipList ? <Spinner /> : !clips.length ? <Empty title="Keine Clips in diesem Zeitraum" />
          : <div class="ch-clipgrid">{clips.map((c, i) => <ClipCardWide c={c} onClick={() => playClip(i)} />)}</div>}
        {clipList?.next && <button class="btn wide" disabled={moreClips} onClick={loadMoreClips}>{moreClips ? '…' : 'Mehr laden'}</button>}
      </>}
      {tab === 'highlights' && (!highlights ? <Spinner /> : !highlights.length ? <Empty title="Keine Highlights" />
        : <div class="ch-col">{highlights.map(v => <VodTile v={v} />)}</div>)}
      {tab === 'playlists' && (!playlists ? <Spinner /> : !playlists.length ? <Empty title="Keine Playlists" />
        : playlists.map(p => <section>
          <div class="ch-pl-head"><div><div class="ch-pl-title">{p.title}</div><div class="ch-pl-meta">{p.vods.length} Video(s)</div></div>
            <button class="chip small" onClick={() => playQueue(p.vods)}><Icon n="play" size={14} /> Alle abspielen</button></div>
          <div class="shelf-row">{p.vods.map(v => <VodTile v={v} width={200} />)}</div>
        </section>))}
    </div>
  </Page>;
}
