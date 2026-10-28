// Settings sheet (SettingsView.swift): root menu with coloured icon squares, sub-pages pushed
// inside the sheet, login sheet (device code) and the system log.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { LiveSource } from './twitch';
import { useStore, setSetting, hideChannel, hideCategory, unhideAll, adStatsFor, setAccount, clearHistory, exportBackup, importBackup, backupFileName, ICONS, iconURL, type Settings as SettingsT } from './store';
import { startDeviceLogin, pollDeviceLogin, loadAccountFollows, setChatColor, type DeviceCode } from './account';
import { pop } from './nav';
import { rewards, checkDrops, loadDropCampaigns, log as rewardsLog, type DropCampaign } from './rewards';
import { points, resetPoints } from './points';
import { formatDuration } from './logic';
import { Empty, Spinner, Icon, Sheet, ACCENTS, relDate } from './ui';
import { logs, clearLogs, logLine, LOG_LEVELS, type LogLevel } from './log';
import { PushSettings } from './push';
import { TOP_CODES, langName, deviceLang } from './pages';
import './settings.css';

const DEFAULT_ORDER: LiveSource[] = ['as', 'al', 'eu', 'twitch'];
const SOURCE_NAMES: Record<LiveSource, string> = { as: 'Luminous Asien', al: 'Albanien-Proxy (TTV.LOL)', eu: 'Luminous Europa', twitch: 'Offizielles Twitch (Werbung)' };
const adStatsLabel = ([breaks, sec]: [number, number]) =>
  `${Math.round(sec / 60)} min gemessen · ${breaks} ${breaks === 1 ? 'Werbepause' : 'Werbepausen'}${sec >= 600 ? ` (${(breaks / (sec / 3600)).toFixed(1).replace('.', ',')}/h)` : ''}`;
/** Named chat colours every account may use (ChatMenuSheet.swift); hex only for Turbo/Prime. */
const CHAT_COLORS: [string, string][] = [['blue', '0000FF'], ['blue_violet', '8A2BE2'], ['cadet_blue', '5F9EA0'], ['chocolate', 'D2691E'], ['coral', 'FF7F50'],
  ['dodger_blue', '1E90FF'], ['firebrick', 'B22222'], ['golden_rod', 'DAA520'], ['green', '008000'], ['hot_pink', 'FF69B4'], ['orange_red', 'FF4500'],
  ['red', 'FF0000'], ['sea_green', '2E8B57'], ['spring_green', '00FF7F'], ['yellow_green', '9ACD32']];

type SubPage = 'account' | 'general' | 'player' | 'chat' | 'drops' | 'points' | 'labs' | 'about' | 'logs';
// Settings-app rows: white symbol on a solid system-coloured square.
const MENU: [SubPage, string, string, string][] = [
  ['account', 'Twitch-Konto', 'person', '#af52de'], ['general', 'Allgemein', 'gear', '#8e8e93'], ['player', 'Player', 'playRect', '#007aff'],
  ['chat', 'Chat', 'bubbles', '#34c759'], ['drops', 'Drops', 'box', '#ff3b30'], ['points', 'Kanalpunkte', 'target', '#5856d6'],
  ['labs', 'Funktionen im Test', 'flask', '#ff9500'], ['about', 'Über', 'info', '#8e8e93']];
const TITLES: Record<SubPage, string> = { account: 'Twitch-Konto', general: 'Allgemein', player: 'Player', chat: 'Chat', drops: 'Drops',
  points: 'Kanalpunkte', labs: 'Funktionen im Test', about: 'Über', logs: 'Systemprotokolle' };

