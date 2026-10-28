# Abgleich iOS-App ↔ Web-App (Stand 2026-10-27)

Die iOS-App (`Sources/`, Branch `optimize`) ist die Vorgabe, die Web-App (`pwa/src/`, Branch `pwa`) der Nachbau. Verglichen wurde der Code beider Seiten, optisch und technisch, von drei getrennten Durchgängen: Bildschirme außerhalb des Players, Player und Chat, Technik. Zeilenangaben beziehen sich auf den Stand vom 27.10.2026 und veralten mit jeder Änderung; die Dateinamen bleiben der Einstieg.

Spalten: **Aufwand** klein = unter ~50 Zeilen, mittel = ein halber bis ganzer Tag, groß = mehrere Tage. **Browser/machbar** = auf GitHub Pages ohne eigenen Server, in Safari auf iOS.

## Umsetzungsstand (28.10.2026)

Die Listen unten beschreiben den Stand **vor** der Angleichung. Umgesetzt sind seitdem alle Top-Listen der drei Teile: Formate und Typografie, neue Karten, Long-Press-Menüs, Startseite, Durchsuchen, Kategorieseite, Meine VODs, Kanalseite, Einstellungen als Sheet mit acht Unterseiten, Player-Overlay, Fortschrittsleiste, Pull-Geste, Werbepausen-Countdown, Player- und Sleep-Timer-Sheet, Chat-Kopfzeile, Stream-Info, Mini-Player, Multi-Live mit VODs, Clip-Feed, Chat-Zeilen, Eingabezeile mit Punkte-Kapsel, Infozeile, Chat-Einstellungs-, Nachrichten-, Emote- und Badge-Sheet, Hinweise als Bänder, Chat-Robustheit (Timeout, PING, Dedupe, NOTICEs, Historie, Filter), VOD-Chat-Fallback, Follow-Poll unabhängig vom Tab, Hidden-/Pin-Regeln, Backup im iOS-Format, Drops-Timer, Punkte-Statistik, Service-Worker-Updates, Logger mit Levels.

Noch offen:
- Truhen-Zustand der Punkte-Kapsel (grün, „Bonus abholen“): die Web-App holt Truhen automatisch ab und meldet keinen offenen Bonus an den Chat.
- „Deine Kategorien“ nach Zuschauern sortieren: die gespeicherten Kategorien tragen keine Zuschauerzahl.
- Browser-Zurück schließt das ganze Einstellungs-Sheet statt einer Unterseite.
- Clip-Pfeile im Single-Player und der zweite Sheet-Detent („groß“).
- Nicht auf dem iPhone geprüft: Videowiedergabe, Pull-Geste, Leiste im gedrehten Querformat, Ton im Hintergrund, Vorladen im Clip-Feed, Long-Press. Geprüft ist nur Headless-Chrome (Layout, Konsole ohne Fehler, echter Chat).

## Gesamtbild

Die Web-App hat Struktur und Funktionsumfang der iOS-App weitgehend übernommen (Tabs, Shelves, Kanalseite, Quellen-Rennen, Chat, Drops, Punkte, VOD-Recovery). Die Unterschiede liegen in drei Schichten:

1. **Optik der Bausteine.** Karten ohne Kartenfläche, andere Badges, Zahlen- und Datumsformate, Schriftgrößen um 1–2 px daneben, Kontextmenüs fehlen, Einstellungen als eine lange Seite statt Menü mit Unterseiten. Alles im Browser machbar, meist klein bis mittel.
2. **Player und Chat.** Kein Chat-Header mit Zahnrad, kein Chat-Einstellungs-Sheet, Infozeile statt Punkte-Kapsel, Overlay-Knöpfe als Kreise statt Glyphen, Fortschrittsleiste ohne Drag-Knopf, Mini-Player mit Video statt Status-Icon, Hinweise als graue Karten statt getönter Bänder. Ebenfalls machbar, mittel.
3. **Technische Robustheit.** Chat ohne Dedupe, ohne eigenes PING und ohne Bann-/NOTICE-Behandlung; VOD-Chat ohne Fallback bei Hash-Rotation; Live-Poll nur solange die Startseite gemountet ist; Backup-Format inkompatibel zur iOS-App; gefolgte Kanäle können ausgeblendet werden. Überwiegend kleine Änderungen mit großer Wirkung.

Nicht erreichbar im Browser (bleibt Unterschied): Liquid Glass und schrumpfende Tab-Leiste (nur angenähert), Playlist-Umschreiben (`LiveDVRPlaylist`, Low-Latency-Rewrite, geprüfter Ersatz-Stream), usher-Qualitätsliste bei Twitch offiziell, Web-Session mit Integritäts-Token (Belohnungen einlösen, Abo-werbefrei), Keychain, Live Activity, Video im Hintergrund, Downloads/Offline, Moobot (CORS), Spatial Audio, App-Icon zur Laufzeit, Login über twitch.tv-Cookie (Device-Code bleibt).

## Reihenfolge, die ich vorschlage

Zuerst die technischen Kleinigkeiten mit Wirkung (Teil 3, Punkte 1–9: Chat-Robustheit, Dedupe, NOTICEs, Historie, Filter, VOD-Chat, Live-Poll, Hidden-Regeln, Backup-Import). Dann die Bausteine, die überall sichtbar sind (Teil 1: Formatierung, StreamCard/VodCard/ClipCard, Typografie). Dann Player und Chat (Teil 2: Chat-Header + Sheet, Eingabezeile, Stream-Info, Overlay, Fortschrittsleiste). Zum Schluss die großen Umbauten (Einstellungen als Menü, Kontextmenüs, Hinweise im Chat, Multi-Live-VODs).

# Teil 1: Bildschirme außerhalb des Players

Zeilenangaben: iOS `Sources/…`, PWA `pwa/src/…`. Übereinstimmungen (Tab-Namen, große Titel, Avatar-Button rechts, Shelf-Prinzip mit „Alle“, Systemfarben hell/dunkel, Akzent als einzige Wahl, Kategorie-Kacheln 110 px im Shelf / 3 Spalten im Grid, Tage-Gruppen Heute/Gestern/Diese Woche/Früher, Kanal-Tabs mit Unterstrich) sind weggelassen.

## 1.1 Grundlagen: Textstile, Farben, Abstände, Formatierung

Die PWA trifft die Grundwerte meist, weicht aber bei Sektionstiteln, Akzentpalette, Zahlen- und Datumsformaten ab.

| Element | iOS (Referenz) | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Sektions-/Shelf-Titel | `.title3.bold` = 20 pt (DesignSystem.swift:24, 298) | `.shelf-head h2`, `.section-title` 22 px/700 (style.css:55, 66) | 2 px zu groß | klein | ja |
| Karten-Titel | `.subheadline.semibold` = 15 pt (DesignSystem.swift:26) | 15 px/600 (style.css:85) | iOS reserviert immer 2 Zeilen (`lineLimit(2, reservesSpace: true)`, CardViews.swift:145), PWA clampt nur | klein | ja |
| Meta-Text | `.caption` = 12 pt (DesignSystem.swift:32) | `.card-sub`/`.row-sub` 13 px (style.css:86) | 1 px zu groß | klein | ja |
| Badge-Text | `.caption2.bold` = 11 pt (DesignSystem.swift:34), Radius 4 | 12 px/600, Radius 5 (style.css:76) | Größe, Gewicht, Radius | klein | ja |
| Karten-Radius | `TRadius.card` 14, Karte hat Hintergrund `tCard` + 12 pt Innenabstand (CardViews.swift:170-173) | Thumb-Radius 10, kein Kartenhintergrund, Text ohne Innenabstand (style.css:70-84) | Karten wirken „nackt“; iOS-Karten sind gefüllte Flächen | mittel | ja |
| Akzentfarben | 7: twitch 9146ff, blue 2f7cf6, green 10b981, pink ec4899, orange f97316, red e5484d, teal 06b6d4 (Theme.swift:20-26) | 6: 9146ff, 0a84ff, 30d158, ff9f0a, ff375f, 64d2ff (pages.tsx:453) | andere Töne, Petrol fehlt, Pink statt Rot-Pink, keine Labels | klein | ja |
| Helle Akzentvariante | `tPurple` = helle Variante im Dark Mode (bf94ff), Akzent im Light Mode (Theme.swift:38-43); Streamer-Namen auf Karten/Verlauf darin | nur `--accent` | Namen in der PWA nie in der hellen Variante | klein | ja |
| Danger | ff4f4d (Constants.swift:195) | ff3b30 / ff453a (style.css:7, 15) | leicht anders | klein | ja |
| Zuschauerzahl | `"%.1fk"` → „12.8k“, kein Mio (TwitchAPI.swift:1647) | „12,8k“, „1,2 Mio.“ (logic.ts:123) | Komma statt Punkt, Mio-Stufe | klein | ja |
| Dauer | „1h 23min“ / „23min“ (TwitchAPI.swift:1651) | „1 h 23 min“ / „23 min“ (logic.ts:131) | Leerzeichen | klein | ja |
| VOD-Datum | kurzes Datum „21.10.26“ (CardViews.swift:12-17, 265) | relativ „vor 3 Tagen“ (ui.tsx:138) | völlig anderes Format | klein | ja |
| Clip-Dauer | „0:28“ (CardViews.swift:423) | „28 s“ (ui.tsx:127) | Format | klein | ja |
| Offline-seit | „13 T · 21. Okt.“ (Dauer in T/h/min + Datum, TwitchAPI.swift:1688) | „Zuletzt live vor 3 Tagen“ (pages.tsx:124, 316) | Format und Wortlaut | klein | ja |
| Listen-Hintergrund | `tDark` = systemBackground überall | `.page:has(.group)` schaltet hell auf grouped grau (style.css:116) | nur Settings, in Ordnung | – | – |

## 1.2 Navigationsleiste, Tab-Leiste, Account-Button, Mini-Player

Fast identisch; es fehlen der Akzent-Ring am Avatar und die SF-Symbole der Tabs.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Avatar-Button | 32 px, bei Login 2 px Ring in Akzent (HeaderView.swift:38-44); Platzhalter `person.crop.circle.fill` grau | 32 px ohne Ring (ui.tsx:72-77, style.css:52) | Ring fehlt | klein | ja |
| Tab-Icons | SF `house`, `magnifyingglass`, `clock.arrow.circlepath` (MainTabView.swift:239-244) | eigene Pfade `home`, `browse`, `library` (ui.tsx:10-12); Library-Icon ist ein Balken-Symbol, kein Uhr-Pfeil | drittes Icon falsch | klein | ja |
| Tab-Leiste iOS 26 | Liquid Glass, schrumpft beim Scrollen (`tabBarMinimizeBehavior`, MainTabView.swift:2247) | feste Leiste mit Blur (style.css:58) | kein Minimieren | mittel | teilweise |
| Mini-Player | iOS 26.1: `tabViewBottomAccessory`: Statusicon + Titel `.subheadline.semibold` + ✕, auf der Tab-Leiste (MainTabView.swift:1654-1672); älter: schwebende Glas-Karte Radius 14, 1 px Akzentrand 25 % (1676-1700) | `.player.mini` 64 px hoch, 112×63 Video-Thumb links, Radius 14, dunkler Hintergrund #1c1c1e fest, kein Akzentrand (style.css:229-233) | Video statt Statusicon, feste Dunkelfarbe auch im Light Mode, kein Rand | mittel | ja |
| Multi-Live-Leiste | eigene Glas-Karte „Multi-Live · 1/4“ + „Ansehen“ über der Tab-Leiste (MainTabView.swift:1705-1740) | nicht vorhanden (Multi-Live nur Button auf Kanalseite) | fehlt | groß | ja |
| Einstellungen | als Sheet (`.sheet`, MainTabView.swift:442) mit Schließen-Button | gepushte Seite mit Zurück (pages.tsx:401) | Präsentation | klein | ja |

## 1.3 Startseite

Die Shelves sind da, aber die Karten sehen anders aus (Avatar statt Kartenfläche, andere Badges), es fehlen Breiten-Unterschiede, Kontextmenüs, Anheften, Clips-Kanalmenü, die Login-Karte weicht ab.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Login-Karte | Icon `person.crop.circle.badge.plus` (Akzent, `.title`) + „Melde dich an, um deine Lieblingskanäle zu finden.“ + „Optional: für deine Twitch-Follows, den Chat und Kanalpunkte. Alles andere funktioniert ohne Konto.“ + Kapsel „Mit Twitch anmelden“ öffnet direkt den Login (HomeView.swift:273-298, Radius 16, Padding 14, `tCard`) | `.callout` ohne Icon, Text „Folge Kanälen über das Herz…“, Button führt zu Settings (pages.tsx:79-81) | Texte, Icon, Ziel | klein | ja |
| Jetzt-live-Shelf leer | Header „Jetzt live“ + grauer Satz „Keiner deiner Kanäle ist live“ (HomeView.swift:442-454) | nur Hinweis „Gerade ist keiner deiner Kanäle live.“ ohne Header (pages.tsx:86) | Header fehlt, Wortlaut | klein | ja |
| Stream-Kartenbreite | gefolgt 300 pt (HomeView.swift:461), Top 240 pt (532) | beide 260 px (style.css:70) | Breiten | klein | ja |
| StreamCard-Inhalt | Thumb oben, Badge „JETZT LIVE“ kompakt 9 pt mit weißem Punkt oben links (DesignSystem.swift:436-452), Zuschauer mit Auge unten rechts, Multi-Live „+“ oben rechts; darunter Titel (2 Zeilen reserviert), Name in `tPurple` (tappbar → Kanalseite), Kategorie grau, Tag-Chips 18 pt Kapseln (CardViews.swift:110-173); kein Avatar | Avatar 36 px + Name als Titel, Stream-Titel darunter, Kategorie als Pill; Badges „LIVE“, „12,8k Zuschauer“, Uptime unten links (ui.tsx:98-110) | Aufbau komplett anders; Uptime-Badge gibt es auf iOS nicht; Tags fehlen | mittel | ja |
| Ansehen fortsetzen | `ResumeVodCard` 220 pt, Radius 6, 4 px Balken, Titel 1 Zeile `.subheadline.semibold`, Streamer `.footnote` (CardViews.swift:642-700); nur > 60 s, max. 10 | normale `VodCard` 260 px mit Dauer-Badge und „vor x“ (pages.tsx:87) | eigene Karte fehlt | klein | ja |
| Clips-Shelf | Titel „Clips deiner Kanäle“ + Menü „Alle Kanäle ⌄“ pro Kanal (HomeView.swift:471-489); `ShelfClipCard` 130 pt, 9:16, Radius 10, Auge+Zuschauer unten links, Titel 2 Zeilen `.caption` (963-998) | kein Kanalmenü; `ClipCard` 150 px, Badge „28 s“ unten rechts, Titel 15 px + „Name · n Aufrufe“ (ui.tsx:125-130) | Menü fehlt, Karte anders | mittel | ja |
| Top-Streams Sprachmenü | Menü mit genau 2 Einträgen: Gerätesprache (z. B. „Deutsch“) / „Weltweit“, Label `.subheadline.semibold` grau mit `chevron.down` neben dem Titel (HomeView.swift:510-528); Sprache selbst in Einstellungen → Allgemein | `<select>` mit 12 Sprachen, Akzentfarbe auf grauem Feld (pages.tsx:92-93, style.css:131) | anderes Steuerelement, andere Logik | klein | ja |
| Top-Shelf Limit | 20, ausgeblendete rausgefiltert + nachgefüllt (HomeView.swift:506) | alle geladenen | Länge | klein | ja |
| Offline-Shelf | Titel „Offline · N“ (Count), Avatar 64, Name `.caption` 12 pt, Breite 72, angeheftete zuerst (HomeView.swift:538-563) | „Offline“ ohne Zahl, Breite 76, 12 px (pages.tsx:97-98) | Zähler fehlt | klein | ja |
| Web-Session-/Drops-Link-Banner | Karten mit ✕ (eine Woche ausgeblendet) auf Home (HomeView.swift:300-379) | fehlen (Drops-Links nur in Settings) | fehlt | mittel | ja |
| Kontextmenüs (Long-Press) | StreamCard: „Zu Multi-Live“, „Oben in ‚Gefolgt‘ anheften“ (gefolgt), „Diesen Kanal ausblenden“/„Kategorie ‚x‘ ausblenden“ (Top); Offline-Avatar: anheften (CardViews.swift:178-182, HomeView.swift:560) | `onContextMenu` öffnet die Kanalseite (ui.tsx:100) | Menüs fehlen, Anheften gibt es gar nicht | groß | ja (eigenes Long-Press-Menü) |
| „Alle“-Listen | Inline-Titel; Toolbar-Toggle Raster/Liste (HomeView.swift:584-596); Raster = 2 Spalten StreamCard; Liste = `StreamRowView` (Thumb 136×76,5 Radius 8, roter Punkt + Zuschauer, Name `.subheadline.bold`, Titel `.footnote` 2 Zeilen, Kategorie-Pill, Tags, CardViews.swift:550-626); Top: Chips Sprache/Weltweit, „N hier ausgeblendet · Verwalten“, „Mehr laden“/„Twitch liefert den Rest gerade nicht.“ (727-767) | `grid` minmax 300 → 1 Spalte am Phone, `wide`-Karten; kein Toggle, keine Chips, kein Hidden-Footer (pages.tsx:106-127) | Raster 2-spaltig, Listenmodus, Chips, Footer fehlen | mittel | ja |
| Offline-„Alle“ | Zeilen: Avatar 36 px Deckkraft .75, Pin-Mark, Name, „13 T · 21. Okt.“, iPhone-Icon für lokale Follows, Chevron rechts (HomeView.swift:680-724) | Avatar 36, „Zuletzt live vor x“, kein Chevron/Icon (pages.tsx:122-124) | Details | klein | ja |
| Leerzustände „Alle“ | `ContentUnavailableView` mit SF-Icon (`heart`, `moon.zzz`, `exclamationmark.triangle`) + Aktion „Offline-Kanäle ansehen · N“ (HomeView.swift:600-677) | keine | fehlen | klein | ja |

