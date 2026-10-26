# Funktionsaudit: iOS-App → Web-App

Grundlage ist der Quellcode auf dem Branch `optimize` (`Sources/`, `Shared/`, `Widgets/`, `TV/`, rund 40 000 Zeilen Swift) und die Notizen in `CLAUDE.md`. Jede Funktion steht hier mit ihrer Swift-Datei, einer Kategorie, dem Stand in der Web-App und dem Teststand.

## Kategorien

- **A**: geht im Browser direkt.
- **B**: geht mit Änderungen oder anderer Architektur.
- **C**: nur teilweise möglich.
- **D**: unter den Vorgaben (kein Server, keine Kosten, kein Sideloading, GitHub Pages) nicht möglich.
- **X**: absichtlich ausgeschlossen (Projektregel in `CLAUDE.md`, siehe unten).

## Teststand

- **Sim**: im iOS-Simulator (iOS 27, Safari, echtes iOS-WebKit) ausgeführt, von `http://127.0.0.1`, einem Origin, den Twitch nicht freigibt (wie github.io).
- **Chromium**: nur im eingebauten Chromium-Browser geprüft (Bedienlogik, kein Video).
- **nicht getestet**: weder auf einem echten iPhone noch im Simulator ausgeführt.

Kein Test lief auf einem echten iPhone (außer der Anmeldung, die der Nutzer selbst bestätigt hat). Alles, was hier „Sim“ heißt, ist auf dem Gerät **nicht getestet**. Getestet wurde in Safari und in der installierten Home-Bildschirm-App des Simulators; ein eingeschleustes Testskript des lokalen Testservers las dabei den Zustand aus. Bekannte Eigenheit des Simulators (siehe `CLAUDE.md`): Manche Streams bleiben schwarz, obwohl Ton und Zeit laufen. Das trat auch hier auf.

## Ausgeschlossen durch Projektregel (X)

`CLAUDE.md` verbietet, diesen Code zu ändern, zu erweitern oder nach TypeScript zu portieren. Er fehlt deshalb in der Web-App, und das ist Absicht:

| Funktion | Swift-Code |
|---|---|
| Abonnenten-VODs ohne Abo ansehen | `TwitchAPI.swift`: `workerVariants` … `getM3U8`, `storyboardHack`, `workerJSON` |
| VOD-Playlists aus dem Twitch-CDN neu bauen, gelöschte VODs wiederfinden | `VodRecoveryService.swift`, `kVodRecoveryHosts` |
| Stummgeschaltete Passagen (Urheberrecht) wiederherstellen | `VodUnmute.swift`, `playableMutedLinks`, `proxiedPlaylistURL`, `workingProxyBase` |
| VODs über den Cloudflare-Worker | `workerJSON`, `getM3U8` |

Die Web-App spielt VODs nur über Twitchs normales Wiedergabe-Token ab (`vodURL` in `src/twitch.ts`). Für Abonnenten-VODs lehnt Twitch das Token ab, und die App zeigt „VOD nicht gefunden oder nur für Abonnenten.“

