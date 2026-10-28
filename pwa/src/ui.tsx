// Shared building blocks (DesignSystem.swift / CardViews.swift counterparts).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatViewers, formatDuration, formatClipDuration, formatShortDate } from './logic';
import { openChannel, play, pop, push } from './nav';
import { state, useStore, isPinned, togglePin, isFollowedOrPinned, isHiddenCategory, followsCategory, hideChannel, hideCategory, type HistoryEntry } from './store';
import type { Stream, Vod, Clip, Category, ChannelBrief } from './twitch';

/** Accent palette of the iOS app (Theme.swift AccentTheme): hex, German label. */
export const ACCENTS: [string, string][] = [['#9146ff', 'Twitch-Lila'], ['#2f7cf6', 'Blau'], ['#10b981', 'Grün'],
  ['#ec4899', 'Pink'], ['#f97316', 'Orange'], ['#e5484d', 'Rot'], ['#06b6d4', 'Petrol']];

// 24-px glyphs after the SF symbols the iOS app uses. Cut-outs run against the outer contour
// (nonzero winding); shapes drawn over each other run the same way.
const EYE = 'M12 5.5c4.5 0 8.3 2.8 10.5 6.5-2.2 3.7-6 6.5-10.5 6.5S3.7 15.7 1.5 12C3.7 8.3 7.5 5.5 12 5.5zm0 3a3.5 3.5 0 0 0 0 7 3.5 3.5 0 0 0 0-7z';
const SLASH = 'M3.3 2 22 20.7l-1.4 1.4L1.9 3.4z';
const PIN = 'M9 2h6l-.5 1.5v6L17 12.5V14h-4v6.5l-1 1.5-1-1.5V14H7v-1.5l2.5-3v-6z';
const paths: Record<string, string> = {
  // house: roof with eaves, body, door notch
  home: 'M12 2.8 1.8 11.6l1.2 1.5L5 11.3V20a1.5 1.5 0 0 0 1.5 1.5h3.5v-6h4v6h3.5A1.5 1.5 0 0 0 19 20v-8.7l2 1.8 1.2-1.5z',
  // magnifyingglass
  browse: 'M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.8 4.8-1.4 1.4-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2.2a5.3 5.3 0 1 0 0 10.6 5.3 5.3 0 0 0 0-10.6z',
  // clock.arrow.circlepath: ring open at the top left, arrowhead there, hands inside
  library: 'M7.25 3.77A9.5 9.5 0 1 1 2.5 12h2A7.5 7.5 0 1 0 8.25 5.5zM4.98 6.24l1.17-4.37 3.2 5.54zM11 7h2v5.4l3.3 2-1 1.7-4.3-2.6z',
  back: 'M15.5 4.5 8 12l7.5 7.5-1.4 1.4L5.2 12l8.9-8.9z',
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M6 4h4.5v16H6zm7.5 0H18v16h-4.5z',
  close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z',
  down: 'M4.9 8.5 12 15.6l7.1-7.1 1.4 1.4L12 18.4 3.5 9.9z',
  right: 'M9 4.5 16.5 12 9 19.5 7.6 18.1 13.7 12 7.6 5.9z',
  // person.crop.circle.fill: head and shoulders wound against the circle, so they cut out.
  person: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm6.9 11.3c-1.6-2.4-4-3.8-6.9-3.8s-5.3 1.4-6.9 3.8a9.3 9.3 0 0 0 13.8 0z',
  // person.crop.circle.badge.plus: smaller person, plus badge beside it
  personPlus: 'M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 4a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zm5.5 9.1c-1.3-1.9-3.2-3-5.5-3s-4.2 1.1-5.5 3a7.4 7.4 0 0 0 11 0zM19 14.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm-.7 2v1.8h-1.8v1.4h1.8v1.8h1.4v-1.8h1.8v-1.4h-1.8v-1.8z',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM10.3 2h3.4l.5 2.6 1.6.9 2.5-.9 1.7 2.9-2 1.8v1.8l2 1.8-1.7 2.9-2.5-.9-1.6.9-.5 2.6h-3.4l-.5-2.6-1.6-.9-2.5.9-1.7-2.9 2-1.8v-1.8l-2-1.8 1.7-2.9 2.5.9 1.6-.9z',
  chat: 'M4 4h16v12H8l-4 4z',
  airplay: 'M3 4h18v12h-4l-1.5-2H19V6H5v8h3.5L7 16H3zm9 9 6 7H6z',
  full: 'M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z',
  pip: 'M3 5h18v14H3zm2 2v10h14V7zm6 5h7v4h-7z',
  heart: 'M12 21 3.5 12.5A5 5 0 0 1 12 6a5 5 0 0 1 8.5 6.5z',
  heartOutline: 'M12 21 3.5 12.5A5 5 0 0 1 12 6a5 5 0 0 1 8.5 6.5zm0-2.5 5.7-5.9A3.6 3.6 0 0 0 12 8.2a3.6 3.6 0 0 0-5.7 4.4z',
  share: 'M12 2l4.5 4.5-1.4 1.4L13 5.8V15h-2V5.8L8.9 7.9 7.5 6.5zM5 10h3v2H6v8h12v-8h-2v-2h3v12H5z',
  more: 'M5 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  rew: 'M12 5V1.5L7 6l5 4.5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  fwd: 'M12 5V1.5L17 6l-5 4.5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z',
  grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
  list: 'M3 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 .5h13v2H8zM3 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 .5h13v2H8zM3 15.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 .5h13v2H8z',
  send: 'M3 20.5 21 12 3 3.5 3 10l12 2-12 2z',
  smile: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-3.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7 14a5.5 5.5 0 0 0 10 0z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  gift: 'M3 8h18v4H3zm1 5h7v8H4zm9 0h7v8h-7zM12 8C10 4 6 4 7 7l5 1zm0 0c2-4 6-4 5-1l-5 1z',
  link: 'M9.2 13.4 13.4 9.2l1.4 1.4-4.2 4.2zM8.5 11l1.4 1.4-2.1 2.1a2 2 0 0 0 2.8 2.8l2.1-2.1 1.4 1.4-2.1 2.1a4 4 0 0 1-5.6-5.6zm7-7a4 4 0 0 1 5.6 5.6L19 11.7l-1.4-1.4 2.1-2.1a2 2 0 0 0-2.8-2.8l-2.1 2.1-1.4-1.4z',
  eye: EYE,
  eyeSlash: EYE + SLASH,
  pin: PIN,
  pinSlash: PIN + SLASH,
  trash: 'M9 2h6l1 2h4v2H4V4h4zM6 7h12l-1 14H7z',
  // globe: ring, equator, meridian and an inner ellipse ring
  globe: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 1.7a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6zM3 11h18v2H3zm8-8h2v18h-2zm1-.5a4.5 9.5 0 0 1 0 19 4.5 9.5 0 0 1 0-19zm0 1.8a2.8 7.7 0 0 0 0 15.4 2.8 7.7 0 0 0 0-15.4z',
  clock: 'M12 2a10 10 0 0 1 0 20 10 10 0 0 1 0-20zm-1 4v7.7l5 3 1-1.7-4-2.4V6z',
  film: 'M2 3h20v13H2zm3 3v7h14V6zM4 18h16v1.5H4zm2 3h12v1.5H6z',
  moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1zm3.5-.5h5v1.2l-3.2 3.3h3.2v1.2h-5V7l3.2-3.3h-3.2z',
  warning: 'M12 2.5 22.5 20.5H1.5zM11 9v5h2V9zm1 6.5a1.2 1.2 0 0 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
  arrowUpLeft: 'M6 6h9v2H9.4l9 9-1.4 1.4-9-9V15H6z',
  scissors: 'M6 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 1.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM6 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 1.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM9 9.5 21 3l1 1.7L10.2 11zm0 5L21 21l1-1.7L10.2 13z',
  playRect: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm7 4.5v7l5.5-3.5z',
  antenna: 'M12 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-1 4h2v9h-2zM8.11 7.11A5.5 5.5 0 0 0 8.11 14.89l1.27-1.27A3.7 3.7 0 0 1 9.38 8.38zm7.78 0A5.5 5.5 0 0 1 15.89 14.89l-1.27-1.27A3.7 3.7 0 0 0 14.62 8.38zM5.99 4.99A8.5 8.5 0 0 0 5.99 17.01l1.27-1.27A6.7 6.7 0 0 1 7.26 6.26zm12.02 0A8.5 8.5 0 0 1 18.01 17.01l-1.27-1.27A6.7 6.7 0 0 0 16.74 6.26z',
  up: 'M4.9 15.5 12 8.4l7.1 7.1-1.4 1.4L12 11.2l-5.7 5.7z',
};
// Settings menu and channel page glyphs (checkmark.seal, shippingbox, flask …): drawn with cut-outs
// that only work under the evenodd rule, so they keep it.
const evenodd: Record<string, string> = {
  seal: 'M12 1.5l2.4 1.9 3-.3 1.2 2.8 2.8 1.2-.3 3 1.9 2.4-1.9 2.4.3 3-2.8 1.2-1.2 2.8-3-.3L12 22.5l-2.4-1.9-3 .3-1.2-2.8-2.8-1.2.3-3L1 12l1.9-2.4-.3-3 2.8-1.2 1.2-2.8 3 .3zm-1.4 13.6 5.8-5.8-1.4-1.4-4.4 4.4-2.2-2.2L7 11.5z',
  octagon: 'M7.8 2h8.4L22 7.8v8.4L16.2 22H7.8L2 16.2V7.8zM9.4 8 8 9.4l2.6 2.6L8 14.6 9.4 16l2.6-2.6 2.6 2.6 1.4-1.4-2.6-2.6L16 9.4 14.6 8 12 10.6z',
  bubbles: 'M2 3h13v10H7l-4 3v-3H2zm15 5h5v10h-1v3l-4-3H9v-3h8z',
  box: 'M12 2 3 6.5v11L12 22l9-4.5v-11zm0 2.2 6.5 3.3L12 10.8 5.5 7.5zM5 9.3l6 3v7.2l-6-3zm14 0v7.2l-6 3v-7.2z',
  target: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  flask: 'M9 2h6v2h-1v5.5l5.5 9.5A2 2 0 0 1 17.8 22H6.2a2 2 0 0 1-1.7-3L10 9.5V4H9z',
  info: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8h2v7h-2zm0-3.5h2v2h-2z',
  checkcircle: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.5 13.6 6.6-6.6-1.4-1.4-5.2 5.2-2.6-2.6L6.5 11.6z',
  circle: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  swap: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM9 7l-4 3.5L9 14v-2.5h6v-2H9zm6 3v2.5h-6v2h6V17l4-3.5z',
  palette: 'M12 2a10 10 0 0 0 0 20c1.4 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a5 5 0 0 0 5-5c0-4.7-4.5-8.5-10-8.5zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  chart: 'M3 12h4v9H3zm7-7h4v16h-4zm7 4h4v12h-4z',
  backup: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM9 6 5.5 10h2.5v5h2v-5h2.5zm6 12 3.5-4H16V9h-2v5h-2.5z',
  download: 'M12 16l4.5-4.5-1.4-1.4L13 12.2V3h-2v9.2L8.9 10.1 7.5 11.5zM5 10h3v2H6v8h12v-8h-2v-2h3v12H5z',
  terminal: 'M3 4h18v16H3zm2 2v12h14V6zm2 2 3 3-3 3-1.2-1.2L7.6 11 5.8 9.2zm5 5h5v2h-5z',
  arrowUpRight: 'M7 7h10v10h-2V10.4L6.4 19 5 17.6 13.6 9H7z',
  bell: 'M12 2a1.5 1.5 0 0 1 1.5 1.5V4a6 6 0 0 1 4.5 5.8V15l2 2v1H4v-1l2-2V9.8A6 6 0 0 1 10.5 4v-.5A1.5 1.5 0 0 1 12 2zm-2 18h4a2 2 0 0 1-4 0z',
  textsize: 'M3 5h10v2H9v12H7V7H3zm11 5h7v2h-2.5v7h-2v-7H14z',
  translate: 'M4 4h8v2H9.6a9 9 0 0 1-1.8 4.3A9 9 0 0 0 11 12l-.6 2a11 11 0 0 1-3.9-2.3A11 11 0 0 1 2.6 14L2 12a9 9 0 0 0 3.2-2.1A9 9 0 0 1 3.5 6H4zm1.6 2a7 7 0 0 0 1.4 3 7 7 0 0 0 1.4-3zM15 9h2l4 11h-2l-1-3h-4l-1 3h-2zm1 2.6L14.6 15h2.8z',
};
export function Icon({ n, size = 22 }: { n: keyof typeof paths | keyof typeof evenodd | string; size?: number }) {
  return <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d={paths[n] ?? evenodd[n]} fill="currentColor" fill-rule={n in evenodd ? 'evenodd' : undefined} /></svg>;
}

