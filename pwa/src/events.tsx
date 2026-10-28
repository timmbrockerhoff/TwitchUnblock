// Notices above the chat (ChatView.notices, LiveEventsService.swift, ChatPubSub.swift,
// RaidService.swift, ChatNotices.swift, HypeTrainCard.swift): pinned message → channel drops →
// poll → prediction → hype train → raid, as full-width bands with an icon column and a 10 % tint.
// Public GQL for reading; logged in (TV client token): poll vote, prediction bet, watch streak.
// Measured 2026-10-26 with nonexistent ids: VoteInPoll → POLL_NOT_FOUND, MakePrediction →
// MUST_ACCEPT_TOS, i.e. both pass auth without an integrity token.
import './events.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { gql, gqlPersisted } from './twitch';
import { readHype, applyHype, endHypeFlash, readableColor, type LiveHype } from './logic';
import { state, useStore } from './store';
import { rewards, gql as accountGql, errors } from './rewards';
import { buildParts, type Part } from './chat';
import { expectPayout } from './points';

const H_VOTE = '1280e27b0f3c7ae60b5714bd569771ea50635778473182e6e959e2dcfcc16e3c';
const H_PREDICT = 'b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8';
const H_STREAK = '7d04fbaa5bb32d193c742caa2c855dfde371a2a8cb25afed5b5c3d45f5ee9278';
const H_POLL = 'e83188a3836c636393df3191665e543a03733d7c51d3ade3d85e42aa46c2bf55';
const H_PRED = 'beb846598256b75bd7c1fe54a80431335996153e358ca9c7837ce7bb83d7d383';
const MIN_BET = 10, MAX_BET = 250000;
const persisted = (operationName: string, sha256Hash: string, variables: unknown = {}) =>
  accountGql([{ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash } } }]);
/** Twitch's error text: GQL errors, else the payload's error code (with a hint for the one we know). */
const failure = (j: any, payload: string) => {
  if (!j) return 'Keine Antwort von Twitch';
  const e = errors(j) ?? (Array.isArray(j) ? j[0] : j)?.data?.[payload]?.error?.code;
  return e === 'MUST_ACCEPT_TOS' ? 'MUST_ACCEPT_TOS – den Vorhersage-Bedingungen einmal auf twitch.tv zustimmen' : e;
};

/** Watch streak per channel login (BatchGetWatchStreaks). Never a line of its own: the points
 *  capsule in the chat shows it ("👑 20 · 🔥 5"), landscape's info line when there is none. */
export const watchStreaks: Record<string, number> = {};

type Pinned = { id: string; name: string; color: string; badges: { url: string; title: string }[]; parts: Part[]; text: string; by?: string; startsAt?: number; endsAt?: number };
type Poll = { id: string; title: string; choices: { id: string; title: string; votes: number }[]; endsAt?: number; active: boolean; multi: boolean };
type Prediction = { id: string; title: string; locked: boolean; closesAt?: number; winner?: string;
  outcomes: { id: string; title: string; color: string; points: number; users: number; top?: number }[]; mine?: { outcome: string; points: number } };
type Drops = { id: string; name: string; game: string; endsAt?: number; url?: string; reward: string; image?: string; minutes: number; more: number };
export type Raid = { login: string; name: string; viewers: number; go: boolean };

const secsLeft = (t?: number) => t ? Math.max(0, Math.round((t - Date.now()) / 1000)) : undefined;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** Like Twitch: 950, 27.4K, 1.2M (one decimal, dropped when 0). */
const compact = (v: number) => {
  const one = (x: number, u: string) => { const t = Math.floor(x * 10) / 10; return (Number.isInteger(t) ? String(t) : t.toFixed(1)) + u; };
  return v >= 1e6 ? one(v / 1e6, 'M') : v >= 1000 ? one(v / 1000, 'K') : String(v);
};
const ratioText = (r: number) => r.toFixed(2).replace(/\.?0+$/, '');
const outcomeColor = (c: string) => c === 'PINK' ? '#f5009b' : c === 'GRAY' || c === 'GREY' ? 'var(--muted)' : '#3d7dff';
const DROPS_DISMISSED = 'drops_notice_dismissed';
const dismissedDrops = (): string[] => { try { return JSON.parse(localStorage.getItem(DROPS_DISMISSED) || '[]'); } catch { return []; } };
const isoMs = (s?: string) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : undefined; };