## Wiedergabe live

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Live über Quellen-Rennen (Luminous Asien/Europa, TTV.LOL-Proxy, Twitch offiziell), zeitversetzt parallel, Twitch zuletzt | `TwitchAPI.swift` `getLive`, `raceLiveSources` | B | umgesetzt (`raceLive`) | Sim: Luminous Asien gewann, Bild und Ton liefen |
| Reihenfolge der Quellen einstellbar | `liveSourceSteps` | A | umgesetzt (Einstellungen) | Sim: Umstellen per ↑/↓ gespeichert, Player nahm danach „Luminous Europa“ |
| Quelle im Player wechseln | `PlayerSettingsSheet.swift` | A | umgesetzt; die gewählte Quelle bekommt ihre volle Zeit, erst danach die anderen (vorher gewann oft eine schnellere andere Quelle) | Sim: Albanien, Asien, Europa, Twitch offiziell, jeweils Wiedergabe; zwei Fehler dabei gefunden und behoben (Quelle ignoriert, Video blieb nach Wechsel ohne Quelle) |
| Qualitätswahl | `parseMaster`, `preferredQualityKey` | C | bei Proxys ja; bei „Twitch offiziell“ nur „Automatisch“, weil usher fremden Seiten keinen CORS-Header schickt | Sim: 480p gewählt → Bild 852×480, Wahl gespeichert; Proxy bietet Source, 720p60, 480p, 360p, 160p, Nur Audio |
| Niedrige Latenz | `fast_bread`, `low_latency` | A | umgesetzt | Sim: aus → usher-Adresse mit `fast_bread=false&low_latency=false`, an → `true`, beide spielen |
| Live-Sekundärquelle Cloudflare-Worker | `workerLiveLinks` | D | nicht übernommen: fremder Server des Upstream-Entwicklers, die Vorgabe lautet „kein Backend“ | – |
| Zuschauer ohne Werbung über den eigenen Account (Abo/Turbo) | `accountPlaybackToken` | D | fehlt: braucht die Web-Sitzung (Cookie `auth-token` von twitch.tv), die eine fremde Seite nicht lesen kann | – |
| Zurückspulen im Live (LiveDVRPlaylist: Aufnahme + Live-Segmente in einer Playlist) | `LiveDVRPlaylist.swift`, `LivePlaylistLoader.swift` | C | ersetzt: beim Zurückspulen wechselt der Player auf die laufende Aufnahme (Archiv-VOD), nativ abgespielt; „● Live“ springt zurück. Keine verschmolzene Zeitleiste, Kanäle ohne Aufnahme nur im kleinen nativen Puffer | Sim: eine Stunde zurück (5:00:31 von 6:00:20), „● Live“ zurück zum Live-Stream; Fehler gefunden und behoben: der Sprung beim Laden wurde verworfen. Bild im Simulator teils schwarz |
| Werbepausen mit Ersatz-Stream füllen | `adFreeBackupPlaylist`, `LiveDVRPlaylist` | D | nicht möglich: verlangt das Umschreiben der Media-Playlist, und `playlist.ttvnw.net` antwortet fremden Seiten mit 403 | – |
| Werbepausen erkennen, Ton aus, Hinweis | `AdBreakMonitor.swift`, `liveAdGap` | C | umgesetzt über die `EXT-X-DATERANGE`-Metadaten, die Safari als Cues meldet (maßgeblich ist der zuletzt begonnene Eintrag); Ton aus, Hinweis, danach Ton wie vorher; Knopf „Ersatz-Stream“ lädt ein Token mit Player-Typ embed/popout/autoplay | Sim mit echter Werbung (Pre-Roll bei 6 von 12 Top-Streams): Hinweis und Ton aus für ~32 s, danach weiter; zwei Fehler gefunden und behoben (Video blieb nach der Werbung stehen; Hinweis blieb nach der Werbung stehen). Ersatz-Stream: bei otplol_ sofort ohne Werbung |
| Werbepausen je Quelle zählen, Reihenfolge danach | `LiveAdStats` | B | umgesetzt: Sekunden und Pausen je Quelle, Anzeige bei der Quellen-Reihenfolge, Schalter „Nach Werbepausen sortieren“ (Proxys mit den wenigsten Pausen pro Stunde zuerst, sobald zwei je 20 min gemessen sind) | Logik: `npm test`; Chromium: Anzeige und Reihenfolge (Albanien vor Asien bei 1 statt 6 Pausen/h); Sim: 70 s für „Luminous Asien“ gezählt |
| Chat-Verzögerung an die Latenz anpassen, Chat-Replay bei großem Abstand | `liveLatency`, `LiveLatency.swift` | B | nicht umgesetzt | – |
| Zuschauerzahl und Laufzeit regelmäßig aktualisieren | `getStreamStats` | A | Zuschauer, Titel, Kategorie und Aufnahme jede Minute; Laufzeit läuft mit | Sim: Abfrage nachweislich jede Minute |