// Building blocks (settingCard / label / toggleRow / sliderRow in SettingsView.swift) ------------
function Card({ icon, title, children }: { icon?: string; title?: string; children: ComponentChildren }) {
  return <section class="scard">{title && <div class="scard-label">{icon && <Icon n={icon} size={20} />}<span>{title}</span></div>}{children}</section>;
}
const Div = () => <div class="sdiv" />;
function TRow({ title, sub, value, onChange }: { title: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return <label class="srow"><div class="srow-text"><div class="srow-title">{title}</div>{sub && <div class="srow-sub">{sub}</div>}</div>
    <input type="checkbox" class="switch" checked={value} onChange={e => onChange((e.target as HTMLInputElement).checked)} /></label>;
}
function SliderRow({ title, value, min, max, step, format, onChange }: { title: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return <div class="srow col"><div class="srow-line"><span class="srow-title">{title}</span><span class="srow-sub mono">{format(value)}</span></div>
    <input type="range" min={min} max={max} step={step} value={value} onInput={e => onChange(Number((e.target as HTMLInputElement).value))} /></div>;
}
/** Word/user lists: chips with ✕, a field to add (Enter, comma or leaving the field). */
function ListEditor({ title, sub, items, placeholder, max, onChange }: { title: string; sub: string; items: string[]; placeholder: string; max: number; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const words = draft.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (words.length) onChange([...new Set([...items, ...words])].slice(0, max));
    setDraft('');
  };
  return <div class="srow col"><div class="srow-title">{title}</div><div class="srow-sub">{sub}</div>
    {items.length > 0 && <div class="chips">{items.map(w => <button class="chip small" onClick={() => onChange(items.filter(x => x !== w))}>{w} <Icon n="close" size={12} /></button>)}</div>}
    <form onSubmit={e => { e.preventDefault(); add(); }}>
      <input class="sinput" placeholder={placeholder} value={draft} onInput={e => setDraft((e.target as HTMLInputElement).value)} onBlur={add}
        autocapitalize="off" autocorrect="off" spellcheck={false} enterkeyhint="done" /></form></div>;
}
const Pill = ({ children, onClick, danger, disabled }: { children: ComponentChildren; onClick: () => void; danger?: boolean; disabled?: boolean }) =>
  <button class={'spill' + (danger ? ' danger' : '')} disabled={disabled} onClick={onClick}>{children}</button>;

// Sheet -----------------------------------------------------------------------------------------
export function Settings() {
  const s = useStore();
  const [stack, setStack] = useState<SubPage[]>([]);
  const [login, setLogin] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const page = stack[stack.length - 1];
  const go = (p: SubPage) => setStack(st => [...st, p]);
  const back = () => setStack(st => st.slice(0, -1));
  useEffect(() => { body.current?.scrollTo(0, 0); }, [page]);
  const [copied, setCopied] = useState('');
  const acc = s.account;
  return <div class="sheet-backdrop" onClick={pop}>
    <div class="sheet settings" onClick={e => e.stopPropagation()} role="dialog" aria-label="Einstellungen">
      <div class="sheet-bar">
        {page ? <button class="nav-btn" onClick={back} aria-label="Zurück"><Icon n="back" /></button>
          : <button class="close-btn left" onClick={pop} aria-label="Schließen"><Icon n="close" size={16} /></button>}
        <h3>{page ? TITLES[page] : ''}</h3>
        <span class="sheet-right">{page === 'logs' && <button class="nav-btn text" onClick={() => copyLogs(setCopied)}>{copied || 'Teilen'}</button>}</span>
      </div>
      <div class="sheet-body settings-body" ref={body}>
        {!page && <>
          <h1 class="large-title">Einstellungen</h1>
          <div class="group acc-banner">
            {acc?.avatar ? <img class="acc-avatar" src={acc.avatar} alt="" /> : <span class="acc-avatar placeholder"><Icon n="person" size={60} /></span>}
            <div><div class="acc-login">{acc?.login ?? 'Twitch'}</div><div class="srow-sub">{acc ? 'Verbunden' : 'Nicht angemeldet'}</div></div>
          </div>
          <div class="group">{MENU.map(([p, title, icon, tint]) => <button class="menu-row" onClick={() => go(p)}>
            <span class="menu-icon" style={{ background: tint }}><Icon n={icon} size={17} /></span><span class="menu-title">{title}</span><Icon n="right" size={16} /></button>)}</div>
          <p class="sfooter">Version Web {__APP_VERSION__}</p>
        </>}
        {page === 'account' && <AccountPage onLogin={() => setLogin(true)} />}
        {page === 'general' && <GeneralPage />}
        {page === 'player' && <PlayerPage />}
        {page === 'chat' && <ChatPage />}
        {page === 'drops' && <DropsPage onLogin={() => setLogin(true)} />}
        {page === 'points' && <PointsPage onLogin={() => setLogin(true)} />}
        {page === 'labs' && <LabsPage />}
        {page === 'about' && <AboutPage onLogs={() => go('logs')} />}
        {page === 'logs' && <LogsPage />}
      </div>
    </div>
    {login && <LoginSheet onClose={() => setLogin(false)} />}
  </div>;
}

// Twitch-Konto ----------------------------------------------------------------------------------
function AccountPage({ onLogin }: { onLogin: () => void }) {
  const s = useStore();
  const acc = s.account;
  const logout = () => confirm('Möchtest du dich wirklich abmelden?') && setAccount(null);
  return <Card icon="person" title="Twitch-Konto">
    <div class="srow">
      <span class={'acc-check' + (acc ? ' ok' : '')}><Icon n={acc ? 'checkcircle' : 'circle'} size={22} /></span>
      <div class="srow-text"><div class="srow-title">API-Anmeldung</div><div class={'srow-sub' + (acc ? ' ok' : '')}>{acc ? 'Verbunden' : 'Chat, gefolgte Kanäle und Top'}</div></div>
      <Pill danger={!!acc} onClick={acc ? logout : onLogin}>{acc ? 'Abmelden' : 'Mit Twitch anmelden'}</Pill>
    </div>
    {acc && <button class="srow plain" onClick={() => { setAccount(null); onLogin(); }}>
      <span class="acc-check accent"><Icon n="swap" size={22} /></span>
      <div class="srow-text"><div class="srow-title accent">Konto wechseln</div><div class="srow-sub">Twitch fragt nach deinen Zugangsdaten: Melde dich mit dem anderen Konto an.</div></div>
    </button>}
    <p class="srow-sub pad-top">Login per Code auf twitch.tv/activate (Twitchs TV-Zugang): kein Passwort in dieser App, kein Server.</p>
  </Card>;
}

// Allgemein -------------------------------------------------------------------------------------
function GeneralPage() {
  const s = useStore();
  const st = s.settings;
  const [hidden, setHidden] = useState(false);
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const langs = TOP_CODES.map(c => [c, langName(c)] as const).sort((a, b) => a[1].localeCompare(b[1], 'de'));
  const vodCount = s.history.filter(h => h.kind === 'vod').length;
  const channelCount = new Set(s.history.map(h => h.login)).size;
  // The iOS share sheet ("In Dateien sichern"): an <a download> did nothing in the installed
  // web app (Simulator). Other browsers fall back to the download.
  const download = () => {
    const name = backupFileName();
    const f = new File([exportBackup()], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [f] })) { navigator.share({ files: [f] }).then(() => setMsg('Datei exportiert')).catch(() => {}); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = name; a.click();
    setMsg('Datei exportiert');
  };
  return <>
    <Card>
      <div class="srow">
        <div class="srow-text"><div class="srow-title">Top-Streams</div><div class="srow-sub">Sprache der Streamer. Standardmäßig die Sprache deines Geräts ({langName(deviceLang())}).</div></div>
        <select class="sselect" value={st.topLang} onChange={e => setSetting('topLang', (e.target as HTMLSelectElement).value)}>
          <option value={deviceLang()}>Gerät · {langName(deviceLang())}</option>
          <option value="">Weltweit</option>
          {langs.map(([c, n]) => <option value={c}>{n}</option>)}
        </select>
      </div>
      <Div />
      <TRow title="Startseite als Liste" sub="Kanäle in einer Liste wie auf Twitch (Vorschaubild links) statt in einem Raster" value={st.homeListLayout === 'list'} onChange={v => setSetting('homeListLayout', v ? 'list' : 'grid')} />
      <Div />
      <TRow title="Zuletzt angesehen" sub="Abkürzungen zu den zuletzt geöffneten Kanälen, in der Suche." value={st.showRecentChannels} onChange={v => setSetting('showRecentChannels', v)} />
    </Card>
    <Card icon="eyeSlash" title="Ausgeblendete Kanäle und Kategorien">
      <p class="srow-sub">Sie erscheinen nicht mehr in Top oder in Kategorien. Die Suche findet sie trotzdem, und was du folgst, wird nie ausgeblendet.</p>
      {!s.hiddenChannels.length && !s.hiddenCategories.length ? <p class="srow-sub">Nichts ausgeblendet. Halte einen Stream oder eine Kategorie gedrückt und wähle „Ausblenden“.</p>
        : <button class="srow plain" onClick={() => setHidden(true)}>
          <span class="srow-title grow">Kanäle ({s.hiddenChannels.length}) · Kategorien ({s.hiddenCategories.length})</span><Icon n="right" size={16} /></button>}
    </Card>
    <Card icon="palette" title="Darstellung">
      <div class="srow-title">Akzentfarbe</div>
      <div class="swatches">{ACCENTS.map(([c, label]) => <button class={'accent-dot' + (st.accent === c ? ' on' : '')} style={{ background: c }} aria-label={label} title={label}
        onClick={() => setSetting('accent', c)}>{st.accent === c && <Icon n="check" size={12} />}</button>)}</div>
      <Div />
      <div class="srow-title">App-Symbol</div>
      <div class="icon-tiles">{ICONS.map(([id, label]) => <button class={'icon-tile' + (st.appIcon === id ? ' on' : '')} onClick={() => setSetting('appIcon', id)} aria-label={label}>
        <img src={iconURL(id)} alt="" /><span>{label}</span></button>)}</div>
      <p class="srow-sub">Wirkt beim nächsten Hinzufügen zum Home-Bildschirm: altes Symbol löschen, in Safari neu hinzufügen.</p>
    </Card>
    <Card icon="chart" title="Verlauf">
      <div class="stats">
        <div class="stat"><Icon n="film" size={18} /><b>{vodCount}</b><span>VODs</span></div>
        <div class="stat"><Icon n="person" size={18} /><b>{channelCount}</b><span>Kanäle</span></div>
      </div>
      {(vodCount > 0 || channelCount > 0) && <Pill danger onClick={() => confirm('Verlauf und Fortschritt löschen?') && clearHistory()}><Icon n="trash" size={16} /> Löschen</Pill>}
    </Card>
    <Card icon="backup" title="Sicherung">
      <p class="srow-sub">Exportiere deine gefolgten Kanäle, Kategorien und Einstellungen in eine Datei, um sie anderswo zu importieren (App oder Website).</p>
      <div class="srow-btns">
        <Pill onClick={download}><Icon n="share" size={16} /> Exportieren</Pill>
        <Pill onClick={() => file.current?.click()}><Icon n="download" size={16} /> Importieren</Pill>
      </div>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={async e => {
        const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
        const r = importBackup(await f.text());
        setMsg(r ? `Import abgeschlossen: ${r.added} neue Kanäle, ${r.skipped} schon vorhanden` : 'Diese Datei ist keine TwitchUnblock-Sicherung');
      }} />
      {msg && <p class="srow-sub">{msg}</p>}
    </Card>
    {hidden && <HiddenSheet onClose={() => setHidden(false)} />}
  </>;
}

/** HiddenContentSheet.swift: sections, "Wieder anzeigen" capsules, "Alle wieder anzeigen". */
function HiddenSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const empty = !s.hiddenChannels.length && !s.hiddenCategories.length;
  return <Sheet title="Ausgeblendete Kanäle und Kategorien" onClose={onClose}>
    <p class="hint pad">{empty ? 'Nichts ausgeblendet. Halte einen Stream oder eine Kategorie gedrückt und wähle „Ausblenden“.'
      : 'Sie erscheinen nicht mehr in Top oder in Kategorien. Die Suche findet sie trotzdem, und was du folgst, wird nie ausgeblendet.'}</p>
    {s.hiddenChannels.length > 0 && <><h2 class="section-title">Kanäle ({s.hiddenChannels.length})</h2>
      <div class="group">{s.hiddenChannels.map(l => <div class="row"><span class="srow-title">{s.hiddenInfo[l]?.name ?? l}</span><button class="unhide" onClick={() => hideChannel(l, false)}>Wieder anzeigen</button></div>)}</div></>}
    {s.hiddenCategories.length > 0 && <><h2 class="section-title">Kategorien ({s.hiddenCategories.length})</h2>
      <div class="group">{s.hiddenCategories.map(c => <div class="row"><span class="srow-title">{c.name || c.id}</span><button class="unhide" onClick={() => hideCategory(c, false)}>Wieder anzeigen</button></div>)}</div></>}
    {!empty && <div class="group" style={{ marginTop: 16 }}><button class="row danger" onClick={() => confirm('Alle wieder anzeigen?') && unhideAll()}><Icon n="eye" size={18} /> Alle wieder anzeigen</button></div>}
  </Sheet>;
}

