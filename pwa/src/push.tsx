// Live notifications while the app is closed: Web Push sent by .github/workflows/live-push.yml.
// No server of our own, so the subscription reaches the workflow as a GitHub secret the user pastes.
import { useEffect, useState } from 'preact/hooks';
import { useStore } from './store';

// Public half of the VAPID pair (repo variable VAPID_PUBLIC_KEY, injected by pages.yml).
const KEY: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';
const SECRETS_URL = 'https://github.com/timmbrockerhoff/TwitchUnblock/settings/secrets/actions';

const installed = () => (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
const keyBytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export function PushSettings() {
  const s = useStore();
  const [sub, setSub] = useState<PushSubscriptionJSON>();
  const [msg, setMsg] = useState('');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  useEffect(() => {
    if (supported) navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(x => x && setSub(x.toJSON())).catch(() => {});
  }, []);

  // Must start from the tap: iOS only shows the permission prompt for a user gesture.
  const subscribe = async (renew: boolean) => {
    setMsg('');
    if (await Notification.requestPermission() !== 'granted') { setMsg('Mitteilungen sind für diese App nicht erlaubt (iOS-Einstellungen → Mitteilungen).'); return; }
    try {
      const pm = (await navigator.serviceWorker.ready).pushManager;
      // A subscription made with another key (or one the push service dropped) can't be reused.
      const old = await pm.getSubscription();
      if (old && renew) await old.unsubscribe();
      const opts = { userVisibleOnly: true, applicationServerKey: keyBytes(KEY) };
      const x = await pm.subscribe(opts).catch(async () => { await (await pm.getSubscription())?.unsubscribe(); return pm.subscribe(opts); });
      setSub(x.toJSON());
    } catch (e) { setMsg(`Einrichten fehlgeschlagen: ${(e as Error).message}`); }
  };

  // Regenerated on every render, so it always matches the current follows.
  const channels = [...new Set([...s.follows, ...s.accountFollows])].filter(l => !s.hiddenChannels.includes(l)).sort();
  const json = sub ? JSON.stringify([{ subscription: sub, channels }]) : '';
  const copy = () => navigator.clipboard.writeText(json).then(() => setMsg('Kopiert.'), () => setMsg('Kopieren ging nicht: Text oben markieren und kopieren.'));

  return <>
    <h2 class="section-title">Mitteilungen im Hintergrund</h2>
    {!KEY ? <p class="hint pad">Noch nicht eingerichtet: Im GitHub-Repo fehlt die Variable VAPID_PUBLIC_KEY. Danach die Web-App neu bauen lassen.</p>
    : !installed() ? <p class="hint pad">Geht nur in der installierten App (ab iOS 16.4): in Safari „Teilen“ → „Zum Home-Bildschirm“ und die App von dort öffnen.</p>
    : !supported ? <p class="hint pad">Dieses Gerät unterstützt keinen Web Push.</p>
    : !sub ? <>
      <div class="group"><button class="row accent" onClick={() => subscribe(false)}>Live-Mitteilungen einrichten</button></div>
      <p class="hint pad">Meldet, wenn ein gefolgter Kanal live geht, auch wenn die App geschlossen ist. Ein GitHub-Workflow prüft das alle paar Minuten.</p>
    </> : <>
      <div class="group">
        <div class="row"><code style={{ display: 'block', fontSize: 11, wordBreak: 'break-all', userSelect: 'all', maxHeight: 96, overflow: 'auto' }}>{json}</code></div>
        <button class="row accent" onClick={copy}>Kopieren</button>
        <button class="row" onClick={() => subscribe(true)}>Neues Abo erzeugen</button>
      </div>
      <ol class="hint pad" style={{ paddingLeft: 34 }}>
        <li>Auf „Kopieren“ tippen ({channels.length} gefolgte Kanäle).</li>
        <li>Auf GitHub die <a href={SECRETS_URL} target="_blank" rel="noopener">Repository-Secrets</a> öffnen (Settings → Secrets and variables → Actions).</li>
        <li>Beim ersten Mal „New repository secret“, Name <b>PUSH_SUBSCRIPTIONS</b>, Text einfügen, „Add secret“. Sonst beim vorhandenen PUSH_SUBSCRIPTIONS den Stift antippen, Inhalt ersetzen, „Update secret“.</li>
        <li>Nach neuen Follows oder Entfolgen hier wieder kopieren und das Secret ersetzen.</li>
      </ol>
      <p class="hint pad">Die Mitteilung kommt meist 5 bis 15 Minuten nach Streamstart, weil GitHub die Prüfung nicht pünktlich startet. Mehrere Geräte: die Einträge aus den eckigen Klammern beider Geräte in eine Liste setzen, getrennt durch Komma. Bleibt alles still, im Workflow-Protokoll nach „gone“ suchen und hier ein neues Abo erzeugen.</p>
    </>}
    {msg && <p class="hint pad">{msg}</p>}
  </>;
}
