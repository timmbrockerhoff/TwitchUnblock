// App-shell cache so the installed app opens offline/fast. Twitch data and video are never cached.
const CACHE = 'shell-v1';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './manifest.webmanifest']))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    // Network first: a new deploy shows up on the next launch; offline falls back to the cached shell.
    e.respondWith(fetch(e.request).then(r => { caches.open(CACHE).then(c => c.put('./index.html', r.clone())); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  // Hashed build assets and icons: cache first.
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  })));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const login = e.notification.data && e.notification.data.login;
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    if (list[0]) { list[0].focus(); list[0].postMessage({ login }); return; }
    return self.clients.openWindow(login ? './#/live/' + login : './');
  }));
});
// Web Push from .github/workflows/live-push.yml. iOS revokes the subscription if a push shows no notification.
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { /* not ours */ }
  e.waitUntil(self.registration.showNotification(p.title || 'TwitchUnblock', {
    body: p.body || '', icon: p.icon || './icons/icon-192.png', tag: p.login, data: { login: p.login },
  }));
});
