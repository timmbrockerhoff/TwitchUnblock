// VOD fallbacks and deleted-VOD recovery, ported from TwitchAPI.swift and
// VodRecoveryService.swift. Browser-only CORS work is delegated to the same
// TwitchUnblock workers that expose /api/get-m3u8 and /api/recover-*.
import type { Master, Variant } from './logic';

export const WORKER_BASES = [
  'https://test2.kurzmathis4.workers.dev',
  'https://test2-fallback.vxcraftmanpetit.workers.dev',
] as const;

export type RecoverableStream = {
  streamID: string;
  login: string;
  epoch: number;
  start: string;
  title: string;
  game: string;
  maxViews: number;
  duration: number;
};

export type RecoveredVod = {
  streamID: string;
  title: string;
  login: string;
  startedAt: string;
  links: Record<string, string>;
  variants?: Record<string, Variant>;
};

export type MutedRange = { start: number; end: number };
export type PreparedVod = { url: string; restored: number; remaining: MutedRange[]; revoke?: () => void };

type WorkerReply = {
  links?: Record<string, string>;
  variants?: Record<string, { h?: number; fps?: number; bw?: number }>;
  streams?: unknown[];
  unavailable?: boolean;
};

const downUntil = new Map<string, number>();
const timeout = (ms: number) => AbortSignal.timeout(ms);
const nextUTCMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

/** Convert the compact variant map returned by the worker to the PWA model. */
export function workerVariants(value: WorkerReply['variants']): Record<string, Variant> {
  const out: Record<string, Variant> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, v] of Object.entries(value)) {
    if (!v || typeof v !== 'object' || !Number.isFinite(Number(v.h))) continue;
    out[key] = { height: Number(v.h), fps: Number(v.fps) || 0, bandwidth: Number(v.bw) || 0 };
  }
  return out;
}

/** Try healthy workers first. A quota failure is held until midnight UTC. */
async function workerJSON(path: string, ms = 20000): Promise<WorkerReply | undefined> {
  const now = Date.now();
  const ordered = [...WORKER_BASES].sort((a, b) => Number((downUntil.get(a) ?? 0) > now) - Number((downUntil.get(b) ?? 0) > now));
  const unreachable: string[] = [];
  for (const base of ordered) {
    try {
      const r = await fetch(base + path, { signal: timeout(ms), cache: 'no-store' });
      if (r.status === 429 || (r.status >= 502 && r.status <= 504)) {
        const body = await r.text().catch(() => '');
        if (WORKER_BASES.length > 1) downUntil.set(base, body.includes('1027') ? nextUTCMidnight() : now + 30 * 60_000);
        continue;
      }
      for (const failed of unreachable) downUntil.set(failed, now + 30 * 60_000);
      if (!r.ok) return undefined;
      return await r.json() as WorkerReply;
    } catch {
      unreachable.push(base);
    }
  }
  return undefined;
}

/** The worker's own live source chain (workerLiveLinks in iOS), the last resort of raceLive.
 *  Its links go through /api/proxy, so the master ("Auto") and every quality are readable. */
export async function workerLive(login: string): Promise<Master | undefined> {
  if (!/^[a-z0-9_]{1,25}$/i.test(login)) return undefined;
  const j = await workerJSON(`/api/get-live?name=${encodeURIComponent(login.toLowerCase())}&proxy=false`, 15000);
  if (!j?.links || !Object.keys(j.links).length) return undefined;
  return { links: j.links, variants: workerVariants(j.variants) };
}

/** Worker implementation of getM3U8: official token, storyboard/CDN fallback, then proxy. */
export async function workerVod(id: string): Promise<Master | undefined> {
  if (!/^\d{1,20}$/.test(id)) return undefined;
  const j = await workerJSON(`/api/get-m3u8?id=${encodeURIComponent(id)}`);
  if (!j?.links || !Object.keys(j.links).length) return undefined;
  return { links: j.links, variants: workerVariants(j.variants) };
}

function recoverable(value: unknown): RecoverableStream | undefined {
  const x = value as Partial<RecoverableStream> | null;
  if (!x || !/^\d{1,20}$/.test(String(x.streamID ?? '')) || !/^[a-z0-9_]{1,25}$/i.test(String(x.login ?? ''))) return undefined;
  const epoch = Number(x.epoch), start = String(x.start ?? '');
  if (!Number.isFinite(epoch) || !Number.isFinite(Date.parse(start))) return undefined;
  return {
    streamID: String(x.streamID), login: String(x.login).toLowerCase(), epoch: Math.floor(epoch), start,
    title: String(x.title ?? ''), game: String(x.game ?? ''), maxViews: Number(x.maxViews) || 0,
    duration: Math.max(0, Math.round(Number(x.duration) || 0)),
  };
}