## Player und Bedienung

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Eigene Steuerung im YouTube-Stil (Leiste, ±10 s, Doppeltipp, Ausblenden nach 3 s, „● Live“) | `PlayerControls.swift` | B | umgesetzt (`Controls` in `src/player.tsx`) | Sim |
| Vollbild | `rotatePlayer` | C | nativer Vollbild-Player von iOS (`webkitEnterFullscreen`); dort fehlen eigene Steuerung und Chat. Das iPhone kennt die Fullscreen-API nur für `<video>` | Sim: öffnet den iOS-Vollbild-Player; Fehler gefunden und behoben: nach dem Schließen stand das Video auf Pause |
| Querformat: Video neben dem Chat | Landscape-Layout | B | umgesetzt per CSS, sobald das Gerät gedreht wird | Sim; Fehler gefunden und behoben: in der installierten App drückte ein langer Untertitel die Chat-Spalte auf zwei Drittel der Breite |
| Querformat per Knopf erzwingen | `requestGeometryUpdate` | D | iOS-Safari hat kein `screen.orientation.lock` | – |
| Bild füllen per Pinch | `fillScreen` | B | umgesetzt im Querformat (Auseinanderziehen füllt, Zusammenziehen zeigt alles), auch als Schalter „Bildschirm füllen“ | Sim: beide Gesten, Einstellung gespeichert |
| Wischen nach unten minimiert | `PlayerPull.swift` | B | umgesetzt im Hochformat (mindestens 90 px nach unten über das Video) | Sim: Wischen über das Video → Mini-Player, Stream läuft weiter |
| Mini-Player über der Tab-Leiste | `TabAccessory` | B | umgesetzt | Sim |
| AirPlay | AVKit | B | `webkitShowPlaybackTargetPicker` | Sim: Knopf ruft die iOS-Auswahl auf; ohne AirPlay-Geräte im Simulator nicht weiter prüfbar, auf dem iPhone **nicht getestet** |
| Bild in Bild | AVKit | C | `webkitSetPresentationMode`; der Knopf erscheint nur, wenn das Gerät Bild in Bild meldet | Sim: Safari im Simulator meldet kein Bild in Bild, Knopf ausgeblendet; auf dem iPhone **nicht getestet** |
| Wiedergabe im Hintergrund, Sperrbildschirm | `PlaybackAudio.swift` | C | mit Bild pausiert iOS beim Wechsel auf den Home-Bildschirm und setzt bei Rückkehr fort; mit Qualität „Nur Audio“ läuft der Ton im Hintergrund weiter (nur bei Proxy-Quellen wählbar). Media-Session-Titel gesetzt | Sim: Video 20 s im Hintergrund → pausiert; „Nur Audio“ 26 s im Hintergrund → lief durch. Sperrbildschirm-Anzeige nicht gesehen |
| Schlaf-Timer | `SleepTimerService.swift` | A | umgesetzt | Sim (installierte App): 21:15:20 auf 15 min gestellt, um 21:30:42 war der Player geschlossen |
| Geschwindigkeit (VOD/Clip) | `PlayerSettingsSheet` | A | umgesetzt | Sim: 1,5× → 6 s Video in 4 s, gespeichert |
| Immersiver Player (Chat über dem Video, drei Modi) | `ImmersivePlayer.swift` | C | nicht übernommen; nur Hoch- und Querformat | – |
| Live Activity, Dynamic Island | `PlayerActivity.swift`, `Widgets/`, `Shared/` | D | gibt es für Web-Apps nicht | – |
| Raumklang | `SpatialAudio.swift` | D | keine Web-API | – |
| Multi-Live (bis 4 Streams) | `MultiLive.swift`, `MultiLiveView.swift` | B | umgesetzt; Raster mit 480p, Ton nur beim angetippten Stream | Sim: zwei Streams, Ton per Tippen hin und her; zwei Fehler gefunden und behoben (Tippen kam bei einer Zelle nicht an; abgebende Zelle blieb pausiert) |