## 1.4 Durchsuchen

Suchfeld sitzt in der PWA im Inhalt statt in der Leiste, Vorschlagsliste ist keine Karte, Verlauf ist ein anderer (Suchbegriffe statt zuletzt geöffnete Kanäle), Sortier-Chips der Kategorieseite fehlen, die Kategorieseite ist einspaltig.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Suchfeld | `.searchable` in der Nav-Bar, immer sichtbar, Prompt „Kanäle, Kategorien oder Links“ (SearchView.swift:322-337, GermanStrings:426) | eigenes `<input>` unter dem Titel, „Kanäle, Kategorien, Links“ (pages.tsx:159-162) | Platzierung/Text; kein Abbrechen-Button | klein | teilweise |
| Hinweiszeile | über den Ergebnissen „Sucht diesen Kanal“/„Öffnet dieses VOD“/„Öffnet diesen Clip“ mit Icon, `.caption` grau (SearchView.swift:57-64) | Zeilen „VOD 123 öffnen“, „Clip öffnen“, „Kanal ‚x‘ öffnen“ als list-row (pages.tsx:164-170) | andere Form | klein | ja |
| Vorschläge | Karte `tCard` Radius 14, Zeilen 48 pt, Avatar 32 mit rotem Ring (live), Name `.tCardTitle` + `eye.slash` wenn ausgeblendet, zweite Zeile „LIVE“-Badge 9 pt + „12.8k · Spiel“, `arrow.up.left` rechts, Divider ab 56 pt, max. 5 (SearchView.swift:130-191) | `list-row` Avatar 36, Punkt „● Live · Spiel · Zuschauer“, kein Pfeil, kein Hidden-Hinweis, ohne Limit (pages.tsx:166-168) | Karte, Ring, Badge, Pfeil fehlen | mittel | ja |
| Kategorien bei Suche | Shelf „Kategorien“, max. 12, Long-Press ausblenden (SearchView.swift:72-82) | Shelf „Kategorien“, kein Limit, kein Menü (pages.tsx:169) | Limit/Menü | klein | ja |
| Verlauf | „Zuletzt angesehen“ = zuletzt geöffnete Kanäle (max. 10) als 34-pt-Kapseln mit ✕ je Chip + rotes „Löschen“ im Header; nur im Suchmodus sichtbar; abschaltbar in Settings (SearchView.swift:193-242) | Suchbegriffe als Chips im Leerlauf + Chip „Verlauf löschen“ (pages.tsx:172-173) | anderer Inhalt, anderer Ort, kein ✕ pro Chip | klein | ja |
| Leerlauf-Titel | „Kategorien“ (CategoriesView.swift:167) | „Top-Kategorien“ (pages.tsx:175) | Text | klein | ja |
| „Deine Kategorien“ | mit „Alle“ → Grid-Seite „Deine Kategorien“ mit Leerzustand (CategoriesView.swift:159, 221-247); nach Zuschauern sortiert | kein „Alle“, Reihenfolge Speicher (pages.tsx:174) | „Alle“ fehlt | klein | ja |
| Kategorie-Kachel | Radius 6, Name `.footnote.semibold` 13 pt 2 Zeilen reserviert, roter Punkt 6 px + Zuschauer `.caption` (CardViews.swift:485-520); Long-Press Ausblenden; ausgeblendete mit Badge „Ausgeblendet“ und 50 % | Radius 8, Name 1 Zeile, „n Zuschauer“ ohne Punkt (ui.tsx:131-137, style.css:101-104) | Punkt, 2 Zeilen, Menü, Badge | klein | ja |
| Hidden-Footer / Mehr laden | „N hier ausgeblendet · Verwalten“ (Sheet) + „Mehr laden“ / „Twitch lädt ohne Konto gerade nicht mehr…“ (CategoriesView.swift:266-281) | nur „Mehr laden“ (pages.tsx:177) | Footer fehlt | klein | ja |
| Kategorieseite Toolbar | Inline-Titel; `eye.slash`-Icon (nur wenn nicht gefolgt/ausgeblendet) + Herz (gefüllt rot wenn gefolgt, Entfolgen mit Bestätigung) (CategoriesView.swift:508-566) | Herz + Textbutton „Ausblenden/Einblenden“ (pages.tsx:205-207) | Icon statt Text | klein | ja |
| Kategorieseite Kopf | kein Kopf; Zeile Chips: Sprachmenü (Globus, „Alle Sprachen“/Gerät/…, 33 Codes) + Sort-Chips „Meiste Zuschauer“/„Wenigste Zuschauer“/„Name (A → Z)“ (CategoriesView.swift:411-421, 597-633) | `cat-head` mit Boxart 72 px + „n Zuschauer“ + Sprach-Select 12 Sprachen; keine Sortierung (pages.tsx:208-210) | Kopf gibt es nicht, Sortierung fehlt | mittel | ja |
| Kategorieseite Raster | 2 Spalten StreamCard (CategoriesView.swift:392, 444) | `grid` wide → 1 Spalte (pages.tsx:213) | Spalten | klein | ja |
| Ausgeblendete Kategorie | Streifen „Ausgeblendet · Wieder anzeigen“ unter der Nav-Bar (CategoriesView.swift:570-593) | – | fehlt | klein | ja |

## 1.5 Meine VODs

Die PWA zeigt gemischten Verlauf (Live/Clips) mit Bearbeiten-Modus, iOS nur VODs mit Long-Press; Zeilen-Meta, Downloads-Sektion und Leerzustand weichen ab.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Inhalt | nur VODs (`type == .vod`, LibraryView.swift:21) | VOD + Live + Clip (pages.tsx:230, 238) | Live/Clip-Einträge gibt es auf iOS nicht | klein | ja |
| Leerzustand | Icon `film.stack`, „Noch kein VOD in deinem Verlauf.“ + „VODs, die du abspielst, erscheinen hier und laufen dort weiter, wo du aufgehört hast.“ (LibraryView.swift:55-57) | „Noch nichts angesehen“ / „Angesehene VODs, Clips und Livestreams erscheinen hier.“ ohne Icon (pages.tsx:234) | Texte, Icon | klein | ja |
| Downloads | Sektion „Downloads · 1,2 GB“ mit `DownloadRow` (LibraryView.swift:74-81, DownloadsView.swift:209-327) | Hinweistext „Downloads gibt es in der Web-App nicht…“ (pages.tsx:233) | technisch nicht machbar (Playlist-CORS) | – | nein |
| Verlauf-Header | „Verlauf“ 20 pt + rotes „Löschen“ (`.subheadline`) rechts mit Alert (LibraryView.swift:85-92) | Nav-Button „Bearbeiten/Fertig“, Löschen nur in Settings (pages.tsx:231) | anderes Muster | klein | ja |
| Tagesgruppen-Label | `.footnote.semibold` 13 pt grau (LibraryView.swift:94-98) | `.section-title` 22 px/700 (pages.tsx:235) | viel zu groß | klein | ja |
| Zeile | Thumb 116×65, Radius 8, 3 px Balken; Titel `.tCardTitle` 2 Zeilen; Streamer `.caption` in `tPurple`; Meta-Zeile 16 pt hoch: Uhr-Icon „12min / 3h 10min“ + Auge + Aufrufe (LibraryView.swift:150-242) | Thumb 120, Radius 8; Titel; „Live · Name“ grau; Balken 4 px darunter (pages.tsx:236-240) | Meta fehlt, Balken-Ort, Farbe des Streamers | klein | ja |
| Entfernen | Long-Press: „Zu Multi-Live“ + „Aus dem Verlauf entfernen“ (LibraryView.swift:202-212) | Bearbeiten-Modus mit rotem ✕ (pages.tsx:240) | Muster | mittel | ja |
| Ansehen fortsetzen | `ResumeVodCard`, max. 15, < 95 % (LibraryView.swift:24-31) | `VodCard` 260 px, max. 20 (pages.tsx:102, 232) | Karte (s. Home) | klein | ja |

## 1.6 Kanalseite

Grundaufbau stimmt, aber Banner-Form, Avatar-Größe, Statuszeile, Beschreibungs-Kürzung, Button-Reihe, Tab-Inhalte (Clips 16:9 in 2 Spalten, Playlists mit „Alle abspielen“, nicht gelistete VODs inline, Filter per Lupe) weichen ab; die PWA hat zusätzliche Buttons (Multi-Live, Ausblenden, Lokal entfolgen) und Hinweistexte, die es auf iOS nicht gibt.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Nav-Bar | Titel leer (inline), rechts nur 🔍 (Filter, wechselt auf Tab VODs, ✕ zum Schließen) (ChannelView.swift:234-244) | Titel = Kanalname, rechts Teilen-Icon (pages.tsx:309) | Titel, Lupe fehlt, Teilen am falschen Ort | klein | ja |
| Banner | Höhe 96 pt, Radius 14, 16 pt Seitenabstand (ChannelView.swift:271-278) | volle Breite, 6:1, eckig (style.css:164) | Form | klein | ja |
| Avatar | 76 pt, Ring 2,5 pt rot mit −3 Padding wenn live (ChannelView.swift:281-286) | 84 px, Ring 3 px Hintergrund + 2 px rot (style.css:92-93) | Größe/Ring | klein | ja |
| Name | `.title2.bold` 22 pt + `checkmark.seal.fill` in Akzent (ChannelView.swift:290-293) | 24 px + Häkchen im Akzentkreis 18 px (pages.tsx:314, style.css:166-167) | Größe, Partner-Symbol | klein | ja |
| Statuszeilen | „@login“ `.subheadline`; dann eine Zeile `.footnote`: „12.8k Follower · ● LIVE“ (LIVE rot bold, Punkt 7 px) oder „12.8k Follower · Offline seit: 13 T · 21. Okt.“ (ChannelView.swift:295, 371-385) | „@login · 12,8k Follower“ und darunter „● LIVE“ / „Offline · zuletzt live vor x“ (pages.tsx:315-316) | Zeilenaufteilung, Wortlaut | klein | ja |
| Beschreibung zu | erste 80 Zeichen (Zeilenumbrüche entfernt), 2 Zeilen, grau + „ …mehr“ fett in Textfarbe; darunter Zeile Link-Icon „X und n weitere Links“ semibold Textfarbe; ganzer Block ist ein Button (ChannelView.swift:327-351) | CSS-Clamp 2 Zeilen + „ …mehr“ in Akzent; Link-Zeile als Akzent-Link ohne Icon (pages.tsx:319, 324) | Farben, Icon | klein | ja |
| Beschreibung offen | Volltext mit Links (`richText`), Socials als Label mit Link-Icon in Akzent, Panels als `tCard`-Karten Radius 14 (Bild → Titel → Text), Button „Weniger anzeigen“ fett; schwebende Kapsel „⌃ Weniger anzeigen“ (`.regularMaterial`, Schatten) 32 pt über dem Rand, scrollt zum Header (ChannelView.swift:302-325, 207-230) | Socials als list-rows, Panels ohne Kartenfläche, „Weniger anzeigen“ als Link; keine schwebende Kapsel (pages.tsx:320-323, style.css:171) | Panels-Karten, Kapsel fehlt | mittel | ja |
| Buttons | nur 2: `PlayerFollowButton` (Kapsel: „Folgen“ prominent Akzent mit Herz / „Folge ich“ grau bordered mit Häkchen, Entfolgen mit confirmationDialog) + „Teilen“ grau bordered Kapsel (ChannelView.swift:355-364, MainTabView.swift:2260-2315) | bis zu 4 Buttons mit Texten „Auf Twitch folgen“/„Gefolgt (Twitch)“/„Folgst du (Twitch)“/„Lokal entfolgen“, „Multi-Live“, „Ausblenden“ + 3 Hinweis-Absätze (pages.tsx:325-336) | zu viele Elemente, Texte; Zustand „Folge ich“ + Häkchen fehlt | mittel | ja |
| Tabs | Unterstrich 2,5 pt Kapsel in Textfarbe, aktiv `.semibold`, inaktiv `.regular` grau, Abstand 16, Divider darunter (ChannelView.swift:399-420) | 2 px Rand, immer 600, Abstand 18, Rahmenlinie (style.css:172-174) | Gewicht/Dicke | klein | ja |
| Übersicht Live-Karte | 16:9 640×360, Radius 14, Badge „JETZT LIVE“ (11 pt) oben links, Titel `.headline`, „12.8k Zuschauer · Spiel“ `.footnote` (ChannelView.swift:434-453) | `StreamCard wide` mit Avatar/Pill (pages.tsx:340) | eigene Karte | klein | ja |
| Übersicht Shelves | VODs (220 pt, inkl. nicht gelisteter an ihrem Datum, ohne die große Karte), Clips (`ShelfClipCard`), Highlights (220), Playlists (Karte mit Playlist-Titel, Tipp = Queue) (ChannelView.swift:460-493) | VODs 260 px ab Index 0 (Doppelung mit großer Karte), „Clips der Woche“ (iOS: „Clips“), Highlights, keine Playlists (pages.tsx:341-343) | Titel, Doppelung, Playlists-Shelf fehlt | klein | ja |
| VODs-Tab | 1 Spalte `VodCardView` (Kartenfläche, Dauer-Badge oben rechts, 3 px Balken, Titel + kurzes Datum); nicht gelistete inline als `UnlistedVodCardView` (Verlauf-Gradient, Badge „Nicht gelistetes VOD“ Akzent / „Nicht mehr verfügbar“ rot, Icon `eye.slash`/`xmark.octagon`) (CardViews.swift:260-405, ChannelView.swift:534-571); Infinite Scroll; Filterfeld `TSearchField` „Stichwort (z. B.: Horror)“ nur nach Lupe; „Ältere VODs suchen“ | Filterfeld „VODs filtern“ immer sichtbar; `VodCard wide` (Badge unten rechts, „Name · vor x · n Aufrufe“); „Mehr laden“-Button; nicht gelistete als eigene Sektion „Nicht gelistete VODs“ + Erklärtext, Status-Badge „Suche …“/„Nicht verfügbar“ (pages.tsx:347-361) | Karte, Platz der Badge, Filter, Unlisted-Darstellung | mittel | ja |
| Clips-Tab | `TChip`-Kapseln „24 Std. / 7 T / 30 T / Alle“ (small), 2-Spalten `ClipCardView` 16:9 (Auge+Zuschauer oben links, „0:28“ unten rechts, Meta „Datum · Kurator“), „Mehr laden“ (ChannelView.swift:675-725, CardViews.swift:408-469) | `Segmented` „24 Std./7 Tage/30 Tage/Alle“, `clip-grid` 9:16-Karten, kein Mehr laden (pages.tsx:363-365) | Steuerelement, Kartenformat, Labels | mittel | ja |
| Highlights-Tab | 1 Spalte `VodCardView` | `grid` wide | wie VODs | klein | ja |
| Playlists-Tab | pro Liste: Titel `.callout.bold`, „Beschreibung · n Video(s)“ `.caption`, rechts Kapsel „▶ Alle abspielen“ (small, Akzent), darunter Reihe `VodCardView` 200 pt (ChannelView.swift:607-661) | einfaches `Shelf` ohne Beschreibung/Zähler/Alle abspielen (pages.tsx:368) | Kopf und Queue fehlen | mittel | ja |
| Long-Press VOD | „Zu Multi-Live“ (ChannelView.swift:590) | – | fehlt | mittel | ja |
| Fehler/nicht gefunden | `ContentUnavailableView` „Streamer nicht gefunden.“ bzw. „Fehler beim Laden der Daten.“ + „Erneut versuchen“ (ChannelView.swift:191-194) | „Streamer nicht gefunden“ ohne Retry (pages.tsx:280) | Retry fehlt | klein | ja |

## 1.7 Einstellungen und Login