// Context menu on a long press (the iOS contextMenu): items are read when the press fires, so
// they reflect the store at that moment (pinned, hidden …).
export type MenuItem = { label: string; icon?: string; danger?: boolean; onSelect: () => void };
let menu: MenuItem[] | undefined;
const menuListeners = new Set<() => void>();
export function showMenu(items: MenuItem[]) { menu = items; menuListeners.forEach(l => l()); }
function MenuHost() {
  const [, r] = useState(0);
  useEffect(() => { const l = () => r(x => x + 1); menuListeners.add(l); return () => { menuListeners.delete(l); }; }, []);
  if (!menu) return null;
  const close = () => { menu = undefined; r(x => x + 1); };
  return <div class="sheet-backdrop" onClick={close}>
    <div class="menu" role="menu" onClick={e => e.stopPropagation()}>
      <div class="menu-items">{menu.map(i => <button class={'menu-item' + (i.danger ? ' danger' : '')} role="menuitem"
        onClick={() => { close(); i.onSelect(); }}>{i.label}{i.icon && <Icon n={i.icon} size={20} />}</button>)}</div>
      <button class="menu-cancel" onClick={close}>Abbrechen</button>
    </div>
  </div>;
}
/** Spread onto a card: 450 ms press opens the menu; moving the finger scrolls instead. Right click
 *  on a desktop does the same. preventDefault on the touchend stops the click that would follow. */