## VODs, Clips, Verlauf

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| VOD abspielen (normales Token) | `getM3U8` (nur dessen Twitch-Teil) | B | neu geschrieben, nicht portiert; nur „Automatisch“ als Qualität | Sim: Zeit lief, Ton an, Bild schwarz (Simulator) |
| Fortsetzen an der letzten Stelle, Fortschritt speichern | `AppStore`, `VodMetaStore.swift` | A | umgesetzt (localStorage, alle 5 s und beim Verlassen) | Sim: bei 1:00:25 verlassen, fortgesetzt bei 1:00:33; Fehler gefunden und behoben: IndexedDB hing nach einem Safari-Neustart, Speichern ging still verloren |
| Kapitel (Spielwechsel) | `getVodMarkers` | A | umgesetzt (Marken auf der Leiste, Liste in den Einstellungen) | Sim: xQc-VOD mit drei Kapiteln, Marken auf der Leiste, Sprung auf 56:59 |
| VOD-Chat-Replay | `VodChatService.swift`, `VodChatView.swift` | A | umgesetzt (Persisted Query `VideoCommentsByOffsetOrCursor`) | Sim |
| VOD-Downloads, Offline-Wiedergabe, Chat-Archiv | `VodDownloads.swift`, `OfflineServer.swift`, `VodChatArchive.swift` | D | Hinweis in „Meine VODs“; VOD-Playlists auf CloudFront erlauben nur `https://www.twitch.tv` | – |
| Verlauf nach Tagen (Heute/Gestern/Diese Woche/Früher), Entfernen | `LibraryView.swift` | A | umgesetzt, Entfernen über „Bearbeiten“ | Sim |
| „Ansehen fortsetzen“ (Start und Meine VODs) | `ResumeVodCard` | A | umgesetzt | Sim: Regal auf Start und in Meine VODs, Antippen setzt an der Stelle fort |
| Clip abspielen, „Zur VOD“ | `getClip` | A | umgesetzt (MP4) | Sim |
| Clip-Feed vertikal, ein Player | `ClipFeedView.swift` | B | umgesetzt; ein `<video>` für den ganzen Feed, damit der Ton beim Wischen an bleibt | Sim |
| „Clips deiner Kanäle“ (24 h, 8 Kanäle) | `HomeView.swift` | A | umgesetzt | Sim |
| Highlights, Playlists eines Kanals | `getHighlights`, `getCollections` | A | umgesetzt | Sim: riotgames 50 Highlights, Playlists „First Stand 2025“, „Worlds 24“ … |

## Chat

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Live-Chat lesen (IRC über WebSocket, anonym) | `ChatService.swift`, `IRCParser.swift` | A | umgesetzt, gebündelt alle 200 ms | Sim |
| Chatverlauf beim Betreten | robotty `recent-messages` | A | umgesetzt (blasser dargestellt) | Sim |
| Twitch-, BTTV-, FFZ-, 7TV-Emotes | `EmoteService.swift` | A | umgesetzt | Sim |
| BTTV/7TV-Änderungen live | `BTTVLive.swift` | B | nicht umgesetzt | – |
| Badges | `BadgeService.swift` | A | umgesetzt (öffentliches GQL) | Sim |
| Schreiben | `ChatService.send` | B | umgesetzt (IRC mit `chat:edit`), eigene Nachricht lokal angezeigt | nicht getestet (kein Login) |
| Automatisch übersetzen | `ChatTranslation.swift` | B | nur Googles Web-Endpunkt (`gtx`); Apples Übersetzung auf dem Gerät gibt es im Browser nicht. Abweichung: mindestens zwei Wörter, Erkennungs-Konfidenz ≥ 0,5, keine Übersetzung, die nur Groß-/Kleinschreibung oder Lacher ändert | Sim |
| Raummodi (Slow, Follower, Abo, Emote) als Infozeile | `ChatView` `infoLine` | A | umgesetzt | Sim |
| Gelöschte Nachrichten, Bans | `CLEARCHAT`, `CLEARMSG` | A | umgesetzt (ausblenden oder durchgestrichen) | Sim: echte Moderator-Löschung nach 32 s durchgestrichen, mit Option aus ausgeblendet |
| Erwähnungen hervorheben | `ChatModels.swift` | A | umgesetzt | nicht getestet |
| Bots und !Befehle ausblenden | `ChatSettingsSheet` | A | umgesetzt | Sim: an → keine Bot-Zeilen und !Befehle mehr |
| Schriftgröße, Zeitstempel | `ChatSettingsSheet` | A | umgesetzt | Sim: 20 px und Zeitstempel bei allen Nachrichten |
| Emote-Auswahl | `EmotePickerView.swift` | C | nur Kanal- und Drittanbieter-Emotes; eigene Abo-Emotes bräuchten den Scope `user:read:emotes` | nicht getestet |
| Namensfarbe | `setChatColor` | A | umgesetzt (Helix `PUT chat/color`, CORS geprüft) | nicht getestet |
| Chatter-Liste, Bot-Befehle, Nutzerkarte, Emote-Info | `ChatMenuSheet.swift`, `BotCommands.swift`, `MessageSheet.swift`, `EmoteInfoService.swift` | B | nicht umgesetzt | – |
| Angepinnte Nachrichten, Umfragen, Vorhersagen, Hype Train, Raids, Watch Streak | `LiveEventsService.swift`, `ChatPubSub.swift`, `RaidService.swift`, `HypeTrainCard.swift`, `ChatNotices.swift` | C | nicht umgesetzt; ob `wss://hermes.twitch.tv` von fremden Seiten aus antwortet, ist nicht geprüft | – |

