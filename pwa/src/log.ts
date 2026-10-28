// App-wide log (Logger.swift counterpart): newest first, capped, kept in localStorage so a
// problem seen on the iPhone can still be read after the web app was reloaded.
import { changed } from './store';

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';
export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'success', 'warn', 'error'];
/** `ok` is kept for older entries and callers: true = success, false = error. */
export type LogEntry = { at: number; cat: string; text: string; level: LogLevel; detail?: string; ok?: boolean };
const KEY = 'appLog', MAX = 500;

const levelOf = (ok?: boolean): LogLevel => ok === true ? 'success' : ok === false ? 'error' : 'info';
export let logs: LogEntry[] = (() => {
  try { return (JSON.parse(localStorage.getItem(KEY) || '[]') as LogEntry[]).map(l => ({ ...l, level: l.level ?? levelOf(l.ok) })); }
  catch { return []; }
})();

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function add(level: LogLevel, cat: string, text: string, detail?: string) {
  const ok = level === 'success' ? true : level === 'error' ? false : undefined;
  logs = [{ at: Date.now(), cat, text, level, detail, ok }, ...logs].slice(0, MAX);
  changed();
  // One write per burst, not per line.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(logs)); } catch { /* full or blocked */ } }, 1000);
}
/** `ok`: true = success (green), false = failure (red), undefined = info. */
export function addLog(cat: string, text: string, ok?: boolean, detail?: string) { add(levelOf(ok), cat, text, detail); }
/** Logger.swift style: `log.warn('GQL', 'Seite verweigert', 'HTTP 403')`. */
export const log = {
  debug: (cat: string, text: string, detail?: string) => add('debug', cat, text, detail),
  info: (cat: string, text: string, detail?: string) => add('info', cat, text, detail),
  success: (cat: string, text: string, detail?: string) => add('success', cat, text, detail),
  warn: (cat: string, text: string, detail?: string) => add('warn', cat, text, detail),
  error: (cat: string, text: string, detail?: string) => add('error', cat, text, detail),
};
export function clearLogs() { logs = []; try { localStorage.removeItem(KEY); } catch { /* blocked */ } changed(); }

export const logLine = (l: LogEntry) =>
  `[${new Date(l.at).toLocaleString('de-DE')}] [${l.cat}] [${l.level.toUpperCase()}] ${l.text}${l.detail ? ' → ' + l.detail : ''}`;