export function useLongPress(items: () => MenuItem[] | undefined) {
  const t = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<[number, number]>();
  const fired = useRef(false);
  const open = () => { const m = items(); if (m?.length) { fired.current = true; showMenu(m); } };
  const cancel = () => { clearTimeout(t.current); t.current = undefined; };
  return {
    onTouchStart: (e: TouchEvent) => { fired.current = false; start.current = [e.touches[0].clientX, e.touches[0].clientY]; cancel(); t.current = setTimeout(open, 450); },
    onTouchMove: (e: TouchEvent) => { const s = start.current; if (s && Math.hypot(e.touches[0].clientX - s[0], e.touches[0].clientY - s[1]) > 10) cancel(); },
    onTouchEnd: (e: TouchEvent) => { cancel(); if (fired.current) { e.preventDefault(); fired.current = false; } },
    onTouchCancel: cancel,
    onContextMenu: (e: Event) => { e.preventDefault(); if (!fired.current) open(); fired.current = false; },
  };
}

/** Large-title page with optional back button and trailing items (navigation bar of a NavigationStack). */
export function Page({ title, back, trailing, children, large = true, onRefresh }: {
  title: string; back?: boolean; trailing?: ComponentChildren; children: ComponentChildren; large?: boolean; onRefresh?: () => Promise<unknown>;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const f = () => setScrolled(scrollY > 40); addEventListener('scroll', f, { passive: true }); return () => removeEventListener('scroll', f); }, []);
  // Pull to refresh: a finger dragged down 80px from the top of the page, like the iOS app's lists.
  useEffect(() => {
    if (!onRefresh) return;
    let startY: number | undefined;
    const start = (e: TouchEvent) => { startY = scrollY <= 0 ? e.touches[0].clientY : undefined; };
    const end = (e: TouchEvent) => {
      if (startY === undefined || scrollY > 0 || e.changedTouches[0].clientY - startY < 80) return;
      setRefreshing(true); onRefresh().finally(() => setRefreshing(false));
    };
    addEventListener('touchstart', start, { passive: true }); addEventListener('touchend', end, { passive: true });
    return () => { removeEventListener('touchstart', start); removeEventListener('touchend', end); };
  }, [onRefresh]);
  return <div class="page">
    {refreshing && <div class="spinner-wrap pull"><div class="spinner" /></div>}
    <header class={'navbar' + (scrolled || !large ? ' solid' : '')}>
      <div class="nav-leading">{back && <button class="nav-btn" onClick={pop} aria-label="Zurück"><Icon n="back" /></button>}</div>
      <div class="nav-title">{(scrolled || !large) && title}</div>
      <div class="nav-trailing">{trailing}</div>
    </header>
    {large && <h1 class="large-title">{title}</h1>}
    {children}
    <MenuHost />
  </div>;
}