Die PWA ist eine einzige lange Seite ohne Untermenüs, iOS ein Settings-App-ähnliches Menü (Icons in Farbquadraten, acht Unterseiten). Viele iOS-Schalter fehlen, einige PWA-Schalter gibt es auf iOS nicht (oder woanders).

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Präsentation | Sheet, `NavigationStack`, großer Titel, `TCloseButton` (SettingsView.swift:52-64) | gepushte Seite mit Zurück | Muster | klein | ja |
| Wurzelmenü | Account-Banner (Avatar 60, Login `.title2.semibold`, „Verbunden“/„Nur Web-Sitzung“), dann 8 Zeilen mit 29-pt-Farbquadraten (Radius 7, weißes Symbol): Twitch-Konto lila `person.crop.circle.fill`, Allgemein grau `gearshape.fill`, Player blau `play.rectangle.fill`, Chat grün `bubble.left.and.bubble.right.fill`, Drops rot `shippingbox.fill`, Kanalpunkte indigo `circle.circle.fill`, Funktionen im Test orange `flask.fill`, Über grau `info.circle.fill`; Footer „Version 1.4.x“ (SettingsView.swift:131-249) | flache Sektionen Konto / Kanalpunkte & Drops / Videoplayer / Reihenfolge der Live-Quellen / Chat / Darstellung / Mitteilungen / Ausgeblendet / Daten / Info (pages.tsx:401-491) | Struktur und Reihenfolge | groß | ja |
| Unterseiten | `Form` mit Karten-Sektionen, jede mit `Label`-Kopf (Icon Akzent, `.headline`): z. B. Allgemein = Top-Streams-Sprache (Menü), „Startseite als Liste“, „Zuletzt angesehen“; Ausgeblendet; Darstellung; Truhen; Sleep-Timer; Verlauf (Stat-Boxen VODs/Kanäle + „Löschen“); Sicherung; Cache (SettingsView.swift:269-300, 418-1096) | keine Köpfe mit Icon; Top-Sprache, Startseite als Liste, Zuletzt angesehen, Sleep-Timer, Verlauf-Statistik, Cache fehlen | Inhalte | groß | ja (Sleep-Timer/Cache: teilweise) |
| Akzent-Auswahl | 7 Kreise 28 pt, aktiv weißer Ring 2,5 + Häkchen, a11y-Label (SettingsView.swift:477-498) | 6 Kreise 26 px, Ring in Textfarbe, keine Häkchen (pages.tsx:453-454) | Palette, Markierung | klein | ja |
| App-Symbol | 58 pt, Radius 13, Rand Akzent 3 pt / `tBorder` 1 pt, Label darunter („Klassisch“, „Lila“, „Nacht“, „Hell“, „Kontrast“, „Neon“), Hinweistext (SettingsView.swift:508-565) | 48 px, Radius 11, keine Labels (pages.tsx:455-457) | Größe/Labels | klein | ja |
| Konto | Zeilen „API-Anmeldung“ (Chat, gefolgte Kanäle und Top) und „Web-Sitzung (Punkte)“ mit Häkchen-Icon grün + bordered Button „Mit Twitch anmelden“/„Abmelden“; „Konto wechseln“ (SettingsView.swift:1139-1200) | eine Zeile „Mit Twitch anmelden“ in Akzent bzw. Avatar+Name+„Verbunden · n Twitch-Follows“ und rotes „Abmelden“ (pages.tsx:403-409) | Aufbau | mittel | ja |
| Login-Flow | `TwitchWebLoginSheet`: WKWebView twitch.tv, Cookie + App-Token, ggf. „Authorize“ (HomeView.swift:116-132) | Sheet mit Device-Code (38 px Monospace, „twitch.tv/activate öffnen“) (pages.tsx:493-515) | technisch bedingt | – | nein (Web-Login mit Cookie nicht möglich) |
| Player-Seite | Immersiver Player, Niedrige Latenz, „Mit meinem Abo werbefrei schauen“ (+ „Web-Sitzung verbinden“), Reihenfolge (nummerierte Akzent-Kreise 22 pt auf `tSurface`-Zeilen Radius 10, Chevron-Pfeile 34 pt, „Standardreihenfolge“), Bevorzugte Qualität (Menü „Quelle (Original)“ … „Nur Audio“), Bildschirm füllen (Querformat), Stummgeschalteten Ton wiederherstellen, Chat im Multi-Live, 3D-Audio (segmented Auto/Aus), Latenz anzeigen (SettingsView.swift:851-998) | Bevorzugte Qualität (Select „Source“/„Automatisch“…), Niedrige Latenz, Bildschirm füllen, „Werbepausen überbrücken“ (nicht in iOS-Settings), Reihenfolge mit ↑↓-Textpfeilen + Ad-Statistik, „Nach Werbepausen sortieren“ (iOS automatisch) (pages.tsx:426-438) | Labels (iOS „Modus mit niedriger Latenz“, „Bildschirm füllen (Querformat)“, „Quelle (Original)“), fehlende/zusätzliche Schalter, Ad-Statistik gibt es auf iOS nicht in den Settings | mittel | ja |
| Chat-Seite | Chat-Verhalten (Letzte Nachrichten laden, Autovervollständigung, Gelöschte, Bots, Befehle getrennt, Auto-Sync + Stepper, Stummgeschaltete Wörter, Hervorgehobene Wörter, blockierte Nutzer), Anpassung (Angeheftete, Kanal-Drops, Zuschauerserie, Umfragen & Vorhersagen, Raid-System, Querformat-Banner), Chat-Größen (Live-Vorschau mit `ChatMessageRow`, Zeitstempel, 5 Slider Schriftgröße/Abstand/Abzeichen/Emote/Breite, Reset) (SettingsView.swift:713-849) | Schriftgröße-Select (13/15/17/20), Zeitstempel, Gelöschte, „Bots und !Befehle ausblenden“ (kombiniert), Automatisch übersetzen (auf iOS im Chat-Zahnrad, nicht in Settings), Namensfarbe (iOS: im Chat-Sheet) (pages.tsx:440-450) | Großteil fehlt; Slider statt Select | groß | ja |
| Drops/Kanalpunkte | eigene Seiten (DropsPanel, PointsTrackerPanel) mit Karten | in „Kanalpunkte & Drops“: 3 Toggles + „Drops jetzt prüfen“ + Kampagnen-Liste (pages.tsx:411-424) | iOS-Seiten nicht nachgebaut | groß | teilweise |
| Mitteilungen | iOS: unter „Funktionen im Test“ (Live-Benachrichtigungen + Testbutton, ntfy) | eigene Sektionen „Mitteilungen“ + „Mitteilungen im Hintergrund“ (GitHub-Secret-Anleitung) (pages.tsx:460-462, push.tsx) | andere Technik; Platz | – | teilweise |
| Ausgeblendet | Karte mit Zähler „Kanäle (n) · Kategorien (n)“ → `HiddenContentSheet` (List mit Sektionen, Kapsel „Wieder anzeigen“, Swipe, „Alle wieder anzeigen“, Detents medium/large) (SettingsView.swift:435-467, HiddenContentSheet.swift) | Sektion mit Zeilen + Link „Einblenden“ (pages.tsx:464-466) | Sheet, Wortlaut („Wieder anzeigen“), Alle | klein | ja |
| Daten | Sicherung: Text + zwei bordered Buttons „Exportieren“/„Importieren“ mit Icons; Verlauf-Löschen in „Verlauf“-Karte (SettingsView.swift:1202-1266) | „Sicherung exportieren/importieren“, „Verlauf löschen“ als Zeilen (pages.tsx:468-473) | Form | klein | ja |
| Über | Karte: „TwitchUnblock“ `.tSection` + Version + Akzentkreis 26, Beschreibung, „Erstellt von MXFia19“, Zeile „Quellcode der App“ (44 pt `tSurface`, `arrow.up.right`), „Unabhängiges Projekt, nicht mit Twitch verbunden.“, „Systemprotokolle anzeigen“ mit Zähler-Badge; dazu „Experteneinstellungen“ (eigener Worker) (SettingsView.swift:1417-1474, 304-382) | Zeilen „Systemprotokoll · n Einträge ›“, „Version Web x“, „Quellcode (GitHub)“, „Original-App von MXFia19 (MIT-Lizenz)“, „Was die Web-App nicht kann“ (pages.tsx:480-488) | Wortlaut/Aufbau; Experten-Worker fehlt (in Ordnung) | klein | ja |
| Toggle-Zeilen | Titel `.tCardTitle` + Untertitel `.caption`, Toggle Akzent-Tint (SettingsView.swift:1670-1691) | Switch grün #34c759 fest (style.css:126) | Toggle-Farbe = Akzent | klein | ja |

## 1.8 Sonstiges (Sheets, Leerzustände, Loader, Hinweise)

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Sheet-Leiste | `tSheetBar`: NavigationStack, Inline-Titel, System-Schließen (iOS 26 ✕-Symbol, sonst „Schließen“) links (DesignSystem.swift:209-234) | 40/1fr/40-Grid, ✕ rechts 30 px grau (style.css:184-186) | Seite des Schließen-Buttons | klein | ja |
| Leerzustand | `ContentUnavailableView`: SF-Icon groß, Titel `.title2.bold`, Beschreibung, optional `TPrimaryButton` (DesignSystem.swift:380-424) | h3 20 px + p, kein Icon, keine Aktion (ui.tsx:86-88) | Icon/Aktion fehlen | klein | ja |
| Loader | System-`ProgressView` grau (DesignSystem.swift:427-433) | CSS-Ring 28 px, Akzent (style.css:160) | Farbe | klein | ja |
| Mehr-laden-Button | `tBorderedStyle` large, volle Breite, Akzent, busy → Spinner; Ende-Hinweis `TListEndNote` (DesignSystem.swift:473-514) | `.btn wide` Glas, Akzent, kein Busy-Zustand (style.css:139-143) | Busy/Ende-Hinweis fehlen | klein | ja |
| Chips | `TChip`: `.bordered` grau / `.borderedProminent` Akzent, `.small`, Kapsel, Label mit Icon möglich (DesignSystem.swift:238-264) | `.chip` Glas 34 px, aktiv Akzent-Fläche (style.css:149, 371) | nah dran; Icon-Variante fehlt | klein | ja |

## Die 10 wichtigsten Angleichungen der Bildschirme

1. **StreamCard wie iOS bauen**: Kartenfläche `tCard` Radius 14, 12 px Innenabstand, Titel 2 Zeilen reserviert, Name in heller Akzentvariante (tappbar), Kategorie grau, Tag-Chips, Badges „JETZT LIVE“ 9–11 pt (Radius 4) und Auge+Zuschauer unten rechts; Avatar und Uptime weg; Breiten 300/240. (mittel)
2. **VodCard/ResumeVodCard/ClipCard angleichen**: Dauer-Badge oben rechts, 3 px Balken, kurzes Datum statt „vor x“; Resume-Karte 220 px, Radius 6, 4 px Balken; Shelf-Clip 130 px mit Auge-Badge unten links; Clip-Grid auf der Kanalseite 16:9 in 2 Spalten mit „0:28“. (mittel)
3. **Formatierung**: `formatViewers` „12.8k“ ohne Mio, `formatDuration` „1h 23min“, Offline „13 T · 21. Okt.“, Clip-Dauer „0:28“. (klein)
4. **Kanalseite-Header**: Nav-Titel leer + Lupe (Filter einblendbar), Banner 96 px mit Radius 14, Avatar 76, Statuszeile „Follower · ● LIVE / Offline seit: …“, „…mehr“ fett in Textfarbe, nur „Folgen/Folge ich“ + „Teilen“ als Kapseln; die Extra-Buttons und Hinweistexte raus (Multi-Live/Ausblenden ins Long-Press-Menü). (mittel)
5. **Kontextmenüs per Long-Press** auf Stream-, Kategorie-, VOD-Karten und Verlaufszeilen (Multi-Live, Anheften, Ausblenden, Entfernen) statt Bearbeiten-Modus und Rechtsklick → Kanalseite. (groß)
6. **Einstellungen als Menü mit Unterseiten** (8 Einträge mit Farbquadrat-Icons, Account-Banner oben, Version im Footer) und die fehlenden Allgemein-/Player-/Chat-Schalter mit iOS-Wortlaut; Toggle-Farbe = Akzent; Akzentpalette und App-Symbol-Kacheln wie iOS. (groß)
7. **„Alle“-Listen**: 2-Spalten-Raster, Raster/Liste-Toggle in der Nav-Bar mit `StreamRowView`-Layout, Sprach-Chips und „N hier ausgeblendet · Verwalten“, Leerzustände mit Icon. (mittel)
8. **Kategorieseite**: Kopf mit Boxart entfernen, Chip-Zeile Sprachmenü + Sortierung, 2-Spalten-Raster, `eye.slash`-Icon statt Text, „Ausgeblendet · Wieder anzeigen“-Streifen. (mittel)
9. **Browse-Details**: Vorschläge als Karte (Avatar 32 mit rotem Ring, LIVE-Badge, Pfeil, max. 5), Hinweiszeile „Sucht diesen Kanal“, „Zuletzt angesehen“-Kanal-Chips mit ✕ im Suchmodus, Leerlauf-Titel „Kategorien“, „Alle“ bei „Deine Kategorien“, Kachel mit rotem Punkt und 2 Zeilen. (klein–mittel)
10. **Typografie-Feinheiten**: Sektionstitel 20 px, Meta 12 px, Badge 11 px/700, Tagesgruppen 13 px semibold grau, Verlaufszeile mit Uhr/Auge-Meta und Streamer in Akzent, Avatar-Ring 2 px im Nav-Button, Library-Tab-Icon `clock.arrow.circlepath`, Offline-Shelf „Offline · N“. (klein)

Nicht im Browser machbar: Downloads (VOD-Playlists nicht lesbar), Web-Login mit twitch.tv-Cookie (Device-Code bleibt), echtes `tabBarMinimizeBehavior`/Liquid Glass (nur angenähert).

# Teil 2: Player und Chat

Grundlage: `Sources/Views/Player/*`, `Sources/Chat/*`, `Sources/Views/MainTabView.swift` (Zeilen 643–1460 Player-Layout, 1654–1740 Mini-Player), `Sources/Views/Screens/MultiLiveView.swift`, `Sources/AppStore.swift` gegen `pwa/src/player.tsx`, `chat.ts`, `events.tsx`, `notices.tsx`, `ui.tsx`, `pages.tsx`, `style.css`. Der immersive Player (`ImmersivePlayer.swift`) hat in der PWA kein Gegenstück und ist nicht einzeln aufgeführt; die Tabellen vergleichen den nativen Player mit eigenen Controls.

