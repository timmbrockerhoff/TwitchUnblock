// Channel points earned by watching and time watched, per channel (PointsTracker.swift):
// minutes = every minute-watched Twitch accepted, points = balance increases (passive points,
// streaks, chests), not prediction payouts. Fed by rewards.ts, shown in Settings → Kanalpunkte.
import { changed } from './store';

export type PointsChannel = { login: string; minutes: number; points: number; chests: number; last: number };
export type PointsSession = { login: string; start: number; minutes: number; points: number };
const KEY = 'pointsTracker', MAX_CHANNELS = 300;

type Saved = { channels: Record<string, PointsChannel>; since?: number };
const saved: Saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{"channels":{}}'); } catch { return { channels: {} }; } })();

export const points = {
  channels: saved.channels ?? {} as Record<string, PointsChannel>,
  /** Start of counting (first minute, or reset). */
  since: saved.since as number | undefined,
  /** Channels earning right now (several in multi-live), since they were opened. */
  sessions: {} as Record<string, PointsSession>,
  get totalMinutes() { return Object.values(this.channels).reduce((a, c) => a + c.minutes, 0); },
  get totalPoints() { return Object.values(this.channels).reduce((a, c) => a + c.points, 0); },
  get totalChests() { return Object.values(this.channels).reduce((a, c) => a + c.chests, 0); },
};
/** Expected prediction payout per channel: taken off the next balance rise (3 min at most). */
const payouts: Record<string, { points: number; until: number }> = {};

function save() { try { localStorage.setItem(KEY, JSON.stringify({ channels: points.channels, since: points.since })); } catch { /* full or blocked */ } }
function update(login: string, change: (c: PointsChannel) => void) {
  if (!login) return;
  const c = points.channels[login] ?? { login, minutes: 0, points: 0, chests: 0, last: 0 };
  change(c); c.last = Date.now(); points.channels[login] = c;
  points.since ??= Date.now();
  // Local storage stays small: the 300 channels seen most recently.
  const all = Object.values(points.channels);
  if (all.length > MAX_CHANNELS) delete points.channels[all.reduce((a, b) => a.last < b.last ? a : b).login];
  save(); changed();
}

/** Presence started on a channel: its session starts from zero. */
export function beginSession(login: string) { const k = login.toLowerCase(); if (k) { points.sessions[k] = { login: k, start: Date.now(), minutes: 0, points: 0 }; changed(); } }
export function endSession(login: string) { const k = login.toLowerCase(); if (points.sessions[k]) { delete points.sessions[k]; changed(); } }
/** A minute Twitch accepted. */
export function addMinute(login: string) { const k = login.toLowerCase(); update(k, c => { c.minutes++; }); if (points.sessions[k]) points.sessions[k].minutes++; }
/** Balance rise: counted, minus an expected prediction payout. */
export function addGain(delta: number, login: string) {
  const k = login.toLowerCase();
  if (delta <= 0) return;
  let gain = delta;
  const p = payouts[k];
  if (p) { delete payouts[k]; if (p.until > Date.now()) gain = Math.max(0, delta - p.points); }
  if (gain <= 0) return;
  update(k, c => { c.points += gain; });
  if (points.sessions[k]) points.sessions[k].points += gain;
}
/** Chest claimed (its points arrive through addGain). */
export function addChest(login: string) { update(login.toLowerCase(), c => { c.chests++; }); }
/** Prediction won on this channel: its payout is not watch income. */
export function expectPayout(pts: number, login: string) { const k = login.toLowerCase(); if (pts > 0 && k) payouts[k] = { points: pts, until: Date.now() + 180_000 }; }
export function resetPoints() { points.channels = {}; points.since = undefined; save(); changed(); }
