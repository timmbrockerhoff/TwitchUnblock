// Chat panel (ChatView.swift): message rows, input bar with the points capsule, info line,
// chat settings sheet (ChatSettingsSheet.swift), message / emote / badge sheets (MessageSheet,
// ChatNotices), chatters, bot commands, username colour (ChatMenuSheet), emote picker
// (EmotePickerView) and the VOD chat replay (VodChatView).
import './chatpanel.css';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as tw from './twitch';
import { formatClock, formatViewers, followerDuration, mergeMessages } from './logic';
import { ChatClient, VodChat, botCommands, type BotCommandSet, loadGlobalEmotes, loadChannelEmotes, forgetChannelEmotes, translate, wantsTranslation,
  isFiltered, emoteList, emoteInfo, type EmoteEntry, type ChatMsg, type Part, type Badge } from './chat';
import { useStore, state, setSetting, type Settings } from './store';
import { openChannel, play } from './nav';
import { Icon, Sheet, Spinner } from './ui';
import { LiveEvents, watchStreaks } from './events';
import { rewards } from './rewards';
import { points } from './points';
import { helix, setChatColor } from './account';

type V = HTMLVideoElement & { getStartDate?: () => Date };
type VodRef = { id: string; channelId?: string; offset: number; login?: string };
type EmotePart = Extract<Part, { t: 'emote' }>;
type Card = { msg: ChatMsg } | { emote: EmotePart; userId?: string } | { badge: Badge };

/** SF Symbol stand-ins (16 px grid, currentColor). */
const P: Record<string, string> = {
  people: 'M5 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM1 12c0-2 2-3.5 4-3.5s4 1.5 4 3.5v1H1zm8.5 1v-1c0-1-.4-1.9-1-2.6.8-.5 1.6-.9 2.5-.9 2 0 4 1.5 4 3.5v1z',
  star: 'M8 1l2 4.5 5 .5-3.7 3.4 1.1 5L8 12l-4.4 2.4 1.1-5L1 6l5-.5z',
  smile: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM5.5 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM4.8 9.5h6.4A3.3 3.3 0 0 1 8 11.8a3.3 3.3 0 0 1-3.2-2.3z',
  tortoise: 'M3 9a5 4 0 0 1 10 0h1.5a1 1 0 0 1 0 2H13l-1 2h-1.5l.5-2H5l.5 2H4l-1-2H1.5a1 1 0 0 1 0-2z',
  squares: 'M2 2h9v9H2zm2 2v5h5V4zm8 1h2v9H5v-2h7z',
  seal: 'M8 1l1.6 1.3 2-.3.8 1.9 1.9.8-.3 2L15 8l-1.3 1.6.3 2-1.9.8-.8 1.9-2-.3L8 15l-1.6-1.3-2 .3-.8-1.9-1.9-.8.3-2L1 8l1.3-1.6-.3-2 1.9-.8.8-1.9 2 .3zm3 4.5L7 9.6 5.5 8 4.3 9.2 7 12l5.2-5.3z',
  history: 'M8 1.5A6.5 6.5 0 1 1 1.5 8H3a5 5 0 1 0 1.5-3.6L6 6H2V2l1.4 1.4A6.5 6.5 0 0 1 8 1.5zM7.3 4h1.4v3.7l2.6 1.5-.7 1.2-3.3-1.9z',
  translate: 'M1 2h6v1.5H5.6A8 8 0 0 1 4.3 7a5 5 0 0 0 1.7 1.2l-.6 1.4A6.5 6.5 0 0 1 3.3 8.3 7 7 0 0 1 .9 9.7L0 8.5a5.6 5.6 0 0 0 2.2-1.3A8.6 8.6 0 0 1 .8 4h1.6a6.7 6.7 0 0 0 .9 2.1A6.6 6.6 0 0 0 4 3.5H1zm9 3h1.6l3.4 9h-1.6l-.9-2.5H9.5L8.6 14H7zm.8 2L9.9 10h1.9z',
  nosign: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.8a5.2 5.2 0 0 0-4.1 8.4l7.3-7.3A5.2 5.2 0 0 0 8 2.8zm4.1 2L4.8 12.1A5.2 5.2 0 0 0 12.1 4.8z',
  bubble: 'M2 2h12v9H6l-3 3v-3H2z',
  textsize: 'M1 12 4.5 3h1.4L9.4 12H7.8L7 9.8H3.4L2.6 12zm2.9-3.6h2.7L5.2 4.9zM10 12V8.5h1.3v.6a2 2 0 0 1 1.6-.7c1.3 0 2.1.9 2.1 2.2V12h-1.3v-1.3c0-.8-.4-1.2-1-1.2-.7 0-1.1.5-1.1 1.2V12z',
  strike: 'M2 7.3h12v1.4H2zM8 2c2.2 0 3.6 1.1 3.8 2.9h-1.6C10 4 9.3 3.4 8 3.4S6 4 6 4.8c0 .6.4 1 1.3 1.3H4.6C4.2 5.6 4.3 2 8 2zm3.7 7.5c.2 2.4-1.5 3.5-3.7 3.5-2.3 0-3.7-1.2-3.9-3h1.6C5.9 11 6.7 11.6 8 11.6c1.3 0 2-.6 2-1.4 0-.3-.1-.5-.2-.7z',
  cpu: 'M4 4h8v8H4zm1.5 1.5v5h5v-5zM6 0h1v3H6zm3 0h1v3H9zM6 13h1v3H6zm3 0h1v3H9zM0 6h3v1H0zm0 3h3v1H0zm13-3h3v1h-3zm0 3h3v1h-3z',
  bell: 'M8 1a1 1 0 0 1 1 1v.3A4.5 4.5 0 0 1 12.5 7v3l1.5 2v1H2v-1l1.5-2V7A4.5 4.5 0 0 1 7 2.3V2a1 1 0 0 1 1-1zm-1.7 13h3.4a1.7 1.7 0 0 1-3.4 0z',
  terminal: 'M1 2h14v12H1zm1.5 1.5v9h11v-9zM4 5l2.5 2.5L4 10l-1-1 1.5-1.5L3 6zm3.5 3.5H12V10H7.5z',
  palette: 'M8 1a7 7 0 0 1 7 7c0 1.7-1.3 2.5-3 2.5h-1.5a1 1 0 0 0-.8 1.6c.4.5.3 1.3-.3 1.7A7 7 0 1 1 8 1zM4.5 6a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm2.5-2.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm4 .5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
  reload: 'M8 2a6 6 0 0 1 5.2 3H10.5v1.5H15V2h-1.5v1.8A7.5 7.5 0 0 0 .5 8H2a6 6 0 0 1 6-6zm6 6a6 6 0 0 1-11.2 3h2.7V9.5H1V14h1.5v-1.8A7.5 7.5 0 0 0 15.5 8z',
  keyboard: 'M1 4h14v8H1zm1.5 1.5v5h11v-5zM3.5 6h1.5v1.5H3.5zm3 0H8v1.5H6.5zm3 0H11v1.5H9.5zm2.5 0h1.5v1.5H12zM3.5 8.5h1.5V10H3.5zm3 0h4V10h-4zm5.5 0h1.5V10H12z',
  chevron: 'M6 3l5 5-5 5-1-1 4-4-4-4z',
  reply: 'M6 3v3h3c3 0 5 2 5 5v2c-1-2-3-3-5-3H6v3L1 8z',
  more: 'M3 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm5 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  up: 'M8 3l4.5 4.5-1 1L8.7 5.7V13H7.3V5.7L4.5 8.5l-1-1z',
  pin: 'M9 1l6 6-2 1-1 4-3-3-4 6-1-1 6-4-3-3 4-1 1-2z',
  chart: 'M2 9h3v6H2zm5-5h3v11H7zm5 3h3v8h-3z',
  gift: 'M2 6h12v3H2zm1 4h10v5H3zm3-9c1.5 0 2 1.5 2 3H6a1.5 1.5 0 0 1 0-3zm4 0a1.5 1.5 0 0 1 0 3H8c0-1.5.5-3 2-3z',
  flame: 'M8 1c1 2.5 3.5 3.5 3.5 7A3.5 3.5 0 0 1 8 11.5 3.5 3.5 0 0 1 4.5 8c0-1.5.6-2.4 1.2-3 .1 1 .5 1.6 1.1 1.8C6.5 5 7 3 8 1zm0 7c.6.8 1.2 1.3 1.2 2.1A1.2 1.2 0 0 1 8 11.3a1.2 1.2 0 0 1-1.2-1.2C6.8 9.3 7.4 8.8 8 8z',
  warn: 'M8 1.5 15 14H1zM7.3 6v4h1.4V6zm.7 5a.9.9 0 1 0 0 1.8A.9.9 0 0 0 8 11z',
};
const CI = ({ n, size = 12, cls }: { n: string; size?: number; cls?: string }) =>
  <svg class={'ci' + (cls ? ' ' + cls : '')} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"><path d={P[n]} fill="currentColor" /></svg>;