// Player ----------------------------------------------------------------------------------------
function PlayerPage() {
  const s = useStore();
  const st = s.settings;
  const move = (i: number, d: number) => {
    const o = [...st.sourceOrder]; const j = i + d; if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; setSetting('sourceOrder', o);
  };
  const qualities: [string, string][] = [['source', 'Quelle (Original)'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p'], ['160', '160p'], ['audio', 'Nur Audio']];
  if (!qualities.some(q => q[0] === st.quality)) qualities.unshift([st.quality, 'Automatisch']);
  return <Card icon="playRect" title="Videoplayer">
    <TRow title="Modus mit niedriger Latenz" sub="Bleibt so nah wie möglich am Live (wie auf Twitch). Kann bei langsamer Verbindung etwas mehr puffern. Gilt für den nächsten Stream, den du öffnest." value={st.lowLatency} onChange={v => setSetting('lowLatency', v)} />
    <Div />
    <div class="srow col">
      <div class="srow-title">Reihenfolge der Live-Quellen</div>
      <div class="srow-sub">In dieser Reihenfolge versucht: Antwortet eine Quelle nicht, übernimmt die nächste. Offizielles Twitch erst, wenn alle davor gescheitert sind.</div>
      {st.sourceOrder.map((src, i) => <div class="src-row">
        <span class="src-num">{i + 1}</span>
        <div class="srow-text"><div class="srow-title">{SOURCE_NAMES[src]}</div>{adStatsFor(src) && <div class="srow-sub">{adStatsLabel(adStatsFor(src)!)}</div>}</div>
        <button class="src-arrow" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Nach oben"><Icon n="up" size={18} /></button>
        <button class="src-arrow" disabled={i === st.sourceOrder.length - 1} onClick={() => move(i, 1)} aria-label="Nach unten"><Icon n="down" size={18} /></button>
      </div>)}
      {st.sourceOrder.join() !== DEFAULT_ORDER.join() && <button class="link" onClick={() => setSetting('sourceOrder', DEFAULT_ORDER)}>Standardreihenfolge</button>}
    </div>
    <Div />
    <TRow title="Werbepausen überbrücken" sub="Ton aus und automatisch auf einen Ersatz-Stream ohne Werbung wechseln" value={st.adSwitch} onChange={v => setSetting('adSwitch', v)} />
    <Div />
    <TRow title="Nach Werbepausen sortieren" sub="Proxys mit den wenigsten gemessenen Werbepausen zuerst, sobald zwei je 20 Minuten gelaufen sind" value={st.adRanking} onChange={v => setSetting('adRanking', v)} />
    <Div />
    <div class="srow">
      <div class="srow-text"><div class="srow-title">Bevorzugte Qualität</div><div class="srow-sub">Wird beim Start eines Streams oder VODs verwendet. Ist sie nicht verfügbar, wird die nächstniedrigere genommen. Eine im Player gewählte Qualität ersetzt sie.</div></div>
      <select class="sselect" value={st.quality} onChange={e => setSetting('quality', (e.target as HTMLSelectElement).value)}>{qualities.map(([v, l]) => <option value={v}>{l}</option>)}</select>
    </div>
    <Div />
    <TRow title="Bildschirm füllen (Querformat)" sub="Zoomt das Bild im Querformat bis an die Ränder, auf Kosten von oben und unten. Aus: Das ganze Bild wird mit gleichen Balken an den Seiten angezeigt. Keine Wirkung im Hochformat." value={st.fillScreen} onChange={v => setSetting('fillScreen', v)} />
    <Div />
    <TRow title="Chat im Multi-Live" sub="Der Chat des Videos, das du hörst, neben dem Mosaik (Querformat)." value={st.multiLiveChat} onChange={v => setSetting('multiLiveChat', v)} />
  </Card>;
}

// Chat ------------------------------------------------------------------------------------------
function ChatPage() {
  const s = useStore();
  const st = s.settings;
  const set = <K extends keyof SettingsT>(k: K) => (v: SettingsT[K]) => setSetting(k, v);
  const [pending, setPending] = useState('');
  const [applied, setApplied] = useState('');
  const [colorMsg, setColorMsg] = useState('');
  const [hex, setHex] = useState('#9146ff');
  const pick = async (name: string) => {
    if (pending) return;
    setPending(name); setColorMsg('');
    const err = await setChatColor(name);
    setPending(''); setColorMsg(err ?? ''); if (!err) setApplied(name);
  };
  return <>
    <Card icon="bubbles" title="Chat-Verhalten">
      <TRow title="Letzte Nachrichten laden" sub="Twitch sendet nichts von vor deinem Beitritt. Die letzten Zeilen kommen von recent-messages.robotty.de, einem Drittanbieterdienst." value={st.chatLoadRecent} onChange={set('chatLoadRecent')} />
      <Div />
      <TRow title="Autovervollständigung" sub="Schlägt beim Tippen Emotes und Namen vor." value={st.chatAutocomplete} onChange={set('chatAutocomplete')} />
      <Div />
      <TRow title="Gelöschte Nachrichten anzeigen" sub="Behält moderierte Nachrichten durchgestrichen, statt sie zu entfernen." value={st.chatShowDeleted} onChange={set('chatShowDeleted')} />
      <Div />
      <TRow title="Bots ausblenden" sub="Nightbot, StreamElements, Fossabot…" value={st.chatHideBots} onChange={set('chatHideBots')} />
      <Div />
      <TRow title="Befehle ausblenden" sub="Nachrichten, die mit „!“ beginnen." value={st.chatHideCommands} onChange={set('chatHideCommands')} />
      <Div />
      <div class="srow">
        <div class="srow-text"><div class="srow-title">Sync-Anpassung</div><div class="srow-sub">Chat noch vor dem Video? Füg ein paar Sekunden hinzu. Dahinter? Zieh welche ab.</div></div>
        <span class={'stepper-val' + (st.chatSyncNudge ? ' accent' : '')}>{st.chatSyncNudge > 0 ? '+' : ''}{st.chatSyncNudge} s</span>
        <span class="stepper"><button disabled={st.chatSyncNudge <= -20} onClick={() => setSetting('chatSyncNudge', st.chatSyncNudge - 1)} aria-label="Weniger">−</button>
          <button disabled={st.chatSyncNudge >= 20} onClick={() => setSetting('chatSyncNudge', st.chatSyncNudge + 1)} aria-label="Mehr">+</button></span>
      </div>
      <Div />
      <ListEditor title="Stummgeschaltete Wörter" sub="Nachrichten, die sie enthalten, werden nicht angezeigt." items={st.chatMutedWords} placeholder="spoiler" max={50} onChange={set('chatMutedWords')} />
      <Div />
      <ListEditor title="Hervorgehobene Wörter" sub="Nachrichten, die sie enthalten (oder dich erwähnen), werden hervorgehoben." items={st.chatHighlightWords} placeholder="giveaway, turnier" max={30} onChange={set('chatHighlightWords')} />
      <Div />
      <ListEditor title="Blockierte Nutzer" sub="Ihre Nachrichten werden im Chat ausgeblendet." items={st.chatBlockedUsers} placeholder="nutzername" max={500} onChange={set('chatBlockedUsers')} />
    </Card>
    <Card icon="palette" title="Anpassung">
      <TRow title="Angeheftete Nachrichten" sub="Banner für angeheftete Nachrichten anzeigen" value={st.showPinned} onChange={set('showPinned')} />
      <Div />
      <TRow title="Kanal-Drops" sub="Eine Karte oben im Chat, wenn der Kanal Drops hat (ausblendbar)" value={st.showDropsNotice} onChange={set('showDropsNotice')} />
      <Div />
      <TRow title="Zuschauerserie" sub="Dein 🔥-Serien-Abzeichen anzeigen" value={st.showStreak} onChange={set('showStreak')} />
      <Div />
      <TRow title="Umfragen & Vorhersagen" sub="Umfragen, Vorhersagen und Hype Train anzeigen" value={st.showEvents} onChange={set('showEvents')} />
      <Div />
      <TRow title="Raid-System" sub="Banner + automatisch dem geraideten Kanal beitreten" value={st.enableRaids} onChange={set('enableRaids')} />
    </Card>
    <Card icon="textsize" title="Chat-Größen">
      <ChatPreview st={st} />
      <Div />
      <TRow title="Zeitstempel" sub="Zeigt die Uhrzeit vor jeder Nachricht." value={st.chatTimestamps} onChange={set('chatTimestamps')} />
      <Div />
      <SliderRow title="Schriftgröße" value={st.chatFont} min={10} max={20} step={1} format={v => `${v} pt`} onChange={set('chatFont')} />
      <SliderRow title="Nachrichtenabstand" value={st.chatSpacing} min={0} max={8} step={1} format={v => `${v} px`} onChange={set('chatSpacing')} />
      <SliderRow title="Abzeichengröße" value={st.chatBadgeScale} min={0.7} max={1.5} step={0.05} format={v => `${v.toFixed(2)}x`} onChange={set('chatBadgeScale')} />
      <SliderRow title="Emote-Größe" value={st.chatEmoteScale} min={0.7} max={1.5} step={0.05} format={v => `${v.toFixed(2)}x`} onChange={set('chatEmoteScale')} />
      <SliderRow title="Chat-Breite" value={st.chatWidth} min={0.2} max={0.6} step={0.01} format={v => `${Math.round(v * 100)} %`} onChange={set('chatWidth')} />
      <p class="srow-sub">Nur im Querformat.</p>
      <button class="link" onClick={() => { setSetting('chatFont', 13); setSetting('chatSpacing', 4); setSetting('chatBadgeScale', 1); setSetting('chatEmoteScale', 1); setSetting('chatWidth', 0.32); setSetting('chatTimestamps', true); }}>Auf Standard zurücksetzen</button>
    </Card>
    <Card icon="translate" title="Übersetzen">
      <TRow title="Automatisch übersetzen" sub="Fremdsprachige Nachrichten ins Deutsche (Google-Übersetzer)" value={st.chatTranslate} onChange={set('chatTranslate')} />
    </Card>
    {s.account && <Card icon="palette" title="Farbe des Benutzernamens">
      <p class="srow-sub">Ändere deine Farbe im Chat. Freie Farbtöne nimmt Twitch nur mit Turbo oder Prime an.</p>
      <div class="color-grid">{CHAT_COLORS.map(([name, h]) => <button class="color-cell" disabled={!!pending} onClick={() => pick(name)}>
        <i style={{ background: '#' + h }} /><span>{name.replace(/_/g, ' ')}</span>
        {pending === name ? <div class="spinner mini" /> : applied === name && <Icon n="check" size={12} />}</button>)}</div>
      <div class="srow-btns"><input type="color" value={hex} onInput={e => setHex((e.target as HTMLInputElement).value)} />
        <Pill disabled={!!pending} onClick={() => pick(hex)}>Hex setzen</Pill></div>
      {colorMsg && <p class="srow-sub error">{colorMsg}</p>}
    </Card>}
  </>;
}
/** Live preview of the size settings (two sample lines with a real badge and emote). */
function ChatPreview({ st }: { st: SettingsT }) {
  const rows = [['Lewdolas', '#e6e619', 'ça va y’a des sourires'], ['Damonarix', '#ff7f50', 'L’honnêteté d’un Skaven @toi']];
  return <div class="chat-preview" style={{ fontSize: st.chatFont }}>
    {rows.map(([name, color, text], i) => <div class="msg" style={{ padding: `${st.chatSpacing / 2}px 0` }}>
      {st.chatTimestamps && <span class="ts">12:3{i} </span>}
      <img class="badge-img" style={{ width: 18 * st.chatBadgeScale, height: 18 * st.chatBadgeScale }} src="https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1" alt="" />
      <b style={{ color }}>{name}</b>: {text} <img class="emote" style={{ height: 28 * st.chatEmoteScale }} src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0" alt="Kappa" />
    </div>)}
  </div>;
}

// Drops / Kanalpunkte (DropsView.swift, PointsTrackerView.swift) ---------------------------------
const dateShort = (iso?: string) => iso ? new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) : '';
/** One campaign: game · name, link hint, each drop with its progress bar. */
function Campaign({ c, brief }: { c: DropCampaign; brief?: boolean }) {
  return <div class="campaign">
    <div class="srow-title">{c.game} · {c.name}</div>
    {!c.linked && <div class="srow-sub warn">Spielkonto fehlt{c.linkURL && <> · <a href={c.linkURL} target="_blank" rel="noopener">Verknüpfen</a></>}</div>}
    {brief && <div class="srow-sub">{c.upcoming ? `Beginnt ${dateShort(c.startAt)}` : `Endet ${dateShort(c.endAt)}`} · {c.drops.map(d => `${d.required} Min.`).join(', ')}</div>}
    {!brief && c.drops.map(d => <div class="drop"><div class="srow-sub">{d.claimed ? 'Abgeholt' : `${Math.min(d.current, d.required)} / ${d.required} Min.`} · {d.name}</div>
      <div class="progress inline"><div style={{ width: `${Math.min(100, d.current / Math.max(1, d.required) * 100)}%` }} /></div></div>)}
  </div>;
}
function DropsPage({ onLogin }: { onLogin: () => void }) {
  const s = useStore();
  const st = s.settings;
  // Like the iOS page: inventory and every open campaign are re-read when the page opens.
  useEffect(() => { if (s.account) { checkDrops(); loadDropCampaigns(); } }, [s.account?.userId]);
  if (!s.account) return <Card icon="box" title="Drops">
    <p class="srow-sub">Drops laufen über dein Twitch-Konto, wie Kanalpunkte: Melde dich einmal an.</p>
    <Pill onClick={onLogin}>Mit Twitch anmelden</Pill></Card>;
  const ready = rewards.drops.filter(c => c.linked), waiting = rewards.drops.filter(c => !c.linked);
  const started = new Set(rewards.drops.map(c => c.id));
  // Open campaigns: the ones with progress first, then running before upcoming.
  const touched = (c: DropCampaign) => c.drops.some(d => d.claimed || d.current > 0);
  const open = rewards.available.filter(c => !started.has(c.id))
    .sort((a, b) => Number(touched(b)) - Number(touched(a)) || Number(a.upcoming) - Number(b.upcoming));
  const ds = rewards.dropSession;
  return <>
    <Card icon="box" title="Drops">
      <TRow title="Drops automatisch abholen" sub="Sobald ein Drop fertig ist, holt die App ihn für dich ab (während eines Lives alle 5 Min. geprüft und wenn du diese Seite öffnest)." value={st.autoDrops} onChange={v => setSetting('autoDrops', v)} />
      <Div />
      <TRow title="Drop-Fortschritt im Hintergrund" sub="Lädt bei Kanälen mit Drops einen unsichtbaren zweiten Stream in niedriger Qualität (mehr Datenverbrauch)" value={st.dropsStream} onChange={v => setSetting('dropsStream', v)} />
      <Div />
      <Pill onClick={() => { checkDrops(true); loadDropCampaigns(); }}>Drops jetzt prüfen</Pill>
    </Card>
    {ds && <Card icon="target" title={`Fortschritt auf ${ds.channel || '—'}`}>
      <div class="srow-sub">{Math.min(ds.current, ds.required)} / {ds.required} Min.</div>
      <div class="progress inline"><div style={{ width: `${Math.min(100, ds.current / Math.max(1, ds.required) * 100)}%` }} /></div>
    </Card>}
    <Card icon="gift" title="Laufende Kampagnen">
      {!rewards.drops.length ? <p class="srow-sub">Keine Drops in Arbeit. Schau ein Live mit Drops (Tag „DropsEnabled“), um welche zu verdienen.</p>
        : <>
          {ready.map(c => <Campaign c={c} />)}
          {waiting.length > 0 && <details class="fold"><summary class="srow-title">Verknüpfung fehlt ({waiting.length})</summary>{waiting.map(c => <Campaign c={c} />)}</details>}
        </>}
    </Card>
    <Card icon="box" title="Offene Kampagnen">
      <p class="srow-sub">Alle aktuell laufenden Kampagnen: Schau ein Live des Spiels (Tag „DropsEnabled“), damit sie zu „Laufende Kampagnen“ wandern.</p>
      {!open.length ? <p class="srow-sub">{rewards.available.length ? 'Gerade keine weitere offene Kampagne.' : 'Twitch gibt die Liste für diesen Login nicht frei.'}</p>
        : open.map(c => <Campaign c={c} brief />)}
    </Card>
  </>;
}
/** PointsTrackerPanel: what watching earned, now, in total and per channel (points.ts). */
function PointsPage({ onLogin }: { onLogin: () => void }) {
  const s = useStore();
  const sessions = Object.values(points.sessions).sort((a, b) => a.start - b.start);
  const channels = Object.values(points.channels).sort((a, b) => b.last - a.last);
  const n = (v: number) => v.toLocaleString('de-DE');
  const mins = (m: number) => m ? formatDuration(m * 60) : '0min';
  return <>
    <Card icon="gift" title="Truhen automatisch abholen">
      <TRow title="Truhen automatisch abholen" sub="Sammelt Punkte-Truhen ein, sobald sie erscheinen." value={s.settings.autoPoints} onChange={v => setSetting('autoPoints', v)} />
    </Card>
    {!s.account && <Card><p class="srow-sub">Punkte werden mit angemeldetem Konto verdient und gezählt (wie Drops).</p><Pill onClick={onLogin}>Mit Twitch anmelden</Pill></Card>}
    {sessions.length > 0 && <Card icon="antenna" title="Gerade">
      {sessions.map(x => <div class="srow"><span class="srow-title grow">{x.login}</span><span class="srow-sub mono">{mins(x.minutes)} · +{n(x.points)}</span></div>)}
    </Card>}
    <Card>
      <div class="srow-line"><span class="scard-label" style={{ margin: 0 }}>Gesamt</span>
        {points.since && <span class="srow-sub">seit {new Date(points.since).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}</div>
      <div class="stats">
        <div class="stat"><Icon n="clock" size={18} /><b>{mins(points.totalMinutes)}</b><span>Geschaut</span></div>
        <div class="stat"><Icon n="target" size={18} /><b>+{n(points.totalPoints)}</b><span>Verdient</span></div>
        <div class="stat"><Icon n="gift" size={18} /><b>{n(points.totalChests)}</b><span>Truhen</span></div>
      </div>
    </Card>
    <Card icon="target" title="Nach Kanal">
      {!channels.length ? <p class="srow-sub">Noch nichts gezählt: Schau einen Livestream mit angemeldetem Konto.</p>
        : channels.map(c => <div class="srow">
          <div class="srow-text"><div class="srow-title">{c.login}</div><div class="srow-sub">{relDate(new Date(c.last).toISOString())}</div></div>
          <div class="pt-right"><span class="points">+{n(c.points)}</span><span class="srow-sub mono">{mins(c.minutes)}{c.chests > 0 ? ` · 🎁 ${c.chests}` : ''}</span></div>
        </div>)}
    </Card>
    <p class="srow-sub pad">Auf diesem Gerät gezählt, solange du angemeldet bist: die Minuten, die Twitch für Punkte zählt, und die beim Zuschauen verdienten Punkte (passiv, Serien, Truhen), keine Gewinne aus Vorhersagen.</p>
    {channels.length > 0 && <div class="pad"><Pill danger onClick={() => confirm('Gezählte Zeit und Punkte löschen?') && resetPoints()}>Zurücksetzen</Pill></div>}
  </>;
}

// Funktionen im Test ----------------------------------------------------------------------------
function LabsPage() {
  const s = useStore();
  const [result, setResult] = useState('');
  const notify = async (on: boolean) => {
    if (on && 'Notification' in window && await Notification.requestPermission() !== 'granted') { setResult('Benachrichtigungen abgelehnt: Erlaube sie in den iOS-Einstellungen → TwitchUnblock.'); return; }
    setSetting('notifyLive', on);
  };
  const test = async () => {
    if (!('Notification' in window)) return setResult('Dieses Gerät unterstützt keine Mitteilungen.');
    if (await Notification.requestPermission() !== 'granted') return setResult('Benachrichtigungen abgelehnt: Erlaube sie in den iOS-Einstellungen → TwitchUnblock.');
    const reg = await navigator.serviceWorker?.ready.catch(() => undefined);
    const opts = { body: 'Benachrichtigungen funktionieren 🎉' };
    if (typeof reg?.showNotification === 'function') reg.showNotification('TwitchUnblock', opts); else new Notification('TwitchUnblock', opts);
    setResult('Gesendet: Sie kommt gleich an (verlass die App, um sie wie eine echte zu sehen).');
  };
  return <>
    <Card icon="flask" title="Funktionen im Test">
      <p class="srow-sub">Neue Funktionen, an denen noch gefeilt wird: Sie können sich ändern oder Fehler machen.</p>
      <TRow title="Live-Benachrichtigungen" sub="Werde benachrichtigt, wenn ein gefolgter Kanal live geht, solange die App offen ist. Bei geschlossener App: „Mitteilungen im Hintergrund“ unten." value={s.settings.notifyLive} onChange={notify} />
      {s.settings.notifyLive && <Pill onClick={test}><Icon n="bell" size={16} /> Testbenachrichtigung senden</Pill>}
      {result && <p class="srow-sub">{result}</p>}
    </Card>
    <PushSettings />
  </>;
}

// Über ------------------------------------------------------------------------------------------
function AboutPage({ onLogs }: { onLogs: () => void }) {
  useStore();
  const link = (title: string, url: string) => <a class="credit-link" href={url} target="_blank" rel="noopener"><Icon n="arrowUpRight" size={14} /><span>{title}</span></a>;
  return <Card icon="info" title="Info">
    <div class="srow"><div class="srow-text"><div class="about-name">TwitchUnblock</div><div class="srow-sub">Version Web {__APP_VERSION__}</div></div><span class="accent-dot big" /></div>
    <p class="srow-sub">Twitch-VODs und Livestreams ohne Abo in voller Qualität ansehen. Nichts einzurichten.</p>
    <p class="made-by">Erstellt von <a href="https://github.com/MXFia19" target="_blank" rel="noopener">MXFia19</a> <span class="srow-sub">(MIT-Lizenz)</span></p>
    {link('Quellcode der App', 'https://github.com/timmbrockerhoff/TwitchUnblock')}
    {link('Was die Web-App nicht kann', 'https://github.com/timmbrockerhoff/TwitchUnblock/blob/pwa/pwa/LIMITATIONS.md')}
    <p class="srow-sub dim">Unabhängiges Projekt, nicht mit Twitch verbunden.</p>
    <button class="srow plain accent" onClick={onLogs}><Icon n="terminal" size={18} /><span class="grow">Systemprotokolle anzeigen</span><span class="count-badge">{logs.length}</span></button>
  </Card>;
}

// Login -----------------------------------------------------------------------------------------
export function LoginSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<DeviceCode>();
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    startDeviceLogin().then(async c => {
      setCode(c);
      const acc = await pollDeviceLogin(c, () => cancelled);
      if (cancelled) return;
      if (acc) { setAccount(acc); rewardsLog(`Angemeldet als ${acc.login}`, true); loadAccountFollows(); checkDrops(true); onClose(); }
      else setErr('Der Code ist abgelaufen. Bitte erneut versuchen.');
    }).catch(e => setErr('Anmeldung fehlgeschlagen: ' + e.message));
    return () => { cancelled = true; };
  }, []);
  return <Sheet title="Mit Twitch anmelden" onClose={onClose}>
    {err ? <p class="error">{err}</p> : !code ? <Spinner /> : <div class="login">
      <p>Öffne twitch.tv/activate, melde dich dort an und gib diesen Code ein:</p>
      <div class="code" onClick={() => navigator.clipboard?.writeText(code.user_code)}>{code.user_code}</div>
      <a class="btn prominent wide" href={code.verification_uri} target="_blank" rel="noopener">twitch.tv/activate öffnen</a>
      <p class="hint">Warte auf Bestätigung … Danach kehrst du einfach hierher zurück.</p>
    </div>}
  </Sheet>;
}

