// App-wide log (Logger.swift counterpart): newest first, capped, kept in localStorage so a
// problem seen on the iPhone can still be read after the web app was reloaded.
import { changed } from './store';

export type LogEntry = { at: number; cat: string; text: string; ok?: boolean };
const KEY = 'appLog', MAX = 300;

export let logs: LogEntry[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })();

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** `ok`: true = success (green), false = failure (red), undefined = info. */
export function addLog(cat: string, text: string, ok?: boolean) {
  logs = [{ at: Date.now(), cat, text, ok }, ...logs].slice(0, MAX);
  changed();
  // One write per burst, not per line.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(logs)); } catch { /* full or blocked */ } }, 1000);
}
export function clearLogs() { logs = []; try { localStorage.removeItem(KEY); } catch { /* blocked */ } changed(); }

export const logLine = (l: LogEntry) =>
  `[${new Date(l.at).toLocaleString('de-DE')}] [${l.cat}]${l.ok === false ? ' FEHLER' : ''} ${l.text}`;