export function AccountButton() {
  const s = useStore();
  return <button class={'nav-btn avatar-btn' + (s.account ? ' ring' : '')} onClick={() => push({ name: 'settings' })} aria-label="Einstellungen">
    {s.account?.avatar ? <img src={s.account.avatar} alt="" /> : <span class="avatar-placeholder"><Icon n="person" size={32} /></span>}
  </button>;
}

/** Shelf with title, optional menu beside it (language / channel picker) and "Alle". */
export function Shelf({ title, onAll, menu, children }: { title: string; onAll?: () => void; menu?: ComponentChildren; children: ComponentChildren }) {
  return <section class="shelf">
    <div class="shelf-head"><h2>{title}</h2>{menu}{onAll && <button class="link" onClick={onAll}>Alle</button>}</div>
    <div class="shelf-row">{children}</div>
  </section>;
}
/** Grey "Label ⌄" over a native <select>: the picker is the system menu, like a SwiftUI Menu. */
export function ShelfMenu<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const label = options.find(o => o[0] === value)?.[1] ?? options[0]?.[1];
  return <label class="shelf-menu"><span>{label}</span><Icon n="down" size={12} />
    <select value={value} onChange={e => onChange((e.target as HTMLSelectElement).value as T)}>
      {options.map(([v, l]) => <option value={v}>{l}</option>)}</select></label>;
}

