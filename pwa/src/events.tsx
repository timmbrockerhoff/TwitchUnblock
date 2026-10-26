// Live events above the chat (LiveEventsService.swift, ChatPubSub.swift, RaidService.swift):
// pinned message, poll, prediction and hype train from public GQL every 20 s, raids from
// Twitch's Hermes WebSocket (anonymous, reachable from other sites: measured 2026-10-26).
// Read-only: voting and betting are not ported.
import { useEffect, useState } from 'preact/hooks';
import { gql, gqlPersisted } from './twitch';
import { formatViewers } from './logic';

type Pinned = { text: string; by: string };
type Poll = { title: string; choices: { title: string; votes: number }[]; endsAt?: number; active: boolean };
type Prediction = { title: string; locked: boolean; closesAt?: number; outcomes: { title: string; color: string; points: number; users: number }[] };
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
  const [, tick] = useState(0);

  useEffect(() => {
    if (!channelId) return;
    let alive = true;
    const load = async () => {
      const [pin, pl, pr, hy] = await Promise.all([
        gql(`query($id: ID!) { channel(id: $id) { pinnedChatMessages(first: 1) { edges { node { endsAt pinnedMessage { content { text } sender { displayName } } } } } } }`, { id: channelId }),
        gqlPersisted('ChannelPollContext_GetViewablePoll', { login }, 'e83188a3836c636393df3191665e543a03733d7c51d3ade3d85e42aa46c2bf55'),
        gqlPersisted('ChannelPointsPredictionContext', { count: 1, channelLogin: login }, 'beb846598256b75bd7c1fe54a80431335996153e358ca9c7837ce7bb83d7d383'),
        gql(`query($l: String!) { user(login: $l) { channel { hypeTrain { execution { expiresAt progress { goal progression level { value } } } } } } }`, { l: login }),
      ]);
      if (!alive) return;
      const node = pin?.channel?.pinnedChatMessages?.edges?.[0]?.node;
      setPinned(node && (!node.endsAt || Date.parse(node.endsAt) > Date.now())
        ? { text: node.pinnedMessage?.content?.text ?? '', by: node.pinnedMessage?.sender?.displayName ?? '' } : null);
      const p = pl?.data?.channel?.viewablePoll;
      setPoll(p ? { title: p.title, active: (p.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE',
        endsAt: p.startedAt && p.durationSeconds ? Date.parse(p.startedAt) + p.durationSeconds * 1000 : p.endedAt ? Date.parse(p.endedAt) : undefined,
        choices: (p.choices ?? []).map((c: any) => ({ title: c.title, votes: c.totalVoters ?? c.votes?.total ?? 0 })) } : null);
      const ch = pr?.data?.community?.channel;
      const ev = ch?.activePredictionEvents?.[0] ?? ch?.lockedPredictionEvents?.[0];
      setPred(ev ? { title: ev.title, locked: ev.status === 'LOCKED',
        closesAt: ev.status !== 'LOCKED' && ev.createdAt ? Date.parse(ev.createdAt) + ev.predictionWindowSeconds * 1000 : undefined,
        outcomes: (ev.outcomes ?? []).map((o: any) => ({ title: o.title, color: o.color, points: o.totalPoints ?? 0, users: o.totalUsers ?? 0 })) } : null);
      const ex = hy?.user?.channel?.hypeTrain?.execution;
      setHype(ex ? { level: ex.progress?.level?.value ?? 1, progress: ex.progress?.progression ?? 0, goal: ex.progress?.goal ?? 1, endsAt: ex.expiresAt ? Date.parse(ex.expiresAt) : undefined } : null);
    };
    load();
    const t = setInterval(load, 20000), t2 = setInterval(() => tick(x => x + 1), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(t2); };
  }, [login, channelId]);

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
      {poll.choices.map(c => <div class="choice"><span>{c.title}</span><span class="row-sub">{Math.round(c.votes / total(poll.choices.map(x => x.votes)) * 100)} %</span>
        <div class="bar"><div style={{ width: `${c.votes / total(poll.choices.map(x => x.votes)) * 100}%` }} /></div></div>)}
      <button class="x" onClick={() => close('poll:' + poll.title)} aria-label="Schließen">×</button></div>}
    {pred && show('pred:' + pred.title) && <div class="event"><b>🔮 {pred.title}</b>
      <span class="row-sub"> · {pred.locked ? 'geschlossen' : pred.closesAt ? `noch ${mmss(secsLeft(pred.closesAt)!)}` : 'offen'}</span>
      {pred.outcomes.map(o => <div class="choice"><span style={{ color: o.color === 'PINK' ? '#f5009b' : '#3d7dff' }}>{o.title}</span>
        <span class="row-sub">{Math.round(o.points / total(pred.outcomes.map(x => x.points)) * 100)} % · {formatViewers(o.points)} Punkte · {formatViewers(o.users)}</span>
        <div class="bar"><div style={{ width: `${o.points / total(pred.outcomes.map(x => x.points)) * 100}%`, background: o.color === 'PINK' ? '#f5009b' : '#3d7dff' }} /></div></div>)}
      <button class="x" onClick={() => close('pred:' + pred.title)} aria-label="Schließen">×</button></div>}
    {pinned && show('pin:' + pinned.text) && <div class="event pin">📌 <b>{pinned.by}</b>: {pinned.text}
      <button class="x" onClick={() => close('pin:' + pinned.text)} aria-label="Schließen">×</button></div>}
  </div>;
}