## Konto, Kanalpunkte, Drops

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Anmeldung (Hauptkonto) | `TwitchAuthManager.swift`, `TwitchWebAuthManager.swift`, `TwitchWebLoginSheet` | B | Gerätecode-Verfahren (`id.twitch.tv/oauth2/device`) mit der App-Client-ID, ohne Secret, mit Refresh-Token | Code-Anzeige: Chromium; vollständige Anmeldung vom Nutzer auf dem iPhone bestätigt (26.10.2026); Token-Endpunkt antwortet `authorization_pending` |
| Web-Sitzung (Cookie `auth-token`) | `TwitchWebAuthManager.swift` | D | eine fremde Seite kann twitch.tv-Cookies nicht lesen | – |
| Gefolgte Kanäle des Kontos | `getFollowedLogins` | A | umgesetzt (Helix, nur lesen) | nicht getestet |
| Auf Twitch folgen/entfolgen | `FollowService` | C | umgesetzt mit dem TV-Zugang (Kanalseite und Herz im Player). Gemessen: `followUser` beantwortet Twitch für die Web-Client-ID mit „failed integrity check“, für die TV-Client-ID nur mit „unauthenticated“, verlangt dort also kein Integritäts-Token. Ohne TV-Zugang nur lokales Folgen | ohne Login: Chromium (Hinweis und lokales Folgen); Folgen mit echtem Konto **nicht getestet** |
| Lokales Folgen ohne Konto | `isLocallyFollowed` | A | umgesetzt | Sim |
| Gefolgte Kategorien | `getFollowedCategoriesGQL` | D | braucht die Web-Sitzung | – |
| Kanalpunkte: Truhe automatisch, Kontostand | `ChannelPointsService.swift`, `PointsTracker.swift`, `ChannelPointsView.swift` | C | umgesetzt über einen zweiten Gerätecode-Login mit Twitchs TV-Client-ID (`src/rewards.ts`): Kontostand und Truhe alle 30 s, „minute-watched“ an `spade.twitch.tv` jede Minute, solange ein Live-Stream läuft. Belohnungen einlösen (`ChannelPointsView`) und Watch Streak fehlen | Login-Code: Chromium; Einlösen **nicht getestet** (braucht echten Login) |
| Drops: automatisch einlösen, Fortschritt, Konto-Verknüpfungen | `Drops.swift`, `DropsView.swift` | C | umgesetzt mit demselben TV-Login: Inventar beim Start, bei Rückkehr in die App und alle 5 min, fertige Drops werden eingelöst. Fortschritt über einen unsichtbaren zweiten Stream mit Konto-Token (die App liest dafür die Playlist, das geht im Browser nicht). Verknüpfen nur als Link zur Publisher-Seite | **nicht getestet** |