/** ContentUnavailableView: symbol, title, text, optional action. */
export function Empty({ icon, title, text, action, onAction, children }: {
  icon?: string; title: string; text?: string; action?: string; onAction?: () => void; children?: ComponentChildren;
}) {
  return <div class="empty">{icon && <Icon n={icon} size={44} />}<h3>{title}</h3>{text && <p>{text}</p>}
    {action && <button class="btn prominent" onClick={onAction}>{action}</button>}{children}</div>;
}
export const Spinner = ({ text }: { text?: string }) => <div class="spinner-wrap"><div class="spinner" />{text && <p>{text}</p>}</div>;
/** TLoadMoreButton: full width, spinner while busy. */
export const LoadMore = ({ busy, onClick, label = 'Mehr laden' }: { busy?: boolean; onClick: () => void; label?: string }) =>
  <button class="btn wide" disabled={busy} onClick={onClick}>{busy ? <span class="spinner small" /> : label}</button>;
/** TListEndNote: why a list stops here. */
export const ListEndNote = ({ text }: { text: string }) => <p class="end-note">{text}</p>;
/** TChip: capsule, filled with the accent when on, optional symbol. */
export function Chip({ on, icon, onClick, children }: { on?: boolean; icon?: string; onClick: () => void; children: ComponentChildren }) {
  return <button class={'chip' + (on ? ' on' : '')} onClick={onClick}>{icon && <Icon n={icon} size={14} />}{children}</button>;
}
/** "N hier ausgeblendet · Verwalten" under a list with hidden entries. */
export const HiddenFooter = ({ count }: { count: number }) => count > 0
  ? <button class="hidden-footer" onClick={() => push({ name: 'settings' })}><Icon n="eyeSlash" size={12} />{count} hier ausgeblendet · Verwalten</button> : null;

