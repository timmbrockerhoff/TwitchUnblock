// Live-start Web Push, run by .github/workflows/live-push.yml (no server of our own).
// Stateless: a stream counts as "went live" when it started after SINCE (the start of the last
// successful run, read by the workflow), so delayed or skipped cron runs don't lose a start.
// Logs only counts: Actions logs of a public repo are public, and subscriptions/follows are private.
//
// Local check without keys: node push/live-push.mjs --dry-run [--channels a,b] [--since-min 600]
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry-run');
const env = process.env;

const now = Date.now();
// Bounds: first run / long pause → 15 min back; never more than 2 h (no flood after an outage).
const last = Date.parse(env.SINCE ?? '');
const since = arg('--since-min') ? now - Number(arg('--since-min')) * 60e3
  : Math.max(Number.isFinite(last) ? last : now - 15 * 60e3, now - 2 * 3600e3);

const subs = DRY && !env.PUSH_SUBSCRIPTIONS
  ? [{ subscription: null, channels: (arg('--channels') ?? 'papaplatte,montanablack88,trymacs,caedrel,ibai').split(',') }]
  : parseSubs(env.PUSH_SUBSCRIPTIONS || '[]');
function parseSubs(text) {
  // Own message: V8's JSON errors quote a snippet of the input, i.e. of the secret.
  let v; try { v = JSON.parse(text); } catch { v = undefined; }
  if (!Array.isArray(v)) { console.log('PUSH_SUBSCRIPTIONS is not a JSON array: copy it again from the app'); process.exit(1); }
  return v;
}

const logins = [...new Set(subs.flatMap(s => s.channels ?? []).map(l => String(l).toLowerCase()))];
const live = new Map(); // login → payload
for (let i = 0; i < logins.length; i += 100) {
  const r = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `query($l: [String!]) { users(logins: $l) { login displayName profileImageURL(width: 70)
      stream { id title createdAt game { displayName } } } }`, variables: { l: logins.slice(i, i + 100) } }),
  });
  const users = (await r.json())?.data?.users;
  if (!r.ok || !Array.isArray(users)) throw new Error(`Twitch GQL failed (HTTP ${r.status})`); // fail → SINCE doesn't advance
  for (const u of users) {
    if (!u?.stream) continue;
    const started = Date.parse(u.stream.createdAt);
    if (DRY) console.log(`${u.login}: live since ${Math.round((now - started) / 60e3)} min${started > since ? ' → notify' : ''}`);
    if (started <= since) continue;
    const game = u.stream.game?.displayName;
    live.set(u.login, { title: `${u.displayName ?? u.login} ist live`, body: [u.stream.title, game].filter(Boolean).join(' · '),
      icon: u.profileImageURL, login: u.login });
  }
}

let webpush;
if (!DRY && live.size) { // nothing to send → no keys needed (secrets not set up yet)
  webpush = (await import('web-push')).default;
  webpush.setVapidDetails('https://github.com/timmbrockerhoff/TwitchUnblock', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}
let sent = 0, failed = 0;
for (const [n, s] of subs.entries()) {
  sub: for (const login of new Set((s.channels ?? []).map(l => String(l).toLowerCase()))) {
    const p = live.get(login);
    if (!p) continue;
    if (DRY) { console.log(`would send to subscription #${n}: ${JSON.stringify(p)}`); continue; }
    try {
      // TTL 30 min: a live start delivered hours later is noise; topic collapses repeats per channel.
      await webpush.sendNotification(s.subscription, JSON.stringify(p), { TTL: 1800, urgency: 'high', topic: login.replace(/[^\w-]/g, '').slice(0, 32) });
      sent++;
    } catch (e) {
      failed++;
      const code = e?.statusCode;
      if (code === 404 || code === 410) { console.log(`Subscription #${n}: ${code} gone, regenerate it in the app and update PUSH_SUBSCRIPTIONS`); break sub; }
      console.log(`Subscription #${n}: send failed (${code ?? e?.name ?? 'error'})`); // not e.message: may contain the endpoint
    }
  }
}
console.log(`${subs.length} subscriptions, ${logins.length} channels, ${live.size} went live since ${new Date(since).toISOString()}, ${sent} sent, ${failed} failed`);
