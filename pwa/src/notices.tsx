// In-app notices (InAppNotices.swift counterpart): one banner at a time at the top of the screen,
// 5 s each, queue of 5. Web push would need a server, so a notice raised while the app is hidden
// is kept in localStorage (3 days, like iOS) and shown on the next return or start.
import { useRef } from 'preact/hooks';
import { changed, useStore } from './store';
import { Icon } from './ui';

export type NoticeKind = 'dropReady' | 'dropClaimed' | 'dropLink' | 'update' | 'auth' | 'info';
/** `action: 'reload'` = tap reloads the page (new version). */
export type Notice = { kind: NoticeKind; title: string; body?: string; url?: string; action?: 'reload' };

const PENDING_KEY = 'noticesPending', KEEP_MS = 3 * 86_400_000;
let current: (Notice & { id: number }) | null = null;
let queue: Notice[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;

const same = (a: Notice) => (b: Notice) => a.kind === b.kind && a.title === b.title && a.body === b.body;

export function notice(n: Notice) {
  if (document.visibilityState !== 'visible') { keepForLater(n); return; }
  show(n);
}
function show(n: Notice) {
  if (queue.some(same(n)) || (current && same(n)(current))) return;
  queue = [...queue, n].slice(-5);
  if (!current) next();
}

/** dropLink once per campaign, also across app starts. */
export function noticeDropLink(campaignId: string, n: Notice) {
  let seen: string[] = [];
  try { seen = JSON.parse(localStorage.getItem('noticedDropLinks') || '[]'); } catch { /* fresh */ }
  if (seen.includes(campaignId)) return;
  try { localStorage.setItem('noticedDropLinks', JSON.stringify([...seen, campaignId].slice(-100))); } catch { /* blocked */ }
  notice(n);
}

type Pending = Notice & { at: number };
const readPending = (): Pending[] => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } };
function keepForLater(n: Notice) {
  const list = readPending();
  if (list.some(same(n))) return;
  try { localStorage.setItem(PENDING_KEY, JSON.stringify([...list, { ...n, at: Date.now() }].slice(-5))); } catch { /* blocked */ }
}
/** Notices that arrived while hidden (or before a reload): shown now, three days at most. */
function showPending() {
  const list = readPending();
  if (!list.length) return;
  try { localStorage.removeItem(PENDING_KEY); } catch { /* blocked */ }
  for (const n of list) if (Date.now() - n.at < KEEP_MS) show(n);
}

function next() {
  if (current || !queue.length || document.visibilityState !== 'visible') return;
  current = { ...queue[0], id: nextId++ };
  queue = queue.slice(1);
  changed();
  clearTimeout(timer);
  timer = setTimeout(dismiss, 5000);
}

export function dismiss() {
  clearTimeout(timer);
  current = null;
  changed();
  // Let the banner leave before the next one comes in.
  if (queue.length) timer = setTimeout(next, 400);
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { showPending(); next(); } });
if (document.visibilityState === 'visible') showPending();

const ICON: Record<NoticeKind, string> = { dropLink: 'link', dropClaimed: 'check', dropReady: 'gift', update: 'fwd', auth: 'person', info: 'title' };

/** Mounted once at the app root, above the player and sheets. */
export function NoticeHost() {
  useStore();
  const startY = useRef(0);
  const n = current;
  if (!n) return null;
  return <div class="notice-wrap">
    <button key={n.id} class={'notice ' + n.kind} role="status"
      onClick={() => { dismiss(); if (n.action === 'reload') location.reload(); else if (n.url) open(n.url, '_blank', 'noopener'); }}
      onTouchStart={e => { startY.current = e.touches[0].clientY; }}
      onTouchEnd={e => { if (e.changedTouches[0].clientY - startY.current < -12) { e.preventDefault(); dismiss(); } }}>
      <span class="notice-icon"><Icon n={ICON[n.kind]} size={16} /></span>
      <span class="notice-text"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</span>
    </button>
  </div>;
}