Konventionen der iOS-App: `tPrimary` = Akzent (Standard #9146ff), `tLive` = #e91916, `tWarning` = #e6e619, `tSuccess` = #00ff88, `tCard` = secondarySystemBackground, `tSurface` = tertiarySystemFill; `.footnote` = 13 pt, `.subheadline` = 15 pt, `.headline` = 17 pt semibold, `.title3` = 20 pt. Chat-Schrift Standard 13 pt (`AppStore.swift:338`, Bereich 10–20).

## 2.1 Player-Steuerung (Overlay)

Die PWA hat Aufbau und Fade-Out übernommen, weicht aber bei Knopf-Optik (Kreise statt nackter Glyphen), Fortschrittsleiste (kein Inset, kein Drag-Knopf, keine Zeit-Bubble, live ohne Archiv gar keine Leiste), Live-Chip, Doppeltipp-Feedback und beim Vollbild-Verhalten ab.

| Element | iOS (Referenz) | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Reduzieren-Knopf oben links | `PlayerControls.swift:240-249`: `chevron.down` 18 pt semibold, weiß, Schatten, 44×44 Trefffläche, kein Hintergrund | `player.tsx:505`, `style.css:205`: `.glass` 36 px Kreis rgba(60,60,60,.45) blur 12 | Kreis statt nackter Glyphe; 36 statt 44 px | klein | ja |
| Titel neben dem Chevron | `PlayerControls.swift:251`, `MainTabView.swift:1120-1146`: nur im Querformat (`landscapeTitle`: Name `.tCardTitle` weiß, darunter `● Uptime` rot + 👁 Zuschauer als `TMeta`); Hochformat nichts | `player.tsx:506`, `style.css:203`: `<b>Name</b> · Uptime` 13 px, immer, einzeilig | Im Hochformat überflüssig; im Querformat fehlen 2 Zeilen, kein Tipp → Kanalseite | klein | ja |
| Knöpfe oben rechts | `PlayerControls.swift:263-299`: [💬 nur Querformat bei geschlossenem Chat] · AirPlay 44×44 · `gearshape.fill` 18 pt semibold, alle ohne Hintergrund, mit Schatten | `player.tsx:507-509`: AirPlay, PiP, Zahnrad als `.glass` 36 px Kreise, Zahnrad als Umriss-Icon | PiP-Knopf gibt es in iOS nicht; 💬-Knopf fehlt; Kreise statt Glyphen | klein | ja (PiP-Knopf bleibt sinnvoll, Safari hat kein Auto-PiP) |
| Mittelknöpfe | `PlayerControls.swift:381-411`: Glas-Kreise 44 / 60 / 44 pt, Glyphe = 40 % der Größe, Abstand 36 (Hoch) / 56 (Quer); Vor-Knopf am Live-Rand (< 5 s) Opazität .35 + disabled; beim Puffern `ProgressView` 60 pt statt Play | `player.tsx:512-514`, `style.css:204-207`: 56 / 56 / 56 px, Icons 28/32/28, Abstand 28 fix; ±10 s fehlen ganz, wenn `!canSeek`; kein Puffer-Spinner; Vor-Knopf nie abgeblendet | Größen, Abstände, Live-Rand-Logik, Spinner | klein | ja (`waiting`-Event) |
| Doppeltipp ±10 s | `PlayerControls.swift:339-378`: sofort; „⏪ 10 Sekunden“-Blitz (Kreis weiß .18) 0,7 s auf der getippten Hälfte; rechts am Live-Rand ignoriert | `player.tsx:489-495`: 300 ms Fenster, kein Feedback, Einzeltipp erst nach 300 ms; kein Live-Rand-Guard | Feedback fehlt, Einzeltipp träge | klein | ja |
| Verlauf (Gradient) | `PlayerControls.swift:307`: schwarz .45 → .10 → .55 | `style.css:199`: .45 → transparent 30 %…70 % → .55 | Mitte .10 statt 0 | klein | ja |
| Zeitangabe unten links | `PlayerControls.swift:442-482`: `.footnote` semibold monospaced; Position weiß, „/ Gesamt“ weiß .7; hinter Live zusätzlich Kapsel „● Live“ (Punkt 7 pt weiß .6, Kapsel schwarz .35, Padding 9/5); am Rand nur „● Live“ mit rotem Punkt ohne Kapsel | `player.tsx:517-519`, `style.css:208-210`: alles 13 px eine Farbe; `.live-dot` 13 px bold weiß .7 ohne Kapsel; am Rand rot | Zweifarbigkeit und Kapsel fehlen | klein | ja |
| Vollbild-Knopf | `PlayerControls.swift:424-433`, `MainTabView.swift:1148-1157`: `arrow.up.left.and.arrow.down.right` 17 pt, 44×44 → `rotatePlayer` (Querformat in der App, Chat daneben) | `player.tsx:521-524`: zwei Knöpfe: „Querformat“ (CSS-Rotation `pseudo-land`) und „Vollbild“ (Safari-Vollbild, verliert Chat und Controls) | iOS kennt nur einen Knopf = Querformat mit Chat | klein | teilweise (keine Orientation-Lock-API; die CSS-Rotation entspricht iOS, Safari-Vollbild wäre zu streichen) |
| Fortschrittsleiste | `PlayerControls.swift:488-563`: Kapsel in Akzent über volle Breite; sichtbar: Inset 18 (Hoch) / 28 (Quer) px, Linie 4 px (6 beim Ziehen), Knopf 14 px (22 beim Ziehen) mit Schatten, 44 px Griffstreifen; Bubble mit Zielzeit/„Live“ (schwarz .75 Kapsel, 30 px darüber); ausgeblendet: 3 px Linie am Bildrand (nur VOD); live immer vorhanden | `player.tsx:527-532`, `style.css:211-217`: `<input type=range>` 14 px, bottom −7 px, Track 3 px weiß .35, Knopf 14 px nur wenn sichtbar, kein Inset, kein Dickerwerden, keine Bubble; nur wenn `total>0 && canSeek && (live ? archive : true)` → Live ohne Aufzeichnung keine Leiste; Kapitelmarker `<i>` (im nativen iOS-Player nicht vorhanden) | Optik und Drag-Verhalten; Live ohne Archiv | mittel | teilweise (Safari `seekable` beim Live-HLS nur wenige Minuten) |
| Fade-out | `PlayerControls.swift:171-179`: 3 s bei Wiedergabe, Pause → bleibt; 0,2/0,25 s animiert | `player.tsx:482`: 3 s, Pause bleibt; `.controls.on` ohne Transition | Animation fehlt | klein | ja |
| Pull nach unten (Hochformat) | `PlayerControls.swift:325-336`, `PlayerPull.swift`, `MainTabView.swift:1426-1445`: Drag ab 12 pt, Player folgt dem Finger und schrumpft bis 12 %, Schwelle `min(120, max(80, 15 % Höhe))` oder Schwung; Zurückfedern | `player.tsx:413-419`: nur `touchend` mit dy > 90 && |dx| < 60 → minimieren; kein Mitführen | Kein visuelles Feedback | mittel | ja (transform in touchmove) |
| Pinch im Querformat | `PlayerControls.swift:301-304`: > 1,08 füllen, < 0,92 ganzes Bild, 0,25 s animiert | `player.tsx:412`: `gestureend` ±0,1 | gleichwertig, ohne Animation | klein | ja |
| Werbepausen-Banner | `ImmersivePlayer.swift:2183-2236` (compact, in `VideoPlayerView.swift:928`): oben Mitte, Kapsel schwarz .65, 📣 „Werbepause · {n} s“ 11 pt bold, Countdown; `VideoPlayerView.swift:931-946`: Lücke ohne Ersatz → Glas-Kapsel „Werbepause übersprungen · weiter in {n} s“ | `player.tsx:435-436`, `style.css:220`: unten links, Box schwarz .75 radius 8, 13 px: „Werbepause · Ton aus“ bzw. „Werbepause übersprungen · über {Quelle}“, 6 s; ohne Countdown | Position, Form, Texte, Countdown | klein | teilweise (Restdauer aus `EXT-X-DATERANGE`-Cue `DURATION`) |
| Hinweis-Kapsel (Account-Stream) | `VideoPlayerView.swift:951-961`: unten, 13 pt bold, Kapsel schwarz .65, 2,5 s | fehlt | – | klein | ja |
| Ton-an-Pille | fehlt (nicht nötig) | `player.tsx:428-434`: „🔇 Ton an“ oben Mitte | Browser-Zwang | – | – |

## 2.2 Player-Einstellungs-Sheet

Die PWA packt alles in ein Sheet mit `<select>`-Zeilen und zusätzlichen Kanal-/Multi-/Teilen-Zeilen; iOS hat ein kurzes Sheet mit Icon-Zeilen, Unterlisten mit Haken, genau so hoch wie seine Zeilen, und einen eigenen Sleep-Timer-Sheet.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Sheet-Rahmen | `PlayerSettingsSheet.swift:27-71`: insetGrouped List, dunkel, ohne Titel-Leiste, Drag-Indicator, Höhe `76 + 52 × Zeilen` (zweiter Detent `.large`) | `player.tsx:543`, `ui.tsx:148-155`, `style.css:178`: Titel „Einstellungen“ + ✕, max-height 88vh | Titelzeile zu viel, Höhe nicht an Zeilen gebunden | klein | ja |
| Zeilen-Icons | `PlayerSettingsSheet.swift:83-89`: `Label` mit SF-Symbol (slider.horizontal.3, gauge…, bubble.left.and.bubble.right, moon.zzz, gobackward), Wert rechts grau | `player.tsx:545-558`: Text links, `<select>` rechts, keine Icons | Icons fehlen | klein | ja |
| Qualität | `:30-35`: Zeile → Unterliste mit Haken, Auswahl schließt Sheet | `:545-547`: `<select>` inline + Hinweistext bei „Twitch offiziell“ | Unterliste statt Select | klein | ja |
| Quelle | nicht im Sheet (nur immersives ⋯-Menü `PlayerMenuSheet.swift:67-79`) | `:548-549`: Select „Quelle“ | PWA-Zusatz | klein | – |
| Geschwindigkeit | `:37-43`: nur VOD/Clip, Unterliste `VodSpeed.all`, „Normal“ für 1× | `:550-551`: `<select>` 0,5…2, „Normal“/„1.25×“ | Unterliste; Label-Format (de-Komma) | klein | ja |
| Chat | `:45-53`: ein Toggle, der im Hochformat `chatHidden`, im Querformat `landscapeChat` (.column/.hidden) schaltet | `:552-555`: Toggle „Chat“ + Select „Chat im Querformat“ (Daneben / Über dem Video / Aus) | „Über dem Video“ gibt es im nativen Player nicht mehr (`MainTabView.swift:648-649`); zweite Zeile entfällt | klein | ja |
| Sleep-Timer | `:54-56` → `SleepTimerSheet.swift`: Kapsel-Raster 15/30/45/60/90/120 min, eigene Dauer 1–720 min, laufend: Restzeit `largeTitle` lila; Chip mit Restzeit unter dem Video (`MainTabView.swift:1345-1347`) | `:556-558`: `<select>` 0/15…120 inline; Restzeit im Zeilentext | eigener Sheet, Restzeit-Chip, freie Dauer fehlen | klein | ja |
| Zurückspulen | `:57-61`: nur bei Live ohne angehängte Aufzeichnung | fehlt (PWA springt per Leiste ins Archiv, `player.tsx:361-368`) | funktional gedeckt | – | – |
| Kapitel / Kanalseite / Multi-Live / Teilen | nicht im Sheet; Kanal = Avatar/Name unter Video, Multi-Live/Teilen = Chips (`MainTabView.swift:1320-1351`) | `:560-566`: eigene Gruppen im Sheet | wandern in die Stream-Info (2.3) | klein | ja |

## 2.3 Layouts Hoch- / Querformat

Größter Unterschied: iOS zeigt bei offenem Chat zwischen Video und Chat nur die 48 pt-Kopfzeile „Live-Chat“ (Zahnrad, ✕) und bei geschlossenem Chat eine YouTube-artige Stream-Info; die PWA hat stattdessen immer eine Info-Zeile (Avatar, Titel, Herz, Punkte) und keinen Chat-Header. Im Querformat ist die Chat-Breite in iOS verstellbar, in der PWA fest 34 %.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Video im Hochformat | `MainTabView.swift:655,694-703`: Breite × 9/16, `ignoresSafeArea(.vertical)` → Bild liegt unter der Statusleiste; Home-Indikator ausgeblendet (`:330`) | `style.css:195`: `margin-top: var(--safe-t)` → schwarzer Balken über dem Bild | Bild sitzt tiefer | klein | ja |
| Chat-Header (Chat offen) | `MainTabView.swift:1209-1260`: 48 pt, `tDark`, „Live-Chat“ / „Chat-Wiedergabe“ `.headline`; rechts [LIVE-Kapsel rot bei Aufzeichnung] [Clip ◀ ▶] Zahnrad 17 pt → `ChatSettingsSheet`, ✕ 16 pt → Chat zu; Divider; Pull am Header reduziert den Player | fehlt; `player.tsx:443-456` zeigt `.info-row` (Avatar 36, Titel, Sub-Zeile, ◆ Punkte, ♥) | Chat-Einstellungen aus dem Chat nicht erreichbar; Info-Zeile frisst Platz | mittel | ja |
| Chat geschlossen (Hochformat) | `MainTabView.swift:1170-1206,1304-1316`: Stream-Info: Titel `.title3` bold (3 Zeilen), Detailzeile `.footnote` grau „6,3k Zuschauer · ● 3:15:11 · Spiel“, Avatar 40 + Name `.headline` + `PlayerFollowButton` („Folgen“ lila / „Folge ich“ grau), Chip-Reihe (Drops verknüpfen gelb, Multi-Live, Teilen, Herunterladen, Zurück zu Live, Sleep-Restzeit, Clip-Pfeile), `chatCard` „Live-Chat / Zum Öffnen tippen ›“ (`:1262-1281`) | `style.css:226`: `.below` scrollt, nur `.info-row`; Chat nur über Zahnrad-Sheet wieder einblendbar; Follow = Herz-Icon statt Kapsel; Quelle („Luminous Asien“) in der Sub-Zeile | Komplett anderes Bild | mittel | ja |
| Querformat-Aufbau | `MainTabView.swift:643-742`: HStack, Video volle Höhe, ignoriert vertikale + linke Safe-Area, Chat-Spalte `max(Breite × chatWidthRatio, 220)`, Ratio 0,20–0,60 per Griff (`:752-789`: Kapsel 3×28 weiß .22, beim Ziehen 5×48 + 2 px Akzentlinie); darüber `chatHeader(landscape: true)` | `style.css:262-266`: `flex: 0 0 34 %`, border-left .5 px, nicht verstellbar; `.info-row` in der Spalte statt Header; `.land` nur bei `height ≤ 600` | Breite, Griff, Header | mittel | ja |
| Chat im Querformat aus | `MainTabView.swift:942-943`, `PlayerControls.swift:264-278`: 💬-Knopf oben rechts vor AirPlay → `.column` | `style.css:270`: Spalte weg, kein Wiedereinblenden außer Sheet | 💬-Knopf fehlt | klein | ja |
| „Über dem Video“ | im nativen Player entfernt (`MainTabView.swift:647-649`) | `style.css:271-281`: `.lc-overlay` 32 %/220 px, schwarz .45 | PWA-Modus zu viel | klein | – |
| Querformat-Erkennung | nativ | `.land` = `(orientation: landscape) and (max-height: 600px)` oder `pseudo-land` | iPad-Querformat bleibt Hochformat-Layout | klein | ja |

## 2.4 Mini-Player

iOS reduziert auf eine einzeilige System-Leiste auf der Tab-Bar (Status-Icon, Titel, ✕); die PWA zeigt eine zweizeilige dunkle Karte mit laufendem Video-Thumbnail und Pause-Knopf.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Form | `MainTabView.swift:1654-1672` (iOS 26.1 `tabViewBottomAccessory`, System-Glas, Tab-Bar schrumpft beim Scrollen) bzw. `:1676-1704` älter: Glas-Karte radius 14, Akzent-Rand .25, Padding 12/8, 92 pt über dem Rand | `style.css:229-237`: fix 64 px, bg #1c1c1e opak, Schatten, radius 14 | Opak statt Glas, kein Akzent-Rand | klein | teilweise (`backdrop-filter`) |
| Inhalt | Status-Icon (`:1628-1650`: Live = `dot.radiowaves` rot, VOD = `play.fill` Akzent, Laden = Spinner, Fehler = ⚠ gelb) · `statusTitle` `.subheadline` semibold eine Zeile · ✕ | `player.tsx:438-442`: Video-Thumbnail 112×63 (läuft weiter) · Name 14 px + Titel 13 px · Pause-Knopf · ✕ | Thumbnail/zweite Zeile/Play-Knopf gibt es in iOS nicht; Status-Icon fehlt | klein | ja |
| Play/Pause-Knopf | keiner | `player.tsx:440`: Icon immer `pause`, wechselt nicht mit dem Zustand | Zustand falsch | klein | ja |
| Multi-Live / Clips reduziert | nicht reduzierbar (`fullScreenCover`); stattdessen `multiBar` „Multi-Live · n/4“ + „Ansehen“ auf Home (`:1709-1741`) | `style.css:235-237`: Text „Multi-Live / Clips · tippen zum Öffnen“ | PWA-Zusatz | – | – |

## 2.5 Multi-Live

Die PWA hat ein 2-Spalten-Raster mit festem 480p und Chat auf dem Telefon; iOS ordnet 2/3/4 Kacheln je nach Orientierung, erlaubt VODs mit eigenen Controls, hat Kachel-Kopfzeilen mit Lautsprecher/VOD-Badge/Groß-öffnen/✕, Status-Zustände mit „Erneut versuchen“ und zeigt den Chat nur auf breiten Geräten.

| Element | iOS (`MultiLiveView.swift`) | PWA (`player.tsx:687-745`) | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Kopfzeile | `:135-160`: „Multi-Live“ `.headline` + „Tippe auf ein Video, um es zu hören“ `tMeta`; rechts [💬 nur regular width] `+` ✕ als `TIconButton` 34 pt Glas | `:692-697`: Chevron-Minimieren, „Multi-Live“ bold, `＋` (Textzeichen), ✕ als `.glass` 36 px | Untertitel fehlt, `＋` kein Icon | klein | ja |
| Anordnung | `:170-187`: Quer: 2 nebeneinander / 3 = groß + 2 gestapelt / 4 = 2×2; Hoch: untereinander, Abstand 4, Padding 4; Kacheln radius 8, 2 pt Akzent-Rand wenn hörbar | `:698-700`, `style.css:296-302`: immer 2 Spalten, gap 2, keine Rundung, `outline` 2 px | Hochformat-Stapel, 3er-Layout, Rundung | klein | ja |
| Kachel-Kopfzeile | `:328-348`: Verlauf schwarz .7 → klar; Lautsprecher-Icon (an/aus) · „VOD“-Badge lila · Name 13 bold · „groß öffnen“ + ✕ als 30 pt Glas-Kreise | `:730-732`, `style.css:303-305`: Name 12 px unten links + „🔊“, ✕ 24 px oben rechts | Kopfzeile, Lautsprecher-Icon, „im Player öffnen“ fehlen | klein | ja |
| Zustände | `:272-316`: Spinner; „Offline oder nicht gefunden“ / „Dieser Stream konnte nicht gestartet werden“ + „Erneut versuchen“; VOD-Ende „Erneut ansehen“; „Abspielen“ wenn von iOS gestoppt | `:708-713,731`: „Wird geladen …“ / „Offline oder keine Quelle“, kein Retry | Texte, Retry | klein | ja |
| Qualität | `MultiLive.swift:138-147`: 1080/720/480 nach Anzahl, gedeckelt durch Präferenz | `:715`: fest 480 | – | klein | ja |
| VODs im Mosaik | `MultiLive.swift:84-104`, `MultiLiveView.swift:364-427`: VOD-Kacheln mit ±10 s, Play/Pause, Slider, Zeit; Position gespeichert | nur Live-Logins | Fehlt komplett | groß | ja |
| Werbepause pro Kachel | `:256-258`: `AdBreakBanner(compact)` | fehlt | – | klein | teilweise |
| Chat | `:163-166,203-229`: nur `horizontalSizeClass == .regular`, Breite `min(360, 32 %)`, auch VOD-Replay | `:702`: `ChatPanel` der aktiven Kachel immer unter dem Raster | PWA zeigt auf dem iPhone Chat | klein | ja |
| Hinzufügen | `:83-89,114-133`: Alert mit Textfeld „Kanal, VOD-Link oder VOD-ID“ | `:735-745`: Sheet mit Suchfeld + Liste live gefolgter Kanäle | PWA komfortabler, Texte anders | klein | ja |
| Persistenz / Start | `MultiLive.swift:43-50`: UserDefaults, Long-Press auf Karten, `multiBar` auf Home | nur Session (`#/multi/a,b`) | Zusammenstellen aus der App fehlt | mittel | ja |

## 2.6 Clip-Feed

Die PWA scrollt mit einem einzigen `<video>`; es fehlen Fortschrittslinie mit Scrubbing, Ton-Knopf, Teilen, Auto-Weiter am Clip-Ende, Pause-Icon, 2×-Halten und das Vorladen der Nachbarn.

| Element | iOS (`ClipFeedView.swift`) | PWA (`player.tsx:748-787`) | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Obere Leiste | `:304-317`: ✕ links, Lautsprecher an/aus rechts (`TIconButton` 36 weiß), Quer: nach 3 s ausgeblendet | `:775-776`: Chevron-Minimieren links, ✕ rechts; Ton nur über „🔇 Ton an“-Pille | Lautsprecher-Toggle fehlt | klein | ja |
| Untere Info | `:440-499`: Name 17 bold (Tipp → Kanal), Titel 15 (2 Zeilen / 1 Quer), Meta 13 weiß .75 „vor 2 Tagen · von X · 12,3k Aufrufe“, Kapsel „▶ Ganzes VOD ab hier“ (Glas), Teilen-Kreis 36 rechts, Verlauf klar → schwarz .6 | `:781-783`, `style.css:314-315`: `<b>Name</b>`, Titel, „N Aufrufe · geclippt von X“ 13 px, Button „Zur VOD“ bordered small; kein Teilen | Meta (Datum fehlt), VOD-Knopf, Teilen, Verlauf | klein | ja |
| Fortschrittslinie | `:503-532`: 3 pt weiß (8 beim Ziehen), scrubbbar | fehlt | – | klein | ja |
| Pause | `:399-405,409-413`: Tipp pausiert, `play.fill` 60 pt .85 | `:772,779`: Tipp pausiert, kein Icon | Feedback | klein | ja |
| 2× halten | `:416-430`: Long-Press ≥ 0,35 s → Rate 2, Label „⏩ 2×“ | fehlt | – | klein | ja |
| Clip-Ende | `:261-268`: nächster Clip, letzter läuft erneut | `:204,774`: `loop` | Verhalten | klein | ja |
| Vorladen | `:51-64`: Player für aktuellen ± 1, Links für +2 | ein `<video>`, `src` beim Wechsel | Lücke beim Wischen | mittel | teilweise (zweites `<video>` möglich; Ton-Freischaltung pro Element) |
| Schließen per Kantenwisch | `:280-297`: 24 pt-Streifen links, ab ⅓ Breite | fehlt (Browser-Zurück minimiert, `nav.ts:56-59`) | – | klein | ja |

## 2.7 Chat-Zeilen

Die PWA-Zeile ist nahe dran, aber Standardgröße, Hervorhebungen (Erwähnung, gelöscht, Systemnachricht), Antwort-Zitat, Erste-Nachricht-Marker, Link-/Erwähnungsfarbe und das Tipp-Ziel weichen ab.

| Element | iOS (`ChatView.swift:1130-1333`) | PWA (`player.tsx:655-664`, `style.css:242-251`) | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Schriftgröße | 13 pt Standard, 10–20 (`AppStore.swift:338,364`) | 15 px Standard, Stufen 13/15/17/20 (`store.ts:35`, `pages.tsx:442`) | Standard größer, keine Feinstufen | klein | ja |
| Zeilen-Padding | `:1251-1252`: horizontal 12, vertikal 4; Flow-Abstand 4 | `.msg` 3 px 0, Liste 6/10 px, line-height 1.35 | leicht | klein | ja |
| Zeitstempel | `:1291-1293`: Standard an (`AppStore.swift:352`), `size − 2` grau | `.ts` .85em grau, Standard aus | Standard | klein | ja |
| Verlaufs-Nachrichten | `:1296-1299`: Uhr-Icon vor dem Namen, keine Abdunkelung | `.msg.old` Opazität .55 | Optik | klein | ja |
| Badges | `:1300-1304`: Höhe `fontSize + 3` (16 @ 13 pt), Tipp → Badge-Sheet | `.badge-img` 18 px, kein Tipp | Größe folgt nicht der Schrift; Sheet fehlt | klein | ja |
| Emotes | `:1313`: Höhe `fontSize + 11` (24 @ 13 pt) × `emoteScale` | `.emote` 28 px fest | Größe folgt nicht der Schrift | klein | ja |
| Erwähnung `@x` im Text | `:1315-1316`: semibold Akzent | `<b>` ohne Farbe | – | klein | ja |
| Links | `:1317-1321`: #007aff unterstrichen, Mitte gekürzt | `<a>` Akzentfarbe | – | klein | ja |
| /me-Aktion | `:1310-1311`: Nutzerfarbe, nicht kursiv | kursiv + Farbe | – | klein | ja |
| Erwähnung (an mich) | `:1232,1258-1263`: Hintergrund Akzent .14 + 3 pt Akzent-Balken links | `.msg.mention`: rgba(233,25,22,.18) rot, radius 6, kein Balken | Farbe | klein | ja |
| Gelöscht | `:1267-1268`: rot (.8) durchgestrichen, Opazität .55 | Opazität .35, `line-through` in Textfarbe | Farbe/Opazität | klein | ja |
| Systemnachricht | `:1196-1206`: ★ gelb + Text 11 pt semibold über der Nachricht, kein Hintergrund; `:1173-1194` Raid: Karte lila .14 mit „Kanal ansehen“ | `.msg.system`: `.sys` grau .9em + Hintergrund Akzent 14 % | Optik; Raid-Karte fehlt | klein | ja |
| Erste Nachricht | `:1162-1170`: „✨ Erste Nachricht“ lila 11 pt, Hintergrund Akzent .05 | fehlt | – | klein | ja |
| Antwort-Zitat | `:1208-1226`: 2 pt Akzent-Balken + „↩ @user: Text“ 11 pt grau | fehlt (`reply-parent-*` nicht gelesen) | – | klein | ja |
| Hervorhebungswörter / ausgeblendete Nutzer | `:1231-1233`, `AppStore.chatBlockedUsers` | fehlen | – | mittel | ja |
| Übersetzung | `:1239-1249`: SF-Symbol `translate` + Text `size − 1` grau | `.tr`: „🌐 Text“ .9em grau | Glyphe | klein | ja |
| Tipp auf Zeile | `:1031-1035`: ganze Zeile → `MessageSheet` | nur Name → `UserCard` | Ziel/Fläche | klein | ja |

## 2.8 Chat-Eingabe und Infozeile

Die PWA hat keine Punkte-Kapsel am Feld, den Emote-Knopf außerhalb links statt im Feld rechts, eine Text-Infozeile mit „Chatter / Befehle“-Links, die Streak als eigene Zeile (in iOS zweimal abgelehnt) und weder Autovervollständigung, Zeichenzähler, Bann-Banner noch Chatregeln.

| Element | iOS (`ChatView.swift`) | PWA (`player.tsx:647-676`, `style.css:252-257`) | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Infozeile | `:73-174`: min 28 pt, `tCard`; scrollende Chips 11 pt medium + 10 pt Icon: `person.2.fill` „Nur Follower“ / „Follower seit {d}“, `star.fill` „Nur Abonnenten“, `face.smiling` „Nur Emotes“, `tortoise.fill` „Langsamer Modus: {s} s“, `square.on.square` „Einzigartige Nachrichten“, `checkmark.seal.fill` „Verifiziertes Konto erforderlich“; Sync-Chip „{n} s (+1)“ als Menü ±1 s; 🔥 Streak nur ohne Kapsel; „Angeheftet“-Chip; `ClosedNoticesChip` | `.info-line` 12 px grau, Text mit „ · “: „Slow-Modus N s“, „Nur Follower“, „Nur Abonnenten“, „Nur Emotes“, „Verbinde …“, Notice, „Chat N s verzögert“ / „Chat der Aufzeichnung“; rechts Links „Chatter“ „Befehle“ | Icons, Texte, Follower-Minuten, unique/verified, Sync-Menü, Pin-/Closed-Chips; Chatter/Befehle gehören ins Zahnrad | mittel | ja |
| Punkte-Kapsel | `:835-842`, `ChannelPointsView.swift:4-57`: links vom Feld, 36 pt `tSurface`-Kapsel: 👑 12 + Balance 13 semibold + 🔥 Streak; grün mit weißem Punkt bei Truhe; „+N“-Badge; Tipp → `ChannelPointsSheet` | `player.tsx:450`: „◆ 1.234“ 13 px Akzent in der Info-Row, nicht tippbar; Streak separat „🔥 Zuschau-Serie: N Streams“ (`events.tsx:187`) | Platz, Form, Streak-Zeile, Bonus-Zustand, Sheet | mittel | teilweise (Balance/Truhe ja; Einlösen braucht Integrity) |
| Feld | `:844-886`: Kapsel `tSurface`, Platzhalter „Nachricht senden…“ / „Chat…“ (Quer) / „Verbinden…“; Emote-Knopf innen rechts (`face.smiling` 18 pt → `keyboard` wenn Picker offen), 40×36 | `:673-674`: Emote-`nav-btn` 40 px außen links, Input radius 18 bg `--fill` 16 px, „Chatten …“ | Position, Platzhalter, Icon-Wechsel | klein | ja |
| Senden | `:888-900`: `arrow.up.circle.fill` 30 pt, weiß auf Akzent, grau wenn nicht sendbar, Scale-Transition | `:675`: Papierflieger 22 px Akzent | Icon | klein | ja |
| Zeichenzähler | `:904-911`: ab 400 „412/500“ gelb/rot | fehlt | – | klein | ja |
| Autovervollständigung | `:767-822`: Chips 30 pt (`@Name` Akzent, Emote-Bild 20 + Name) über dem Feld | fehlt | – | mittel | ja |
| Bann-Banner | `:925-954`: gelb .14 „Aus diesem Chat gebannt: nur lesen…“ + Retry | fehlt | – | klein | ja |
| Chatregeln | `:1399-1440`: Sheet vor der ersten Nachricht | fehlt | – | klein | ja |
| Ausgeloggt | `:452`: keine Eingabezeile | `:676`: „Zum Chatten in den Einstellungen mit Twitch anmelden.“ | PWA-Zusatztext | klein | ja |
| Folgen/Jump-Knopf | `:1084-1097`: „⬇ Folgen“ prominente Kapsel small Akzent, unten rechts, Padding 10 | `.pill-btn.jump` „Zu neuen Nachrichten“ 14 px schwarz .85, unten Mitte 64 px | Text, Farbe, Position | klein | ja |
| Emote-Picker | `:420-429`: ersetzt die Nachrichtenliste (volle Fläche) | `:682`, `style.css:256`: Raster max 200 px unter dem Feld | Platz | mittel | ja |

## 2.9 Chat-Einstellungen

In der PWA gibt es kein Chat-Einstellungs-Sheet; fünf Schalter liegen in den App-Einstellungen, „Nur Chat“, die Hinweise-Unterseite, „Chat neu laden“ und die benannte Namensfarbe fehlen.

| Element | iOS (`ChatSettingsSheet.swift`) | PWA (`pages.tsx:441-451`) | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Zugang | Zahnrad im Chat-Header (`MainTabView.swift:1228-1238`), VOD: nur Darstellung | Settings-Seite | Sheet fehlt | mittel | ja |
| Rahmen | `:31-75`: NavigationStack „Chat-Einstellungen“, insetGrouped, dunkel, medium/large | `.group`-Zeilen | – | klein | ja |
| Nur Chat | `:34`: Toggle `bubble.left` (Video weg, Chat volle Höhe) | fehlt | – | klein | ja |
| Schriftgröße | `:35-41`: Stepper 10–20, „13 pt“ | Select Klein/Normal/Groß/Sehr groß | – | klein | ja |
| Übersetzen / Zeitstempel / Gelöschte / Bots | `:42-50` mit Icons `translate`, `clock`, `strikethrough`, `cpu` | vorhanden, ohne Icons | Icons | klein | ja |
| Hinweise im Chat | `:54-56,105-117`: Unterseite „n / 4“: Angeheftete Nachrichten, Umfragen & Vorhersagen, Kanal-Drops, Zuschauerserie | fehlt (alles immer an) | – | klein | ja |
| Chatter | `:57` → `ChatMenuSheet.swift:111-173`: „Chatter · N“, „Namen filtern…“, `person.fill` + Login, Leer-Zustand „Warte auf die Chat-Liste…“ + Hinweis | `player.tsx:811-819` aus der Infozeile: „Chatter · N“, „Suchen“, Hinweis, Tipp → UserCard | Ort, Platzhalter, Leer-Zustand | klein | ja |
| Bot-Befehle | `:58` → `BotCommandsSheet` | `player.tsx:820-828` aus der Infozeile | Ort | klein | ja |
| Namensfarbe | `:60-62` → `ChatMenuSheet.swift:11-104`: 15 benannte Farben (Hex nur Turbo/Prime), Haken/Spinner, Fehlertext | `pages.tsx:449-450`: `<input type=color>` + „Setzen“ | Für Nicht-Turbo-Konten schlägt Hex fehl | klein | ja (Helix `color=blue_violet`) |
| Chat neu laden | `:63` | fehlt | – | klein | ja |

## 2.10 Hinweise im Chat

Die PWA zeigt alle Ereignisse als gleichartige graue Karten mit ×, in anderer Reihenfolge (Pin zuletzt), ohne Icon-Spalte, ohne Drops-Karte, ohne Pin-Meta/Dauerbalken/Einklappen und mit einfacheren Umfrage-/Vorhersage-Karten; die Streak steht als eigene Zeile.

| Element | iOS | PWA (`events.tsx:153-190`, `style.css:337-356`) | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Reihenfolge / Container | `ChatView.swift:179-239`: Pin → Drops → Umfrage → Vorhersage → Hype Train → Raid, volle Breite mit Divider, kein Abstand | `.events` gap 6; Raid → Hype → Umfrage → Vorhersage → Fehler → Streak → Pin | Reihenfolge, Karten statt Bänder | klein | ja |
| Banner-Rahmen | `LiveEventsService.swift:747-769`: Icon 12 pt links (`chart.bar.fill` Akzent / `sparkles` lila / `tram.fill` rot), Hintergrund `tint.opacity(0.10)`, × 26 pt | `.event`: `var(--card)` radius 10, 13 px, × 18 px | Icon-Spalte, Tönung | klein | ja |
| Angeheftet | `ChatPubSub.swift:177-298`: 📌 lila, Badges 14, „Name: Text“ 13 pt 1 Zeile, Meta 10 pt „Angeheftet von X · vor 3 Min. · noch 10 Min.“, Chevron klappt auf (max 160 pt scrollbar), × → Chip „Angeheftet“; 2 pt lila Restdauer-Balken | `:188-189`: „📌 Name: Text“, `max-height 4.2em`, × | Meta, Aufklappen, Chip, Dauerbalken | mittel | ja |
| Kanal-Drops-Karte | `ChatNotices.swift:107-162`: Bild 34, „Schau {m} Min., um {r} zu erhalten“ 12 bold, „Kampagne · Spiel · +n Belohnung(en)“ 11 grau, „Bis {d}“ 10, „Details“, × dauerhaft | fehlt | – | klein | ja (öffentliche GQL `viewerDropCampaigns`) |
| Umfrage | `LiveEventsService.swift:775-856`, `EventBar` `:1134-1192`: „📊 Titel“ + ⏱ Countdown Akzent; Wahl: Label 11, % 10 grau, Kapsel-Balken 5 pt, ✓ grün, 🏆 Sieger; Zeile tippbar; „N Stimmen“; beendet → eingeklappt | `:160-168`: „📊 Titel · noch m:ss“, Label / „N %“ + Link „Abstimmen“, 4 px Balken, „✓ deine Stimme“ | Tippbare Balken, Stimmenzahl, Sieger, Einklappen | klein | ja |
| Vorhersage | `:862-1130`: „🔮 Titel 🔒“, Countdown lila; EventBar PINK/BLUE mit Stat-Zeile 10 pt (Punkte, 1:Quote, Nutzer, Höchsteinsatz); Tipp → Panel „„X“ vorhersagen“ + „Guthaben N“, Chips 10/100/1k/10k/Max, Zahlenfeld, „Vorhersagen“-Kapsel; „Deine Vorhersage: n Pkt. auf „o“ · möglicher Gewinn: n Pkt.“ grün; gesperrt → eingeklappt | `:169-185`: Titel · Zustand; „% · N Punkte · N“, Balken; `<select>` + Zahlenfeld + Link „Setzen“; „Dein Einsatz: n Punkte“ | Stat-Zeile, Preset-Chips, Button, Gewinn-Text, Einklappen | mittel | ja |
| Hype Train | `HypeTrainCard.swift`: Anrollen mit 2–3 Pillen 14 pt, Chip „Im Anrollen“ rot, „Noch n zum Start“; „Hype Train · Level n“ + ⏱ rot + Balken rot + „%“; „Level n geschafft!“ grün; abgefahren/beendet; Golden Kappa/Schatz | `:156-159`: „Hype Train · Level n · noch m:ss“ + 4 px Akzent-Balken | Anrollen, Prozent, Flashes, Farbe rot | mittel | ja |
| Raid | `ChatView.swift:211-236`: `figure.run` + „🚀 Raid zu Name“ 12 bold + „N Zuschauer“, Kapsel „Beitreten“, Hintergrund Akzent .12 | `:154-155`: „Raid zu Name mit N Zuschauern · …“ + Link „Mitgehen“ | Text, Kapsel | klein | ja |
| Zuschauerserie | `ChatView.swift:144-146,837`: in der Punkte-Kapsel („👑 20 · 🔥 5“), sonst Chip; nie eigene Zeile | `:187`: eigene Zeile | Vom Nutzer zweimal abgelehnt | klein | ja |
| Querformat | `ChatNotices.swift:230-335`: `CollapsedNoticesBar` (Icon-Reihe mit Countdowns, 26 pt), `NoticesHideStrip` „Ausblenden ⌃“, gespeichert | nichts | – | mittel | ja |

## 2.11 Sheets

Das PWA-Nutzerprofil ersetzt das iOS-Nachrichten-Sheet, kann aber weder antworten, erwähnen, kopieren noch ausblenden; Emote-Picker und Emote-Sheet sind stark reduziert, Punkte-Sheet und Chatregeln fehlen, der VOD-Chat hat keine Statuszeile und keine Zustände.

| Element | iOS | PWA | Unterschied | Aufwand | Browser |
|---|---|---|---|---|---|
| Nachrichten-Sheet | `MessageSheet.swift`: Avatar 46 oder Initial-Kreis, Name `.title3` bold in Nutzerfarbe; ↩ Antworten („Antwort an @Name“ + Papierflieger, `reply-parent-msg-id`), ⋯ Menü Kopieren / Erwähnen / Im Chat ausblenden; Liste = Thread oder alle Zeilen der Person als volle `ChatMessageRow`, getippte Zeile Akzent .12 | `player.tsx:792-809` UserCard: Avatar 84 mit Live-Ring, „@login · N Follower“, „Konto seit …“, Beschreibung, „Kanalseite öffnen“, letzte 30 Zeilen als Klartext | Alle Aktionen fehlen; Zeilen ohne Badges/Namen | mittel | ja |
| Emote-Picker | `EmotePickerView.swift`: volle Chat-Fläche, Suchfeld 13 pt, Tabs „⭐ Dieser Kanal“ / 7TV / BTTV / FFZ / Twitch, 6 Spalten, Zelle 46×34 + Name 8 pt, Long-Press Details/Kopieren, Lade-/Leer-Zustände | `player.tsx:682`, `style.css:256-257`: `auto-fill 40 px`, 28 px, erste 400, keine Suche/Tabs/Namen, keine Twitch-Emotes, unter dem Feld, max 200 px | – | mittel | ja (Helix `chat/emotes/user`) |
| Emote-Sheet | `ChatNotices.swift:409-659`: Bild 72, Name 22 monospaced, „7TV · Kanal-Emote“ / „Twitch · Abo-Emote Stufe n“, Autor, Original-Name; Besitzer-Zeile + Abo-Emote-Vorschau; „Auf 7TV ansehen“; „Namen kopieren“ + „Zur Nachricht hinzufügen“ | `player.tsx:679-681`: Titel = Name, Bild 112 px, Quelle | Fast alles | mittel | ja |
| Badge-Sheet | `:662-673`: Bild 54, Titel 20, Beschreibung, „Abzeichen“ | fehlt | – | klein | ja |
| Kanalpunkte-Sheet | `ChannelPointsView.swift:61-…`: Balance, Bonus abholen, Belohnungen einlösen | fehlt | – | groß | teilweise |
| Sleep-Timer | s. 2.2 | inline Select | – | klein | ja |
| VOD-Chat-Replay | `VodChatView.swift:32-56`: Statuszeile 11 pt: ⟲ „VOD-Chat“ · Offset lila · „#login“ Akzent; `:92-114`: „Chat wird geladen…“ / Fehler / „Keine Nachrichten an dieser Stelle des VODs“; Header „Chat-Wiedergabe“ + Zahnrad + ✕ | `player.tsx:460,622-635`: gleiche `ChatPanel`, keine Statuszeile, keine Zustände | – | klein | ja |

## Die 10 wichtigsten Angleichungen von Player und Chat

1. **Chat-Header + Chat-Einstellungs-Sheet** (2.3, 2.9): 48 px-Zeile „Live-Chat“/„Chat-Wiedergabe“ mit Zahnrad und ✕ zwischen Video und Chat; Sheet mit Nur Chat, Schriftgröße-Stepper 10–20 pt, Übersetzen, Zeitstempel, Gelöschte, Bots, Unterseite „Hinweise im Chat“, Chatter, Bot-Befehle, benannte Namensfarbe, Chat neu laden; „Chatter/Befehle“-Links raus aus der Infozeile. (mittel)
2. **Eingabezeile** (2.8): Punkte-Kapsel 👑 Balance · 🔥 Streak links vom Feld (grün bei Truhe), Emote-Knopf im Feld rechts mit Keyboard-Wechsel, „Nachricht senden…“, `arrow.up.circle.fill` 30 px, Zeichenzähler; Streak-Zeile und „◆“ streichen. (klein/mittel)
3. **Stream-Info bei geschlossenem Chat** (2.3): Titel 20 pt, Detailzeile „6,3k Zuschauer · ● 3:15:11 · Spiel“, Avatar 40 + Name + Folgen-Kapsel, Chip-Reihe, Chat-Karte „Zum Öffnen tippen“; Info-Row bei offenem Chat entfernen; Kanal/Multi/Teilen aus dem Player-Sheet. (mittel)
4. **Overlay-Optik** (2.1): nackte Glyphen 18 pt mit Schatten in 44 px; Titel nur im Querformat, zweizeilig; Mittelknöpfe 44/60/44, Vor-Knopf am Live-Rand .35, Puffer-Spinner; Live-Chip als schwarze Kapsel hinter Live, Position weiß / Gesamt .7; „10 Sekunden“-Blitz, Einzeltipp ohne 300 ms Wartezeit. (mittel)
5. **Fortschrittsleiste** (2.1): Inset 18/28 px, 4→6 px Linie und 14→22 px Knopf mit Zeit-Bubble beim Ziehen, Leiste auch live ohne Archiv, 3 px-Ruhelinie nur VOD, Kapitelmarker raus. (mittel)
6. **Vollbild = Querformat in der App** (2.1, 2.3): ein Knopf schaltet die CSS-Rotation, Safari-Vollbild entfällt; „Über dem Video“ streichen; 💬-Knopf bei geschlossenem Chat; Chat 32 % (≥ 220 px) mit Zieh-Griff. (klein/mittel)
7. **Chat-Zeilen** (2.7): 13 px Standard; Erwähnung Akzent .14 + 3 px-Balken; Gelöscht rot durchgestrichen .55; Systemnachricht als gelbe ★-Zeile, Raid-Karte; Antwort-Zitat, „✨ Erste Nachricht“; `@x` Akzent, Links blau; Verlaufs-Uhr; Badge/Emote-Höhe an Schrift; Tipp auf ganze Zeile. (klein/mittel)
8. **Hinweise** (2.10): Reihenfolge Pin → Drops → Umfrage → Vorhersage → Hype → Raid als Bänder mit Icon-Spalte und 10 %-Tönung; Pin mit Meta, Aufklappen, Dauerbalken, „Angeheftet“-Chip; Kanal-Drops-Karte; Umfrage mit tippbaren Balken/Stimmen/Sieger; Vorhersage mit Stat-Zeile, Preset-Chips, „Vorhersagen“-Kapsel; Hype-Train-Anrollphase, rot. (mittel/groß)
9. **Nachrichten-Sheet, Emote-Sheet, Picker** (2.11): Sheet bei Tipp auf die Zeile mit Antworten/Erwähnen/Kopieren/Ausblenden und echten Zeilen; Emote-Sheet mit Kopieren/Einfügen, Quelle, Besitzer; Badge-Sheet; Picker als Vollfläche mit Suche, Tabs, 6 Spalten, eigene Twitch-Emotes. (mittel)
10. **Mini-Player, Pull, Sleep-Timer, Clip-Feed** (2.4, 2.1, 2.2, 2.6): einzeilige Glas-Leiste mit Status-Icon, Titel, ✕, korrektes Play/Pause; Pull mit Mitführen/Skalieren, Schwelle 80–120 px; Sleep-Timer-Sheet mit Kapsel-Raster + freier Dauer + Restzeit-Chip; Clip-Feed: Fortschrittslinie, Ton-Knopf, Teilen, Auto-Weiter, Pause-Icon, 2×-Halten, Meta „vor 2 Tagen · von X · N Aufrufe“, „Ganzes VOD ab hier“. (klein/mittel)

Multi-Live (2.5) liegt dahinter: das Raster läuft funktional, die VOD-Unterstützung allein wäre ein großer Posten.

# Teil 3: Technik

Verglichen wurde der Arbeitsstand von `pwa/` (eingecheckt auf dem Branch `pwa`) mit den Swift-Quellen auf `optimize`. Der geschützte VOD-Block (`workerVariants`…`getM3U8`, `VodRecoveryService`, `VodUnmute`) wurde nur als Black Box behandelt. "fehlt" = kein Gegenstück im PWA-Code.

Aufwand: klein = unter ~50 Zeilen, mittel = ein halber bis ganzer Tag, groß = mehrere Tage oder neue Infrastruktur. "machbar" bezieht sich auf GitHub Pages ohne eigenen Server, Safari auf iOS.

## 3.1 Twitch-API-Zugriff

| Funktion/Verhalten | iOS (Datei:Zeile) | PWA (Datei:Zeile oder "fehlt") | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| GQL-Timeout | `TwitchAPI.swift:106` 10 s (`twitchGQL`), `:1896` 15 s (`gqlRequest`), `:222` 6 s (Account-Token) | `twitch.ts:46,62` 15 s überall; `:233` 8 s Account-Token | PWA wartet auf GQL bis 15 s, bevor Live-Quellen starten (iOS 10 s) | klein | ja |
| GQL-Header | `TwitchAPI.swift:110-111` eigener User-Agent + zufällige `Device-ID`; `:4-8` Referer/Origin twitch.tv bei Playlists | `twitch.ts:47` nur `Client-ID` | Browser kann UA/Origin nicht setzen; `Device-ID` wäre möglich | klein | teilweise |
| Pagination Seite 2+ mit Android-Client-ID, Erkennung "IntegrityCheckFailed" → `refused` → Helix-Fortsetzung mit Konto | `TwitchAPI.swift:1910-1956`, `:2274-2306`, `CategoriesView.swift:57-88` | `twitch.ts:53-57` nur Android-ID; kein `refused`-Status, Helix-Fallback fehlt | Bei Ablehnung durch Twitch sieht die PWA ein stilles Listenende | klein | ja (Erkennung); Helix-Fallback nur, wenn das TV-Token Helix-Listen darf |
| Helix mit Konto für Top-Streams (50/100), Kategorien, Suche, gefolgte Live-Streams (3×100) | `TwitchAPI.swift:1299-1433` | fehlt (nur GQL, Top 30/Seite) | PWA Top-Liste = 30 Einträge je Seite statt 50/100; gefolgte Live-Streams kommen aus `users(logins)` (`twitch.ts:86-94`) | mittel | teilweise: ob der TV-Client `streams/followed` darf, ist unbelegt |
| Box-Art-Größe | `:2169` 570×760, `sharpBoxArt` `:1483` | `twitch.ts:98,104,110` 285×380 | auf 3×-Displays unschärfer | klein | ja |
| Kanalsuche | `:1532` `first: 5` | `twitch.ts:120` `first: 8` | PWA zeigt 8 Vorschläge | – | – |
| Kanal-VODs je Seite | `:1104` 100 | `twitch.ts:156` 50 | – | klein | ja |
| Clips je Seite + "Mehr laden" | `:2245` 100, Fortsetzung `ChannelView.swift:756-781` | `twitch.ts:177` 50, keine Fortsetzung in `pages.tsx:274` | Kanal-Clips in der PWA auf 50 gedeckelt | klein | ja |
| VOD-Marker: Kapitel und stummgeschaltete Passagen (`muteInfo`, 3-min-Blöcke verschmolzen) + `createdAt` | `:2445-2494` | `twitch.ts:204-214` nur Kapitel | PWA kennt die Mute-Ranges nicht (keine Markierung auf der Leiste) | klein | ja |
| `ChannelBrief.lastEnd` = Ende des letzten VOD oder lastBroadcast | `:2033-2075`, `lastLiveEnd :1674` | `twitch.ts:86-94` nur `lastBroadcast.startedAt` | "Zuletzt live vor…" in der PWA = Start- statt Endzeit | klein | ja |
| Avatar-Cache mit 5-min-Miss-Sperre | `:1232-1282` | fehlt (`UserCard` lädt je Öffnen neu `player.tsx:794`) | kein Cache für Nutzerkarten | klein | ja |
| Web-Session-Prüfung `currentUser` (`.valid/.invalid/.unknown`, Netzfehler löscht nie) | `:1831-1864`, `AppStore.swift:79-101` | `main.tsx:60-66` prüft nur `client_id` beim Start; `account.ts:51-63` refresht bei 401 | gleichwertig für das Device-Token; keine periodische Prüfung | – | – |
| Worker-Wahl: eigener Worker ("Experten"), `/api/get-live` als letzte Live-Quelle, Health 429/1027→Mitternacht | `Constants.swift:28-127`, `TwitchAPI.swift:1014-1020` | `vod.ts:6-9,60-80` nur VOD-Routen, gleiche Ausfalllogik; kein eigener Worker, kein `get-live` | Live-Notquelle fehlt, obwohl die Worker für VODs bereits genutzt werden | klein | ja |
| Playlist-Parser (`parseMaster`, IVS-Source, `(source)`-Gruppen) | `:36-86` | `logic.ts:17-45` | identisch portiert, getestet | – | – |
| Qualitätslogik (`preferredQualityKey`, `sortQualities`, `qualityPreference`) | `:1706-1813` | `logic.ts:47-94`; `qualityPreference` inline in `player.tsx:358` (`parseInt(k)` statt nächster Stufe, >1080 → nicht "source") | 936p/1440p-Varianten werden anders gemerkt | klein | ja |

## 3.2 Live-Quellen und Werbevermeidung

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| Staggered race, 1,5 s, Twitch nie parallel zu Proxys | `TwitchAPI.swift:768,803-861` | `twitch.ts:327-346` | gleich; PWA zusätzlich `firstAlone` für Quellwechsel im Player | – | – |
| Quellreihenfolge: gespeicherte Ordnung, sonst `LiveAdStats.ranked` + `worker` am Ende | `:701-710` | `player.tsx:155-159` (adRanking nur bei Schalter), Multi-Live-Zellen ohne Ranking `player.tsx:711` | Multi-Live ignoriert die Werbestatistik | klein | ja |
| Luminous: 8 s, EU-Spiegel parallel; TTV.LOL 10 s mit `X-Donate-To`; usher 8 s | `:886-978` | `twitch.ts:303-322` 8/10 s; usher wird nicht gelesen (CORS) | gleich bis auf usher | – | nein (usher ohne CORS) |
| Konto-Wiedergabe ohne Werbung (Web-Session, `hide_ads`/`show_ads`, 6-s-Gate, Integritäts-Retry) | `:173-214,635-654`; `AppStore.swift:264-280` | `twitch.ts:227-246` mit TV-Token; laut Audit nie `adFree` | funktional tot in der PWA | – | nein (Integritäts-Token + Web-Session) |
| `LiveAdStats`: pro Playlist-Reload (≤10 s) gezählt | `:714-749`, `LiveDVRPlaylist.swift:227-242` | `store.ts:120-130` alle 10 s bei `!paused` | gleichwertig | – | – |
| Werbepausen-Erkennung: `AVPlayerItemMetadataCollector` für `CLASS="twitch-stitched-ad"`, Blockbildung, max 200 s, Ton aus mit +5-s-Deadline, 0,5-s-Tick | `AdBreakMonitor.swift:38-209` | `logic.ts:192-207` Heuristik "letzter Ad-Cue nach letztem `live`-Cue", 1-s-Tick `player.tsx:312-323`, Ton aus `:326-332` | PWA hat keine Dauer/Restzeit, keine Deadline bei hängender Dauer; Fehlerkennung möglich bei fehlendem `live`-Marker | klein | teilweise (Safari liefert DATERANGE als Cue, END-DATE unzuverlässig) |
| Ersatz-Stream: Media-Playlist anderer Player-Typen wird geprüft (`contains("stitched-ad")`, 6 s) und nur werbefrei genutzt; Segment-Lücke gefüllt, DISCONTINUITY | `TwitchAPI.swift:988-1009`, `LiveDVRPlaylist.swift:143-194,200-212` | `player.tsx:376-407` wechselt blind auf den ersten Token, Playlist nicht prüfbar; danach bleibt der Player dort | PWA kann in eine zweite Werbepause laufen; kein Rückweg | – | nein (playlist.ttvnw.net 403) |
| `liveAdGap`-Hinweis "weiter in n s" aus START-DATE+DURATION | `LiveDVRPlaylist.swift:244-258`, `VideoPlayerView.swift:931-950` | `player.tsx:435` nur "Werbepause · Ton aus" | Restzeit fehlt | klein | teilweise |
| Live mit Vergangenheit (`tudvr://`, Aufnahme + Live-Segmente, `reopen` nach 403, fMP4-MAP) | `LiveDVRPlaylist.swift:75-116,96-105,324-350`; `VideoPlayerView.swift:458-488` | `player.tsx:361-368` Wechsel auf Archiv-VOD, `goLive :360` | kein gemeinsamer Zeitstrahl, kein Zurück ohne Aufnahme über Safaris Puffer hinaus | – | nein |
| Low-Latency: Playlist-Rewrite TARGETDURATION 2, Prefetch entfernt (`tulive://`) | `LivePlaylistLoader.swift:34-109` | fehlt (nur `fast_bread/low_latency` als usher-Parameter, `twitch.ts:248-250`) | Safari hält ~3×TARGETDURATION Abstand | – | nein |
| Live-Edge-Haltung: Ziel `min(8,max(3.5,rec−2))`, Floor 4 s, Drift-Sprung nach 4 s/≥30 s Abstand, `userSeek` | `LiveLatency.swift:30-198`; `VideoPlayerView.swift:310-358` | fehlt | Keine Regelung des Abstands; Safari entscheidet | mittel | teilweise (Seeks auf `seekable.end − x`) |
| Chat-Sync: `LiveSyncEstimator` (10. Perzentil über 60 s, ≥6 Proben), + `chatSyncNudge ±20 s` | `LiveLatency.swift:279-303`; `MainTabView.swift:152-162`; `AppStore.swift:574` | `logic.ts:235-246` `lag − 6`, ohne Glättung, ohne Nudge | PWA-Verzögerung schwankt mit dem Bordalter; kein manueller Feintrim | klein | ja |
| Stream-Statistik-Refresh (Zuschauer, Start, `archiveId`) | `MainTabView.swift:2178-2195` alle 30 s | `player.tsx:271-280` alle 60 s | doppeltes Intervall | klein | ja |
| Wiedergabe-Interruptions (Anruf/Siri: Resume-Logik, lange Unterbrechung → Edge-Reload) | `PlaybackAudio.swift:136-324`; `VideoPlayerView.swift:496-536` | `player.tsx:299-309` nur Fullscreen-Ende-Workaround | Nach Rückkehr steht ein Live-Stream in der PWA weit hinter dem Edge | klein | teilweise (`visibilitychange` → Seek auf `seekable.end`) |
| Hintergrund-Audio: Session `.playback`, Audio weiter bei gesperrtem Display | `PlaybackAudio.swift:44-118` | nur Qualität "Nur Audio" läuft weiter | iOS pausiert `<video>` im Hintergrund | klein | teilweise: automatischer Wechsel auf `audio_only` bei `visibilitychange: hidden` (nur Proxy-Quellen) |

## 3.3 Chat-Technik

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| IRC-Parser Tag-Unescape | `IRCParser.swift:11-20` kein Unescape (nur `system-msg`/`reply-body` separat) | `logic.ts:138-148` unescaped alle Tags | PWA korrekter | – | – |
| Emote-Bereiche in Codepoints | `IRCParser.swift:53-78` | `logic.ts:164-179` | gleich, getestet | – | – |
| Batching ~200 ms, Dedupe per id, chronologisches Einsortieren bei sinkendem Delay | `ChatService.swift:116-204` | `chat.ts:254-273` Batch 200 ms; kein Dedupe per id (`ChatPanel.add player.tsx:591`) | History + Live können doppelt landen | klein | ja |
| Nachrichtencap | `ChatService.swift:39-40` 200, 600 bei Scroll-Pause | `player.tsx:592` 250 ohne Pause-Modus | beim Hochscrollen fliegen in der PWA Nachrichten weg | klein | ja |
| Verbindungs-Timeout 10 s → anonymer Fallback; Reconnect 2→30 s; nach ≥8 s Delay anonym; 3. Fehler → Systemzeile | `ChatService.swift:239-249,367-398,499-525` | `chat.ts:213-217` nur `onclose` → 1→30 s; kein Timeout, kein anonymer Fallback, keine Hinweiszeile | Hängende Sockets (iOS-Hintergrund) werden nicht erkannt | klein | ja |
| App-eigenes PING alle 240 s | `ChatService.swift:276-278` | fehlt (nur PONG auf Server-PING `chat.ts:228`) | tote Verbindung nach Hintergrund bleibt bis zum nächsten Server-PING unbemerkt | klein | ja |
| `login_authentication_failed` → anonym; `msg_banned` → Lesemodus; PART/CLEARCHAT auf uns → Rejoin (15-s-Fenster) | `ChatService.swift:779-799,310-342,570-582,915-938` | `chat.ts:240` NOTICE nur als Text | Gebannter Account: PWA zeigt nur den Twitch-Text, sendet weiter ins Leere | klein | ja |
| Ablehnungs-NOTICEs (`msg_followersonly`…) → übersetzte Meldung und Rückzug des lokalen Echos | `ChatService.swift:804-831,865-870` | `chat.ts:275-283` Echo bleibt stehen; NOTICE roh | Nutzer glaubt, Nachricht sei angekommen | klein | ja |
| ROOMSTATE + `chatSettings` per GQL (Rules, `requireVerifiedAccount`, Follower-Minuten) vor dem Senden; Regeln akzeptieren | `ChatService.swift:846-861`, `ChatModels.swift:133-147`, `ChatView.swift:957-979` | `chat.ts:242-251` nur ROOMSTATE | keine Chat-Regeln, kein "verifiziert nötig" | klein | ja |
| Follower-Modus-Dauer | `ChatModels.swift:106-128` | `player.tsx:648` "Nur Follower" ohne Minuten | – | klein | ja |
| USERNOTICE: Announcement-Farbe, Raid-Link, `highlighted-message`, `first-msg`, Reply-Threads (`reply-parent-*`) | `ChatService.swift:683-744,664-670`, `MessageSheet.swift:13-251` | `chat.ts:165-168` nur `system-msg` als Zeile; keine Replies, kein first-msg/highlight | Antworten im Thread, Hervorhebungen fehlen | mittel | ja |
| Filter: `chatMutedWords`, `chatBlockedUsers` (500), `chatHighlightWords`, Bot-Liste (17 Namen), Reclassify bei Änderung | `AppStore.swift:619-671`, `ChatView.swift:406-412` | `chat.ts:148-149` 11 Bots + `!`; `fromIRC :164` nur `@me`-Mention | Wortfilter, Nutzer blockieren, Highlight-Wörter fehlen | klein | ja |
| Historie: robotty `limit=60`, `rm-deleted`, CLEARCHAT/CLEARMSG im Replay, Sortierung nach `tmi-sent-ts` | `ChatService.swift:982-1048` | `chat.ts:218-223` `limit=100`, `rm-deleted` ignoriert, keine Replay-Moderation | gelöschte Nachrichten tauchen in der PWA wieder auf | klein | ja |
| Emote-Auflösung: Kanal BTTV→FFZ→7TV → persönliche BTTV-Pro → global | `EmoteService.swift:113-124` | `chat.ts:122-127` Kanal (eine Map, Reihenfolge nach Ladezeit) → global | keine persönlichen Emotes; Prioritäten bei Namenskollision undefiniert | klein | ja |
| BTTV-Pro persönliche Emotes (`lookup_user`) | `BTTVLive.swift:92-96`, `EmoteService.swift:225-234` | fehlt (`chat.ts:67-77` nur create/update/delete) | – | klein | ja |
| BTTV-Socket eine Verbindung für alle Chats, Reconnect 2→60 s | `BTTVLive.swift:25-82` | `chat.ts:52-64` eine Verbindung pro ChatPanel, 1→60 s | Multi-Live öffnet n Sockets | klein | ja |
| FFZ animierte Emotes (`animated.2`), `largeURL` 4 | `EmoteService.swift:309-325` | `chat.ts:23` nur `urls['2']` | FFZ-Animationen stehen still | klein | ja |
| 7TV Zero-Width (`flags & 1`), `originalName`, Autor; BTTV/FFZ `modifier` | `EmoteService.swift:352-367,263-273`, `ChatModels.swift:70-92` | fehlt (`chat.ts:22`) | Zero-Width-Emotes erscheinen als eigenes Bild statt Overlay | mittel | ja (CSS-Overlay) |
| Emote-Info-Sheet (Twitch `emote(id)`: Typ, Tier, Besitzer live?, gleiche Tier-Emotes; BTTV/FFZ/7TV-Seite, Autor, Kopieren/Einfügen) | `EmoteInfoService.swift:36-85`, `ChatNotices.swift:409-658` | `player.tsx:679-681` Bild + Quelle | – | mittel | ja |
| Badge-Titel/Beschreibung im Sheet | `BadgeService.swift:143-170` | `title` als Tooltip (`player.tsx:658`) | – | klein | ja |
| Badges: Helix mit Token, GQL-Fallback, statischer CDN-Fallback | `BadgeService.swift:27-134` | `chat.ts:106-118` nur GQL, unbekannte Badges fallen weg | Badge fehlt statt CDN-Bild | klein | ja |
| Bild-Cache: RAM 64 MB nach dekodierten Bytes, ≤40 Frames, Disk 200 MB LRU | `ImageCache.swift:41-57,103-132,208-247` | fehlt (`<img>` pro Nachricht) | 250 Nachrichten × animierte WebPs laufen alle gleichzeitig | mittel | teilweise (Animationen außerhalb des Viewports per `IntersectionObserver`/`content-visibility` anhalten) |
| Autocomplete: Emotes (Prefix vor Contains) und `@`-Mentions aus Chattern | `EmoteService.swift:165-196`, `ChatView.swift:730-822` | fehlt | – | mittel | ja |
| Emote-Picker: Gruppen (Kanal/7TV/BTTV/FFZ + Twitch gesehene), Suche, Long-Press-Info | `EmotePickerView.swift:3-173` | `player.tsx:682` flache Liste, 400 Einträge, keine Suche | – | klein | ja |
| Nachrichten-Sheet: Antworten, Erwähnen, Kopieren, Nutzer ausblenden, Thread | `MessageSheet.swift:89-159` | `player.tsx:792-809` Profil + letzte 30 Zeilen | – | mittel | ja |
| Namensfarbe: 15 benannte Farben (für alle Konten), Hex nur Turbo/Prime | `ChatMenuSheet.swift:22-31`, `TwitchAPI.swift:1165-1191` | `pages.tsx:448-449` freier `<input type=color>` → Hex | Hex wird Nicht-Turbo-Konten abgelehnt | klein | ja (Scope-Frage offen) |
| Chatter-Liste aus 353/366/JOIN/PART mit `presenceSupported` | `ChatService.swift:557-582` | `chat.ts:235-237` ohne 366 → "wartet"/"leer" nicht unterscheidbar | – | klein | ja |
| Bot-Befehle: Nightbot, SE, Fossabot, Moobot, Filter, Kopieren | `BotCommands.swift:37-97` | `chat.ts:396-416` ohne Moobot (CORS), kein Filter | – | klein (Filter) | nein (Moobot) / ja |
| Übersetzung: NL-Spracherkennung, Apple on-device, Web 3 parallel, Cache 500, Queue 30/Sprache | `ChatTranslation.swift:56-61,64-79,111-118,137-175,181-196` | `chat.ts:291-342` Google `sl=auto`, 2 parallel, 2/s, Backoff 30 s→10 min, ≥2 Wörter, Cache unbegrenzt (`tCache :291`) | PWA speichert jede Zeile für immer (Speicherwachstum) | klein | ja (Cache deckeln) |
| VOD-Chat: Persisted Query mit Raw-GQL-Fallback bei `PersistedQueryNotFound`, Retry 3→30 s, Lookahead 30 s, `seen` ≤20 000, Cap 200, Sprungregel (<−2 s / >+30 s) | `VodChatService.swift:41-47,92-112,150-232,254-260` | `chat.ts:345-391` nur Persisted (Hash-Rotation = Chat tot), Fehler = `fetchedUntil+30` ohne Backoff, Lookahead 20 s, Sprung ±15 s, `seen` und Puffer unbegrenzt | Robustheit und Speicher | klein | ja |
| Pinned Message: `pinnedBy`, `startsAt/endsAt` mit Ablauf-Task, Badges/Emotes/Farbe des Senders | `ChatPubSub.swift:41-158` | `events.tsx:59,67-69` Text + Name, Ablauf nur beim nächsten Poll | – | klein | ja |
| Live-Events: Streak/Poll/Prediction alle 15 s parallel; Hype Train 5 s (Approach)/15 s mit Zustandsautomat (Approach-Pills, Kickoff, Level done, Ended, Golden/Treasure) | `LiveEventsService.swift:112,256-263,482-713`, `HypeTrainCard.swift` | `events.tsx:56-90` alles alle 20 s, Hype nur Level/Progress/Ende | Approach-Phase, Varianten, Übergänge fehlen | mittel | ja |
| Prediction: Gewinner nach Ende 60 s (`resolvedPredictionEvents`), `topPredictors`, Quote, Presets (10/100/1k/10k/Max), Gewinn an `PointsTracker` | `LiveEventsService.swift:353-476`, `:862-1131` | `events.tsx:75-81,169-185` nur laufend/locked, freier Betrag | – | klein | ja |
| Poll: Ergebnis-Faltung, Gewinner-Trophäe, Multichoice | `LiveEventsService.swift:775-857` | `events.tsx:160-168` | kleiner Rückstand | klein | ja |
| Raids: Hermes mit Keepalive-Watchdog, Reconnect 2→60 s, `reconnect`-Envelope | `RaidService.swift:40-136` | `events.tsx:124-148` ohne Watchdog; Reconnect ab 4 s | tote Hermes-Verbindung bleibt bis `onclose` stumm | klein | ja |
| Drops-Karte über dem Chat (`viewerDropCampaigns`, alle 10 min, dismiss-Liste) | `ChatNotices.swift:23-104` | fehlt (nur "Drops verknüpfen"-Notice) | – | klein | ja |
| Watch Streak | `LiveEventsService.swift:266-280` (Web-Session) | `events.tsx:64,83-84,187` (TV-Token) | vorhanden; LIMITATIONS.md behauptet das Gegenteil | – | – |
| Chat-Teardown erst nach Verlassen (PiP/Fullscreen hält) | `ChatView.swift:604-624` | `player.tsx:607` sofort | – | – | – |

## 3.4 AppStore-Zustand, Verlauf, Backup

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| Tokens im Keychain, UserDefaults nur als Fallback | `Keychain.swift:11-61` | `store.ts:137-141` `localStorage` | Browser hat kein Keychain | – | nein |
| Verlauf: 50 Einträge, Typen `vod`/`channel` | `AppStore.swift:878-884`, `Models.swift:195-231` | `store.ts:161-164` 500 Einträge, Typen `vod/live/clip`; Kanalseiten werden nicht erfasst | "Zuletzt geöffnete Kanäle" (Suche) fehlt; PWA hat stattdessen Suchbegriffe | klein | ja |
| VOD-Fortschritt: ≥5 s Delta, Cap 500, Save 30 s debounced + Flush | `AppStore.swift:595-616,932-1005` | `store.ts:172` ohne Cap; Save 2 s; Flush bei `visibilitychange`/`pagehide` | Progress-Map wächst unbegrenzt | klein | ja |
| Cloud-Sync über Worker (`/api/sync/get|post`) | `AppStore.swift:1031-1630` | fehlt (bewusst, "kein Backend") | iOS-Verlauf und PWA-Verlauf sind getrennt | groß | teilweise (Vorgabe schließt es aus) |
| Backup-Format `twitchunblock-backup` v1, Import merged (Follows ≤300, Kategorien ≤200) | `Backup.swift:26-209` | `store.ts:177-192` Format `TwitchUnblock-PWA` v1, Import ersetzt alles | iOS-Backup lässt sich in der PWA nicht einspielen und umgekehrt | klein | ja |
| HiddenContent: Caps 500/200, Validierung, Follows/Pins nie versteckt, `hideChannel` verweigert bei Follow, Top-Refill | `HiddenContent.swift:31-172`, `AppStore.swift:477-523`, `HomeView.swift:926-935` | `store.ts:106-113` ohne Caps/Validierung; `pages.tsx:23` filtert auch gefolgte Kanäle aus Home; kein Refill | gefolgter Kanal kann in der PWA aus der Startseite verschwinden | klein | ja |
| Gepinnte Streamer (vorn in Follow-Listen) | `AppStore.swift:451-461`, `HomeView.swift:223-240` | fehlt | – | klein | ja |
| Gefolgte Kategorien lokal + Twitch-Liste | `AppStore.swift:411-425`, `TwitchGQL.swift:237-249` | `store.ts:114-117`, `rewards.ts:178-199` mit `followGame` | PWA kann mehr | – | – |
| Chat-Darstellungsregler: Abstand, Badge-/Emote-Skala, Chat-Breite 20–60 % | `AppStore.swift:338-371` | `store.ts:16` nur `chatFont` | – | klein | ja |
| Einstellungen: `chatLoadRecent`, `chatAutocomplete`, `showPinned/DropsNotice/FollowButton/Streak/Events`, `enableRaids`, `multiLiveChat`, `restoreMutedAudio`, `homeListLayout`, `showRecentChannels`, `categoryLang`, `autoPurgeImageCache` | `AppStore.swift:156-241,286-307,526-576` | `store.ts:10-32` | fehlende Schalter: Historie laden, Notices einzeln, Raids, Kategorie-Sprache persistent | klein | ja |
| Hidden-Users (Chat) in Settings | `SettingsView` `hidden_users` | fehlt | – | klein | ja |

## 3.5 Drops

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| Fortschritt: kleinste Variante (audio_only) alle 10 s neu lesen, HEAD je Segment, 401/403 → Token neu, 404 → Live-Ende, Fehler >2 → `failing`, Pause 60 s | `Drops.swift:515-571,603-662` | `rewards.ts:93-99` + `player.tsx:421` unsichtbares `<video>` mit Master-Playlist → Safari-ABR wählt Qualität selbst | PWA lädt potenziell 720p+ statt audio_only; Settings-Text "niedriger Qualität" stimmt nicht | klein | teilweise (kleine Darstellung erzwingen, Safari wählt dann niedrige Varianten) |
| Kanal-Kampagnen alle 10 min neu prüfen | `Drops.swift:521-538` | `player.tsx:342` einmal beim Quellstart | – | klein | ja |
| Inventar: 5 min im Live, Foreground, Login; Claim-Verifikation per erneutem Inventar | `Drops.swift:198-242,561-566` | `rewards.ts:104-145` | PWA ohne Re-Read nach Claim | klein | ja |
| Alle offenen Kampagnen (`dropCampaigns`, UPCOMING) | `Drops.swift:246-298` | fehlt (nur `dropCampaignsInProgress`) | Drops-Seite zeigt nur begonnene Kampagnen | klein | teilweise |
| `dropCurrentSession` (aktueller Drop + Minuten) | `Drops.swift:301-315` | fehlt | – | klein | ja |
| `needsAccountLink` = `!isAccountConnected && !url.contains("twitch.tv")` | `Drops.swift:438` | `rewards.ts:113` `linked: isAccountConnected ?? true` | Twitch-eigene Badge-Drops lösen in der PWA eine Link-Notice aus | klein | ja |
| Link-Sheet mit WKWebView + Cookies | `DropsLinkSheet` | `notices.tsx:62` `window.open` | – | – | nein |
| Notify einmal je Drop/Status, persistent | `Drops.swift:343-356`, `InAppNotices.swift:59-76` | `rewards.ts:102,125` nur in-memory | nach Reload erneut gemeldet | klein | ja |

## 3.6 Kanalpunkte

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| Polling: Balance 90 s, Truhe 30 s, minute-watched 60 s | `ChannelPointsService.swift:35-36,46` | `rewards.ts:81` eine Query 30 s + 60 s | vertretbar | – | – |
| spade-URL aus `twitch.tv/<login>` bzw. `settings.<hash>.js` | `:294-316` | `rewards.ts:14` fest `https://spade.twitch.tv/track` | bricht bei URL-Rotation still | klein | teilweise |
| Claim via Integritäts-Token, ≤5 Versuche | `:50-56,322-367` | `rewards.ts:59-66` TV-Token, ein Versuch, Retry nach 30 s | gleichwertig | – | – |
| Belohnungen lesen + `redeemCommunityPointsCustomReward` | `:369-465`, `ChannelPointsView.swift` | fehlt | – | mittel | teilweise (Lesen ja; Einlösen ohne Integrität unbelegt) |
| `PointsTracker` (Minuten/Punkte/Truhen je Kanal, 300 Kanäle) | `PointsTracker.swift:13-133` | fehlt | – | klein | ja |
| Balance-Delta-Animation | `:158-179` | fehlt | kosmetisch | klein | ja |

## 3.7 Benachrichtigungen

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| Live-Benachrichtigung im Hintergrund: `BGAppRefreshTask` ≥15 min | `LiveNotifier.swift:26-150` | `pages.tsx:20-44` Poll 2 min nur während Home gemountet | PWA-Poll stoppt auf Durchsuchen/Meine VODs/Kanalseite | klein | ja (Poll in ein Modul außerhalb der View) |
| ntfy über Worker | `NtfyNotifier.swift:14-138` | `pwa/push/live-push.mjs` + GitHub Actions alle 5 min | anderer Mechanismus; Setup manuell | – | – |
| Notification-Tap → `openLiveChannel` | `AppDelegate.swift:37-46` | `sw.js:22-29`, `main.tsx:75` | gleich | – | – |
| In-App-Notices: 5 s, Queue 5, 3 Tage aufbewahrt | `InAppNotices.swift:43-144` | `notices.tsx:18-51` 4 s, Queue 5, nicht persistent | nach Reload weg | klein | ja |

## 3.8 Downloads, Offline, VOD-Meta, Schlaf, Live Activity, Sprache

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| VOD-Downloads | `VodDownloads.swift`, `VodChatArchive.swift:49-105` | fehlt | – | groß | nein (CloudFront erlaubt nur twitch.tv) |
| OfflineServer | `OfflineServer.swift:14-172` | fehlt | – | – | nein |
| VodMetaStore (Länge/Views je Verlaufszeile lazy) | `VodMetaStore.swift:11-27` | `store.ts:39` `length` beim Abspielen gespeichert | ältere Einträge ohne Länge gelten als "nicht fertig" | klein | ja |
| Schlaf-Timer: 1-s-Ticker, Chip im Player | `SleepTimerService.swift:12-86`, `MainTabView.swift:519-524` | `player.tsx:48-49,255-260,556-558` Prüfung nur bei `timeupdate` | bei pausiertem Video feuert der Timer nicht | klein | ja (`setTimeout`) |
| Live Activity | `PlayerActivity.swift:17-145`, `Widgets/` | Media Session `player.tsx:214-252` | – | – | nein |
| Top-Sprache: 33 Helix-Codes, Gerätesprache mit Aliasen | `TopLanguage.swift:8-38` | `pages.tsx:16-17` 12 Sprachen, Default `navigator.language.slice(0,2)` auch außerhalb der Liste | `nl`, `sv`, `zh-hk` nicht wählbar; Default kann unsichtbar sein | klein | ja (`Intl.DisplayNames`) |
| Kategorie-Sprache (eigene Einstellung, global) | `AppStore.swift:541`, `CategoriesView.swift:598-646` | `pages.tsx:184` pro Seite, nicht gespeichert | – | klein | ja |
| App-Icon-Wechsel zur Laufzeit | `AppIcons.swift:12-68` | `store.ts:96-99` nur `apple-touch-icon`-Link | – | – | nein |
| Spatial Audio aus | `SpatialAudio.swift` | fehlt | – | – | nein |

## 3.9 Login, Deep-Links, Share

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| App-OAuth implicit (Scopes `user:read:follows chat:read chat:edit user:manage:chat_color`) | `TwitchAuthManager.swift:21-121` | `account.ts:7-32` Device-Code mit TV-Client, Refresh-Token | TV-Token bekommt keine Scopes → `channels/followed`, `chat/color` unsicher | – | nein (Implicit-Redirect auf mxfia19.github.io registriert) |
| Web-Session (Cookie `auth-token`) + Integrität | `TwitchWebAuthManager.swift:21-369` | fehlt | – | – | nein |
| 401 auf Helix → Logout + `oauthExpired`-Hinweis | `HomeView.swift:805-812` | `account.ts:56-59` Refresh, dann `setAccount(null)` ohne Hinweis | – | klein | ja |
| URL-Schema `twitchunblock://live/<login>` | `TwitchUnblockApp.swift:17-22` | `main.tsx:36-52` `#/live|vod|clip|channel|multi` + `?u=` | PWA kann mehr | – | – |
| Share-Extension | keine auf iOS | `manifest.webmanifest:15` `share_target` (iOS unterstützt es nicht) | beide ohne Teilen-Ziel | – | nein |
| Foreground-Refresh-Batch (30 s Mindestabstand, 120 s Stuck) | `TwitchUnblockApp.swift:76-97` | `main.tsx:73` nur `checkDrops` bei `visible` | Follows/Drops nicht gebündelt | klein | ja |

## 3.10 Service Worker, Updates, Logging, Tests

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| Update-Mechanik | App-Version aus `VERSION`+Commits | `sw.js:2` Cache-Name fest `shell-v1`; Assets cache-first ohne Aufräumen | alte gehashte Assets bleiben im Cache; kein "Update verfügbar"-Hinweis | klein | ja |
| Logger: 5 Level, Kategorie, Detail, 500 Einträge | `Logger.swift:4-112` | `log.ts:1-22` `ok`-Flag, 300 Einträge, localStorage | PWA loggt deutlich weniger Stellen; kein Debug-Level | klein | ja |
| LogsView: Filter nach Level und Kategorie, Teilen | `LogsView.swift` | `pages.tsx:518-538` Filter Kategorie, Kopieren | – | klein | ja |
| LiveDiagnostics (Stalls, Bitrate alle 60 s) | `LiveLatency.swift:206-260` | fehlt | `video.getVideoPlaybackQuality()` | klein | teilweise |
| Unit-Tests | keine | `pwa/test/logic.test.ts` 86 Zeilen | PWA voraus; ungetestet: `fromIRC`, `VodChat`, Backup-Import | klein | ja |

## 3.11 Sonstige Verhaltensunterschiede

| Funktion/Verhalten | iOS | PWA | Unterschied | Aufwand | machbar |
|---|---|---|---|---|---|
| "Clips deiner Kanäle": alle gefolgten Kanäle, in 8er-Chunks, Kanal-Picker | `HomeView.swift:167-198` | `pages.tsx:69` `logins.slice(0, 8)` → nur die ersten 8 Follows, kein Picker | nicht gleichwertig | klein | ja |
| Home-Refresh: alle 3 min, bei Rückkehr nach 60 s, bei Follow-Änderung, Konto-Follows jedes Mal neu | `HomeView.swift:92-109,143-149,820-828` | `pages.tsx:66` 2 min; Konto-Follows einmal je `userId` | Follows, die am PC geändert wurden, erscheinen erst nach Reload | klein | ja |
| Suche: 300 ms, ≥2 Zeichen, Helix-Fallback für Kategorien | `SearchView.swift:194-197,295-312` | `pages.tsx:140-145` 250 ms, ab 1 Zeichen | – | klein | ja |
| Verlauf-Gruppen "Diese Woche" = Kalenderwoche | `LibraryView.swift:34-48` | `pages.tsx:222-228` letzte 6 Tage | kosmetisch | klein | ja |
| Resume-Regel: >60 s, <95 %; VOD "zu Ende" (<30 s vor Schluss) → Start | `LibraryView.swift:24-31`, `VideoPlayerView.swift:266-274` | `pages.tsx:102`, `player.tsx:180-181` 95 % | "<30 s vor Ende → von vorn" fehlt | klein | ja |
| Multi-Live: Qualität 1080/720/480 nach Anzahl, VOD-Kacheln, Chat für hörbare Kachel | `MultiLive.swift:41,87-148,604-608` | `player.tsx:687-745` immer 480p, nur Live | – | klein | ja |
| Clip-Feed: Pool mit Nachbar-Preload, Halten = 2×, Chrome-Autohide 3 s | `ClipFeedView.swift:25-60` | `player.tsx:748-787` ein `<video>`, kein Preload | Wischen lädt erst dann | klein | ja |

## Audit-Aussagen, die nicht (mehr) stimmen

1. `FEATURE_AUDIT.md` Zeile 115 und `LIMITATIONS.md` Zeile 168 („Watch Streak fehlt“): der Watch Streak ist in `events.tsx:64,83-84,187` über `BatchGetWatchStreaks` umgesetzt. Nur das Einlösen von Belohnungen fehlt.
2. `LIMITATIONS.md` Zeile 171 („Namensfarbe lässt sich nicht ändern“) widerspricht `pages.tsx:448-449` und `account.ts:100-104`: der Picker ist da und sendet `PUT chat/color`. Ob der Scope kommt, ist ungetestet.
3. `FEATURE_AUDIT.md` Zeile 33 („Cloudflare-Worker: fremder Server, Vorgabe kein Backend“): `vod.ts:6-9` hängt für VOD-Fallback und Recovery bereits an diesen Workern. Die Live-Notquelle (`/api/get-live`) wäre mit demselben `workerJSON` in ~15 Zeilen einbaubar.
4. `COMPATIBILITY_MATRIX.md` Zeile 224 („api.vodvod.top ausgeschlossen“): die Recovery ist über `recover-list`/`recover-resolve` portiert.
5. `PWA_ARCHITECTURE.md` Zeile 330 („höchstens drei Anfragen gleichzeitig“): `chat.ts:322-323` erlaubt 2 parallel und 2 pro Sekunde mit Backoff.
6. `PWA_ARCHITECTURE.md` Zeile 268 („einzige Client-ID“): `twitch.ts:7-15` enthält vier IDs; der Login nutzt die TV-ID.
7. `PWA_ARCHITECTURE.md` Zeile 336 (Scopes offen): `account.ts:65-68` hält fest, dass das TV-Token ohne Scopes zurückkommt; Follows laufen über die Persisted Query `ChannelFollows`. Für `chat/color` bleibt es offen.
8. `FEATURE_AUDIT.md` Zeile 79 („Clips deiner Kanäle (24 h, 8 Kanäle) umgesetzt“): iOS lädt alle Follows in 8er-Gruppen, die PWA nur die ersten 8 Follows.
9. `FEATURE_AUDIT.md` Zeile 116 / `pages.tsx:415` („unsichtbarer zweiter Stream in niedriger Qualität“): `rewards.ts:93-99` übergibt die Master-Playlist, Safari wählt per ABR. iOS pollt die audio_only-Variante.
10. `FEATURE_AUDIT.md` Zeile 134 („Live-Mitteilung alle 2 min solange die App offen ist“): der Timer lebt in der `Home`-Komponente; auf anderen Tabs wird nicht abgefragt.
11. `FEATURE_AUDIT.md` Zeile 86 (Chat gebündelt): die Dedupe per Nachrichten-id (`ChatService.swift:182-187`) fehlt.
12. `FEATURE_AUDIT.md` Zeile 73 („VOD-Chat-Replay umgesetzt“): ohne Raw-GQL-Fallback bei `PersistedQueryNotFound`; eine Hash-Rotation schaltet den PWA-VOD-Chat ab.
13. `FEATURE_AUDIT.md` Zeile 137 (Sicherung): das Format ist mit dem iOS-Format inkompatibel.
14. `FEATURE_AUDIT.md` Zeile 127 (Ausblenden): die iOS-Regel „gefolgt/gepinnt wird nie ausgeblendet“ fehlt.
15. `FEATURE_AUDIT.md` Zeile 141 nennt nur Hash-Links; `main.tsx:38,45-50` verarbeitet auch `?u=`/`?text=`/`?url=`.
16. `LIMITATIONS.md` Zeile 190 („nur Immersiv-Reste offen“): unvollständig, siehe Top-15.

## Die 15 wichtigsten im Browser machbaren technischen Angleichungen

1. **Chat-Verbindungsrobustheit** (`chat.ts:200-224`): 10-s-Connect-Timeout mit anonymem Fallback, eigenes `PING` alle 240 s, Reconnect-Check bei `visibilitychange: visible`, Hinweiszeile nach 3 Fehlern.
2. **Dedupe per Nachrichten-id + Cap 200/600 bei Scroll-Pause** (`player.tsx:591-592`).
3. **NOTICE-Behandlung**: `msg_banned` → Lesemodus, `login_authentication_failed` → anonym, Ablehnungs-NOTICEs mit deutschem Text und Rückzug des lokalen Echos.
4. **Historie wie iOS**: `rm-deleted`, CLEARCHAT/CLEARMSG im Replay, Sortierung nach `tmi-sent-ts`, `limit=60`.
5. **Chat-Filter**: `mutedWords`, `blockedUsers`, `highlightWords`, vollständige Bot-Liste; Follower-Minuten und `chatSettings` per GQL.
6. **VOD-Chat härten** (`chat.ts:345-391`): Raw-GQL-Fallback, Retry-Backoff 3→30 s, Lookahead 30 s, `seen` trimmen, Puffer deckeln, Sprungregel −2/+30 s.
7. **Live-Poll aus der View lösen**: Modul unabhängig vom Tab alle 2 min; Konto-Follows alle 3 min neu; „Clips deiner Kanäle“ über alle Follows in 8er-Chunks.
8. **Hidden/Follows-Regeln**: gefolgte Kanäle nie ausblenden, Caps 500/200, Validierung, gepinnte Streamer.
9. **Backup-Kompatibilität**: Importer für das iOS-Format mit Merge statt Ersetzen; Progress-Cap 500.
10. **Werbepausen-Restzeit und Deadline**: `DURATION`/`END-DATE` aus dem Cue lesen, „weiter in n s“, Ton spätestens nach Ende+5 s zurück, Block auf 200 s begrenzen.
11. **Drops-Fortschrittsstream sparsam**: kleine Darstellung erzwingen, Kampagnen alle 10 min prüfen, `dropCurrentSession`, `needsAccountLink` wie iOS, Inventar nach Claim neu lesen, Notify-Liste persistent.
12. **Übersetzung/Emotes im Speicher begrenzen**: `tCache` auf 500, animierte Emotes außerhalb des Viewports anhalten, FFZ `animated.2`, 7TV Zero-Width als Overlay, BTTV-Pro `lookup_user`, ein gemeinsamer BTTV-Socket.
13. **Chat-Sync glätten + Nudge**: `LiveSyncEstimator` in `logic.ts:235-246`, Einstellung `chatSyncNudge ±20 s`; Live-Edge-Catch-up nach Rückkehr aus dem Hintergrund.
14. **Live-Events vervollständigen**: Hype-Train-Zustandsautomat, Prediction-Gewinner, `topPredictors`, Presets, Pinned mit Ablauf-Timer, Raid-Watchdog, Drops-Karte über dem Chat.
15. **Service-Worker-Updates und Logging**: Cache-Name aus `__APP_VERSION__`, alte Assets löschen, „Neue Version“-Hinweis; Logger mit Level/Detail und mehr Logpunkten.

Nicht im Browser erreichbar: Playlist-Umschreiben (`LiveDVRPlaylist`, `LivePlaylistLoader`, geprüfter Ersatz-Stream), usher-Qualitätsliste bei Twitch offiziell, Web-Session/Integritäts-Token, Keychain, Live Activity, Hintergrund-Video, Downloads/Offline, Moobot (CORS), Spatial Audio, Icon-Wechsel zur Laufzeit.