const RULES_KEY = 'chatRulesAccepted';
const rulesAccepted = (login: string) => { try { return (JSON.parse(localStorage.getItem(RULES_KEY) || '[]') as string[]).includes(login); } catch { return false; } };
const acceptRules = (login: string) => { try { localStorage.setItem(RULES_KEY, JSON.stringify([...new Set([...(JSON.parse(localStorage.getItem(RULES_KEY) || '[]') as string[]), login])].slice(-200))); } catch { /* blocked */ } };
const landscape = () => !!document.querySelector('.player.land');
const plainText = (m: ChatMsg) => m.parts.map(p => p.v).join('').trim();
/** 450 ms press (or a right click) fires `fire`; the click that would follow is swallowed. */
function longPress(fire: () => void) {
  let t: ReturnType<typeof setTimeout> | undefined, fired = false;
  return {
    onTouchStart: () => { fired = false; clearTimeout(t); t = setTimeout(() => { fired = true; fire(); }, 450); },
    onTouchMove: () => clearTimeout(t), onTouchCancel: () => clearTimeout(t),
    onTouchEnd: (e: Event) => { clearTimeout(t); if (fired) e.preventDefault(); },
    onContextMenu: (e: Event) => { e.preventDefault(); if (!fired) fire(); },
  };
}

// Chat panel ------------------------------------------------------------------------------------
/** `showSettings`/`onShowSettings`: the player's "Live-Chat" header owns the gear; without
 *  `onShowSettings` the gear sits at the end of the info line (iOS without a header). */
