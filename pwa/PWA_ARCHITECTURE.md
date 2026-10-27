# Architektur der Web-App

## Rahmen

Die Web-App ist eine statische Seite. GitHub Pages liefert HTML, JavaScript und CSS aus, alles andere holt der Browser direkt bei Twitch und den Drittanbietern. Es gibt keinen eigenen Server, keine Datenbank und keine Geheimnisse im Code. Die einzige Client-ID im Code (`1e68ku2ehgzy5cy0di3xvfy82sxpf6`) ist dieselbe öffentliche ID wie in der iOS-App; das Gerätecode-Verfahren braucht kein Secret.

Die Swift-App bleibt unverändert. Die Web-App liegt komplett in `pwa/`, dazu kommt der Workflow `.github/workflows/pages.yml`.

## Technik

| Teil | Wahl | Grund |
|---|---|---|
| Sprache | TypeScript (strict) | Vorgabe; `tsc --noEmit` läuft vor jedem Build |
| Build | Vite 6, `base: './'` | läuft unter jedem Pfad, also auch unter `/<repo>/` auf Pages |
| Oberfläche | Preact 10 (JSX, Hooks) | 4 KB statt React; das gesamte JS ist 34 KB gzip |
| Zustand | ein kleines Observable in `store.ts` | ersetzt `AppStore`; kein Framework nötig |
| Einstellungen, Follows, Login, Verlauf, VOD-Fortschritt | `localStorage` | synchron; Verlauf höchstens 500 Einträge (~150 KB), verzögert gespeichert wie in der Swift-App. Zuerst lagen Verlauf und Fortschritt in IndexedDB; im Simulator hing IndexedDB nach einem Safari-Neustart, und jedes Speichern ging still verloren. `idb-keyval` liest nur noch einmalig alte Daten |
| Offline-Start | eigener Service Worker `public/sw.js` | cached nur die App-Hülle; Twitch-Daten und Video nie |
| Manifest | `public/manifest.webmanifest` | `display: standalone`, Symbol aus `assets/icon.png` (dem Standard-Symbol des Repos, nicht dem lokalen Twitch-Logo) |
| Tests | `test/logic.test.ts` mit `node:assert` | ohne Test-Framework, `npm test` |

## Dateien

```
pwa/
  index.html               Einstieg, iOS-Meta-Tags
  public/                  manifest, sw.js, Symbole, poc/ (Machbarkeitstests)
  src/
    logic.ts               reine Logik aus TwitchAPI.swift/IRCParser.swift: M3U8, Qualitäten, Links, IRC, Emote-Bereiche
    twitch.ts              GQL, Quellen-Rennen, Konto-Tokens, Kanal/VOD/Clip-Abfragen
    vod.ts                 VOD-Worker-Fallback, Worker-Status, gelöschte VODs
    account.ts             Gerätecode-Login, Token-Erneuerung, Helix
    store.ts               Einstellungen, Follows, Verlauf, Sicherung
    rewards.ts             Kanalpunkte und Drops (zweiter Login mit Twitchs TV-Client-ID)
    chat.ts                IRC-Client, Emotes, Badges, Übersetzung, VOD-Chat
    nav.ts                 Tab-Stapel, Player-Zustand, Browser-Verlauf
    ui.tsx                 Bausteine: Seite, Regal, Karten, Sheet, Schalter
    pages.tsx              Startseite, Durchsuchen, Kategorie, Meine VODs, Kanal, Einstellungen
    player.tsx             Player, Steuerung, Chat-Panel, Multi-Live, Clip-Feed
    style.css              Systemfarben hell/dunkel, Player immer dunkel
  test/logic.test.ts
```

## Wiedergabe

Die wichtigste Entscheidung folgt aus einer Messung: `playlist.ttvnw.net` beantwortet `fetch` von fremden Seiten mit 403, `usher.ttvnw.net` schickt ihnen keinen CORS-Header. Damit fällt alles weg, was die Playlist im JavaScript liest, also hls.js, ManagedMediaSource, das Umschreiben der Playlist (LiveDVRPlaylist) und das Füllen von Werbepausen.

Was bleibt, ist der native HLS-Player von Safari. `<video src="…m3u8">` lädt Playlists und Segmente selbst und schickt dabei keinen `Origin`. Das hat der Simulator von einem nicht freigegebenen Origin aus bestätigt.

Daraus ergibt sich der Ablauf beim Live-Stream (`raceLive` in `twitch.ts`):

1. GQL liefert Titel, Spiel, Zuschauer, Start und die ID der laufenden Aufnahme.
2. Die Quellen laufen zeitversetzt um 1,5 s gegeneinander: Luminous Asien, TTV.LOL-Proxy, Luminous Europa (drei Spiegel parallel). Die Proxys schicken `Access-Control-Allow-Origin: *`, ihr Master ist also lesbar und liefert die Qualitätsliste.
3. Twitch offiziell (mit Werbung) startet erst, wenn alle Proxys gescheitert sind. Dafür holt die App ein Token per GQL und gibt die usher-Adresse direkt an `<video>`. Eine Qualitätsliste gibt es dann nicht.
4. Die gewählte Qualität wird als einzelne Media-Playlist an `<video>` gegeben, „Automatisch“ als Master.