/** Recent broadcasts known to the external metadata source, via a CORS-safe worker. */
export async function loadRecoverableStreams(login: string): Promise<{ streams: RecoverableStream[]; unavailable: boolean }> {
  const channel = login.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) return { streams: [], unavailable: true };
  const j = await workerJSON(`/api/recover-list?channel=${encodeURIComponent(channel)}`, 12000);
  if (!j) return { streams: [], unavailable: true };
  return { streams: (j.streams ?? []).map(recoverable).filter((x): x is RecoverableStream => !!x), unavailable: !!j.unavailable };
}

/** Rebuild and validate the CDN folder of a deleted/hidden broadcast. */
export async function resolveRecoverableStream(stream: RecoverableStream): Promise<RecoveredVod | undefined> {
  const q = new URLSearchParams({ login: stream.login, streamID: stream.streamID, epoch: String(stream.epoch) });
  const j = await workerJSON(`/api/recover-resolve?${q}`, 30000);
  if (!j?.links || !Object.keys(j.links).length) return undefined;
  return {
    streamID: stream.streamID, login: stream.login, startedAt: stream.start,
    title: stream.title || stream.login, links: j.links, variants: workerVariants(j.variants),
  };
}

type MutedSegment = { index: number; probe: string; start: number; duration: number };

/** URL inside /api/proxy?url=… with another upstream target. */
function retargetProxy(proxy: string, target: string): string | undefined {
  try {
    const u = new URL(proxy);
    if (!u.pathname.endsWith('/api/proxy') || !u.searchParams.has('url')) return undefined;
    u.searchParams.set('url', target);
    return u.href;
  } catch { return undefined; }
}

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: timeout(6000), cache: 'no-store' });
    const ok = r.ok;
    await r.body?.cancel().catch(() => {});
    return ok;
  } catch { return false; }
}

async function probeInBatches(items: MutedSegment[]): Promise<Set<number>> {
  const available = new Set<number>();
  for (let i = 0; i < items.length; i += 8) {
    const part = items.slice(i, i + 8);
    const result = await Promise.all(part.map(x => exists(x.probe)));
    result.forEach((ok, j) => { if (ok) available.add(part[j].index); });
  }
  return available;
}

/** Browser port of VodUnmute's playlist rewrite. It is used only for recent playlists already
 * served by /api/proxy. The first four missing originals decide whether probing the remainder is
 * worthwhile. A Blob HLS URL lets Safari consume the rewritten, fully absolute playlist. */
export async function prepareUnmutedPlaylist(url: string, createdAt?: string): Promise<PreparedVod> {
  if (createdAt && Date.now() - Date.parse(createdAt) >= 4 * 86400_000) return { url, restored: 0, remaining: [] };
  try {
    const r = await fetch(url, { signal: timeout(10000), cache: 'no-store' });
    if (!r.ok) return { url, restored: 0, remaining: [] };
    const text = await r.text();
    if (!text.startsWith('#EXTM3U') || !text.includes('#EXTINF:')) return { url, restored: 0, remaining: [] };
    const lines = text.split('\n');
    const muted: MutedSegment[] = [];
    let clock = 0, pending = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF:')) { pending = Number(line.slice(8).split(',')[0]) || 0; continue; }
      if (!line || line.startsWith('#')) continue;
      let target: string | null = null;
      try { target = new URL(line).searchParams.get('url'); } catch { /* not a proxy URL */ }
      const original = target?.replace(/-muted\.ts(?=$|\?)/, '.ts');
      const probe = original && original !== target ? retargetProxy(line, original) : undefined;
      if (probe) muted.push({ index: i, probe, start: clock, duration: pending });
      clock += pending; pending = 0;
    }
    if (!muted.length) return { url, restored: 0, remaining: [] };

    const first = muted.slice(0, 4);
    const available = await probeInBatches(first);
    if (available.size) {
      const rest = await probeInBatches(muted.slice(first.length));
      rest.forEach(i => available.add(i));
    }
    for (const m of muted) if (available.has(m.index)) lines[m.index] = m.probe;

    const remaining: MutedRange[] = [];
    for (const m of muted) if (!available.has(m.index)) {
      const last = remaining[remaining.length - 1];
      if (last && m.start <= last.end + .5) last.end = m.start + m.duration;
      else remaining.push({ start: m.start, end: m.start + m.duration });
    }
    if (!available.size) return { url, restored: 0, remaining };
    const objectURL = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'application/vnd.apple.mpegurl' }));
    return { url: objectURL, restored: available.size, remaining, revoke: () => URL.revokeObjectURL(objectURL) };
  } catch { return { url, restored: 0, remaining: [] }; }
}
