// Live events above the chat (LiveEventsService.swift, ChatPubSub.swift, RaidService.swift):
// pinned message, poll, prediction and hype train from public GQL every 20 s, raids from
// Twitch's Hermes WebSocket (anonymous, reachable from other sites: measured 2026-10-26).
// Logged in (TV client token): poll vote, prediction bet and watch streak. Measured 2026-10-26 with
// nonexistent ids: VoteInPoll → POLL_NOT_FOUND, MakePrediction → MUST_ACCEPT_TOS (account never
// agreed to Twitch's prediction terms), i.e. both pass auth without an integrity token.
import { useEffect, useState } from 'preact/hooks';
import { gql, gqlPersisted } from './twitch';
import { formatViewers } from './logic';
import { state } from './store';
import { rewards, gql as accountGql, errors } from './rewards';

const H_VOTE = '1280e27b0f3c7ae60b5714bd569771ea50635778473182e6e959e2dcfcc16e3c';
const H_PREDICT = 'b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8';
const H_STREAK = '7d04fbaa5bb32d193c742caa2c855dfde371a2a8cb25afed5b5c3d45f5ee9278';
const MIN_BET = 10, MAX_BET = 250000;
const persisted = (operationName: string, sha256Hash: string, variables: unknown = {}) =>
  accountGql([{ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash } } }]);
/** Twitch's error text: GQL errors, else the payload's error code (with a hint for the one we know). */
const failure = (j: any, payload: string) => {
  if (!j) return 'Keine Antwort von Twitch';
  const e = errors(j) ?? (Array.isArray(j) ? j[0] : j)?.data?.[payload]?.error?.code;
  return e === 'MUST_ACCEPT_TOS' ? 'MUST_ACCEPT_TOS – den Vorhersage-Bedingungen einmal auf twitch.tv zustimmen' : e;
};

type Pinned = { text: string; by: string };
type Poll = { id: string; title: string; choices: { id: string; title: string; votes: number }[]; endsAt?: number; active: boolean; multi: boolean };
type Prediction = { id: string; title: string; locked: boolean; closesAt?: number; outcomes: { id: string; title: string; color: string; points: number; users: number }[];
  mine?: { outcome: string; points: number } };
type Hype = { level: number; progress: number; goal: number; endsAt?: number };
export type Raid = { login: string; name: string; viewers: number; go: boolean };

