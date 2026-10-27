// In-app notices (InAppNotices.swift counterpart): one banner at a time at the top of the screen.
// Web push would need a server, so a notice raised while the app is in the background waits
// until it is visible again.
import { useRef } from 'preact/hooks';
import { changed, useStore } from './store';
import { Icon } from './ui';

export type NoticeKind = 'dropReady' | 'dropClaimed' | 'dropLink';
export type Notice = { kind: NoticeKind; title: string; body?: string; url?: string };

let current: (Notice & { id: number }) | null = null;
let queue: Notice[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;

const same = (a: Notice) => (b: Notice) => a.kind === b.kind && a.title === b.title && a.body === b.body;

export function notice(n: Notice) {
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

function next() {
  // Hidden page: keep it queued, visibilitychange shows it on return.
  if (current || !queue.length || document.visibilityState !== 'visible') return;
  current = { ...queue[0], id: nextId++ };
  queue = queue.slice(1);
  changed();
  clearTimeout(timer);
  timer = setTimeout(dismiss, 4000);
}

export function dismiss() {
  clearTimeout(timer);
  current = null;
  changed();
  // Let the banner leave before the next one comes in.
  if (queue.length) timer = setTimeout(next, 400);
}

document.addEventListener('visibilitychange', () => next());

/** Mounted once at the app root, above the player and sheets. */
export function NoticeHost() {
  useStore();
  const startY = useRef(0);
  const n = current;
  if (!n) return null;
  const icon = n.kind === 'dropLink' ? 'link' : n.kind === 'dropClaimed' ? 'check' : 'gift';
  return <div class="notice-wrap">
    <button key={n.id} class={'notice ' + n.kind} role="status"
      onClick={() => { dismiss(); if (n.url) open(n.url, '_blank', 'noopener'); }}
      onTouchStart={e => { startY.current = e.touches[0].clientY; }}
      onTouchEnd={e => { if (e.changedTouches[0].clientY - startY.current < -12) { e.preventDefault(); dismiss(); } }}>
      <span class="notice-icon"><Icon n={icon} size={16} /></span>
      <span class="notice-text"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</span>
    </button>
  </div>;
}
