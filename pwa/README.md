# TwitchUnblock als Web-App

Twitch-Client für das iPhone, der in Safari läuft und sich über „Zum Home-Bildschirm“ wie eine App installieren lässt. Kein Sideloading, kein Entwicklerzertifikat, kein Server, keine Kosten. Gehostet wird er auf GitHub Pages.

Die Web-App ist eine Portierung der SwiftUI-App aus diesem Repo (Branch `optimize`). Was sie kann und was nicht, steht in:

- `FEATURE_AUDIT.md`: jede Funktion der iOS-App mit Kategorie, Stand und Teststand
- `LIMITATIONS.md`: was fehlt und warum
- `COMPATIBILITY_MATRIX.md`: gemessene CORS- und WebKit-Ergebnisse
- `PWA_ARCHITECTURE.md`: Aufbau, Wiedergabe, Chat, Anmeldung, Deployment

## Installieren auf dem iPhone

1. Die Pages-Adresse in Safari öffnen (nach dem ersten Deployment: `https://timmbrockerhoff.github.io/TwitchUnblock/`).
2. Teilen-Knopf → „Zum Home-Bildschirm“.
3. Die App vom Home-Bildschirm starten. Erst dann gibt es Mitteilungen, und die Daten bleiben dauerhaft gespeichert (Safari löscht Daten normaler Webseiten nach sieben Tagen ohne Besuch).

Anmelden geht in den Einstellungen mit „Mit Twitch anmelden“: Die App zeigt einen Code, den man auf `twitch.tv/activate` eingibt. Ein Passwort gibt man in der App nie ein.

## Entwickeln

Voraussetzung ist Node 22.

```bash
cd pwa
npm install
npm run dev      # Entwicklungsserver, auch im LAN erreichbar
npm test         # Selbsttest der reinen Logik
npm run build    # Typprüfung und Build nach dist/
```

Zum Prüfen in iOS-Safari: Simulator starten und die Seite über `http://127.0.0.1:<port>` öffnen. Wichtig: `http://localhost` lässt Twitch durch, github.io nicht. Wer mit `localhost` testet, sieht also Dinge funktionieren, die online scheitern würden.

Die Machbarkeitstests liegen in `public/poc/index.html` und sind nach dem Deployment unter `/poc/` erreichbar. Sie prüfen GQL, usher, Proxys, natives HLS, Werbe-Metadaten, Zurückspulen, Multistream, IRC, Übersetzung und Geräte-Login im jeweiligen Browser.

Deep-Links: `#/live/<kanal>`, `#/vod/<id>`, `#/clip/<slug>`, `#/channel/<kanal>`, `#/multi/<kanal1>,<kanal2>`.

## Deployment

`.github/workflows/pages.yml` baut bei jedem Push auf den Branch `pwa`, der `pwa/` betrifft, und veröffentlicht `pwa/dist` auf GitHub Pages. Einmalig nötig: Repo-Einstellungen → Pages → Source „GitHub Actions“. Secrets braucht der Workflow keine.

## Lizenz

Basiert auf [TwitchUnblock von MXFia19](https://github.com/MXFia19/TwitchUnblock) (MIT-Lizenz). Nicht mit Twitch verbunden.