export function ChatPanel({ login, channelId, vod, video, archive, showSettings, onShowSettings }: {
  login?: string; channelId?: string; vod?: VodRef; video?: { current: HTMLVideoElement | null }; archive?: { id: string; startedAt?: string };
  showSettings?: boolean; onShowSettings?: (v: boolean) => void }) {
  const s = useStore();
  const st = s.settings;
  const list = useRef<HTMLDivElement>(null);
  const [, render] = useState(0);
  const tick = () => render(x => x + 1);
  const [follow, setFollow] = useState(true);
  const [conn, setConn] = useState(false);
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [picker, setPicker] = useState(false);
  const [sheet, setSheet] = useState<'settings' | 'rules' | 'points'>();
  const [card, setCard] = useState<Card>();
  const pending = useRef<{ text: string; reply?: ChatMsg }>();
  const client = useRef<ChatClient>();
  const vodMsgs = useRef<ChatMsg[]>([]);
  const vodChat = useRef<VodChat>();
  // Live chat held back to match the picture; over 5 min behind in the recording → its chat replay.
  const [sync, setSync] = useState({ delay: 0, replay: false });
  const replayRef = useRef(false);
  replayRef.current = sync.replay;
  const followRef = useRef(follow);
  followRef.current = follow;
  const cid = channelId ?? vod?.channelId;
  const settingsOpen = onShowSettings ? !!showSettings : sheet === 'settings';
  const closeSettings = () => onShowSettings ? onShowSettings(false) : setSheet(undefined);
  const openSettings = () => onShowSettings ? onShowSettings(true) : setSheet('settings');
  const translateBatch = (batch: ChatMsg[]) => {
    if (!state.settings.chatTranslate) return;
    for (const m of batch) if (wantsTranslation(m))
      translate(m.parts.filter(p => p.t === 'text').map(p => p.v).join(' ').replace(/\s+/g, ' ').trim()).then(tr => { if (tr) { m.translation = tr; tick(); } });
  };
  useEffect(() => { loadGlobalEmotes().then(tick); }, []);
  useEffect(() => { if (cid && (login || vod)) loadChannelEmotes(cid, login ?? '').then(tick); }, [cid]);
  useEffect(() => {
    if (!login) return;
    const c = new ChatClient(login, channelId, b => { if (!replayRef.current) translateBatch(b); tick(); }, e => {
      if (e.type === 'notice') setNotice(e.text);
      else { setConn(c.connected); tick(); }
    });
    client.current = c;
    return () => { c.close(); if (client.current === c) client.current = undefined; };
  }, [login, channelId, s.account?.token]);
  useEffect(() => { client.current?.setPaused(!follow); }, [follow]);
  useEffect(() => {
    if (!login || !video) return;
    const t = setInterval(() => {
      const v = video.current, c = client.current; if (!v || !c) return;
      // Safari's getStartDate = PROGRAM-DATE-TIME of media time 0 (NaN without one).
      const pdt0 = (v as V).getStartDate?.().getTime();
      let r = { delay: 0, replay: false };
      if (archive && !archive.startedAt) c.delay = 0;
      else r = c.applySync({ now: Date.now(), t: v.currentTime, pdt0, edge: v.seekable.length ? v.seekable.end(v.seekable.length - 1) : undefined,
        archiveStart: archive && Date.parse(archive.startedAt!) });
      setSync(o => Math.round(o.delay) === Math.round(r.delay) && o.replay === r.replay ? o : r);
    }, 1000);
    return () => { clearInterval(t); if (client.current) client.current.delay = 0; };
  }, [login, archive?.id, archive?.startedAt]);
  const replay = vod ?? (sync.replay && archive ? { id: archive.id, channelId, offset: 0 } : undefined);
  useEffect(() => {
    if (!replay || !video) return;
    vodMsgs.current = []; tick();
    const chat = new VodChat(replay.id, replay.channelId);
    vodChat.current = chat;
    const t = setInterval(async () => {
      const v = video.current; if (!v) return;
      const { msgs: due, reset } = await chat.tick(v.currentTime);
      if (reset) vodMsgs.current = [];
      if (due.length) { const r = mergeMessages(vodMsgs.current, due, !followRef.current); vodMsgs.current = r.list; translateBatch(r.fresh); }
      tick();   // the status line's offset and the loading / error states move with the clock
    }, 1000);
    return () => { clearInterval(t); vodChat.current = undefined; vodMsgs.current = []; tick(); };
  }, [replay?.id]);
  useEffect(() => { if (follow && list.current) list.current.scrollTop = list.current.scrollHeight; });
  // Rotation or a layout switch resizes the list; its scroll event then read as "scrolled up"
  // and the chat stopped following. Pin to the bottom first when following.
  useEffect(() => {
    const el = list.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (followRef.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const c = client.current;
  const room = c?.room ?? {};
  const live = !!login && !replay;
  const all = live ? c?.messages ?? [] : vodMsgs.current;
  const shown = all.filter(m => (st.chatShowDeleted || !m.deleted) && !isFiltered(m));
  const readOnly = !!c?.readOnly;
  const canSend = !!c?.canSend;
  const inputShown = live && !!s.account && !readOnly;
  const balance = login ? rewards.balance[login] : undefined;
  const streak = login && st.showStreak ? watchStreaks[login] ?? 0 : 0;
  const capsule = inputShown && balance != null;
  const land = landscape();
  const jumpDown = () => { setFollow(true); if (list.current) list.current.scrollTop = list.current.scrollHeight; };

  // Sending (rules sheet first, once per channel, like Twitch).
  const deliver = (t: string, reply?: ChatMsg) => { if (client.current?.send(t, reply)) { if (!reply) { setText(''); setPicker(false); } } };
  const send = (t: string, reply?: ChatMsg) => {
    t = t.trim();
    if (!t || t.length > 500 || !login) return;
    if (room.rules?.length && !rulesAccepted(login)) { pending.current = { text: t, reply }; setSheet('rules'); return; }
    deliver(t, reply);
  };
  const reload = () => { if (cid && login) { forgetChannelEmotes(cid); loadChannelEmotes(cid, login).then(tick); } c?.reconnect(); };

  // Autocomplete (chips over the field): "@na" → people who wrote, else emotes, prefix before contains.
  const word = text.split(' ').pop() ?? '';
  let names: string[] = [], emotes: EmoteEntry[] = [];
  if (st.chatAutocomplete && focused && !picker && word.length >= 2) {
    if (word.startsWith('@')) {
      const kw = word.slice(1).toLowerCase(), seen = new Set<string>();
      for (let i = all.length - 1; i >= 0 && names.length < 12; i--) {
        const m = all[i];
        if (m.login && m.login.startsWith(kw) && !seen.has(m.login)) { seen.add(m.login); names.push(m.name); }
      }
    } else {
      const kw = word.toLowerCase(), l = emoteList(cid);
      emotes = [...l.filter(e => e.name.toLowerCase().startsWith(kw)), ...l.filter(e => { const n = e.name.toLowerCase(); return !n.startsWith(kw) && n.includes(kw); })].slice(0, 12);
    }
  }
  const complete = (r: string) => { const w = text.split(' '); w[w.length - 1] = r; setText(w.join(' ') + ' '); };
  const insert = (name: string) => { setText(t => (t && !t.endsWith(' ') ? t + ' ' : t) + name + ' '); setCard(undefined); };

  // Info line: room modes as chips, sync nudge, streak without the capsule, notices.
  const chip = (icon: string, t: string) => <span class="ic"><CI n={icon} size={10} />{t}</span>;
  const info: ComponentChildren[] = [];
  if (login) {
    if (room.followers != null && room.followers >= 0) info.push(chip('people', room.followers > 0 ? `Follower seit ${followerDuration(room.followers)}` : 'Nur Follower'));
    if (room.subs) info.push(chip('star', 'Nur Abonnenten'));
    if (room.emoteOnly) info.push(chip('smile', 'Nur Emotes'));
    if (room.slow) info.push(chip('tortoise', `Langsamer Modus: ${room.slow} s`));
    if (room.r9k) info.push(chip('squares', 'Einzigartige Nachrichten'));
    if (room.verifiedOnly) info.push(chip('seal', 'Verifiziertes Konto erforderlich'));
    if (sync.replay) info.push(chip('history', 'Chat der Aufzeichnung'));
    else if (sync.delay >= 0.5 || st.chatSyncNudge) info.push(<label class="ic menu" title="Chat vor oder hinter dem Video?">
      <CI n="history" size={10} />{Math.round(sync.delay)} s{st.chatSyncNudge ? ` (${st.chatSyncNudge > 0 ? '+' : ''}${st.chatSyncNudge})` : ''}
      <select value="" onChange={e => { const v = (e.target as HTMLSelectElement).value; setSetting('chatSyncNudge', v === '0' ? 0 : Math.max(-20, Math.min(20, st.chatSyncNudge + Number(v)))); }}>
        <option value="" disabled>Chat vor oder hinter dem Video?</option><option value="1">Chat verzögern (+1 s)</option><option value="-1">Chat früher zeigen (−1 s)</option>
        {st.chatSyncNudge !== 0 && <option value="0">Zurück zur reinen Auto-Synchronisierung</option>}</select></label>);
    if (streak > 0 && !capsule) info.push(chip('flame', String(streak)));
    if (notice) info.push(<button class="ic" onClick={() => setNotice('')}>{notice}</button>);
    if (!s.account && !vod) info.push(<span class="ic">Zum Chatten in den Einstellungen mit Twitch anmelden.</span>);
    else if (!conn && !sync.replay && !s.account) info.push(chip('reload', 'Verbinden…'));
  }
  const inlineGear = !onShowSettings;
  const vodState = vod && !shown.length ? (!vodChat.current?.ready ? 'loading' : vodChat.current.error ? 'error' : 'empty') : undefined;
  const sizes = { '--fs': `${st.chatFont}px`, '--badge': `${(st.chatFont + 3) * st.chatBadgeScale}px`, '--emote': `${(st.chatFont + 11) * st.chatEmoteScale}px`, '--sp': `${st.chatSpacing / 2}px` };

  return <div class="chat" style={sizes as any}>
    {vod && <div class="vod-status"><CI n="history" size={11} cls="purple" /><span>VOD-Chat</span><i />
      <span class="purple">{formatClock(video?.current?.currentTime ?? vod.offset)}</span>{vod.login && <span class="acc">#{vod.login}</span>}</div>}
    {login && <LiveEvents login={login} channelId={cid} onRaid={r => play({ kind: 'live', login: r.login })} />}
    <div class="chat-body">
      {picker && inputShown ? <EmotePicker channelId={cid} seen={all} onPick={e => insert(e.name)} onInfo={e => setCard({ emote: { t: 'emote', v: e.name, url: e.url, zeroWidth: e.zeroWidth } })} />
      : <div class="chat-list" ref={list} onScroll={e => { const el = e.target as HTMLDivElement; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }}>
        {vodState === 'loading' ? <div class="chat-empty"><Spinner text="Chat wird geladen…" /></div>
          : vodState === 'error' ? <div class="chat-empty err"><CI n="warn" size={26} /><p>{vodChat.current?.error}</p></div>
          : vodState === 'empty' ? <div class="chat-empty"><CI n="bubble" size={26} /><p>Keine Nachrichten an dieser Stelle des VODs</p></div>
          : shown.map(m => <MessageRow key={m.id} m={m} onTap={x => setCard({ msg: x })}
            onBadge={b => setCard({ badge: b })} onEmote={(p, u) => setCard({ emote: p, userId: u })} onOpenChannel={l => openChannel(l)} />)}
      </div>}
      {!follow && !picker && <button class="btn prominent small follow-btn" onClick={jumpDown}><Icon n="down" size={14} />Folgen</button>}
    </div>
    {(info.length > 0 || inlineGear) && <div class="info-line"><div class="info-scroll">{info}</div>
      {inlineGear && <button class="info-gear" onClick={openSettings} aria-label="Chat-Einstellungen"><Icon n="gear" size={16} /></button>}</div>}
    {live && readOnly && <div class="ban-bar"><CI n="nosign" size={12} /><span>Aus diesem Chat gebannt: nur lesen, ohne dein Konto</span>
      <button class="btn bordered small" onClick={() => c?.retryAccount()}>Mit meinem Konto erneut versuchen</button></div>}
    {inputShown && <div class="chat-bar">
      {(names.length > 0 || emotes.length > 0) && <div class="ac-row">
        {names.map(n => <button class="ac-chip name" onMouseDown={e => e.preventDefault()} onClick={() => complete('@' + n)}>@{n}</button>)}
        {emotes.map(e => <button class="ac-chip" onMouseDown={e => e.preventDefault()} onClick={() => complete(e.name)}><img src={e.url} alt="" />{e.name}</button>)}
      </div>}
      <div class="chat-input">
        {capsule && <button class={'pts-cap' + (land ? ' compact' : '')} onClick={() => { setPicker(false); setSheet('points'); }} aria-label="Kanalpunkte">
          <span class="crown">👑</span><b>{formatViewers(balance!)}</b>{streak > 0 && <><span class="fire">🔥</span><b>{streak}</b></>}
          {login && rewards.lastBalanceChange[login]! > 0 && <span class="pts-delta">+{rewards.lastBalanceChange[login]}</span>}
        </button>}
        <form class="chat-field" onSubmit={e => { e.preventDefault(); send(text); }}>
          <input value={text} onInput={e => setText((e.target as HTMLInputElement).value)} onFocus={() => { setFocused(true); setPicker(false); }} onBlur={() => setTimeout(() => setFocused(false), 250)}
            placeholder={conn ? (land ? 'Chat…' : 'Nachricht senden…') : 'Verbinden…'} maxLength={500} enterkeyhint="send" autocapitalize="sentences" autocomplete="off" disabled={!conn} />
          <button type="button" class={'field-btn' + (picker ? ' on' : '')} onClick={() => setPicker(p => !p)} aria-label={picker ? 'Tastatur' : 'Emotes'}><CI n={picker ? 'keyboard' : 'smile'} size={18} /></button>
        </form>
        {text.trim() && <button class="send-btn" disabled={!canSend} onClick={() => send(text)} aria-label="Senden"><CI n="up" size={18} /></button>}
      </div>
      {text.length > 400 && <div class={'counter' + (text.length > 480 ? ' danger' : '')}>{text.length}/500</div>}
    </div>}

    {settingsOpen && <ChatSettingsSheet live={live && !!login} client={c} login={login} account={!!s.account} onClose={closeSettings}
      onUseCommand={cmd => { closeSettings(); setText(cmd + ' '); }} onReload={() => { reload(); closeSettings(); }} />}
    {sheet === 'rules' && login && <RulesSheet channel={login} rules={room.rules ?? []} onDone={ok => {
      setSheet(undefined); const p = pending.current; pending.current = undefined;
      if (ok) { acceptRules(login); if (p) deliver(p.text, p.reply); } }} />}
    {sheet === 'points' && login && <PointsSheet login={login} balance={balance} streak={streak} onClose={() => setSheet(undefined)} />}
    {card && ('msg' in card ? <MessageSheet m={card.msg} all={all} canSend={canSend && live} onReply={(t, m) => { send(t, m); setCard(undefined); }}
        onMention={n => { setText(t => (t && !t.endsWith(' ') ? t + ' ' : t) + '@' + n + ' '); setCard(undefined); }} onClose={() => setCard(undefined)} />
      : 'emote' in card ? <EmoteSheet p={card.emote} channelId={cid} userId={card.userId} onInsert={inputShown ? insert : undefined} onClose={() => setCard(undefined)} />
      : <BadgeSheet b={card.badge} onClose={() => setCard(undefined)} />)}
  </div>;
}

// Message row (ChatMessageRowContent) -------------------------------------------------------------
const shortLink = (v: string) => v.length > 48 ? v.slice(0, 28) + '…' + v.slice(-14) : v;
const href = (v: string) => v.startsWith('http') ? v : 'https://' + v;
/** Parts as nodes; a zero-width emote (7TV) is drawn over the emote before it. */
function renderParts(parts: Part[], onEmote?: (p: EmotePart) => void) {
  const out: ComponentChildren[] = [];
  let stack: ComponentChildren[] | undefined;
  parts.forEach((p, i) => {
    if (p.t === 'emote') {
      const img = <img class="emote" src={p.url} alt={p.v} title={p.v} loading="lazy" onClick={e => { e.stopPropagation(); onEmote?.(p); }} />;
      if (p.zeroWidth && stack) { stack.push(img); return; }
      stack = [img]; out.push(stack); return;
    }
    // The blank between an emote and the zero-width one over it is not shown.
    const next = parts[i + 1];
    if (stack && p.t === 'text' && !p.v.trim() && next?.t === 'emote' && next.zeroWidth) return;
    stack = undefined;
    out.push(p.t === 'link' ? <a class="msg-link" href={href(p.v)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{shortLink(p.v)}</a>
      : p.t === 'mention' ? <b class="msg-mention">{p.v}</b> : p.v);
  });
  return out.map(x => Array.isArray(x) ? (x.length > 1 ? <span class="emote-stack">{x}</span> : x[0]) : x);
}
const time = (m: ChatMsg) => m.offset != null ? formatClock(m.offset) : new Date(m.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export function MessageRow({ m, onTap, onBadge, onEmote, onOpenChannel, marked }: { m: ChatMsg; onTap?: (m: ChatMsg) => void; onBadge?: (b: Badge) => void;
  onEmote?: (p: EmotePart, userId?: string) => void; onOpenChannel?: (login: string) => void; marked?: boolean }) {
  const st = state.settings;
  const cls = 'msg' + (m.accent ? ' announce' : m.mention ? ' mention' : m.highlighted && !m.system ? ' hl' : '') + (m.deleted ? ' deleted' : '')
    + (m.firstMsg ? ' first' : '') + (marked ? ' marked' : '') + (m.login && onTap ? ' tap' : '');
  return <div class={cls} style={m.accent ? { '--c': m.accent } as any : undefined} onClick={() => { if (m.login) onTap?.(m); }}>
    {m.firstMsg && <div class="msg-first">✨ Erste Nachricht</div>}
    {m.system && (m.raider ? <div class="msg-raid"><CI n="people" size={11} /><span>{m.system}</span>
        <button class="btn bordered small" onClick={e => { e.stopPropagation(); onOpenChannel?.(m.raider!); }}>Kanal ansehen</button></div>
      : <div class={'msg-sys' + (m.login ? '' : ' app')}>{m.login && '★ '}{m.system}</div>)}
    {m.reply && <div class="msg-reply"><CI n="reply" size={9} /><b>@{m.reply.login}</b>: {m.reply.text}</div>}
    {(m.parts.length > 0 || !m.system) && <div class="msg-line">
      {st.chatTimestamps && <span class="ts">{time(m)}</span>}
      {m.history && <CI n="history" size={st.chatFont - 3} cls="ts" />}
      {m.badges.map(b => <img class="badge-img" src={b.url} alt={b.title} title={b.title} onClick={e => { e.stopPropagation(); onBadge?.(b); }} />)}
      <b class="msg-name" style={{ color: m.color }}>{m.name}{m.action ? '' : ':'}</b>{' '}
      <span class="msg-text" style={m.action ? { color: m.color } : undefined}>{renderParts(m.parts, p => onEmote?.(p, m.userId))}</span>
      {m.translation && <div class="tr"><CI n="translate" size={st.chatFont - 2} />{m.translation}</div>}
    </div>}
  </div>;
}

// Input helpers ---------------------------------------------------------------------------------
/** Chat rules (ChatRulesSheet): accepted once per channel before the first message. */
function RulesSheet({ channel, rules, onDone }: { channel: string; rules: string[]; onDone: (ok: boolean) => void }) {
  return <Sheet title={`Chatregeln von ${channel}`} onClose={() => onDone(false)}>
    <div class="rules">{rules.map(r => <p>{r}</p>)}</div>
    <div class="rules-btns"><button class="btn bordered small" onClick={() => onDone(false)}>Abbrechen</button><button class="btn prominent small" onClick={() => onDone(true)}>Einverstanden</button></div>
  </Sheet>;
}

/** ChannelPointsSheet, viewer side: balance, this session's and the channel's totals (points.ts). */
function PointsSheet({ login, balance, streak, onClose }: { login: string; balance?: number; streak: number; onClose: () => void }) {
  const ses = points.sessions[login], ch = points.channels[login];
  return <Sheet title="Kanalpunkte" onClose={onClose}>
    <div class="pts-head"><span class="crown">👑</span><b>{balance != null ? balance.toLocaleString('de-DE') : '–'}</b>{streak > 0 && <span class="row-sub">🔥 Serie: {streak} Streams</span>}</div>
    <div class="group">
      <div class="row"><span>Diese Sitzung</span><span class="row-sub">{ses ? `+${ses.points} Pkt. · ${ses.minutes} Min.` : '–'}</span></div>
      <div class="row"><span>Auf diesem Kanal</span><span class="row-sub">{ch ? `${ch.points} Pkt. · ${ch.minutes} Min. · ${ch.chests} Truhen` : '–'}</span></div>
    </div>
    <p class="hint pad">{state.settings.autoPoints ? 'Truhen werden automatisch abgeholt, sobald sie erscheinen.' : 'Truhen abholen ist in den Einstellungen → Kanalpunkte ausgeschaltet.'}</p>
  </Sheet>;
}

/** Emote picker (EmotePickerView): the whole list area, search, tabs, 6 columns, long press = sheet. */
const TABS = ['Dieser Kanal', '7TV', 'BTTV', 'FFZ', 'Twitch'] as const;
let ownTwitch: EmoteEntry[] | null | undefined;   // Helix chat/emotes/user, once per session (null = not allowed)
function EmotePicker({ channelId, seen, onPick, onInfo }: { channelId?: string; seen: ChatMsg[]; onPick: (e: EmoteEntry) => void; onInfo: (e: EmoteEntry) => void }) {
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const [, re] = useState(0);
  useEffect(() => {
    if (ownTwitch !== undefined || !state.account) return;
    helix(`chat/emotes/user?user_id=${state.account.userId}`).then(j => {
      ownTwitch = Array.isArray(j?.data) && j.data.length ? j.data.map((e: any): EmoteEntry => ({ name: e.name, id: e.id, source: 'twitch', scope: 'global',
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${e.id}/${e.format?.includes('animated') ? 'animated' : 'static'}/dark/2.0` })) : null;
      re(x => x + 1);
    });
  }, []);
  const all = emoteList(channelId);
  let twitch = ownTwitch;
  if (!twitch) {   // no scope for the account's emotes: the Twitch emotes seen in this chat
    const m = new Map<string, EmoteEntry>();
    for (const msg of seen) for (const p of msg.parts) if (p.t === 'emote' && p.url.includes('/emoticons/') && !m.has(p.v)) m.set(p.v, { name: p.v, url: p.url, id: '', source: 'twitch', scope: 'global' });
    twitch = [...m.values()];
  }
  const groups = [all.filter(e => e.scope === 'channel'), all.filter(e => e.source === '7tv'), all.filter(e => e.source === 'bttv'), all.filter(e => e.source === 'ffz'), twitch];
  const kw = q.trim().toLowerCase();
  const list = kw ? all.concat(twitch).filter(e => e.name.toLowerCase().includes(kw)) : groups[tab];
  return <div class="emote-picker">
    <input class="em-search" type="search" placeholder="Emotes suchen" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} autocapitalize="off" autocomplete="off" />
    {!kw && <div class="em-tabs">{TABS.map((t, i) => <button class={i === tab ? 'on' : ''} onClick={() => setTab(i)}>{i === 0 ? '⭐ ' : ''}{t}</button>)}</div>}
    {kw && <div class="em-count">Ergebnisse für „{q.trim()}“: {list.length}</div>}
    {!list.length ? <div class="chat-empty"><p>{kw ? 'Keine Emotes gefunden' : 'Keine Emotes'}</p></div>
      : <div class="em-grid">{list.slice(0, 600).map(e => <button class="em-cell" onClick={() => onPick(e)} {...longPress(() => onInfo(e))}>
        <img src={e.url} alt={e.name} loading="lazy" /><span>{e.name}</span></button>)}</div>}
  </div>;
}

// Sheets ------------------------------------------------------------------------------------------
/** Action sheet of this panel (the ⋯ menu): same look as the long-press menu. */
function ActionMenu({ items, onClose }: { items: { label: string; danger?: boolean; onSelect: () => void }[]; onClose: () => void }) {
  return <div class="sheet-backdrop" onClick={onClose}>
    <div class="menu" role="menu" onClick={e => e.stopPropagation()}>
      <div class="menu-items">{items.map(i => <button class={'menu-item' + (i.danger ? ' danger' : '')} role="menuitem" onClick={() => { onClose(); i.onSelect(); }}>{i.label}</button>)}</div>
      <button class="menu-cancel" onClick={onClose}>Abbrechen</button>
    </div>
  </div>;
}

/** MessageSheet: the person (avatar, name in their colour, profile line), reply / mention / copy /
 *  hide, then the thread or everything they wrote, as real chat rows; the tapped line marked. */
function MessageSheet({ m, all, canSend, onReply, onMention, onClose }: { m: ChatMsg; all: ChatMsg[]; canSend: boolean;
  onReply: (text: string, m: ChatMsg) => void; onMention: (name: string) => void; onClose: () => void }) {
  const s = useStore();
  const [avatar, setAvatar] = useState<string>();
  const [u, setU] = useState<any>();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sub, setSub] = useState<Card>();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    tw.userAvatar(m.login).then(setAvatar);
    tw.gql('query($l: String!) { user(login: $l) { createdAt followers { totalCount } } }', { l: m.login }).then(d => setU(d?.user ?? null));
  }, [m.login]);
  useEffect(() => { if (replying) field.current?.focus(); }, [replying]);
  const root = m.reply?.root ?? m.id;
  const thread = all.filter(x => x.id === root || x.reply?.root === root || x.reply?.parent === root);
  const shown = thread.length > 1 ? thread : (all.filter(x => x.login === m.login).length ? all.filter(x => x.login === m.login) : [m]);
  const hidden = s.settings.chatBlockedUsers.includes(m.login);
  const items = [
    { label: 'Nachricht kopieren', onSelect: () => { navigator.clipboard?.writeText(plainText(m)).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 900); } },
    ...(canSend ? [{ label: 'Erwähnen', onSelect: () => onMention(m.name) }] : []),
    { label: 'Kanalseite öffnen', onSelect: () => { onClose(); openChannel(m.login); } },
    { label: hidden ? 'Im Chat wieder anzeigen' : 'Im Chat ausblenden', danger: !hidden,
      onSelect: () => { setSetting('chatBlockedUsers', hidden ? s.settings.chatBlockedUsers.filter(x => x !== m.login) : [...s.settings.chatBlockedUsers, m.login].slice(-500)); onClose(); } },
  ];
  const sendReply = () => { const t = reply.trim(); if (t) onReply(t, m); };
  return <Sheet title="" onClose={onClose}>
    <div class="ms-head">
      {avatar ? <img class="ms-avatar" src={avatar} alt="" /> : <span class="ms-avatar init" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 25%, transparent)` }}>{m.name.slice(0, 1).toUpperCase()}</span>}
      <div class="ms-who"><b style={{ color: m.color }}>{m.name}</b>
        <span class="row-sub">@{m.login}{u?.followers ? ` · ${formatViewers(u.followers.totalCount)} Follower` : ''}{u?.createdAt ? ` · seit ${new Date(u.createdAt).getFullYear()}` : ''}</span></div>
      {canSend && <button class="ms-btn" onClick={() => setReplying(true)} aria-label="Antworten"><CI n="reply" size={18} /></button>}
      <button class="ms-btn" onClick={() => setMenu(true)} aria-label="Mehr"><CI n="more" size={18} /></button>
    </div>
    {copied && <div class="ms-copied">Nachricht kopiert</div>}
    <div class="ms-list">{shown.map(x => <MessageRow key={x.id} m={x} marked={x.id === m.id} onBadge={b => setSub({ badge: b })} onEmote={(p, uid) => setSub({ emote: p, userId: uid })} />)}</div>
    {replying && canSend && <form class="ms-reply" onSubmit={e => { e.preventDefault(); sendReply(); }}>
      <input ref={field} value={reply} onInput={e => setReply((e.target as HTMLInputElement).value)} placeholder={`Antwort an @${m.name}`} maxLength={500} enterkeyhint="send" autocomplete="off" />
      <button class="send-btn" disabled={!reply.trim()} aria-label="Senden"><CI n="up" size={18} /></button>
    </form>}
    {menu && <ActionMenu items={items} onClose={() => setMenu(false)} />}
    {sub && ('emote' in sub ? <EmoteSheet p={sub.emote} userId={sub.userId} onClose={() => setSub(undefined)} /> : 'badge' in sub ? <BadgeSheet b={sub.badge} onClose={() => setSub(undefined)} /> : null)}
  </Sheet>;
}

const BRAND = { bttv: 'BetterTTV', ffz: 'FrankerFaceZ', '7tv': '7TV' } as const;
const PAGE = { bttv: 'https://betterttv.com/emotes/', ffz: 'https://www.frankerfacez.com/emoticon/', '7tv': 'https://7tv.app/emotes/' } as const;
const largeURL = (u: string) => u.replace(/\/2x(\.webp)?$/, (_, w) => w ? '/4x.webp' : '/3x').replace('/2.0', '/3.0');
/** ChatInfoSheet, emote: big picture, exact name, source and scope, author, page, copy / insert. */
function EmoteSheet({ p, channelId, userId, onInsert, onClose }: { p: EmotePart; channelId?: string; userId?: string; onInsert?: (name: string) => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const e = emoteInfo(p.v, channelId, userId);
  const source = e ? `${BRAND[e.source]} · ${e.scope === 'channel' ? 'Kanal-Emote' : e.scope === 'personal' ? 'persönliches Emote (Pro)' : 'Globales Emote'}` : 'Twitch-Emote';
  return <Sheet title="" onClose={onClose}>
    <div class="emote-info">
      <img src={largeURL(p.url)} alt={p.v} onError={ev => { (ev.target as HTMLImageElement).src = p.url; }} />
      <div class="em-name">{p.v}</div>
      <div class="row-sub">{source}</div>
      {e?.author && <div class="row-sub">Von {e.author}</div>}
      {p.zeroWidth && <div class="row-sub">Überlagert das vorherige Emote</div>}
      {e?.id && <a class="em-link" href={PAGE[e.source] + encodeURIComponent(e.id)} target="_blank" rel="noopener noreferrer">Auf {BRAND[e.source]} ansehen ↗</a>}
      <div class="em-btns">
        <button class="btn prominent small" onClick={() => { navigator.clipboard?.writeText(p.v).catch(() => {}); setCopied(true); }}>{copied ? '✓ Kopiert' : 'Namen kopieren'}</button>
        {onInsert && <button class="btn bordered small" onClick={() => onInsert(p.v)}>Zur Nachricht hinzufügen</button>}
      </div>
    </div>
  </Sheet>;
}
/** ChatInfoSheet, badge: picture 54, title 20, description. */
function BadgeSheet({ b, onClose }: { b: Badge; onClose: () => void }) {
  return <Sheet title="" onClose={onClose}>
    <div class="emote-info badge-info">
      <img src={b.url.endsWith('/2') ? b.url.slice(0, -1) + '3' : b.url} alt="" onError={ev => { (ev.target as HTMLImageElement).src = b.url; }} />
      <div class="badge-title">{b.title}</div>
      {b.description && b.description !== b.title && <div class="row-sub">{b.description}</div>}
      <div class="row-sub">Abzeichen</div>
    </div>
  </Sheet>;
}

// Chat settings (ChatSettingsSheet) ----------------------------------------------------------------
const SwitchRow = ({ icon, label, k }: { icon: string; label: string; k: keyof Settings }) => {
  const st = useStore().settings;
  return <label class="row"><span class="row-l"><CI n={icon} size={16} />{label}</span>
    <input type="checkbox" class="switch" checked={!!st[k]} onChange={e => setSetting(k, (e.target as HTMLInputElement).checked as never)} /></label>;
};
const NavRow = ({ icon, label, value, onClick }: { icon: string; label: string; value?: string; onClick: () => void }) =>
  <button class="row" onClick={onClick}><span class="row-l"><CI n={icon} size={16} />{label}</span>{value && <span class="row-sub">{value}</span>}<CI n="chevron" size={12} cls="muted" /></button>;

function ChatSettingsSheet({ live, client, login, account, onClose, onUseCommand, onReload }: { live: boolean; client?: ChatClient; login?: string; account: boolean;
  onClose: () => void; onUseCommand: (cmd: string) => void; onReload: () => void }) {
  const st = useStore().settings;
  const [sub, setSub] = useState<'notices' | 'chatters' | 'commands' | 'colors'>();
  const noticesOn = [st.showPinned, st.showEvents, st.showDropsNotice, st.showStreak].filter(Boolean).length;
  const font = (d: number) => setSetting('chatFont', Math.max(10, Math.min(20, st.chatFont + d)));
  return <Sheet title="Chat-Einstellungen" onClose={onClose}>
    <div class="group">
      {live && <SwitchRow icon="bubble" label="Nur Chat" k="chatOnly" />}
      <div class="row"><span class="row-l"><CI n="textsize" size={16} />Schriftgröße</span><span class="stepper-val">{st.chatFont} pt</span>
        <span class="stepper"><button disabled={st.chatFont <= 10} onClick={() => font(-1)} aria-label="Kleiner">−</button><button disabled={st.chatFont >= 20} onClick={() => font(1)} aria-label="Größer">+</button></span></div>
      <SwitchRow icon="translate" label="Automatisch übersetzen" k="chatTranslate" />
      <SwitchRow icon="history" label="Zeitstempel" k="chatTimestamps" />
      <SwitchRow icon="strike" label="Gelöschte Nachrichten anzeigen" k="chatShowDeleted" />
      <SwitchRow icon="cpu" label="Bots ausblenden" k="chatHideBots" />
      <SwitchRow icon="terminal" label="Befehle ausblenden" k="chatHideCommands" />
    </div>
    {live && <div class="group top">
      <NavRow icon="bell" label="Hinweise im Chat" value={`${noticesOn} / 4`} onClick={() => setSub('notices')} />
      <NavRow icon="people" label="Chatter" onClick={() => setSub('chatters')} />
      <NavRow icon="terminal" label="Bot-Befehle" onClick={() => setSub('commands')} />
      {account && <NavRow icon="palette" label="Farbe des Benutzernamens" onClick={() => setSub('colors')} />}
      <button class="row" onClick={onReload}><span class="row-l"><CI n="reload" size={16} />Chat neu laden</span></button>
    </div>}
    {sub === 'notices' && <Sheet title="Hinweise im Chat" onClose={() => setSub(undefined)}><div class="group">
      <SwitchRow icon="pin" label="Angeheftete Nachrichten" k="showPinned" />
      <SwitchRow icon="chart" label="Umfragen & Vorhersagen" k="showEvents" />
      <SwitchRow icon="gift" label="Kanal-Drops" k="showDropsNotice" />
      <SwitchRow icon="flame" label="Zuschauerserie" k="showStreak" />
    </div></Sheet>}
    {sub === 'chatters' && client && <ChattersSheet client={client} onClose={() => setSub(undefined)} />}
    {sub === 'commands' && login && <CommandsSheet login={login} onUse={onUseCommand} onClose={() => setSub(undefined)} />}
    {sub === 'colors' && <ColorSheet onClose={() => setSub(undefined)} />}
  </Sheet>;
}

/** ChattersSheet: what IRC announced (NAMES, JOIN/PART, writers); Twitch has no presence API. */
function ChattersSheet({ client, onClose }: { client: ChatClient; onClose: () => void }) {
  const [q, setQ] = useState('');
  const logins = [...client.present].sort();
  const kw = q.trim().toLowerCase();
  const shown = kw ? logins.filter(l => l.includes(kw)) : logins;
  const note = 'Twitch hat seine Präsenz-API abgeschaltet: Nur IRC meldet noch, wer beitritt, und das nur auf eher kleinen Kanälen. Die Liste kann bei großen Streams daher leer bleiben.';
  return <Sheet title={logins.length ? `Chatter · ${logins.length}` : 'Chatter'} onClose={onClose}>
    {!logins.length ? <div class="empty"><CI n="people" size={40} /><h3>{client.presenceSupported ? 'Auf diesem Kanal hat sich niemand angemeldet' : 'Warte auf die Chat-Liste…'}</h3><p>{note}</p></div>
      : <>
        <form class="search" onSubmit={e => e.preventDefault()}><input type="search" placeholder="Namen filtern…" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} autocapitalize="off" /></form>
        <div class="chatters">{shown.slice(0, 1000).map(l => <div class="chatter"><CI n="people" size={11} cls="muted" />{l}</div>)}</div>
        <p class="hint pad">{note}</p>
      </>}
  </Sheet>;
}
function CommandsSheet({ login, onUse, onClose }: { login: string; onUse: (cmd: string) => void; onClose: () => void }) {
  const [sets, setSets] = useState<BotCommandSet[]>();
  const [q, setQ] = useState('');
  useEffect(() => { botCommands(login).then(setSets); }, [login]);
  const kw = q.trim().toLowerCase();
  return <Sheet title="Bot-Befehle" onClose={onClose}>
    {!sets ? <Spinner /> : !sets.length ? <div class="empty"><h3>Keine Befehle gefunden</h3><p>Dieser Kanal nutzt weder Nightbot, StreamElements noch Fossabot oder hat dort keine öffentlichen Befehle.</p></div>
      : <>
        <form class="search" onSubmit={e => e.preventDefault()}><input type="search" placeholder="Befehle filtern" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} autocapitalize="off" /></form>
        {sets.map(set => { const cmds = set.commands.filter(c => !kw || c.name.toLowerCase().includes(kw) || c.response.toLowerCase().includes(kw));
          return cmds.length ? <><h3 class="section-title">{set.bot}</h3><div class="list">{cmds.map(c =>
            <button class="list-row cmd" onClick={() => onUse(c.name)}><div><b>{c.name}</b><div class="row-sub">{c.response}</div></div></button>)}</div></> : null; })}
      </>}
  </Sheet>;
}
/** UsernameColorSheet: the 15 named colours every account may use (hex needs Turbo/Prime). */
const CHAT_COLORS: [string, string][] = [['blue', '0000FF'], ['blue_violet', '8A2BE2'], ['cadet_blue', '5F9EA0'], ['chocolate', 'D2691E'], ['coral', 'FF7F50'],
  ['dodger_blue', '1E90FF'], ['firebrick', 'B22222'], ['golden_rod', 'DAA520'], ['green', '008000'], ['hot_pink', 'FF69B4'], ['orange_red', 'FF4500'],
  ['red', 'FF0000'], ['sea_green', '2E8B57'], ['spring_green', '00FF7F'], ['yellow_green', '9ACD32']];
function ColorSheet({ onClose }: { onClose: () => void }) {
  const [pending, setPending] = useState('');
  const [applied, setApplied] = useState('');
  const [err, setErr] = useState('');
  const pick = async (name: string) => {
    if (pending) return;
    setPending(name); setErr('');
    const e = await setChatColor(name);
    setPending(''); setErr(e ?? ''); if (!e) setApplied(name);
  };
  return <Sheet title="Farbe des Benutzernamens" onClose={onClose}>
    <div class="color-grid pad">{CHAT_COLORS.map(([name, hex]) => <button class="color-row" disabled={!!pending} onClick={() => pick(name)}>
      <i style={{ background: '#' + hex }} /><span>{name.replace(/_/g, ' ')}</span>
      {pending === name ? <span class="spinner small" /> : applied === name ? <CI n="seal" size={12} cls="ok" /> : null}</button>)}</div>
    {err && <p class="hint pad warn">{err}</p>}
  </Sheet>;
}