/** SF Symbol stand-ins, 12 px, currentColor. */
const ICONS: Record<string, string> = {
  pin: 'M9 1l6 6-2 1-1 4-3-3-4 6-1-1 6-4-3-3 4-1 1-2z', chart: 'M2 9h3v6H2zm5-5h3v11H7zm5 3h3v8h-3z',
  sparkles: 'M8 1l1.5 4L14 6.5 9.5 8 8 12 6.5 8 2 6.5 6.5 5 8 1zm5 9l.7 1.8 1.8.7-1.8.7L13 15l-.7-1.8-1.8-.7 1.8-.7L13 10z',
  tram: 'M4 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2l1 2h-1.5l-1-2h-5l-1 2H3l1-2a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v4h8V4H4zm1 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  run: 'M10 1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8 5l3 1 2 3-1.3.8L10.5 8l-1 2.5 2.5 2-1 3-1.4-.6.7-2-2.3-1.7L6 13l-1.4-.9L7 9l.5-2.5L5 8 4 6.5z',
  gift: 'M2 6h12v3H2zm1 4h10v5H3zm3-9c1.5 0 2 1.5 2 3H6a1.5 1.5 0 0 1 0-3zm4 0a1.5 1.5 0 0 1 0 3H8c0-1.5.5-3 2-3z',
  clock: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm-.7 3v4.5l3.2 1.9.7-1.2-2.5-1.5V4z',
  check: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.3 4.3L7 9.6 4.7 7.3 3.5 8.5 7 12l5.5-5.5z',
  trophy: 'M4 1h8v2h2v3a3 3 0 0 1-3 3h-.3A3 3 0 0 1 9 10.9V13h2v2H5v-2h2v-2.1A3 3 0 0 1 5.3 9H5a3 3 0 0 1-3-3V3h2zm8 4h1V4h-1zM3 4v1h1V4z',
  chevron: 'M3 6l5 5 5-5-1.4-1.4L8 8.2 4.4 4.6z', x: 'M4 3l9 9-1 1-9-9zm9 0l1 1-9 9-1-1z',
  circle: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', people: 'M5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM1 12c0-2 2-3.5 4-3.5s4 1.5 4 3.5v1H1zm8.5 1v-1c0-1-.4-1.9-1-2.6.8-.5 1.6-.9 2.5-.9 2 0 4 1.5 4 3.5v1z',
  crown: 'M2 12l1-7 3 3 2-5 2 5 3-3 1 7zm0 1h12v2H2z',
};
const I = ({ n, size = 12 }: { n: string; size?: number }) => <svg class="evt-i" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"><path d={ICONS[n]} /></svg>;
const Countdown = ({ at, cls }: { at?: number; cls?: string }) => {
  const s = secsLeft(at);
  return s != null && s > 0 ? <span class={'evt-cd ' + (cls ?? '')}><I n="clock" size={9} /> {mmss(s)}</span> : null;
};