const thumb = (u: string, w = 440, h = 248) => u.replace('{width}', String(w)).replace('{height}', String(h));
const Eye = ({ n }: { n: number }) => <span class="badge-meta"><Icon n="eye" size={10} />{formatViewers(n)}</span>;
const PinMark = () => <Icon n="pin" size={10} />;

/** Context menu of a live card: multi-live, pin (followed lists), hide channel / category (discovery). */
function streamMenu(s: Stream, pinnable?: boolean, hideable?: boolean, allowCategory = true): MenuItem[] {
  const items: MenuItem[] = [{ label: 'Zum Multi-Live hinzufügen', icon: 'grid', onSelect: () => play({ kind: 'multi', logins: [s.login] }) }];
  if (pinnable) items.push(isPinned(s.login) ? { label: 'Loslösen', icon: 'pinSlash', onSelect: () => togglePin(s.login) }
    : { label: 'Oben in „Gefolgt“ anheften', icon: 'pin', onSelect: () => togglePin(s.login) });
  if (hideable) {
    if (!isFollowedOrPinned(s.login)) items.push({ label: 'Diesen Kanal ausblenden', icon: 'eyeSlash', danger: true, onSelect: () => hideChannel(s.login, true, s.name) });
    if (allowCategory && s.gameId && s.game && !followsCategory(s.gameId))
      items.push({ label: `Kategorie „${s.game}“ ausblenden`, icon: 'eyeSlash', danger: true, onSelect: () => hideCategory({ id: s.gameId, name: s.game }) });
  }
  return items;
}

export type CardFlags = { pinnable?: boolean; hideable?: boolean; hideCategory?: boolean };
/** StreamCardView: card surface, "JETZT LIVE" + viewers on the picture, title (2 lines kept), name
 *  (opens the channel), category, tag chips. `width` 300 (followed) / 240 (top); `wide` = full. */
export function StreamCard({ s, wide, width, pinnable, hideable, hideCategory }: { s: Stream; wide?: boolean; width?: number } & CardFlags) {
  const lp = useLongPress(() => streamMenu(s, pinnable, hideable, hideCategory));
  return <button class={'card' + (wide ? ' wide' : '')} style={width ? { width } : undefined} onClick={() => play({ kind: 'live', login: s.login })} {...lp}>
    <div class="thumb"><img loading="lazy" src={thumb(s.thumb)} alt="" />
      <span class="badge live tl"><i />JETZT LIVE</span><span class="badge br"><Eye n={s.viewers} /></span></div>
    <div class="card-body">
      <div class="card-title">{s.title}</div>
      <span class="card-name" role="link" onClick={e => { e.stopPropagation(); openChannel(s.login); }}>{pinnable && isPinned(s.login) && <PinMark />}{s.name}</span>
      <div class="card-sub">{s.game || ' '}</div>
      <Tags tags={s.tags} />
    </div>
  </button>;
}
/** One line of tag capsules; the ones that don't fit wrap out of sight (TagChips). */
const Tags = ({ tags }: { tags: string[] }) => <div class="tags">{tags.slice(0, 8).map(t => <span class="tag">{t}</span>)}</div>;

/** StreamRowView: list mode of the "Alle" pages. */
export function StreamRow({ s, pinnable, hideable, hideCategory }: { s: Stream } & CardFlags) {
  const lp = useLongPress(() => streamMenu(s, pinnable, hideable, hideCategory));
  return <button class="stream-row" onClick={() => play({ kind: 'live', login: s.login })} {...lp}>
    <div class="row-thumb"><img loading="lazy" src={thumb(s.thumb, 320, 180)} alt="" /><span class="badge bl"><i class="dot live" />{formatViewers(s.viewers)}</span></div>
    <div class="row-body">
      <span class="row-name" role="link" onClick={e => { e.stopPropagation(); openChannel(s.login); }}>{pinnable && isPinned(s.login) && <PinMark />}{s.name}</span>
      <div class="row-title">{s.title}</div>
      {s.game && <span class="pill">{s.game}</span>}
      {s.tags.length > 0 && <Tags tags={s.tags} />}
    </div>
  </button>;
}