Zurückspulen: Liegt eine laufende Aufnahme vor, wechselt der Player beim Zurückspulen auf deren VOD-Playlist (normales Token, nativ). Safari behandelt sie als Event-Playlist ohne Ende (`duration = Infinity`), der ganze bisherige Stream ist spulbar. „● Live“ lädt wieder den Live-Stream.

VODs: `vodPlayback` versucht zuerst Twitchs normales Wiedergabetoken des Kontos. Wenn Twitch kein nutzbares Token liefert, fragt `vod.ts` Haupt- und Ersatz-Worker nach der CDN-/Storyboard-Wiederherstellung. Nicht gelistete Übertragungen kommen über `recover-list` auf die Kanalseite; `recover-resolve` rekonstruiert den CDN-Ordner aus Login, Stream-ID und Startzeit und gibt eine geprüfte Proxy-Playlist an den Player. 429-Quotenfehler stellen den betroffenen Worker bis Mitternacht UTC zurück, vorübergehende 502–504-Fehler für 30 Minuten.

Werbepausen: Safari meldet `EXT-X-DATERANGE`-Einträge als Cues einer Metadaten-Spur. Einträge ohne Ende bleiben dabei für immer aktiv, deshalb wertet `adActive` (`logic.ts`) den zuletzt begonnenen aus: Ein Werbe-Eintrag (`X-TV-TWITCH-AD…`, Stream-Quelle `Amazon…`) nach dem letzten `live`-Eintrag heißt Werbepause. Gemessen mit echter Pre-Roll-Werbung im Simulator. Während einer Pause ist der Ton aus und ein Hinweis zu sehen. Bei „Twitch offiziell“ gibt es dazu den Knopf „Ersatz-Stream“, der Tokens mit den Player-Typen embed, popout und autoplay probiert.

Ton: iOS erlaubt Ton nur nach einem Tippen. Im Hintergrund pausiert iOS ein Video; nur die Qualität „Nur Audio“ läuft weiter (gemessen). Kommt die Wiedergabe ohne Tippen (Deep-Link, nächster Clip), startet sie stumm mit dem Knopf „Ton an“. Der Clip-Feed nutzt ein einziges `<video>`, weil iOS die Erlaubnis pro Element vergibt.

## Chat

`ChatClient` verbindet sich mit `wss://irc-ws.chat.twitch.tv`, anonym als `justinfan…` oder mit `oauth:<token>`, wenn der Login den Scope `chat:edit` hat. Nachrichten werden wie in der Swift-App gebündelt (200 ms) und auf 250 begrenzt. Emotes kommen aus den Twitch-Tags und den Listen von BTTV, FFZ und 7TV, Badges aus öffentlichem GQL. Die Übersetzung schickt höchstens drei Anfragen gleichzeitig an Googles `gtx`-Endpunkt, die Warteschlange fasst 30 Zeilen.

Der VOD-Chat fragt `VideoCommentsByOffsetOrCursor` (Persisted Query) ab und gibt Nachrichten frei, sobald die Wiedergabe ihre Stelle erreicht. Ein Sprung über 15 s lädt neu ab der neuen Stelle.

## Anmeldung

Ein einziger Login per Gerätecode mit Twitchs TV-Client-ID: Die App holt einen Code bei `id.twitch.tv/oauth2/device`, der Nutzer gibt ihn auf `twitch.tv/activate` ein, die App fragt alle 5 s nach dem Token. Gemessen am 26.10.2026: `gql.twitch.tv` verlangt für diesen Client kein Integritäts-Token (Folgen, Kanalpunkte, Drops-Inventar und -Einlösung gehen), IRC nimmt den Token an, Helix `users` auch. Für `channels/followed` und `chat/color` braucht Helix Scopes; die App fragt sie an, ob Twitch sie dem TV-Client gibt, ist offen. Das Token läuft laut `validate` nicht ab; ein Refresh-Token ist trotzdem gespeichert. Es liegt in `localStorage`, die Seite lädt keine fremden Skripte.

Der Login der iOS-App ließ sich nicht übernehmen: Ihre registrierte Weiterleitungsseite (`mxfia19.github.io/…/auth.html`) gibt das Token an `twitchunblock://` weiter, und der twitch.tv-Cookie samt Integritäts-Token ist für eine fremde Seite nicht erreichbar.

## Deployment

`.github/workflows/pages.yml` läuft bei Pushes auf den Branch `pwa`, die `pwa/**` betreffen, oder per Hand: `npm ci`, `npm test`, `npm run build`, Upload von `pwa/dist` als Pages-Artefakt. Pages muss einmal in den Repo-Einstellungen eingeschaltet werden (Quelle: GitHub Actions). Die Versionsnummer ist `1.0.<Anzahl der Commits in pwa/>`.