export function LiveEvents({ login, channelId, onRaid }: { login: string; channelId?: string; onRaid: (r: Raid) => void }) {
  const s = useStore().settings;
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinDismissed, setPinDismissed] = useState('');
  const [drops, setDrops] = useState<Drops | null>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [predOpen, setPredOpen] = useState(false);
  const [hype, setHype] = useState<LiveHype | undefined>();
  const [raid, setRaid] = useState<Raid | null>(null);
  const [closed, setClosed] = useState<string[]>([]);
  // Landscape: the bands fold to an icon row (NoticesHideStrip / CollapsedNoticesBar), remembered.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('noticesCollapsed') === '1'; } catch { return false; } });
  const collapse = (v: boolean) => { setCollapsed(v); try { localStorage.setItem('noticesCollapsed', v ? '1' : '0'); } catch { /* blocked */ } };
  const [voted, setVoted] = useState<Record<string, string[]>>({});   // poll id → own choices (Twitch doesn't return them)
  const [localBet, setLocalBet] = useState<Record<string, { outcome: string; points: number }>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState('');
  const [amount, setAmount] = useState('');
  const [, tick] = useState(0);
  const account = state.account;
  const predRef = useRef<Prediction | null>(null);
  predRef.current = pred;
  const resultUntil = useRef(0);

  // Poll, prediction, streak: together every 15 s (LiveEventsService.interval).
  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    const myPred = 'id self { prediction { points outcome { id } } }';
    const load = async () => {
      const [pl, pr, mine, st] = await Promise.all([
        gqlPersisted('ChannelPollContext_GetViewablePoll', { login }, H_POLL),
        gqlPersisted('ChannelPointsPredictionContext', { count: 1, channelLogin: login }, H_PRED),
        account && accountGql({ query: `query($l: String!) { channel(name: $l) { activePredictionEvents { ${myPred} } lockedPredictionEvents { ${myPred} } } }`, variables: { l: login } }),
        account && state.settings.showStreak && persisted('BatchGetWatchStreaks', H_STREAK),
      ]);
      if (!alive) return;
      const p = pl?.data?.channel?.viewablePoll;
      setPoll(p?.choices?.length ? { id: p.id ?? '', title: p.title ?? 'Umfrage', active: (p.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE',
        endsAt: p.remainingDurationMilliseconds != null ? Date.now() + p.remainingDurationMilliseconds : isoMs(p.endedAt)
          ?? (p.startedAt && p.durationSeconds ? Date.parse(p.startedAt) + p.durationSeconds * 1000 : undefined),
        multi: !!(p.settings?.multichoice?.isEnabled ?? p.settings?.multichoice),
        choices: p.choices.map((c: any) => ({ id: c.id ?? '', title: c.title ?? '', votes: c.totalVoters ?? c.votes?.total ?? 0 })) } : null);
      const ch = pr?.data?.community?.channel;
      const ev = ch?.activePredictionEvents?.[0] ?? ch?.lockedPredictionEvents?.[0];
      if (!ev) {
        // Gone = over: show the winning outcome for a minute instead of dropping it at once.
        const prev = predRef.current;
        if (prev && !prev.winner && prev.id) {
          const d = await gql('query($l: String!) { channel(name: $l) { resolvedPredictionEvents(first: 3) { edges { node { id winningOutcome { id } } } } } }', { l: login });
          if (!alive) return;
          const w = d?.channel?.resolvedPredictionEvents?.edges?.find((e: any) => e.node?.id === prev.id)?.node?.winningOutcome?.id;
          if (w) {
            resultUntil.current = Date.now() + 60000; setPred({ ...prev, winner: w, closesAt: undefined, locked: true });
            // Our win: its payout is not watch income (points.ts takes it off the next balance rise).
            const my = mineOf(prev), o = prev.outcomes.find(x => x.id === w);
            if (my && my.outcome === w && o && o.points > 0) expectPayout(Math.floor(my.points * prev.outcomes.reduce((a, x) => a + x.points, 0) / o.points), login);
          }
          else setPred(null);
        } else if (prev && (!prev.winner || resultUntil.current < Date.now())) setPred(null);
      } else {
        resultUntil.current = 0;
        const me = [...(mine?.data?.channel?.activePredictionEvents ?? []), ...(mine?.data?.channel?.lockedPredictionEvents ?? [])]
          .find((e: any) => e.id === ev.id)?.self?.prediction;
        const locked = !ch?.activePredictionEvents?.length || ev.status === 'LOCKED';
        setPred({ id: ev.id ?? '', mine: me?.outcome?.id ? { outcome: me.outcome.id, points: me.points ?? 0 } : undefined, title: ev.title ?? 'Vorhersage', locked,
          closesAt: !locked && ev.createdAt && ev.predictionWindowSeconds ? Date.parse(ev.createdAt) + ev.predictionWindowSeconds * 1000 : undefined,
          outcomes: (ev.outcomes ?? []).map((o: any) => ({ id: o.id ?? '', title: o.title ?? '', color: o.color ?? 'BLUE', points: o.totalPoints ?? 0, users: o.totalUsers ?? 0,
            top: Math.max(0, ...(o.topPredictors ?? []).map((t: any) => t.points ?? 0)) || undefined })) });
      }
      const streak = (Array.isArray(st) ? st[0] : st)?.data?.batchGetWatchStreaks?.find((x: any) => x.channel?.id === channelId)?.value;
      if (typeof streak === 'number') watchStreaks[login] = streak;
    };
    load();
    const t = setInterval(load, 15000), t2 = setInterval(() => tick(x => x + 1), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(t2); };
  }, [login, channelId, account?.token]);

  // Pinned message every 20 s (ChatPubSub), with its own expiry timer.
  useEffect(() => {
    if (!channelId || !s.showPinned) { setPinned(null); return; }
    let alive = true, expiry: ReturnType<typeof setTimeout> | undefined;
    const q = `query($id: ID!) { channel(id: $id) { pinnedChatMessages(first: 1) { edges { node { id startsAt endsAt pinnedBy { login displayName }
      pinnedMessage { content { text fragments { text content { __typename ... on Emote { id } } } }
        sender { login displayName chatColor displayBadges(channelID: $id) { setID version imageURL(size: DOUBLE) } } } } } } } }`;
    const load = async () => {
      const d = await gql(q, { id: channelId });
      if (!alive || !d) return;
      const node = d.channel?.pinnedChatMessages?.edges?.[0]?.node, pm = node?.pinnedMessage, text: string = pm?.content?.text ?? '';
      const endsAt = isoMs(node?.endsAt);
      if (!node || !text || (endsAt && endsAt < Date.now())) { setPinned(null); return; }
      const sender = pm.sender ?? {};
      const parts: Part[] = [];
      for (const f of pm.content?.fragments ?? []) {
        if (f.content?.__typename === 'Emote' && f.content.id) parts.push({ t: 'emote', v: String(f.text).trim(), url: `https://static-cdn.jtvnw.net/emoticons/v2/${f.content.id}/default/dark/2.0` });
        else if (f.text) parts.push(...buildParts(f.text, '', channelId));
      }
      const by = node.pinnedBy?.login && node.pinnedBy.login !== sender.login ? node.pinnedBy.displayName : undefined;
      setPinned(p => p && p.id === node.id && p.endsAt === endsAt ? p : { id: node.id, name: sender.displayName || sender.login || '', color: sender.chatColor ? readableColor(sender.chatColor) : '#bf94ff',
        badges: (sender.displayBadges ?? []).filter((b: any) => String(b.imageURL).startsWith('https://')).map((b: any) => ({ url: b.imageURL, title: b.setID })),
        parts: parts.length ? parts : buildParts(text, '', channelId), text, by, startsAt: isoMs(node.startsAt), endsAt });
      clearTimeout(expiry);
      if (endsAt) expiry = setTimeout(() => setPinned(p => p && p.id === node.id ? null : p), Math.min(endsAt - Date.now(), 86400000));
    };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); clearTimeout(expiry); };
  }, [channelId, s.showPinned]);

  // Channel drops card every 10 min (ChannelDropsNotice); dismissed campaigns stay away.
  useEffect(() => {
    if (!channelId || !s.showDropsNotice) { setDrops(null); return; }
    let alive = true;
    const load = async () => {
      const d = await gql(`query($id: ID!) { user(id: $id) { channel { viewerDropCampaigns { id name endAt detailsURL game { displayName }
        timeBasedDrops { name requiredMinutesWatched benefitEdges { benefit { name imageAssetURL } } } } } } }`, { id: channelId });
      if (!alive || !d) return;
      const gone = new Set(dismissedDrops());
      const found = (d.user?.channel?.viewerDropCampaigns ?? []).map((c: any): Drops | undefined => {
        if (!c.id || gone.has(c.id)) return;
        const endsAt = isoMs(c.endAt); if (endsAt && endsAt < Date.now()) return;
        const ds = [...(c.timeBasedDrops ?? [])].sort((a, b) => (a.requiredMinutesWatched ?? 0) - (b.requiredMinutesWatched ?? 0));
        const first = ds[0], benefit = first?.benefitEdges?.[0]?.benefit;
        return { id: c.id, name: c.name ?? '', game: c.game?.displayName ?? '', endsAt, url: String(c.detailsURL ?? '').startsWith('https://') ? c.detailsURL : undefined,
          reward: benefit?.name ?? first?.name ?? '', image: benefit?.imageAssetURL, minutes: first?.requiredMinutesWatched ?? 0, more: Math.max(0, ds.length - 1) };
      }).find(Boolean) as Drops | undefined;
      setDrops(found ?? null);
    };
    load();
    const t = setInterval(load, 600000);
    return () => { alive = false; clearInterval(t); };
  }, [channelId, s.showDropsNotice]);
  const dismissDrops = (c: Drops) => {
    try { localStorage.setItem(DROPS_DISMISSED, JSON.stringify([...dismissedDrops().filter(x => x !== c.id), c.id].slice(-100))); } catch { /* blocked */ }
    setDrops(null);
  };

  // Hype train: its own loop (5 s during an approach, 15 s otherwise), a re-read at its deadline
  // and the flash timers; the transitions live in logic.ts (applyHype / endHypeFlash).
  useEffect(() => {
    if (!channelId || !s.showEvents) { setHype(undefined); return; }
    let alive = true, cur: LiveHype | undefined, first = true, seq = 0, applied = 0;
    let loop: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined, flash: ReturnType<typeof setTimeout> | undefined;
    const set = (h: LiveHype | undefined) => {
      cur = h; setHype(h);
      clearTimeout(flash);
      if (h?.flash && h.flashUntil) flash = setTimeout(() => { if (alive && cur) set(endHypeFlash(cur, Date.now())); }, Math.max(0, h.flashUntil - Date.now()));
      clearTimeout(deadline);
      if (h?.endsAt) deadline = setTimeout(read, Math.min(86400000, Math.max(0, h.endsAt - Date.now() + 1000)));
    };
    const read = async () => {
      const mine = ++seq;
      const d = await gql(`query($l: String!) { user(login: $l) { channel { hypeTrain {
        approaching { id goal participants expiresAt eventsRemaining { events secondsRemaining } isGoldenKappaTrain isTreasureTrain }
        execution { id expiresAt endedAt isGoldenKappaTrain isTreasureTrain progress { goal progression total remainingSeconds level { value goal } } } } } } }`, { l: login });
      // A read that failed changes nothing; an older answer than the one applied is ignored.
      if (!alive || !d?.user?.channel || mine <= applied) return;
      applied = mine;
      const now = Date.now(), read = readHype(d.user.channel.hypeTrain, now);
      set(first ? read : applyHype(cur, read, now));
      first = false;
    };
    const run = async () => { await read(); if (alive) loop = setTimeout(run, cur?.phase === 'approaching' ? 5000 : 15000); };
    run();
    return () => { alive = false; clearTimeout(loop); clearTimeout(deadline); clearTimeout(flash); };
  }, [login, channelId, s.showEvents]);

  const vote = async (p: Poll, choice: string) => {
    if (!account || busy) return;
    setBusy(true); setErr('');
    const j = await persisted('ChannelPollContext_VoteInPoll', H_VOTE, { input: { pollID: p.id, choiceID: choice, userID: account.userId,
      voteID: crypto.randomUUID().replace(/-/g, ''), tokens: null } });   // tokens null = free vote, no points
    const e = failure(j, 'voteInPoll');
    if (e) setErr(`Abstimmung: ${e}`); else setVoted(v => ({ ...v, [p.id]: [...(v[p.id] ?? []), choice] }));
    setBusy(false);
  };
  // Like Twitch: one outcome per prediction (more points can be added to it), 10 to 250 000 points.
  const bet = async (p: Prediction, outcome: string, points: number) => {
    if (!account || busy) return;
    setBusy(true); setErr('');
    const j = await persisted('MakePrediction', H_PREDICT, { input: { eventID: p.id, outcomeID: outcome, points, transactionID: crypto.randomUUID().replace(/-/g, '') } });
    const e = failure(j, 'makePrediction');
    if (e) setErr(`Vorhersage: ${e}`);
    else {
      // Twitch can take a few seconds to return the bet; the balance is read again by rewards.ts.
      const before = mineOf(p);
      setLocalBet(b => ({ ...b, [p.id]: { outcome, points: (before?.outcome === outcome ? before.points : 0) + points } }));
      if (rewards.balance[login] != null) rewards.balance[login] = Math.max(0, rewards.balance[login] - points);
      setAmount(''); setPick('');
    }
    setBusy(false);
  };
  const mineOf = (p: Prediction) => {
    const l = localBet[p.id];
    return p.mine && l?.outcome === p.mine.outcome ? { outcome: l.outcome, points: Math.max(l.points, p.mine.points) } : p.mine ?? l;
  };

  // Raids: Hermes topic raid.<channelId>; a keepalive watchdog (every 5 s) replaces a connection
  // that went quiet for 2 × keepalive + 5 s, backoff 2 → 60 s, `reconnect` envelope honoured.
  useEffect(() => {
    if (!channelId || !s.enableRaids) { setRaid(null); return; }
    let ws: WebSocket | undefined, stop = false, retry = 2, keepalive = 15, lastSeen = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setInterval> | undefined;
    const reconnect = () => {
      if (stop) return;
      const old = ws; ws = undefined; old?.close();
      clearTimeout(timer);
      timer = setTimeout(() => open(), retry * 1000);
      retry = Math.min(retry * 2, 60);
    };
    const open = (url = 'wss://hermes.twitch.tv/v1?clientId=kimne78kx3ncx6brgo4mv6wki5h1ko') => {
      const sock = new WebSocket(url);
      ws = sock; lastSeen = Date.now();
      sock.onmessage = e => {
        lastSeen = Date.now();
        let j: any; try { j = JSON.parse(e.data); } catch { return; }
        if (j.type === 'welcome') {
          retry = 2;
          if (typeof j.welcome?.keepaliveSec === 'number') keepalive = j.welcome.keepaliveSec;
          sock.send(JSON.stringify({ type: 'subscribe', id: crypto.randomUUID(), subscribe: { id: crypto.randomUUID(), type: 'pubsub', pubsub: { topic: `raid.${channelId}` } }, timestamp: new Date().toISOString() }));
        } else if (j.type === 'reconnect' && j.reconnect?.url) { ws = undefined; sock.close(); open(j.reconnect.url); }
        else if (j.type === 'notification' && j.notification?.pubsub) {
          const m = JSON.parse(j.notification.pubsub), r = m.raid;
          if (m.type?.startsWith('raid_cancel')) { setRaid(null); return; }
          if (!r?.target_login) return;
          const info = { login: r.target_login, name: r.target_display_name ?? r.target_login, viewers: r.viewer_count ?? 0, go: !!m.type?.startsWith('raid_go') };
          setRaid(info);
          if (info.go) onRaid(info);
        }
      };
      sock.onclose = () => { if (ws === sock) reconnect(); };
    };
    open();
    watchdog = setInterval(() => { if (ws && Date.now() - lastSeen > (keepalive * 2 + 5) * 1000) reconnect(); }, 5000);
    return () => { stop = true; clearTimeout(timer); clearInterval(watchdog); ws?.close(); };
  }, [channelId, s.enableRaids]);

  const close = (k: string) => setClosed(c => [...c, k]);
  const show = (k: string) => !closed.includes(k);
  const total = (n: number[]) => Math.max(1, n.reduce((a, b) => a + b, 0));
  const pollKey = poll ? 'poll:' + (poll.id || poll.title) : '', predKey = pred ? 'pred:' + (pred.id || pred.title) : '';
  const hypeKey = hype ? (hype.phase === 'approaching' ? 'hype-approach' : 'hype') + (hype.id ? ':' + hype.id : '') : '';

  const closedNow = closed.filter(k => k === pollKey || k === predKey || k === hypeKey);
  // What the folded landscape row shows: one icon per notice, with its countdown.
  const folded: [string, number | undefined][] = [];
  if (pinned && pinned.id !== pinDismissed) folded.push(['pin', pinned.endsAt]);
  if (drops) folded.push(['gift', undefined]);
  if (s.showEvents && poll && show(pollKey)) folded.push(['chart', poll.active ? poll.endsAt : undefined]);
  if (s.showEvents && pred && show(predKey)) folded.push(['sparkles', pred.closesAt]);
  if (s.showEvents && hype && show(hypeKey)) folded.push(['tram', hype.endsAt]);
  if (raid) folded.push(['run', undefined]);

  return <div class={'events' + (collapsed ? ' collapsed' : '')}>
    {folded.length > 0 && <button class="evt-collapsed" onClick={() => collapse(false)} aria-label="Hinweise einblenden">
      {folded.map(([i, at]) => <span><I n={i} size={12} /><Countdown at={at} /></span>)}</button>}
    {pinned && pinned.id === pinDismissed && <button class="evt-chip" onClick={() => setPinDismissed('')}><I n="pin" size={10} /> Angeheftet</button>}
    {closedNow.length > 0 && <button class="evt-chip" onClick={() => setClosed([])}><I n="x" size={9} /> {closedNow.length} {closedNow.length === 1 ? 'Hinweis' : 'Hinweise'} ausgeblendet</button>}
    {pinned && pinned.id !== pinDismissed && <PinnedBand pin={pinned} open={pinOpen} onToggle={() => setPinOpen(o => !o)} onClose={() => { setPinOpen(false); setPinDismissed(pinned.id); }} />}

    {drops && <div class="evt card drops">
      {drops.image ? <img class="drops-img" src={drops.image} alt="" /> : <span class="drops-img ph"><I n="gift" size={18} /></span>}
      <div class="evt-body">
        <div class="evt-title">{drops.reward && drops.minutes > 0 ? `Schau ${drops.minutes} Min., um ${drops.reward} zu erhalten` : drops.name}</div>
        <div class="evt-sub one">{[drops.name, drops.game].filter(Boolean).join(' · ')}{drops.more > 0 && ` · +${drops.more} Belohnung(en)`}</div>
        <div class="evt-meta">{drops.endsAt && <span>Bis {new Date(drops.endsAt).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          {drops.url && <a href={drops.url} target="_blank" rel="noopener noreferrer">Details</a>}</div>
      </div>
      <button class="evt-x" onClick={() => dismissDrops(drops)} aria-label="Schließen"><I n="x" size={11} /></button>
    </div>}

    {s.showEvents && poll && show(pollKey) && (() => {
      const sum = total(poll.choices.map(c => c.votes));
      const winner = !poll.active ? poll.choices.reduce((a, b) => b.votes > a.votes ? b : a, poll.choices[0]) : undefined;
      const folded = !poll.active && !pollOpen, mine = voted[poll.id] ?? [];
      return <div class="evt accent">
        <I n="chart" />
        <div class="evt-body">
          <div class={'evt-head' + (!poll.active ? ' tap' : '')} onClick={() => { if (!poll.active) setPollOpen(o => !o); }}>
            <span class="evt-title">📊 {poll.title}</span>
            {poll.active ? <Countdown at={poll.endsAt} cls="accent" /> : <><span class="evt-tag">Ergebnisse</span><I n="chevron" size={10} /></>}
          </div>
          {folded ? (winner && winner.votes > 0 && <div class="evt-win"><I n="trophy" size={10} /> {winner.title} · {Math.round(winner.votes / sum * 100)}%</div>) : <>
            {poll.multi && poll.active && <div class="evt-sub">Mehrere Antworten möglich</div>}
            {poll.choices.map(c => {
              const own = mine.includes(c.id), canVote = !!account && poll.active && !!poll.id && !!c.id && !own && (poll.multi || !mine.length);
              return <EventBar label={c.title} value={c.votes} total={sum} color={winner?.id === c.id && winner.votes > 0 ? 'var(--success, #30d158)' : 'var(--accent)'}
                voted={own} winner={winner?.id === c.id && winner.votes > 0} disabled={!canVote || busy} onTap={() => vote(poll, c.id)} />;
            })}
            <div class="evt-sub">{poll.choices.reduce((a, c) => a + c.votes, 0)} Stimmen</div>
          </>}
        </div>
        <button class="evt-x" onClick={() => close(pollKey)} aria-label="Schließen"><I n="x" size={11} /></button>
      </div>; })()}

    {s.showEvents && pred && show(predKey) && (() => {
      const sum = total(pred.outcomes.map(o => o.points)), mine = mineOf(pred);
      const open = !pred.locked && !pred.winner && (!pred.closesAt || pred.closesAt > Date.now());
      const awaiting = pred.locked && !pred.winner, folded = awaiting && !predOpen;
      const myOutcome = mine && mine.points > 0 ? pred.outcomes.find(o => o.id === mine.outcome) : undefined;
      const ratio = (pts: number) => pts > 0 ? pred.outcomes.reduce((a, o) => a + o.points, 0) / pts : undefined;
      const balance = rewards.balance[login];
      const maxBet = Math.max(0, Math.min(balance ?? MAX_BET, MAX_BET - (mine?.points ?? 0)));
      const selected = pred.outcomes.find(o => o.id === pick);
      const n = Number(amount), valid = Number.isInteger(n) && n >= MIN_BET && n <= maxBet;
      const presets = [...[10, 100, 1000, 10000].filter(v => v < maxBet), ...(maxBet >= MIN_BET ? [maxBet] : [])];
      return <div class="evt purple">
        <I n="sparkles" />
        <div class="evt-body">
          <div class={'evt-head' + (awaiting ? ' tap' : '')} onClick={() => { if (awaiting) setPredOpen(o => !o); }}>
            <span class="evt-title">🔮 {pred.title}{awaiting ? ' 🔒' : ''}</span>
            {open && pred.closesAt ? <Countdown at={pred.closesAt} cls="purple" />
              : pred.winner ? <span class="evt-tag green">Ergebnis</span>
              : awaiting ? <><span class="evt-tag">Vorhersagen geschlossen</span><I n="chevron" size={10} /></> : null}
          </div>
          {!folded && pred.outcomes.map(o => {
            const isMine = mine?.outcome === o.id && mine.points > 0, tappable = open && (!mine || mine.points === 0 || isMine);
            const tint = !pred.winner || pred.winner === o.id ? outcomeColor(o.color) : 'var(--muted)';
            const r = ratio(o.points);
            return <EventBar label={o.title} value={o.points} total={sum} color={tint} voted={isMine} winner={pred.winner === o.id} selected={tappable && pick === o.id}
              disabled={!tappable} onTap={() => { setErr(''); setPick(p => p === o.id ? '' : o.id); }}
              stats={[['circle', compact(o.points)], ...(r ? [['trophy', '1:' + ratioText(r)] as [string, string]] : []), ['people', String(o.users)], ...(o.top ? [['crown', compact(o.top)] as [string, string]] : [])]} />;
          })}
          {myOutcome && mine && <div class="evt-mine">Deine Vorhersage: {compact(mine.points)} Pkt. auf „{myOutcome.title}“
            {!pred.winner && ratio(myOutcome.points) && ` · möglicher Gewinn: ${compact(Math.floor(mine.points * ratio(myOutcome.points)!))} Pkt.`}</div>}
          {open && (!account ? <div class="evt-sub">Zum Vorhersagen in den Einstellungen mit Twitch anmelden.</div>
            : selected ? <div class="evt-bet">
              <div class="evt-head"><span class="evt-bet-on" style={{ color: outcomeColor(selected.color) }}>„{selected.title}“ vorhersagen</span>
                {balance != null && <span class="evt-sub">Guthaben {compact(balance)}</span>}</div>
              <div class="evt-presets">{presets.map(v => <button class="evt-chip" onClick={() => setAmount(String(v))}>{v === maxBet ? 'Max.' : v >= 1000 ? `${v / 1000}k` : v}</button>)}</div>
              <div class="evt-row">
                <input type="number" inputMode="numeric" min={MIN_BET} max={maxBet} placeholder={String(MIN_BET)} value={amount}
                  onInput={e => setAmount((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 7))} />
                <button class="evt-go" style={{ background: valid ? outcomeColor(selected.color) : 'var(--muted)' }} disabled={!valid || busy} onClick={() => bet(pred, selected.id, n)}>Vorhersagen</button>
              </div>
              {n > 0 && n < MIN_BET ? <div class="evt-sub">Mindestens 10 Pkt.</div>
                : n > maxBet ? <div class="evt-err">{maxBet < (balance ?? Infinity) ? 'Maximal 250.000 Pkt. pro Vorhersage' : 'Nicht genug Punkte'}</div> : null}
            </div> : <div class="evt-sub">Tippe auf einen Ausgang, um vorherzusagen</div>)}
        </div>
        <button class="evt-x" onClick={() => close(predKey)} aria-label="Schließen"><I n="x" size={11} /></button>
      </div>; })()}

    {s.showEvents && hype && show(hypeKey) && <div class="evt red"><I n="tram" /><HypeCard h={hype} /><button class="evt-x" onClick={() => close(hypeKey)} aria-label="Schließen"><I n="x" size={11} /></button></div>}

    {err && <div class="evt err"><div class="evt-body">{err}</div><button class="evt-x" onClick={() => setErr('')} aria-label="Schließen"><I n="x" size={11} /></button></div>}

    {raid && <div class="evt raid" role="button" onClick={() => onRaid({ ...raid, go: true })}>
      <I n="run" size={13} />
      <div class="evt-body"><div class="evt-title">🚀 Raid zu {raid.name}</div>{raid.viewers > 0 && <div class="evt-sub">{raid.viewers} Zuschauer</div>}</div>
      <span class="evt-go">Beitreten</span>
    </div>}
    {folded.length > 0 && <button class="evt-hide-strip" onClick={() => collapse(true)}>Ausblenden <I n="chevron" size={10} /></button>}
  </div>;
}

/** Poll choice / prediction outcome: label, %, 5 px capsule bar, optional stats row; tap = act. */
function EventBar({ label, value, total, color, voted, winner, selected, disabled, onTap, stats }: { label: string; value: number; total: number; color: string;
  voted?: boolean; winner?: boolean; selected?: boolean; disabled?: boolean; onTap: () => void; stats?: [string, string][] }) {
  const pct = value / Math.max(1, total);
  return <button class={'evt-bar' + (selected ? ' sel' : '')} style={{ '--c': color } as any} disabled={disabled} onClick={onTap}>
    <div class="evt-bar-head">{winner && <span class="evt-trophy"><I n="trophy" size={10} /></span>}{voted && <span class="evt-check"><I n="check" size={10} /></span>}
      <span class={'evt-bar-label' + (voted ? ' voted' : '')}>{label}</span><span class="evt-pct">{Math.round(pct * 100)}%</span></div>
    <div class="evt-track"><div style={{ width: `max(3px, ${pct * 100}%)` }} /></div>
    {stats && <div class="evt-stats">{stats.map(([i, t]) => <span><I n={i} size={9} /> {t}</span>)}</div>}
  </button>;
}

/** HypeTrainCard: approach pills, kickoff/departed, level + bar, level done, ended. */
function HypeCard({ h }: { h: LiveHype }) {
  const title = h.variant === 'golden' ? 'Golden Kappa Train' : h.variant === 'treasure' ? 'Schatz-Train' : 'Hype Train';
  const f = h.flash;
  if (f?.k === 'ended') return <div class="evt-body"><div class="evt-title">Hype Train beendet! Level {f.level}, {f.percent} %</div></div>;
  if (f?.k === 'departed') return <div class="evt-body"><div class="evt-head"><span class="evt-title">Der Hype Train ist abgefahren!</span><Countdown at={h.endsAt} cls="red" /></div>
    <div class="evt-sub one">Begrenzte Zeit für exklusive Emotes</div></div>;
  if (h.phase === 'approaching' || f?.k === 'kickoff') {
    const count = h.bigGoal ? 3 : 2, filled = f?.k === 'kickoff' ? count : Math.max(0, Math.min(count, count - h.left));
    return <div class="evt-body">
      <div class="evt-head"><span class="evt-title">{title}</span><span class="evt-tag red">Im Anrollen</span>{!f && <Countdown at={h.endsAt} cls="red" />}</div>
      <div class="evt-row"><span class="evt-pills">{Array.from({ length: count }, (_, i) => <i class={i < filled ? 'on' : ''}>{i < filled && '✓'}</i>)}</span>
        {!f && <span class="evt-kick">Noch {Math.max(1, h.left)} zum Start</span>}</div>
    </div>;
  }
  return <div class="evt-body">
    <div class="evt-head"><span class="evt-title">{title} · Level {h.level}</span><Countdown at={h.endsAt} cls="red" /></div>
    {f?.k === 'levelDone' ? <div class="evt-done">Level {f.n} geschafft!</div>
      : <div class="evt-row"><div class="evt-track red"><div style={{ width: `${h.percent * 100}%` }} /></div><span class="evt-pct">{Math.round(h.percent * 100)}%</span></div>}
  </div>;
}

/** PinnedBanner: one line "Name: text" (tap to unfold, ≤ 160 px scrollable), meta line, 2 px
 *  bar with the time left; × → "Angeheftet" chip. */
function PinnedBand({ pin, open, onToggle, onClose }: { pin: Pinned; open: boolean; onToggle: () => void; onClose: () => void }) {
  const now = Date.now();
  const meta = [pin.by ? `Angeheftet von ${pin.by}` : 'Angeheftete Nachricht'];
  if (pin.startsAt) { const m = Math.floor((now - pin.startsAt) / 60000); meta.push(m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : `vor ${Math.floor(m / 60)} Std.`); }
  if (pin.endsAt) meta.push(`noch ${Math.max(1, Math.ceil((pin.endsAt - now) / 60000))} Min.`);
  const frac = pin.startsAt && pin.endsAt && pin.endsAt > pin.startsAt ? Math.max(0, Math.min(1, (pin.endsAt - now) / (pin.endsAt - pin.startsAt))) : undefined;
  const body = pin.parts.map(p => p.t === 'emote' ? <img class="emote" src={p.url} alt={p.v} title={p.v} /> : p.t === 'link' ? <a href={p.v.startsWith('http') ? p.v : 'https://' + p.v} target="_blank" rel="noopener noreferrer">{p.v}</a> : p.v);
  return <div class="evt card pin">
    <span class="pin-i"><I n="pin" size={11} /></span>
    <div class="evt-body">
      <div class={'pin-text' + (open ? ' open' : '')} onClick={() => { if (!open) onToggle(); }}>
        {!open && pin.badges.map(b => <img class="badge-img" src={b.url} alt={b.title} />)}<b style={{ color: pin.color }}>{pin.name}</b>: {body}
      </div>
      <div class="evt-meta">{meta.join(' · ')}</div>
    </div>
    <button class="evt-x" onClick={onToggle} aria-label={open ? 'Einklappen' : 'Aufklappen'}><span class={'evt-chev' + (open ? ' up' : '')}><I n="chevron" size={11} /></span></button>
    <button class="evt-x" onClick={onClose} aria-label="Schließen"><I n="x" size={10} /></button>
    {frac != null && <div class="pin-bar"><div style={{ transform: `scaleX(${frac})` }} /></div>}
  </div>;
}
