# Grenzen der Web-App

Hier steht, was die Web-App gegenüber der iOS-App nicht kann oder anders macht, jeweils mit Ursache. Die vollständige Liste mit Kategorien steht in `FEATURE_AUDIT.md`.

## Absichtlich weggelassen

VOD-Fallbacks und die Rekonstruktion gelöschter oder versteckter Übertragungen sind über die TwitchUnblock-Worker portiert. Diese Wege hängen davon ab, dass mindestens einer der beiden Worker antwortet und Twitch die CDN-Segmente noch nicht gelöscht hat. Bei aktuellen VODs prüft die PWA noch vorhandene Originalsegmente und baut daraus eine lokale HLS-Playlist; Safari bietet Webseiten aber keinen eigenen AVAsset-Resource-Loader. Falls WebKit diese Blob-Playlist ablehnt, fällt der Player automatisch auf die Worker-Playlist zurück. Dort verhindert der Worker einen Wiedergabestopp, indem er nicht erreichbare `-unmuted.ts`-Segmente durch die vorhandene stumme Variante ersetzt.

## Durch Twitchs Server

Twitch lässt fremde Webseiten seine Playlists nicht lesen: `playlist.ttvnw.net` antwortet mit 403, `usher.ttvnw.net` schickt keinen CORS-Header, die VOD-Playlists auf CloudFront erlauben nur `www.twitch.tv`. Der native Player von iOS darf sie trotzdem abspielen, JavaScript kommt aber nicht an den Inhalt. Daraus folgt:

- Werbepausen lassen sich nicht in der Playlist ersetzen. Stattdessen wechselt der Player bei Beginn einer Pause automatisch auf einen Ersatz-Stream (andere Player-Typen, dann andere Proxys). Mit einer echten Werbepause ist das nicht getestet.
- Bei der Quelle „Twitch offiziell“ wählt iOS die Qualität selbst. Eine Auswahl gibt es nur bei den Proxys.
- Reguläre VODs über das Kontotoken haben nur „Automatisch“; über den Worker-Fallback werden die gefundenen Einzelqualitäten angeboten.
- Zurückspulen im Live springt auf die laufende Aufnahme statt auf eine gemeinsame Zeitleiste. Kanäle ohne Aufnahme lassen sich nur innerhalb des kleinen Puffers des Players zurückspulen.
- Downloads und Offline-Wiedergabe gibt es nicht.

## Durch fehlende Twitch-Sitzung

Die iOS-App meldet sich zusätzlich im eingebetteten twitch.tv an und liest das Cookie `auth-token`. Eine fremde Webseite kann Cookies von twitch.tv nicht lesen, und das Integritäts-Token, das Twitch für Schreibaktionen verlangt, entsteht nur auf twitch.tv selbst. Deshalb fehlen:

- Watch Streak und das Einlösen von Kanalpunkte-Belohnungen
- werbefreie Wiedergabe über das eigene Abo oder Turbo (gemessen: Twitch stellt dem TV-Login trotz aktiver Abos nur Token mit Werbung aus; die Proxys sind ohnehin werbefrei)

Die Web-App meldet sich deshalb mit Twitchs TV-Zugang an (ein einziger Login). Damit gehen Chatten, Folgen auf Twitch, Kanalpunkte und Drops, im Simulator mit echtem Konto geprüft. Drops werden nur gutgeschrieben, wenn das Spielkonto beim Hersteller mit Twitch verknüpft ist. Die Namensfarbe braucht einen Helix-Scope, den Twitch dem TV-Zugang nicht gibt; sie lässt sich in der Web-App nicht ändern. Die Liste der gefolgten Kanäle kommt über eine twitch.tv-Abfrage. Grenzen: Punkte und Drops sammeln sich nur, solange ein Live-Stream in der App offen ist. Für Drops lädt die App einen unsichtbaren zweiten Stream, das kostet zusätzliche Daten.

## Durch iOS und WebKit

- Ton startet nur nach einem Tippen. Ohne Tippen beginnt die Wiedergabe stumm mit „Ton an“.
- Multi-Live: iOS spielt nur einen Stream mit Ton, die anderen laufen stumm.
- Vollbild ist der native Player von iOS; eigene Steuerung und Chat fehlen dort.
- Querformat per Knopf dreht nur den Player per CSS; iOS-Safari kann die Ausrichtung nicht sperren. Die Tastatur erscheint dabei im Hochformat.
- Live Activity, Widgets und die Apple-TV-App gibt es für Web-Apps nicht. Sperrbildschirm und Dynamic Island zeigen „Now Playing“ über die Media Session. Raumklang schaltet iOS selbst im Kontrollzentrum zu. Das App-Symbol wirkt erst beim nächsten Hinzufügen zum Home-Bildschirm.
- Im Hintergrund (Home-Bildschirm, andere App) pausiert iOS das Video und setzt es bei Rückkehr fort. Wer weiterhören will, wählt die Qualität „Nur Audio“, die lief im Test im Hintergrund weiter (nur bei Proxy-Quellen wählbar).
- Bild in Bild meldet die Simulator-Safari als nicht verfügbar; auf dem iPhone ist es nicht getestet. Der Knopf erscheint nur, wenn das Gerät es anbietet.
- Apples Übersetzung auf dem Gerät hat keine Web-Schnittstelle. Die App nutzt nur Googles freien Endpunkt; die Chat-Texte gehen dabei an Google.

## Durch die Vorgabe „kein Server“

- Mitteilungen bei Live-Start bei geschlossener App gehen nur über Web Push. Statt eines eigenen Servers schickt sie ein geplanter GitHub-Actions-Workflow (alle 5 min, GitHub startet ihn oft später). Das braucht eine einmalige Einrichtung mit Schlüsseln und Secrets und läuft nur vom Standard-Branch des Repos. Echter Versand an ein iPhone ist nicht getestet.
- Die Sicherung ist eine lokale JSON-Datei statt einer Synchronisierung über den Worker.
- Der Cloudflare-Worker des Upstream-Projekts ist als Live-Notfallquelle nicht eingebaut.

## Noch nicht umgesetzt, aber möglich

Vom immersiven Player gibt es nur den Chat über dem Video im Querformat; Breiten-Griff und Schnellumschalter fehlen noch.

## Nicht getestet

Fast alles ist inzwischen im iOS-Simulator geprüft (Safari und installierte Home-Bildschirm-App), siehe `FEATURE_AUDIT.md`. Auf einem echten iPhone ist nur die Anmeldung bestätigt. **Nicht getestet** sind: Chatten, Erwähnungen, Emote-Auswahl, Namensfarbe, Twitch-Follows des Kontos, Kanalpunkte und Drops (im Simulator mit echtem Konto geprüft, auf dem iPhone nicht), AirPlay und Bild in Bild (im Simulator nicht verfügbar).