const secsLeft = (t?: number) => t ? Math.max(0, Math.round((t - Date.now()) / 1000)) : undefined;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function LiveEvents({ login, channelId, onRaid }: { login: string; channelId?: string; onRaid: (r: Raid) => void }) {
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [hype, setHype] = useState<Hype | null>(null);
  const [raid, setRaid] = useState<Raid | null>(null);
  const [closed, setClosed] = useState<string[]>([]);
  const [streak, setStreak] = useState(0);
  const [voted, setVoted] = useState<Record<string, string[]>>({});   // poll id → own choices (Twitch doesn't return them)
  const [localBet, setLocalBet] = useState<Record<string, { outcome: string; points: number }>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState('');
  const [amount, setAmount] = useState('');
  const [, tick] = useState(0);
  const account = state.account;

  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    const load = async () => {
      const myPred = 'id self { prediction { points outcome { id } } }';
      const [pin, pl, pr, hy, mine, st] = await Promise.all([
        gql(`query($id: ID!) { channel(id: $id) { pinnedChatMessages(first: 1) { edges { node { endsAt pinnedMessage { content { text } sender { displayName } } } } } } }`, { id: channelId }),
        gqlPersisted('ChannelPollContext_GetViewablePoll', { login }, 'e83188a3836c636393df3191665e543a03733d7c51d3ade3d85e42aa46c2bf55'),
        gqlPersisted('ChannelPointsPredictionContext', { count: 1, channelLogin: login }, 'beb846598256b75bd7c1fe54a80431335996153e358ca9c7837ce7bb83d7d383'),
        gql(`query($l: String!) { user(login: $l) { channel { hypeTrain { execution { expiresAt progress { goal progression level { value } } } } } } }`, { l: login }),
        account && accountGql({ query: `query($l: String!) { channel(name: $l) { activePredictionEvents { ${myPred} } lockedPredictionEvents { ${myPred} } } }`, variables: { l: login } }),
        account && persisted('BatchGetWatchStreaks', H_STREAK),
      ]);
      if (!alive) return;
      const node = pin?.channel?.pinnedChatMessages?.edges?.[0]?.node;
      setPinned(node && (!node.endsAt || Date.parse(node.endsAt) > Date.now())
        ? { text: node.pinnedMessage?.content?.text ?? '', by: node.pinnedMessage?.sender?.displayName ?? '' } : null);
      const p = pl?.data?.channel?.viewablePoll;
      setPoll(p ? { id: p.id ?? '', title: p.title, active: (p.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE',
        endsAt: p.startedAt && p.durationSeconds ? Date.parse(p.startedAt) + p.durationSeconds * 1000 : p.endedAt ? Date.parse(p.endedAt) : undefined,
        multi: !!(p.settings?.multichoice?.isEnabled ?? p.settings?.multichoice),
        choices: (p.choices ?? []).map((c: any) => ({ id: c.id ?? '', title: c.title, votes: c.totalVoters ?? c.votes?.total ?? 0 })) } : null);
      const ch = pr?.data?.community?.channel;
      const ev = ch?.activePredictionEvents?.[0] ?? ch?.lockedPredictionEvents?.[0];
      const me = [...(mine?.data?.channel?.activePredictionEvents ?? []), ...(mine?.data?.channel?.lockedPredictionEvents ?? [])]
        .find((e: any) => e.id === ev?.id)?.self?.prediction;
      setPred(ev ? { id: ev.id ?? '', mine: me?.outcome?.id ? { outcome: me.outcome.id, points: me.points ?? 0 } : undefined, title: ev.title, locked: ev.status === 'LOCKED',
        closesAt: ev.status !== 'LOCKED' && ev.createdAt ? Date.parse(ev.createdAt) + ev.predictionWindowSeconds * 1000 : undefined,
        outcomes: (ev.outcomes ?? []).map((o: any) => ({ id: o.id ?? '', title: o.title, color: o.color, points: o.totalPoints ?? 0, users: o.totalUsers ?? 0 })) } : null);
      const ex = hy?.user?.channel?.hypeTrain?.execution;
      const s = (Array.isArray(st) ? st[0] : st)?.data?.batchGetWatchStreaks?.find((x: any) => x.channel?.id === channelId);
      setStreak(s?.value ?? 0);
      setHype(ex ? { level: ex.progress?.level?.value ?? 1, progress: ex.progress?.progression ?? 0, goal: ex.progress?.goal ?? 1, endsAt: ex.expiresAt ? Date.parse(ex.expiresAt) : undefined } : null);
    };
    load();
    const t = setInterval(load, 20000), t2 = setInterval(() => tick(x => x + 1), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(t2); };
  }, [login, channelId, account?.token]);

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
    const j = await persisted('MakePrediction', H_PREDICT, { input: { eventID: p.id, outcomeID: outcome, points,
      transactionID: crypto.randomUUID().replace(/-/g, '') } });
    const e = failure(j, 'makePrediction');
    if (e) setErr(`Vorhersage: ${e}`);
    else {
      // Twitch can take a few seconds to return the bet; the balance is read again by rewards.ts.
      const before = mineOf(p);
      setLocalBet(b => ({ ...b, [p.id]: { outcome, points: (before?.outcome === outcome ? before.points : 0) + points } }));
      if (rewards.balance[login] != null) rewards.balance[login] = Math.max(0, rewards.balance[login] - points);
      setAmount('');
    }
    setBusy(false);
  };
  const mineOf = (p: Prediction) => {
    const l = localBet[p.id];
    return p.mine && l?.outcome === p.mine.outcome ? { outcome: l.outcome, points: Math.max(l.points, p.mine.points) } : p.mine ?? l;
  };

  // Raids: Hermes topic raid.<channelId>, reconnect when the socket drops.
  useEffect(() => {
    if (!channelId) return;
    let ws: WebSocket | undefined, stop = false, retry = 2000;
    const open = (url = 'wss://hermes.twitch.tv/v1?clientId=kimne78kx3ncx6brgo4mv6wki5h1ko') => {
      ws = new WebSocket(url);
      ws.onmessage = e => {
        const j = JSON.parse(e.data);
        if (j.type === 'welcome') { retry = 2000; ws!.send(JSON.stringify({ type: 'subscribe', id: crypto.randomUUID(),
          subscribe: { id: crypto.randomUUID(), type: 'pubsub', pubsub: { topic: `raid.${channelId}` } }, timestamp: new Date().toISOString() })); }
        else if (j.type === 'reconnect' && j.reconnect?.url) { ws!.onclose = null; ws!.close(); open(j.reconnect.url); }
        else if (j.type === 'notification' && j.notification?.pubsub) {
          const m = JSON.parse(j.notification.pubsub);
          const r = m.raid;
          if (!r) return;
          if (m.type === 'raid_cancel_v2') { setRaid(null); return; }
          const info = { login: r.target_login, name: r.target_display_name ?? r.target_login, viewers: r.viewer_count ?? 0, go: m.type === 'raid_go_v2' };
          setRaid(info);
          if (info.go) onRaid(info);
        }
      };
      ws.onclose = () => { if (!stop) setTimeout(() => open(), retry = Math.min(retry * 2, 60000)); };
    };
    open();
    return () => { stop = true; ws?.close(); };
  }, [channelId]);

  const close = (k: string) => setClosed(c => [...c, k]);
  const show = (k: string) => !closed.includes(k);
  const total = (n: number[]) => Math.max(1, n.reduce((a, b) => a + b, 0));
  return <div class="events">
    {raid && <div class="event raid">Raid zu <b>{raid.name}</b> mit {formatViewers(raid.viewers)} Zuschauern{raid.go ? ' · gestartet' : ' · bereitet sich vor'}
      <button class="link" onClick={() => onRaid({ ...raid, go: true })}>Mitgehen</button></div>}
    {hype && show('hype') && <div class="event"><b>Hype Train · Level {hype.level}</b>
      {hype.endsAt && <span class="row-sub"> · noch {mmss(secsLeft(hype.endsAt)!)}</span>}
      <div class="bar"><div style={{ width: `${Math.min(100, hype.progress / hype.goal * 100)}%` }} /></div>
      <button class="x" onClick={() => close('hype')} aria-label="Schließen">×</button></div>}
    {poll && show('poll:' + poll.title) && <div class="event"><b>📊 {poll.title}</b>
      {poll.endsAt && poll.active && <span class="row-sub"> · noch {mmss(secsLeft(poll.endsAt)!)}</span>}
      {poll.choices.map(c => {
        const mine = voted[poll.id] ?? [], canVote = account && poll.active && poll.id && !mine.includes(c.id) && (poll.multi || !mine.length);
        return <div class="choice"><span>{c.title}{mine.includes(c.id) && <b class="mine"> ✓ deine Stimme</b>}</span>
          <span class="row-sub">{Math.round(c.votes / total(poll.choices.map(x => x.votes)) * 100)} %
            {canVote && <button class="link vote" disabled={busy} onClick={() => vote(poll, c.id)}>Abstimmen</button>}</span>
          <div class="bar"><div style={{ width: `${c.votes / total(poll.choices.map(x => x.votes)) * 100}%` }} /></div></div>; })}
      <button class="x" onClick={() => close('poll:' + poll.title)} aria-label="Schließen">×</button></div>}
    {pred && show('pred:' + pred.title) && <div class="event"><b>🔮 {pred.title}</b>
      <span class="row-sub"> · {pred.locked ? 'geschlossen' : pred.closesAt ? `noch ${mmss(secsLeft(pred.closesAt)!)}` : 'offen'}</span>
      {pred.outcomes.map(o => <div class="choice"><span style={{ color: o.color === 'PINK' ? '#f5009b' : '#3d7dff' }}>{o.title}</span>
        <span class="row-sub">{Math.round(o.points / total(pred.outcomes.map(x => x.points)) * 100)} % · {formatViewers(o.points)} Punkte · {formatViewers(o.users)}</span>
        <div class="bar"><div style={{ width: `${o.points / total(pred.outcomes.map(x => x.points)) * 100}%`, background: o.color === 'PINK' ? '#f5009b' : '#3d7dff' }} /></div>
        {mineOf(pred)?.outcome === o.id && <b class="mine">Dein Einsatz: {formatViewers(mineOf(pred)!.points)} Punkte</b>}</div>)}
      {account && !pred.locked && pred.id && (() => {
        const own = mineOf(pred)?.outcome, outcome = own ?? (pick || pred.outcomes[0]?.id), n = Number(amount);
        const max = Math.min(MAX_BET, rewards.balance[login] ?? MAX_BET), ok = Number.isInteger(n) && n >= MIN_BET && n <= max;
        return <div class="bet">
          <select value={outcome} disabled={!!own} onChange={e => setPick((e.target as HTMLSelectElement).value)}>
            {pred.outcomes.map(o => <option value={o.id}>{o.title}</option>)}</select>
          <input type="number" inputMode="numeric" min={MIN_BET} max={max} placeholder={rewards.balance[login] != null ? `max ${formatViewers(max)}` : 'Punkte'}
            value={amount} onInput={e => setAmount((e.target as HTMLInputElement).value)} />
          <button class="link" disabled={!ok || busy} onClick={() => bet(pred, outcome, n)}>Setzen</button>
        </div>; })()}
      <button class="x" onClick={() => close('pred:' + pred.title)} aria-label="Schließen">×</button></div>}
    {err && <div class="event err">{err}<button class="x" onClick={() => setErr('')} aria-label="Schließen">×</button></div>}
    {account && streak > 0 && <div class="streak">🔥 Zuschau-Serie: {streak} {streak === 1 ? 'Stream' : 'Streams'}</div>}
    {pinned && show('pin:' + pinned.text) && <div class="event pin">📌 <b>{pinned.by}</b>: {pinned.text}
      <button class="x" onClick={() => close('pin:' + pinned.text)} aria-label="Schließen">×</button></div>}
  </div>;
}