## Entdecken und Kanalseite

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Startseite mit Regalen (Jetzt live · Du folgst, Ansehen fortsetzen, Clips, Top-Streams mit Sprache, Offline) und „Alle“-Listen | `HomeView.swift` | A | umgesetzt | Sim |
| Durchsuchen: Kanäle, Kategorien, Links (VOD, Clip, Kanal), Suchverlauf | `SearchView.swift` | A | umgesetzt | Chromium (Tippen ins Suchfeld scheitert im Simulator an der Einfüge-Abfrage von iOS) |
| Top-Kategorien als Raster, Kategorie mit Sprachfilter | `CategoriesView.swift` | A | umgesetzt | Sim (Raster), Chromium (Kategorie) |
| „Deine Kategorien“ | `CategoriesView.swift` | B | lokal: Herz auf der Kategorie-Seite, Regal „Deine Kategorien“ in Durchsuchen. Die Twitch-Kategorien des Kontos bräuchten die Web-Sitzung (D) | Chromium: League of Legends gefolgt, Regal erscheint |
| Kanalseite (Banner, Avatar mit Live-Ring, Partner, Follower, Beschreibung, Links, Panels, Tabs Übersicht/VODs/Clips/Highlights/Playlists, VOD-Filter) | `ChannelView.swift`, `ChannelAboutView.swift` | A | umgesetzt | Sim (Übersicht, VODs, Clips) |
| Kanäle und Kategorien ausblenden | `HiddenContent.swift`, `HiddenContentSheet.swift` | A | umgesetzt, Liste in den Einstellungen | Sim: Kategorie aus Raster und Top-Streams verschwunden, Kanal ausgeblendet, über Einstellungen wieder eingeblendet |
| Seiten nach Seite 1 (Android-Client-ID) | `gqlNextRequest` | A | übernommen | Sim: Top-Kategorien 100 → 200, Top-Streams 29 → 56 |

## Mitteilungen, Einstellungen, Sonstiges

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Live-Mitteilung für gefolgte Kanäle | `LiveNotifier.swift` | C | nur solange die App offen ist (Abfrage alle 2 min); Service-Worker-Mitteilung, sonst `new Notification` | Sim (installierte App): Erlaubnis-Dialog erscheint und wird gespeichert; `registration.showNotification` ist dort undefined, `new Notification` wirft keinen Fehler, aber in der Mitteilungszentrale kam nichts an. Funktioniert auf iOS ohne Push-Server also vermutlich nicht |
| Mitteilungen im Hintergrund (ntfy über den Worker) | `NtfyNotifier.swift` | D | Web Push braucht einen eigenen Push-Server | – |
| Akzentfarbe, System-Hell/Dunkel | `Theme.swift`, `DesignSystem.swift` | A | umgesetzt | Sim (hell), Chromium (dunkel) |
| Sicherung | `Backup.swift` (lief über den Worker) | B | lokal als JSON-Datei: Export über das iOS-Teilen-Menü („In Dateien sichern“), Import über die Dateiauswahl | Sim (installierte App): exportiert (573 Byte), geändert, importiert → Akzentfarbe und Follows zurück; Fehler gefunden und behoben: der Export per Download-Link tat in der installierten App nichts |
| Systemprotokolle | `Logger.swift`, `LogsView.swift` | B | nicht umgesetzt | – |
| Eigener Worker | `Constants.swift` `APIConfig` | D/X | nicht übernommen (Backend; der VOD-Teil fällt unter X) | – |
| App-Symbol wählen | `AppIcons.swift` | D | Web-Apps haben ein festes Symbol aus dem Manifest | – |
| Links von außen öffnen | URL-Schema `twitchunblock://` | B | Hash-Links `#/live/…`, `#/vod/…`, `#/clip/…`, `#/channel/…`, `#/multi/a,b` (beim Laden der Seite) | Sim |
| Installation „Zum Home-Bildschirm“ | – | A | Manifest, Symbol, eigenständiger Modus; Statusleisten-Stil `default` | Sim: Dialog mit Symbol und Name, App startet ohne Safari-Leisten mit eigenem Speicher; Fehler gefunden und behoben: mit `black-translucent` gab es den Abstand zur Statusleiste doppelt (iOS verschob die Seite um 62 px) |
| Hinweise in der App | `InAppNotices.swift` | B | nicht umgesetzt | – |
| Apple-TV-App | `TV/` | D | tvOS hat keinen Browser | – |
| Signatur-Info | `SigningInfo.swift` | – | entfällt (kein Sideloading) | – |
