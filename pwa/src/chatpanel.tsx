// Chat panel (ChatView.swift), message/user sheets, chatters, bot commands, emote picker.
import './chatpanel.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as tw from './twitch';
import { formatClock, formatViewers, chatSync } from './logic';
import { ChatClient, VodChat, botCommands, type BotCommandSet, loadGlobalEmotes, loadChannelEmotes, translate, wantsTranslation, isBotLine, emoteList, type ChatMsg, type RoomState } from './chat';
import { useStore, state } from './store';
import { openChannel, play } from './nav';
import { Icon, Sheet, Spinner } from './ui';
import { LiveEvents } from './events';

type V = HTMLVideoElement & { getStartDate?: () => Date };
// Chat panel ------------------------------------------------------------------------------------
export function ChatPanel({ login, channelId, vod, video, archive }: { login?: string; channelId?: string; vod?: { id: string; channelId?: string; offset: number };
  video?: { current: V | null }; archive?: { id: string; startedAt?: string } }) {
  const s = useStore();
  const list = useRef<HTMLDivElement>(null);
  const msgs = useRef<ChatMsg[]>([]);
  const [, render] = useState(0);
  const [follow, setFollow] = useState(true);
  const [room, setRoom] = useState<RoomState>({});
  const [conn, setConn] = useState(false);
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(false);
  const [sheet, setSheet] = useState<'chatters' | 'commands'>();
  const [card, setCard] = useState<{ login: string } | { emote: string; url: string }>();
  const client = useRef<ChatClient>();
  // Live chat held back to match the picture; over 5 min behind in the recording → its chat replay.
  const [sync, setSync] = useState({ delay: 0, replay: false });
  const replayRef = useRef(false);
  replayRef.current = sync.replay;
  const cid = channelId ?? vod?.channelId;
  const add = (batch: ChatMsg[]) => {
    msgs.current = [...msgs.current, ...batch].slice(-250);
    render(x => x + 1);
    if (state.settings.chatTranslate) for (const m of batch) if (wantsTranslation(m))
      translate(m.parts.filter(p => p.t === 'text').map(p => p.v).join(' ').replace(/\s+/g, ' ').trim()).then(tr => { if (tr) { m.translation = tr; render(x => x + 1); } });
  };
  useEffect(() => { loadGlobalEmotes().then(() => render(x => x + 1)); }, []);
  useEffect(() => { if (cid && (login || vod)) loadChannelEmotes(cid, login ?? '').then(() => render(x => x + 1)); }, [cid]);
  useEffect(() => {
    if (!login) return;
    const c = new ChatClient(login, channelId, b => { if (!replayRef.current) add(b); }, e => {
      if (e.type === 'clear') { msgs.current.forEach(m => { if ((e.id && m.id === e.id) || (e.login && m.login === e.login) || (!e.id && !e.login)) m.deleted = true; }); render(x => x + 1); }
      else if (e.type === 'notice') setNotice(e.text);
      else { setRoom({ ...c.room }); setConn(c.connected); }
    });
    client.current = c;
    return () => c.close();
  }, [login, channelId, s.account?.token]);
  useEffect(() => {
    if (!login || !video) return;
    const t = setInterval(() => {
      const v = video.current, c = client.current; if (!v || !c) return;
      // Safari's getStartDate = PROGRAM-DATE-TIME of media time 0 (NaN without one).
      const pdt0 = (v as V & { getStartDate?: () => Date }).getStartDate?.().getTime();
      const r = archive && !archive.startedAt ? { delay: 0, replay: false } : chatSync({ now: Date.now(), t: v.currentTime, pdt0,
        edge: v.seekable.length ? v.seekable.end(v.seekable.length - 1) : undefined, archiveStart: archive && Date.parse(archive.startedAt!) });
      c.delay = r.delay;
      setSync(o => Math.round(o.delay) === Math.round(r.delay) && o.replay === r.replay ? o : r);
    }, 1000);
    return () => { clearInterval(t); if (client.current) client.current.delay = 0; };
  }, [login, archive?.id, archive?.startedAt]);
  const replay = vod ?? (sync.replay && archive ? { id: archive.id, channelId, offset: 0 } : undefined);
  useEffect(() => {
    if (!replay || !video) return;
    // Live ↔ recording replay: start from an empty list both ways.
    if (!vod) { msgs.current = []; render(x => x + 1); }
    const chat = new VodChat(replay.id, replay.channelId);
    const t = setInterval(async () => {
      const v = video.current; if (!v) return;
      const { msgs: due, reset } = await chat.tick(v.currentTime);
      if (reset) msgs.current = [];
      if (due.length || reset) add(due);
    }, 1000);
    return () => { clearInterval(t); if (!vod) { msgs.current = []; render(x => x + 1); } };
  }, [replay?.id]);
  useEffect(() => { if (follow && list.current) list.current.scrollTop = list.current.scrollHeight; });
  // Rotation or a layout switch resizes the list; its scroll event then read as "scrolled up"
  // and the chat stopped following. Pin to the bottom first when following.
  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    const el = list.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (followRef.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = msgs.current.filter(m => (s.settings.chatShowDeleted || !m.deleted) && !(s.settings.chatHideBots && isBotLine(m)));
  const modes = [room.slow ? `Slow-Modus ${room.slow} s` : '', room.followers != null && room.followers >= 0 ? 'Nur Follower' : '', room.subs ? 'Nur Abonnenten' : '',
    room.emoteOnly ? 'Nur Emotes' : '', login && !conn ? 'Verbinde …' : '',
    sync.replay ? 'Chat der Aufzeichnung' : sync.delay >= 1 ? `Chat ${Math.round(sync.delay)} s verzögert` : ''].filter(Boolean).join(' · ');
  const send = (e: Event) => { e.preventDefault(); if (text.trim() && client.current?.send(text.trim())) setText(''); };
  return <div class="chat" style={{ fontSize: s.settings.chatFont + 'px' }}>
    {login && <LiveEvents login={login} channelId={cid} onRaid={r => play({ kind: 'live', login: r.login })} />}
    <div class="chat-list" ref={list} onScroll={e => { const el = e.target as HTMLDivElement; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }}>
      {shown.map(m => <div class={'msg' + (m.mention ? ' mention' : '') + (m.deleted ? ' deleted' : '') + (m.system ? ' system' : '') + (m.history ? ' old' : '')}>
        {m.system && <div class="sys">{m.system}</div>}
        {s.settings.chatTimestamps && <span class="ts">{m.offset != null ? formatClock(m.offset) : new Date(m.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} </span>}
        {m.badges.map(b => <img class="badge-img" src={b.url} alt={b.title} title={b.title} />)}
        {(m.parts.length > 0 || !m.system) && <b style={{ color: m.color }} onClick={() => setCard({ login: m.login })}>{m.name}</b>}{m.parts.length > 0 && (m.action ? ' ' : ': ')}
        <span style={m.action ? { color: m.color, fontStyle: 'italic' } : undefined}>{m.parts.map(p => p.t === 'emote' ? <img class="emote" src={p.url} alt={p.v} title={p.v} onClick={() => setCard({ emote: p.v, url: p.url })} />
          : p.t === 'link' ? <a href={p.v.startsWith('http') ? p.v : 'https://' + p.v} target="_blank" rel="noopener noreferrer">{p.v}</a>
          : p.t === 'mention' ? <b>{p.v}</b> : p.v)}</span>
        {m.translation && <div class="tr">🌐 {m.translation}</div>}
      </div>)}
    </div>
    {!follow && <button class="pill-btn jump" onClick={() => { setFollow(true); if (list.current) list.current.scrollTop = list.current.scrollHeight; }}>Zu neuen Nachrichten</button>}
    {(modes || notice || login) && <div class="info-line">{[modes, notice].filter(Boolean).join(' · ')}
      {login && <span class="info-actions"><button class="link" onClick={() => setSheet('chatters')}>Chatter</button>
        <button class="link" onClick={() => setSheet('commands')}>Befehle</button></span>}</div>}
    {sheet === 'chatters' && client.current && <ChattersSheet logins={[...client.current.present]} onPick={l => { setSheet(undefined); setCard({ login: l }); }} onClose={() => setSheet(undefined)} />}
    {sheet === 'commands' && login && <CommandsSheet login={login} onUse={c => { setSheet(undefined); setText(c + ' '); }} onClose={() => setSheet(undefined)} />}
    {login && !sync.replay && (client.current?.canSend || s.account ? <form class="chat-input" onSubmit={send}>
      <button type="button" class="nav-btn" onClick={() => setPicker(!picker)} aria-label="Emotes"><Icon n="smile" /></button>
      <input value={text} onInput={e => setText((e.target as HTMLInputElement).value)} placeholder="Chatten …" maxLength={500} enterkeyhint="send" />
      {text && <button class="nav-btn accent" aria-label="Senden"><Icon n="send" /></button>}
    </form> : <div class="info-line">Zum Chatten in den Einstellungen mit Twitch anmelden.</div>)}
    {card && ('login' in card
      ? <UserCard login={card.login} msgs={msgs.current.filter(m => m.login === card.login)} onClose={() => setCard(undefined)} />
      : <Sheet title={card.emote} onClose={() => setCard(undefined)}><div class="emote-info">
          <img src={card.url.replace(/\/2x(\.webp)?$/, '/4x$1').replace('/2.0', '/3.0')} alt={card.emote} />
          <p class="row-sub">{emoteSource(card.url)}</p></div></Sheet>)}
    {picker && <div class="emote-picker">{emoteList(cid).slice(0, 400).map(e => <button onClick={() => setText(t => (t ? t + ' ' : '') + e.name + ' ')}><img src={e.url} alt={e.name} title={e.name} loading="lazy" /></button>)}</div>}
  </div>;
}

const emoteSource = (url: string) => url.includes('7tv') ? '7TV' : url.includes('betterttv') ? 'BetterTTV' : url.includes('frankerfacez') ? 'FrankerFaceZ' : 'Twitch';

/** User card (MessageSheet.swift): profile from public GQL plus this person's lines in the chat. */
function UserCard({ login, msgs, onClose }: { login: string; msgs: ChatMsg[]; onClose: () => void }) {
  const [u, setU] = useState<any>();
  useEffect(() => { tw.gql('query($l: String!) { user(login: $l) { displayName profileImageURL(width: 150) createdAt followers { totalCount } description stream { id } } }', { l: login }).then(d => setU(d?.user ?? null)); }, [login]);
  return <Sheet title={u?.displayName ?? login} onClose={onClose}>
    <div class="user-card">
      {u === undefined ? <Spinner /> : u === null ? <p class="hint pad">Konto nicht gefunden.</p> : <div class="ch-head">
        <img class={'avatar xl' + (u.stream ? ' live-ring' : '')} src={u.profileImageURL} alt="" />
        <div><div class="card-title">{u.displayName}</div>
          <div class="row-sub">@{login}{u.followers ? ` · ${formatViewers(u.followers.totalCount)} Follower` : ''}</div>
          <div class="row-sub">Konto seit {new Date(u.createdAt).toLocaleDateString('de-DE')}</div></div></div>}
      {u?.description && <p class="hint pad">{u.description}</p>}
      <div class="pad"><button class="btn bordered small" onClick={() => { onClose(); openChannel(login); }}>Kanalseite öffnen</button></div>
      <h3 class="section-title">Nachrichten in diesem Chat</h3>
      <div class="chat-list pad">{msgs.length ? msgs.slice(-30).map(m => <div class="msg">{m.parts.map(p => p.t === 'emote' ? <img class="emote" src={p.url} alt={p.v} /> : p.v)}</div>)
        : <p class="hint">Keine.</p>}</div>
    </div>
  </Sheet>;
}

function ChattersSheet({ logins, onPick, onClose }: { logins: string[]; onPick: (l: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = logins.filter(l => l.includes(q.toLowerCase())).sort();
  return <Sheet title={`Chatter · ${logins.length}`} onClose={onClose}>
    <form class="search" onSubmit={e => e.preventDefault()}><input type="search" placeholder="Suchen" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} autocapitalize="off" /></form>
    <p class="hint pad">Wer seit dem Öffnen im Chat war oder geschrieben hat. Twitch bietet keine vollständige öffentliche Liste mehr.</p>
    <div class="list">{list.slice(0, 500).map(l => <button class="list-row" onClick={() => onPick(l)}>{l}</button>)}</div>
  </Sheet>;
}
function CommandsSheet({ login, onUse, onClose }: { login: string; onUse: (cmd: string) => void; onClose: () => void }) {
  const [sets, setSets] = useState<BotCommandSet[]>();
  useEffect(() => { botCommands(login).then(setSets); }, [login]);
  return <Sheet title="Bot-Befehle" onClose={onClose}>
    {!sets ? <Spinner /> : !sets.length ? <p class="hint pad">Keine Befehle von Nightbot, StreamElements oder Fossabot gefunden.</p>
      : sets.map(set => <><h3 class="section-title">{set.bot}</h3><div class="list">{set.commands.map(c =>
        <button class="list-row cmd" onClick={() => onUse(c.name)}><div><b>{c.name}</b><div class="row-sub">{c.response}</div></div></button>)}</div></>)}
  </Sheet>;
}