// Systemprotokolle (LogsView.swift): level + category filter, share/copy ---------------------------
const LEVEL_NAMES: Record<LogLevel, string> = { debug: 'Debug', info: 'Info', success: 'Erfolg', warn: 'Warnung', error: 'Fehler' };
let logFilter: { level: LogLevel | ''; cat: string } = { level: '', cat: '' };
const shownLogs = () => logs.filter(l => (!logFilter.cat || l.cat === logFilter.cat) && (!logFilter.level || l.level === logFilter.level));
// Share sheet first (iOS), clipboard elsewhere.
function copyLogs(done: (msg: string) => void) {
  const text = shownLogs().map(logLine).join('\n');
  if (!text) return;
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  navigator.clipboard?.writeText(text).then(() => { done('Kopiert'); setTimeout(() => done(''), 1500); });
}
export function LogsPage() {
  useStore();
  const [, rerender] = useState(0);
  const setF = (f: Partial<typeof logFilter>) => { logFilter = { ...logFilter, ...f }; rerender(x => x + 1); };
  const cats = [...new Set(logs.map(l => l.cat))].sort();
  const shown = shownLogs();
  const levels: [LogLevel | '', string][] = [['', `Alle (${logs.length})`], ...LOG_LEVELS.map(l => [l, LEVEL_NAMES[l]] as [LogLevel, string])];
  return <>
    <div class="chips pad">{levels.map(([v, l]) => <button class={'chip small' + (logFilter.level === v ? ' on' : '')} onClick={() => setF({ level: v })}>{l}</button>)}</div>
    {cats.length > 1 && <div class="chips pad">{[['', 'Alle Kategorien'], ...cats.map(c => [c, c])].map(([v, l]) =>
      <button class={'chip small' + (logFilter.cat === v ? ' on' : '')} onClick={() => setF({ cat: v })}>{l}</button>)}</div>}
    {!shown.length ? <Empty title="Keine Einträge" text="Kanalpunkte, Drops, Player-Quellen und Chat-Verbindungen erscheinen hier." />
      : <div class="group">{shown.map(l => <div class={'row log-row ' + l.level}>
        <div><div>{l.text}</div>{l.detail && <div class="row-sub detail">{l.detail}</div>}
          <div class="row-sub">{l.cat} · {LEVEL_NAMES[l.level]} · {new Date(l.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div></div></div>)}</div>}
    {logs.length > 0 && <div class="group" style={{ marginTop: 20 }}><button class="row danger" onClick={() => confirm('Protokoll löschen?') && clearLogs()}>Protokoll löschen</button></div>}
  </>;
}
