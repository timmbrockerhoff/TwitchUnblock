# Grenzen der Web-App

Hier steht, was die Web-App gegenüber der iOS-App nicht kann oder anders macht, jeweils mit Ursache. Die vollständige Liste mit Kategorien steht in `FEATURE_AUDIT.md`.

## Absichtlich weggelassen

Abonnenten-VODs ohne Abo, das Neubauen von VOD-Playlists aus dem CDN (auch gelöschte VODs) und das Wiederherstellen stummgeschalteter Passagen sind nicht portiert. `CLAUDE.md` verbietet, diesen Code zu ändern, zu erweitern oder zu übertragen. VODs laufen nur mit Twitchs normalem Token; ein Abonnenten-VOD zeigt „VOD nicht gefunden oder nur für Abonnenten.“

## Durch Twitchs Server

Twitch lässt fremde Webseiten seine Playlists nicht lesen: `playlist.ttvnw.net` antwortet mit 403, `usher.ttvnw.net` schickt keinen CORS-Header, die VOD-Playlists auf CloudFront erlauben nur `www.twitch.tv`. Der native Player von iOS darf sie trotzdem abspielen, JavaScript kommt aber nicht an den Inhalt. Daraus folgt:

- Werbepausen lassen sich nicht mit einem Ersatz-Stream füllen. Die App erkennt eine Pause an den Metadaten, schaltet den Ton aus und zeigt einen Hinweis. Ob das bei einer echten Werbepause greift, ist nicht getestet.
- Bei der Quelle „Twitch offiziell“ wählt iOS die Qualität selbst. Eine Auswahl gibt es nur bei den Proxys.
- Bei VODs gibt es nur „Automatisch“ als Qualität.
- Zurückspulen im Live springt auf die laufende Aufnahme statt auf eine gemeinsame Zeitleiste. Kanäle ohne Aufnahme lassen sich nur innerhalb des kleinen Puffers des Players zurückspulen.
- Downloads und Offline-Wiedergabe gibt es nicht.

## Durch fehlende Twitch-Sitzung

Die iOS-App meldet sich zusätzlich im eingebetteten twitch.tv an und liest das Cookie `auth-token`. Eine fremde Webseite kann Cookies von twitch.tv nicht lesen, und das Integritäts-Token, das Twitch für Schreibaktionen verlangt, entsteht nur auf twitch.tv selbst. Deshalb fehlen:

- Folgen und Entfolgen auf dem Twitch-Konto (gefolgte Kanäle werden nur gelesen; lokales Folgen geht)
- gefolgte Kategorien des Kontos
- Kanalpunkte: Truhen automatisch einlösen, Kontostand, Watch Streak
- Drops: automatisch einlösen, Drops-Seite, Konto-Verknüpfungen
- werbefreie Wiedergabe über das eigene Abo oder Turbo

## Durch iOS und WebKit

- Ton startet nur nach einem Tippen. Ohne Tippen beginnt die Wiedergabe stumm mit „Ton an“.
- Multi-Live: iOS spielt nur einen Stream mit Ton, die anderen laufen stumm.
- Vollbild ist der native Player von iOS; eigene Steuerung und Chat fehlen dort.
- Querformat lässt sich nicht per Knopf erzwingen, nur durch Drehen des Geräts.
- Live Activity, Dynamic Island, Widgets, Raumklang, App-Symbol-Wahl und die Apple-TV-App gibt es für Web-Apps nicht.
- Wiedergabe im Hintergrund und Bild in Bild hängen von iOS ab und sind nicht getestet.
- Apples Übersetzung auf dem Gerät hat keine Web-Schnittstelle. Die App nutzt nur Googles freien Endpunkt; die Chat-Texte gehen dabei an Google.

## Durch die Vorgabe „kein Server“

- Mitteilungen bei Live-Start gibt es nur, solange die App geöffnet ist, und nur als Home-Bildschirm-App. Web Push braucht einen Push-Server.
- Die Sicherung ist eine lokale JSON-Datei statt einer Synchronisierung über den Worker.
- Der Cloudflare-Worker des Upstream-Projekts ist als Live-Notfallquelle nicht eingebaut.

## Noch nicht umgesetzt, aber möglich

Diese Funktionen gehen im Browser, fehlen aber noch: Werbepausen-Statistik je Quelle, Chat-Verzögerung passend zur Latenz, Pinch zum Füllen, Wischen zum Minimieren, BTTV/7TV-Live-Updates, Chatter-Liste, Bot-Befehle, Nutzerkarte, Emote-Info, angepinnte Nachrichten, Umfragen, Vorhersagen, Hype Train, Raids (Hermes-WebSocket, nicht geprüft), lokale Kategorie-Favoriten, Systemprotokolle, Hinweise in der App, regelmäßige Aktualisierung der Zuschauerzahl, immersiver Player mit Chat über dem Video.

## Nicht getestet

Nichts davon lief auf einem echten iPhone. Im Simulator geprüft sind Startseite, Live mit Proxy-Quelle, Chat mit Emotes, Badges, Verlauf und Übersetzung, Steuerung, Zurückspulen (Zeitanzeige, Bild im Simulator schwarz), VOD mit Chat-Replay, Kanalseite, Clip-Feed, Multi-Live, Mini-Player, Querformat und Meine VODs. Die vollständige Anmeldung, Chatten, AirPlay, Bild in Bild, Hintergrundwiedergabe, Mitteilungen, die Installation auf dem Home-Bildschirm und das Verhalten bei einer echten Werbepause sind **nicht getestet**.