/** VodCardView: duration top right, 3 px progress bar, title (2 lines kept), short date.
 *  `noName`: the channel's own lists (the streamer is the page). */
export function VodCard({ v, wide, width, noName, onClick, status, statusError, disabled }: {
  v: Vod; wide?: boolean; width?: number; noName?: boolean; onClick?: () => void; status?: string; statusError?: boolean; disabled?: boolean;
}) {
  const p = state.progress[v.id];
  // Long press like ChannelView's VOD cards: into the multi-live mosaic (plain VODs only, not unlisted ones).
  const lp = useLongPress(() => onClick ? undefined : [{ label: 'Zum Multi-Live hinzufügen', icon: 'grid', onSelect: () => play({ kind: 'multi', logins: [{ vod: v.id }] }) }]);
  return <button class={'card' + (wide ? ' wide' : '')} style={width ? { width } : undefined} disabled={disabled} aria-busy={status === 'Suche …'}
    onClick={onClick ?? (() => play({ kind: 'vod', id: v.id }))} {...lp}>
    <div class="thumb"><img loading="lazy" src={v.thumb.includes('404_processing') || !v.thumb ? '' : thumb(v.thumb, 320, 180)} alt="" />
      <span class="badge tr">{formatDuration(v.length)}</span>
      {status && <span class={'badge bl' + (statusError ? ' problem' : '')}>{status}</span>}
      {p && v.length ? <div class="progress"><div style={{ width: `${Math.min(100, p / v.length * 100)}%` }} /></div> : null}</div>
    <div class="card-body"><div class="card-title">{v.title}</div>
      <div class="card-sub">{formatShortDate(v.publishedAt)}{v.name && !noName ? ` · ${v.name}` : ''}</div></div>
  </button>;
}
/** Picture of a history VOD; a recording still running only has Twitch's placeholder → live preview. */
export function vodThumb(h: HistoryEntry): string {
  let url = h.thumb;
  if (!url || url.includes('processing') || url.includes('404')) url = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${h.login.toLowerCase()}-320x180.jpg`;
  return url.replace('%{width}', '320').replace('%{height}', '180').replace('{width}', '320').replace('{height}', '180');
}
/** ResumeVodCard: 220 px, the watched part as a 4 px bar, one-line title, streamer under it. */
export function ResumeVodCard({ h, menu }: { h: HistoryEntry; menu?: () => MenuItem[] }) {
  const lp = useLongPress(() => menu?.());
  const p = state.progress[h.id];
  return <button class="resume" onClick={() => play({ kind: 'vod', id: h.id })} {...lp}>
    <div class="thumb"><img loading="lazy" src={vodThumb(h)} alt="" />
      {p && h.length ? <div class="progress thick"><div style={{ width: `${Math.min(100, p / h.length * 100)}%` }} /></div> : null}</div>
    <div class="resume-title">{h.title || h.name}</div>
    {h.name && <div class="resume-sub">{h.name}</div>}
  </button>;
}
/** ShelfClipCard: upright 130 px tile of the home shelf, viewers bottom left. */
export function ShelfClipCard({ c, onClick }: { c: Clip; onClick: () => void }) {
  return <button class="shelf-clip" onClick={onClick}>
    <div class="thumb tall"><img loading="lazy" src={c.thumb} alt="" /><span class="badge bl"><Eye n={c.views} /></span></div>
    <div class="shelf-clip-title">{c.title}</div>
  </button>;
}
/** Upright clip tile (channel page clip grid). */
export function ClipCard({ c, onClick }: { c: Clip; onClick: () => void }) {
  return <button class="card clip" onClick={onClick}>
    <div class="thumb tall"><img loading="lazy" src={c.thumb} alt="" /><span class="badge br">{formatClipDuration(c.duration)}</span></div>
    <div class="card-body"><div class="card-title">{c.title}</div><div class="card-sub">{c.name ?? ''} · {formatViewers(c.views)} Aufrufe</div></div>
  </button>;
}
/** ClipCardView: 16:9 card, viewers top left, "0:28" bottom right, "Datum · Kurator". */
export function ClipCardWide({ c, onClick }: { c: Clip; onClick: () => void }) {
  return <button class="card wide" onClick={onClick}>
    <div class="thumb"><img loading="lazy" src={c.thumb} alt="" /><span class="badge tl"><Eye n={c.views} /></span><span class="badge br">{formatClipDuration(c.duration)}</span></div>
    <div class="card-body"><div class="card-title">{c.title}</div>
      <div class="card-sub">{[formatShortDate(c.createdAt), c.curator].filter(Boolean).join(' · ')}</div></div>
  </button>;
}
/** CategoryCardView: box art radius 6, name (2 lines kept), red dot + viewers; hidden = badge + 50 %. */
export function CategoryTile({ c, hideable }: { c: Category; hideable?: boolean }) {
  useStore();
  const hidden = !!hideable && isHiddenCategory(c.id);
  const lp = useLongPress(() => hideable && !followsCategory(c.id) ? [hidden
    ? { label: 'Wieder anzeigen', icon: 'eye', onSelect: () => hideCategory(c, false) }
    : { label: 'Diese Kategorie ausblenden', icon: 'eyeSlash', danger: true, onSelect: () => hideCategory(c) }] : undefined);
  return <button class={'cat' + (hidden ? ' hidden' : '')} onClick={() => push({ name: 'category', id: c.id, title: c.name })} {...lp}>
    <div class="cat-art"><img loading="lazy" src={thumb(c.boxArt, 285, 380)} alt="" />{hidden && <span class="badge tl hidden-badge"><Icon n="eyeSlash" size={10} />Ausgeblendet</span>}</div>
    <div class="cat-name">{c.name}</div>
    <div class="cat-viewers" style={c.viewers == null ? { opacity: 0 } : undefined}><i class="dot live" />{c.viewers != null ? formatViewers(c.viewers) : ' '}</div>
  </button>;
}
/** Offline shelf tile: avatar 64 in a 72 px column; long press pins. */
export function OfflineAvatar({ c }: { c: ChannelBrief }) {
  const lp = useLongPress(() => [pinMenuItem(c.login)]);
  return <button class="avatar-tile" onClick={() => openChannel(c.login)} {...lp}><img class="avatar lg" src={c.avatar} alt="" /><span>{c.name}</span></button>;
}
export const pinMenuItem = (login: string): MenuItem => isPinned(login)
  ? { label: 'Loslösen', icon: 'pinSlash', onSelect: () => togglePin(login) }
  : { label: 'Oben in „Gefolgt“ anheften', icon: 'pin', onSelect: () => togglePin(login) };

export function relDate(iso?: string): string {
  if (!iso) return '';
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 3600) return `vor ${Math.max(1, Math.floor(d / 60))} min`;
  if (d < 86400) return `vor ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 30) return `vor ${Math.floor(d / 86400)} ${Math.floor(d / 86400) === 1 ? 'Tag' : 'Tagen'}`;
  return new Date(iso).toLocaleDateString('de-DE');
}

/** Bottom sheet with a title bar (tSheetBar: close on the left). */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  return <div class="sheet-backdrop" onClick={onClose}>
    <div class="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
      <div class="sheet-bar"><button class="close-btn" onClick={onClose} aria-label="Schließen"><Icon n="close" size={16} /></button><h3>{title}</h3><span /></div>
      <div class="sheet-body">{children}</div>
    </div>
  </div>;
}
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div class="segmented">{options.map(([v, l]) => <button class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export function Toggle({ label, value, onChange, sub }: { label: string; value: boolean; onChange: (v: boolean) => void; sub?: string }) {
  return <label class="row"><div><div>{label}</div>{sub && <div class="row-sub">{sub}</div>}</div>
    <input type="checkbox" class="switch" checked={value} onChange={e => onChange((e.target as HTMLInputElement).checked)} /></label>;
}
export function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <label class="row"><span>{label}</span>
    <select value={String(value)} onChange={e => { const raw = (e.target as HTMLSelectElement).value; onChange((typeof value === 'number' ? Number(raw) : raw) as T); }}>
      {options.map(([v, l]) => <option value={String(v)}>{l}</option>)}</select></label>;
}
