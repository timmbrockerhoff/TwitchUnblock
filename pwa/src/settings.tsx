// Settings sheet, login sheet and system log (SettingsView.swift / LogsView.swift counterparts).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { LiveSource } from './twitch';
import { useStore, setSetting, hideChannel, hideCategory, adStatsFor, setAccount, clearHistory, exportBackup, importBackup, ICONS, iconURL } from './store';
import { startDeviceLogin, pollDeviceLogin, loadAccountFollows, setChatColor, type DeviceCode } from './account';
import { push } from './nav';
import { rewards, checkDrops, log as rewardsLog } from './rewards';
import { Page, Empty, Spinner, Icon, Sheet, Toggle, Select } from './ui';
import { logs, clearLogs, logLine } from './log';
import { PushSettings } from './push';

const adStatsLabel = ([breaks, sec]: [number, number]) =>
  `${Math.round(sec / 60)} min gemessen · ${breaks} ${breaks === 1 ? 'Werbepause' : 'Werbepausen'}${sec >= 600 ? ` (${(breaks / (sec / 3600)).toFixed(1).replace('.', ',')}/h)` : ''}`;
const SOURCE_NAMES: Record<LiveSource, string> = { as: 'Luminous Asien', al: 'Proxy Albanien (TTV.LOL)', eu: 'Luminous Europa', twitch: 'Twitch offiziell (mit Werbung)' };
export function Settings() {
  const s = useStore();
  const st = s.settings;
  const [login, setLogin] = useState(false);
  const [color, setColor] = useState('#9146ff');
  const [colorMsg, setColorMsg] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const move = (i: number, d: number) => {
    const o = [...st.sourceOrder]; const j = i + d; if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; setSetting('sourceOrder', o);
  };
  // The iOS share sheet ("In Dateien sichern"): an <a download> did nothing in the installed
  // web app (Simulator). Other browsers fall back to the download.
  const download = () => {
    const name = `TwitchUnblock-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([exportBackup()], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file] }).catch(() => {}); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; a.click();
  };
  const notify = async (on: boolean) => {
    if (on && 'Notification' in window) { const p = await Notification.requestPermission(); if (p !== 'granted') return; }
    setSetting('notifyLive', on);
  };
  return <Page title="Einstellungen" back>
    <h2 class="section-title">Konto</h2>
    <div class="group">
      {s.account ? <>
        <div class="row"><div class="acc"><img class="avatar sm" src={s.account.avatar} alt="" /><div><div>{s.account.name}</div><div class="row-sub">Verbunden · {s.accountFollows.length} Twitch-Follows</div></div></div></div>
        <button class="row danger" onClick={() => confirm('Möchtest du dich wirklich abmelden?') && setAccount(null)}>Abmelden</button>
      </> : <button class="row accent" onClick={() => setLogin(true)}>Mit Twitch anmelden</button>}
    </div>
    <p class="hint pad">Ein Login per Code auf twitch.tv/activate (Twitchs TV-Zugang): kein Passwort in dieser App, kein Server. Damit: Chatten, Folgen auf Twitch, Kanalpunkte, Drops.</p>

    {s.account && <><h2 class="section-title">Kanalpunkte &amp; Drops</h2>
    <div class="group">
      <Toggle label="Truhen automatisch einlösen" value={st.autoPoints} onChange={v => setSetting('autoPoints', v)} />
      <Toggle label="Drops automatisch einlösen" value={st.autoDrops} onChange={v => setSetting('autoDrops', v)} />
      <Toggle label="Drops-Fortschritt sammeln" sub="Lädt bei Kanälen mit Drops einen unsichtbaren zweiten Stream in niedriger Qualität (mehr Datenverbrauch)" value={st.dropsStream} onChange={v => setSetting('dropsStream', v)} />
      <button class="row accent" onClick={() => checkDrops(true)}>Drops jetzt prüfen</button>
    </div>
    <p class="hint pad">Punkte und Drops gibt es, solange ein Live-Stream in der App läuft.</p></>}
    {rewards.drops.length > 0 && <div class="group">{rewards.drops.map(c => <div class="row"><div style={{ flex: 1 }}>
      <div>{c.game} · {c.name}</div>
      {!c.linked && <div class="row-sub">Spielkonto nicht verknüpft{c.linkURL && <> · <a href={c.linkURL} target="_blank" rel="noopener">verknüpfen</a></>}</div>}
      {c.drops.map(d => <div class="row-sub">{d.claimed ? '✓' : `${Math.min(d.current, d.required)}/${d.required} min`} · {d.name}
        <div class="progress inline"><div style={{ width: `${Math.min(100, d.current / Math.max(1, d.required) * 100)}%` }} /></div></div>)}
    </div></div>)}</div>}

    <h2 class="section-title">Videoplayer</h2>
    <div class="group">
      <Select label="Bevorzugte Qualität" value={st.quality} onChange={v => setSetting('quality', v)}
        options={[['auto', 'Automatisch'], ['source', 'Source'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p'], ['160', '160p'], ['audio', 'Nur Audio']]} />
      <Toggle label="Niedrige Latenz" value={st.lowLatency} onChange={v => setSetting('lowLatency', v)} />
      <Toggle label="Bildschirm füllen" sub="Im Querformat: Bild füllt die Fläche (Ränder abgeschnitten); auch per Auseinanderziehen" value={st.fillScreen} onChange={v => setSetting('fillScreen', v)} />
      <Toggle label="Werbepausen überbrücken" sub="Ton aus und automatisch auf einen Ersatz-Stream ohne Werbung wechseln" value={st.adSwitch} onChange={v => setSetting('adSwitch', v)} />
    </div>
    <h2 class="section-title">Reihenfolge der Live-Quellen</h2>
    <div class="group">{st.sourceOrder.map((src, i) => <div class="row"><div><div>{i + 1}. {SOURCE_NAMES[src]}</div>{adStatsFor(src) && <div class="row-sub">{adStatsLabel(adStatsFor(src)!)}</div>}</div>
      <span><button class="nav-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Nach oben">↑</button><button class="nav-btn" disabled={i === st.sourceOrder.length - 1} onClick={() => move(i, 1)} aria-label="Nach unten">↓</button></span></div>)}</div>
    <div class="group"><Toggle label="Nach Werbepausen sortieren" sub="Proxys mit den wenigsten gemessenen Werbepausen zuerst, sobald zwei je 20 Minuten gelaufen sind" value={st.adRanking} onChange={v => setSetting('adRanking', v)} /></div>
    <p class="hint pad">Die Proxys werden zeitversetzt parallel probiert, Twitch offiziell erst, wenn alle davor gescheitert sind. Nur bei den Proxys gibt es eine Qualitätsauswahl (siehe Info).</p>

    <h2 class="section-title">Chat</h2>
    <div class="group">
      <Select label="Schriftgröße" value={st.chatFont} onChange={v => setSetting('chatFont', v)} options={[[13, 'Klein'], [15, 'Normal'], [17, 'Groß'], [20, 'Sehr groß']]} />
      <Toggle label="Zeitstempel" value={st.chatTimestamps} onChange={v => setSetting('chatTimestamps', v)} />
      <Toggle label="Gelöschte Nachrichten zeigen" value={st.chatShowDeleted} onChange={v => setSetting('chatShowDeleted', v)} />
      <Toggle label="Bots und !Befehle ausblenden" value={st.chatHideBots} onChange={v => setSetting('chatHideBots', v)} />
      <Toggle label="Automatisch übersetzen" sub="Fremdsprachige Nachrichten ins Deutsche (Google-Übersetzer)" value={st.chatTranslate} onChange={v => setSetting('chatTranslate', v)} />
    </div>
    {s.account && <><div class="group"><div class="row"><span>Namensfarbe</span><span><input type="color" value={color} onInput={e => setColor((e.target as HTMLInputElement).value)} />
      <button class="btn small" onClick={async () => setColorMsg((await setChatColor(color)) ?? 'Gespeichert')}>Setzen</button></span></div></div>
      {colorMsg && <p class="hint pad">{colorMsg}</p>}</>}

    <h2 class="section-title">Darstellung</h2>
    <div class="group"><div class="row"><span>Akzentfarbe</span><span class="swatches">{['#9146ff', '#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#64d2ff'].map(c =>
      <button class={'swatch' + (st.accent === c ? ' on' : '')} style={{ background: c }} onClick={() => setSetting('accent', c)} aria-label={c} />)}</span></div>
      <div class="row"><div style={{ flex: 1 }}><div>App-Symbol</div><div class="swatches" style={{ flexWrap: 'wrap', marginTop: 10 }}>{ICONS.map(([id, label]) =>
        <button class={'swatch' + (st.appIcon === id ? ' on' : '')} style={{ width: 48, height: 48, borderRadius: 11, background: `center / cover url(${iconURL(id)})` }}
          onClick={() => setSetting('appIcon', id)} aria-label={label} title={label} />)}</div></div></div></div>
    <p class="hint pad">Wirkt beim nächsten Hinzufügen zum Home-Bildschirm: altes Symbol löschen, in Safari neu hinzufügen.</p>

    <h2 class="section-title">Mitteilungen</h2>
    <div class="group"><Toggle label="Live-Mitteilungen" sub="Solange die App offen ist. Bei geschlossener App: „Mitteilungen im Hintergrund“ unten." value={st.notifyLive} onChange={notify} /></div>
    <PushSettings />

    {(s.hiddenChannels.length > 0 || s.hiddenCategories.length > 0) && <><h2 class="section-title">Ausgeblendet</h2>
      <div class="group">{s.hiddenChannels.map(l => <div class="row"><span>{l}</span><button class="link" onClick={() => hideChannel(l, false)}>Einblenden</button></div>)}
        {s.hiddenCategories.map(c => <div class="row"><span>{c.name}</span><button class="link" onClick={() => hideCategory(c, false)}>Einblenden</button></div>)}</div></>}

    <h2 class="section-title">Daten</h2>
    <div class="group">
      <button class="row accent" onClick={download}>Sicherung exportieren</button>
      <button class="row accent" onClick={() => file.current?.click()}>Sicherung importieren</button>
      <button class="row danger" onClick={() => confirm('Verlauf und Fortschritt löschen?') && clearHistory()}>Verlauf löschen</button>
    </div>
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={async e => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      setImportMsg(importBackup(await f.text()) ? 'Sicherung geladen.' : 'Keine gültige Sicherungsdatei.');
    }} />
    {importMsg && <p class="hint pad">{importMsg}</p>}

    <h2 class="section-title">Info</h2>
    <div class="group"><button class="row" onClick={() => push({ name: 'logs' })}><span>Systemprotokoll</span><span class="row-sub">{logs.length} Einträge ›</span></button></div>
    <div class="group about">
      <div class="row"><span>Version</span><span class="row-sub">Web {__APP_VERSION__}</span></div>
      <a class="row" href="https://github.com/timmbrockerhoff/TwitchUnblock" target="_blank" rel="noopener">Quellcode (GitHub)</a>
      <a class="row" href="https://github.com/MXFia19/TwitchUnblock" target="_blank" rel="noopener">Original-App von MXFia19 (MIT-Lizenz)</a>
      <a class="row" href="https://github.com/timmbrockerhoff/TwitchUnblock/blob/pwa/pwa/LIMITATIONS.md" target="_blank" rel="noopener">Was die Web-App nicht kann</a>
    </div>
    <p class="hint pad">Basiert auf TwitchUnblock von MXFia19 (MIT-Lizenz). Nicht mit Twitch verbunden.</p>
    {login && <LoginSheet onClose={() => setLogin(false)} />}
  </Page>;
}

function LoginSheet({ onClose }: { onClose: () => void }) {
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

/** System log (LogsView.swift): filter by category, copy as text. */
export function LogsPage() {
  useStore();
  const [cat, setCat] = useState('');
  const [msg, setMsg] = useState('');
  const cats = [...new Set(logs.map(l => l.cat))].sort();
  const shown = cat ? logs.filter(l => l.cat === cat) : logs;
  // Clipboard first; the share sheet when Safari refuses it.
  const copy = () => {
    const text = shown.map(logLine).join('\n');
    const share = () => { navigator.share?.({ text }).catch(() => {}); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => setMsg('Kopiert'), share); else share();
  };
  return <Page title="Systemprotokoll" back trailing={<button class="nav-btn" onClick={copy} disabled={!shown.length}>{msg || 'Kopieren'}</button>}>
    {cats.length > 1 && <div class="chips pad">{[['', `Alle (${logs.length})`], ...cats.map(c => [c, c])].map(([v, l]) =>
      <button class={'chip' + (cat === v ? ' on' : '')} onClick={() => setCat(v)}>{l}</button>)}</div>}
    {!shown.length ? <Empty title="Keine Einträge" text="Kanalpunkte, Drops, Player-Quellen und Chat-Verbindungen erscheinen hier." />
      : <div class="group">{shown.map(l => <div class={'row log-row' + (l.ok === true ? ' ok' : l.ok === false ? ' fail' : '')}>
        <div><div>{l.text}</div><div class="row-sub">{l.cat} · {new Date(l.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div></div></div>)}</div>}
    {logs.length > 0 && <div class="group" style={{ marginTop: 20 }}><button class="row danger" onClick={() => confirm('Protokoll löschen?') && clearLogs()}>Protokoll löschen</button></div>}
  </Page>;
}
