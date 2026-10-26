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

- gefolgte Kategorien des Kontos
- Watch Streak und das Einlösen von Kanalpunkte-Belohnungen
- werbefreie Wiedergabe über das eigene Abo oder Turbo

Kanalpunkte, Drops und das Folgen auf Twitch laufen deshalb über einen eigenen, zweiten Login mit Twitchs TV-Zugang (Einstellungen → Kanalpunkte & Drops). Ob Twitch das Einlösen damit annimmt, ist **nicht getestet**; das Protokoll in den Einstellungen zeigt jeden Versuch mit Ergebnis. Grenzen: Punkte und Drops sammeln sich nur, solange ein Live-Stream in der App offen ist. Für Drops lädt die App einen unsichtbaren zweiten Stream, das kostet zusätzliche Daten.

## Durch iOS und WebKit

- Ton startet nur nach einem Tippen. Ohne Tippen beginnt die Wiedergabe stumm mit „Ton an“.
- Multi-Live: iOS spielt nur einen Stream mit Ton, die anderen laufen stumm.
- Vollbild ist der native Player von iOS; eigene Steuerung und Chat fehlen dort.
- Querformat lässt sich nicht per Knopf erzwingen, nur durch Drehen des Geräts.
- Live Activity, Dynamic Island, Widgets, Raumklang, App-Symbol-Wahl und die Apple-TV-App gibt es für Web-Apps nicht.
- Im Hintergrund (Home-Bildschirm, andere App) pausiert iOS das Video und setzt es bei Rückkehr fort. Wer weiterhören will, wählt die Qualität „Nur Audio“, die lief im Test im Hintergrund weiter (nur bei Proxy-Quellen wählbar).
- Bild in Bild meldet die Simulator-Safari als nicht verfügbar; auf dem iPhone ist es nicht getestet. Der Knopf erscheint nur, wenn das Gerät es anbietet.
- Apples Übersetzung auf dem Gerät hat keine Web-Schnittstelle. Die App nutzt nur Googles freien Endpunkt; die Chat-Texte gehen dabei an Google.

## Durch die Vorgabe „kein Server“

- Mitteilungen bei Live-Start: Im Test in der installierten App erschien die Erlaubnis-Abfrage, aber keine Mitteilung kam an. iOS zeigt Mitteilungen von Web-Apps offenbar nur über Web Push, und das braucht einen Push-Server.
- Die Sicherung ist eine lokale JSON-Datei statt einer Synchronisierung über den Worker.
- Der Cloudflare-Worker des Upstream-Projekts ist als Live-Notfallquelle nicht eingebaut.

## Noch nicht umgesetzt, aber möglich

Diese Funktionen gehen im Browser, fehlen aber noch: Chat-Verzögerung passend zur Latenz, BTTV/7TV-Live-Updates, Chatter-Liste, Bot-Befehle, Nutzerkarte, Emote-Info, angepinnte Nachrichten, Umfragen, Vorhersagen, Hype Train, Raids (Hermes-WebSocket, nicht geprüft), Systemprotokolle, Hinweise in der App, immersiver Player mit Chat über dem Video.

## Nicht getestet

Fast alles ist inzwischen im iOS-Simulator geprüft (Safari und installierte Home-Bildschirm-App), siehe `FEATURE_AUDIT.md`. Auf einem echten iPhone ist nur die Anmeldung bestätigt. **Nicht getestet** sind: Chatten, Erwähnungen, Emote-Auswahl, Namensfarbe, Twitch-Follows des Kontos, Kanalpunkte und Drops (alle brauchen einen echten Login), AirPlay und Bild in Bild (im Simulator nicht verfügbar).
