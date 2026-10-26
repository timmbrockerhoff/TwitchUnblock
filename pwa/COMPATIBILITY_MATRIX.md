# Kompatibilität: was der Browser darf

Gemessen am 26.10.2026 auf zwei Wegen:

1. `curl` mit gesetztem `Origin`-Header. So antwortet der Server, wenn die Seite auf `https://timmbrockerhoff.github.io` läuft.
2. Die Testseite `public/poc/index.html` in Safari im iOS-Simulator (iOS 27, WebKit), geladen von `http://127.0.0.1:8787`. Twitch gibt diesen Origin nicht frei, er verhält sich also wie github.io.

Auf einem echten iPhone ist nichts davon gelaufen. Die Testseite liegt nach dem Deployment unter `<Pages-Adresse>/poc/` und lässt sich dort auf dem iPhone wiederholen.

## Netzwerk (CORS)

| Ziel | Wofür | Ergebnis | Folge |
|---|---|---|---|
| `gql.twitch.tv/gql` | Kanäle, Streams, Kategorien, Clips, Tokens, VOD-Chat | `Access-Control-Allow-Origin: *`, Preflight erlaubt `Client-ID`, `Authorization`, `Device-ID` | geht |
| `usher.ttvnw.net` (Live- und VOD-Master) | Wiedergabe | kein CORS-Header für fremde Origins (nur `*.twitch.tv` und localhost werden gespiegelt); `fetch` scheitert | Master nicht lesbar: bei „Twitch offiziell“ keine Qualitätsliste |
| `*.playlist.ttvnw.net` (Live-Media-Playlists) | Segmentliste | `403` bei `Origin` ≠ `*.twitch.tv` und ≠ `http://localhost`; github.io, example.com, pages.dev, 127.0.0.1 alle 403 | kein hls.js, kein Umschreiben der Playlist |
| `*.cloudfront.net` (VOD-Media-Playlists) | Segmentliste | `Access-Control-Allow-Origin: https://www.twitch.tv` | keine Downloads |
| `*.hls.ttvnw.net` (Live-Segmente) | Video | `Access-Control-Allow-Origin: *` | lesbar, nützt ohne Playlist aber nichts |
| `as/eu/eu2.luminous.dev` | Live-Proxy | `*`, 200 | Rennen und Qualitätsliste gehen |
| `twitch-al.nadeko.net` (TTV.LOL) | Live-Proxy | `*`, 200, Preflight ok | geht |
| `id.twitch.tv/oauth2/device`, `/token`, `/validate` | Anmeldung | `*`; Gerätecode mit der App-Client-ID ohne Secret, Token-Endpunkt antwortet `authorization_pending` | Anmeldung per Gerätecode |
| `api.twitch.tv/helix` (`channels/followed` GET, `chat/color` PUT, `chat/messages` POST) | Konto | `*`, Methoden im Preflight erlaubt | geht (mit Token) |
| `wss://irc-ws.chat.twitch.tv` | Chat | WebSocket ohne CORS; anonym `justinfan…` empfängt sofort | geht |
| `recent-messages.robotty.de` | Chatverlauf | `*` | geht |
| `7tv.io`, `api.betterttv.net`, `api.frankerfacez.com` | Emotes | Origin gespiegelt bzw. `*` | geht |
| `static-cdn.jtvnw.net` | Emote-Bilder, Avatare | `*` | geht |
| `translate.googleapis.com` (`client=gtx`) | Übersetzung | `*` | geht, ohne Schlüssel |
| `api.vodvod.top` | VOD-Wiederherstellung | nur `https://vodvod.top` | ohnehin ausgeschlossen (Projektregel) |
| `badges.twitch.tv` | alte Badge-API | keine Antwort | nicht genutzt, Badges kommen per GQL |

## Wiedergabe in iOS-Safari

| Prüfung | Ergebnis (Simulator) |
|---|---|
| `canPlayType('application/vnd.apple.mpegurl')` | `maybe`: natives HLS vorhanden |
| `MediaSource` / `ManagedMediaSource` | `false` / `true` (MSE nur als ManagedMediaSource, wegen der 403 oben trotzdem unbrauchbar) |
| usher-Live-Master direkt als `video.src` von 127.0.0.1 | spielt (24 s Wiedergabe in 10 s Wartezeit, `readyState 4`). Die Medienanfragen von `<video>` tragen keinen `Origin`, daher kein 403 |
| einzelne Media-Playlist eines Proxys als `video.src` | spielt, 1920×1080 |
| laufende Aufnahme (Archiv-VOD) als `video.src` | spielt, `duration = Infinity`, `seekable 0–14101 s`: ganzer bisheriger Stream spulbar |
| `EXT-X-DATERANGE` als Metadaten-Cues (Spur auf `hidden`) | 55 Cues in 14 s, z. B. `X-TV-TWITCH-STREAM-SOURCE = live`, `X-TV-TWITCH-TRIGGER-URL` |
| zwei Videos gleichzeitig, stumm | beide laufen |
| Ton bei beiden einschalten (nach Tippen) | iOS pausiert eines: nur ein hörbarer Stream |
| Ton ohne vorheriges Tippen (Deep-Link) | `NotAllowedError`; die App startet stumm und zeigt „Ton an“ |
| `document.pictureInPictureEnabled` | `false` im Safari-Tab des Simulators; `webkitSupportsPresentationMode` existiert |
| `Notification`, `PushManager` im Safari-Tab | nicht vorhanden (gibt es nur in Home-Bildschirm-Apps ab iOS 16.4) |
| `serviceWorker` | vorhanden |
| Doppeltippen auf das Video | zoomte die Seite, bis `touch-action: manipulation` gesetzt war |
| Echte Werbung (Pre-Roll) | Cues `X-TV-TWITCH-AD-…` und `X-TV-TWITCH-STREAM-SOURCE=Amazon…`; Cues ohne Ende bleiben aktiv, nach der Werbung kommt `…=live` dazu |
| Video im Hintergrund (Home-Taste) | pausiert, bei Rückkehr fortgesetzt; „Nur Audio“ läuft weiter |
| iOS-Vollbild schließen | Video pausiert ~0,3 s danach (die App setzt fort) |
| Sprung bei `loadedmetadata`, danach `load()` | `load()` setzt die Position auf 0 zurück |
| `play()` ohne Tippen nach Quellenwechsel | Element blieb bei `networkState 3` (keine Quelle), bis `load()` |
| IndexedDB nach Beenden von Safari | `indexedDB.open` kam nicht mehr zurück, bis Safari erneut beendet wurde |
| Installierte App, `status-bar-style` `black-translucent` | Seite startet bei `scrollY = -62`, Abstand doppelt; mit `default` korrekt |
| Installierte App: `registration.showNotification` | `undefined`; `new Notification` ohne Fehler, aber keine Mitteilung sichtbar |
| Installierte App: Download-Link `<a download>` | ohne Wirkung; `navigator.share({ files })` öffnet „In Dateien sichern“ |

## iOS-Versionen

Ziel des Builds ist `safari16`. Getestet wurde nur iOS 27 im Simulator. Für iOS 16 und 17 gibt es keine Messung.

| Fähigkeit | ab iOS (laut Apple/WebKit-Doku, nicht gemessen) |
|---|---|
| Home-Bildschirm-App mit Manifest | 11.3 |
| Web Push und Mitteilungen in Home-Bildschirm-Apps | 16.4 |
| ManagedMediaSource | 17.1 |
| Web Share Target (Teilen-Menü → App) | nicht unterstützt |
