import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import './style.css';
import { useStore, loadDB, applyAccent, applyIcon } from './store';
import { nav, current, setTab, play, openChannel, type Tab } from './nav';
import { Home, Browse, Library, RoutePage } from './pages';
import { PlayerHost } from './player';
import { Icon } from './ui';
import { NoticeHost } from './notices';
import { checkDrops } from './rewards';
import { helix } from './account';
import { TV_CLIENT_ID } from './twitch';
import { state, setAccount } from './store';
import { clipSlugFromInput, extractVodId, isVodInput, loginFromInput, isValidLogin, vodStartFromInput } from './logic';

// Safari ignores user-scalable=no; cancelling gesturestart stops page pinch-zoom. The player's
// pinch-to-fill still gets gestureend.
document.addEventListener('gesturestart', e => e.preventDefault());

function App() {
  useStore();
  useEffect(openFromURL, []); // after the store listener is registered
  const r = current();
  const root = { home: <Home />, browse: <Browse />, library: <Library /> }[nav.tab];
  const tabs: [Tab, string, string][] = [['home', 'home', 'Startseite'], ['browse', 'browse', 'Durchsuchen'], ['library', 'library', 'Meine VODs']];
  return <>
    <main class={nav.player && !nav.playerMin ? 'behind' : ''}>{r.name === 'root' ? root : <RoutePage r={r} />}</main>
    <PlayerHost />
    <NoticeHost />
    <nav class="tabbar">{tabs.map(([t, icon, label]) =>
      <button class={nav.tab === t ? 'on' : ''} onClick={() => setTab(t)}><Icon n={icon} size={24} /><span>{label}</span></button>)}</nav>
  </>;
}

/** Shared links: ?u=<twitch link> (share target / bookmarklet) or #/live/<login>, #/vod/<id>, #/clip/<slug>, #/channel/<login>, #/multi/<a>,<b>. */
function openFromURL() {
  const p = new URLSearchParams(location.search);
  const shared = p.get('u') ?? p.get('text') ?? p.get('url');
  const [, kind, arg] = location.hash.match(/^#\/(live|vod|clip|channel|multi)\/(.+)$/) ?? [];
  if (kind === 'live') play({ kind: 'live', login: arg });
  else if (kind === 'vod') play({ kind: 'vod', id: arg });
  else if (kind === 'clip') play({ kind: 'clip', slug: arg });
  else if (kind === 'channel') openChannel(arg);
  else if (kind === 'multi') play({ kind: 'multi', logins: arg.split(',').slice(0, 4) });
  else if (shared) {
    const slug = clipSlugFromInput(shared);
    if (slug) play({ kind: 'clip', slug });
    else if (isVodInput(shared) && extractVodId(shared)) play({ kind: 'vod', id: extractVodId(shared)!, start: vodStartFromInput(shared) });
    else if (isValidLogin(loginFromInput(shared))) openChannel(loginFromInput(shared));
  }
  if (kind || shared) history.replaceState(null, '', location.pathname);
}

applyAccent();
applyIcon();
loadDB();
render(<App />, document.getElementById('app')!);
// Logins from before the one-login version used another client: their token can't follow,
// earn points or claim drops. Sign them out once so the user logs in again (TV client).
if (state.account) fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${state.account.token}` } })
  .then(r => r.json()).then(v => {
    if (v?.client_id && v.client_id !== TV_CLIENT_ID) {
      setAccount(null);
      alert('Die App nutzt jetzt einen Login für alles (Chat, Folgen, Kanalpunkte, Drops). Bitte melde dich in den Einstellungen einmal neu an.');
    }
  }).catch(() => {});
// An account taken over from the earlier second login has no name/avatar yet.
if (state.account && !state.account.avatar) helix(`users?id=${state.account.userId}`).then(j => {
  const u = j?.data?.[0]; if (u && state.account) setAccount({ ...state.account, name: u.display_name, avatar: u.profile_image_url });
});
// Finished drops are claimed on start and every return to the app (ForegroundRefresh in iOS).
checkDrops();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDrops(); });
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js');
navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.login) play({ kind: 'live', login: e.data.login }); });
