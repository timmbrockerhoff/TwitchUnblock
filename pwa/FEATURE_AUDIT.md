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

Kein einziger Test lief auf einem echten iPhone. Alles, was hier „Sim“ heißt, ist auf dem Gerät **nicht getestet**. Bekannte Eigenheit des Simulators (siehe `CLAUDE.md`): Manche Streams bleiben schwarz, obwohl Ton und Zeit laufen. Das trat auch hier auf.

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
| Reihenfolge der Quellen einstellbar | `liveSourceSteps` | A | umgesetzt (Einstellungen) | nicht getestet |
| Quelle im Player wechseln | `PlayerSettingsSheet.swift` | A | umgesetzt | nicht getestet |
| Qualitätswahl | `parseMaster`, `preferredQualityKey` | C | bei Proxys ja; bei „Twitch offiziell“ nur „Automatisch“, weil usher fremden Seiten keinen CORS-Header schickt | Logik: `npm test`; Sim: Proxy-Master gelesen |
| Niedrige Latenz | `fast_bread`, `low_latency` | A | umgesetzt | nicht einzeln geprüft |
| Live-Sekundärquelle Cloudflare-Worker | `workerLiveLinks` | D | nicht übernommen: fremder Server des Upstream-Entwicklers, die Vorgabe lautet „kein Backend“ | – |
| Zuschauer ohne Werbung über den eigenen Account (Abo/Turbo) | `accountPlaybackToken` | D | fehlt: braucht die Web-Sitzung (Cookie `auth-token` von twitch.tv), die eine fremde Seite nicht lesen kann | – |
| Zurückspulen im Live (LiveDVRPlaylist: Aufnahme + Live-Segmente in einer Playlist) | `LiveDVRPlaylist.swift`, `LivePlaylistLoader.swift` | C | ersetzt: beim Zurückspulen wechselt der Player auf die laufende Aufnahme (Archiv-VOD), nativ abgespielt; „● Live“ springt zurück. Keine verschmolzene Zeitleiste, Kanäle ohne Aufnahme nur im kleinen nativen Puffer | Sim: Wechsel und Zeitanzeige (4:12:52 / 4:13:46) ja, Bild schwarz (Simulator); PoC: Aufnahme hat `seekable 0–14101 s` |
| Werbepausen mit Ersatz-Stream füllen | `adFreeBackupPlaylist`, `LiveDVRPlaylist` | D | nicht möglich: verlangt das Umschreiben der Media-Playlist, und `playlist.ttvnw.net` antwortet fremden Seiten mit 403 | – |
| Werbepausen erkennen, Ton aus, Hinweis | `AdBreakMonitor.swift`, `liveAdGap` | C | umgesetzt über die `EXT-X-DATERANGE`-Metadaten, die Safari als Cues meldet; Button „Ersatz-Stream“ lädt ein Token mit Player-Typ embed/popout/autoplay | Cues kommen an (PoC: 55 Cues); Verhalten bei einer echten Werbepause **nicht getestet** |
| Werbepausen je Quelle zählen, Reihenfolge danach | `LiveAdStats` | B | nicht umgesetzt | – |
| Chat-Verzögerung an die Latenz anpassen, Chat-Replay bei großem Abstand | `liveLatency`, `LiveLatency.swift` | B | nicht umgesetzt | – |
| Zuschauerzahl und Laufzeit regelmäßig aktualisieren | `getStreamStats` | A | nur beim Öffnen geladen; Laufzeit läuft mit | Sim |

## Player und Bedienung

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Eigene Steuerung im YouTube-Stil (Leiste, ±10 s, Doppeltipp, Ausblenden nach 3 s, „● Live“) | `PlayerControls.swift` | B | umgesetzt (`Controls` in `src/player.tsx`) | Sim |
| Vollbild | `rotatePlayer` | C | nativer Vollbild-Player von iOS (`webkitEnterFullscreen`); dort fehlen eigene Steuerung und Chat. Das iPhone kennt die Fullscreen-API nur für `<video>` | nicht getestet |
| Querformat: Video neben dem Chat | Landscape-Layout | B | umgesetzt per CSS, sobald das Gerät gedreht wird | Sim |
| Querformat per Knopf erzwingen | `requestGeometryUpdate` | D | iOS-Safari hat kein `screen.orientation.lock` | – |
| Bild füllen per Pinch | `fillScreen` | B | nicht umgesetzt | – |
| Wischen nach unten minimiert | `PlayerPull.swift` | B | nicht umgesetzt (Knopf ⌄ vorhanden) | – |
| Mini-Player über der Tab-Leiste | `TabAccessory` | B | umgesetzt | Sim |
| AirPlay | AVKit | B | `webkitShowPlaybackTargetPicker` | nicht getestet (kein AirPlay im Simulator) |
| Bild in Bild | AVKit | C | `webkitSetPresentationMode`; in der Simulator-Safari meldet `pictureInPictureEnabled` false | nicht getestet |
| Wiedergabe im Hintergrund, Sperrbildschirm | `PlaybackAudio.swift` | C | Media-Session-Metadaten gesetzt; ob iOS ein Video einer Web-App im Hintergrund weiterspielt, ist offen | nicht getestet |
| Schlaf-Timer | `SleepTimerService.swift` | A | umgesetzt | Ablauf nicht getestet |
| Geschwindigkeit (VOD/Clip) | `PlayerSettingsSheet` | A | umgesetzt | nicht getestet |
| Immersiver Player (Chat über dem Video, drei Modi) | `ImmersivePlayer.swift` | C | nicht übernommen; nur Hoch- und Querformat | – |
| Live Activity, Dynamic Island | `PlayerActivity.swift`, `Widgets/`, `Shared/` | D | gibt es für Web-Apps nicht | – |
| Raumklang | `SpatialAudio.swift` | D | keine Web-API | – |
| Multi-Live (bis 4 Streams) | `MultiLive.swift`, `MultiLiveView.swift` | B | umgesetzt; Raster mit 480p, Ton nur beim angetippten Stream | Sim: 3 Streams geladen; PoC: zwei stumme Videos laufen gleichzeitig, beim Einschalten des Tons pausiert iOS das andere |

## VODs, Clips, Verlauf

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| VOD abspielen (normales Token) | `getM3U8` (nur dessen Twitch-Teil) | B | neu geschrieben, nicht portiert; nur „Automatisch“ als Qualität | Sim: Zeit lief, Ton an, Bild schwarz (Simulator) |
| Fortsetzen an der letzten Stelle, Fortschritt speichern | `AppStore`, `VodMetaStore.swift` | A | umgesetzt (IndexedDB, alle 5 s) | Sim: Fortschrittsbalken im Verlauf |
| Kapitel (Spielwechsel) | `getVodMarkers` | A | umgesetzt (Marken auf der Leiste, Liste in den Einstellungen) | nicht getestet |
| VOD-Chat-Replay | `VodChatService.swift`, `VodChatView.swift` | A | umgesetzt (Persisted Query `VideoCommentsByOffsetOrCursor`) | Sim |
| VOD-Downloads, Offline-Wiedergabe, Chat-Archiv | `VodDownloads.swift`, `OfflineServer.swift`, `VodChatArchive.swift` | D | Hinweis in „Meine VODs“; VOD-Playlists auf CloudFront erlauben nur `https://www.twitch.tv` | – |
| Verlauf nach Tagen (Heute/Gestern/Diese Woche/Früher), Entfernen | `LibraryView.swift` | A | umgesetzt, Entfernen über „Bearbeiten“ | Sim |
| „Ansehen fortsetzen“ (Start und Meine VODs) | `ResumeVodCard` | A | umgesetzt | nicht getestet (kein VOD > 60 s geschaut) |
| Clip abspielen, „Zur VOD“ | `getClip` | A | umgesetzt (MP4) | Sim |
| Clip-Feed vertikal, ein Player | `ClipFeedView.swift` | B | umgesetzt; ein `<video>` für den ganzen Feed, damit der Ton beim Wischen an bleibt | Sim |
| „Clips deiner Kanäle“ (24 h, 8 Kanäle) | `HomeView.swift` | A | umgesetzt | Sim |
| Highlights, Playlists eines Kanals | `getHighlights`, `getCollections` | A | umgesetzt | nicht getestet |

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
| Gelöschte Nachrichten, Bans | `CLEARCHAT`, `CLEARMSG` | A | umgesetzt (ausblenden oder durchgestrichen) | nicht getestet |
| Erwähnungen hervorheben | `ChatModels.swift` | A | umgesetzt | nicht getestet |
| Bots und !Befehle ausblenden | `ChatSettingsSheet` | A | umgesetzt | nicht getestet |
| Schriftgröße, Zeitstempel | `ChatSettingsSheet` | A | umgesetzt | nicht getestet |
| Emote-Auswahl | `EmotePickerView.swift` | C | nur Kanal- und Drittanbieter-Emotes; eigene Abo-Emotes bräuchten den Scope `user:read:emotes` | nicht getestet |
| Namensfarbe | `setChatColor` | A | umgesetzt (Helix `PUT chat/color`, CORS geprüft) | nicht getestet |
| Chatter-Liste, Bot-Befehle, Nutzerkarte, Emote-Info | `ChatMenuSheet.swift`, `BotCommands.swift`, `MessageSheet.swift`, `EmoteInfoService.swift` | B | nicht umgesetzt | – |
| Angepinnte Nachrichten, Umfragen, Vorhersagen, Hype Train, Raids, Watch Streak | `LiveEventsService.swift`, `ChatPubSub.swift`, `RaidService.swift`, `HypeTrainCard.swift`, `ChatNotices.swift` | C | nicht umgesetzt; ob `wss://hermes.twitch.tv` von fremden Seiten aus antwortet, ist nicht geprüft | – |

## Konto, Kanalpunkte, Drops

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Anmeldung | `TwitchAuthManager.swift`, `TwitchWebAuthManager.swift`, `TwitchWebLoginSheet` | B | Gerätecode-Verfahren (`id.twitch.tv/oauth2/device`) mit der App-Client-ID, ohne Secret, mit Refresh-Token | Code-Anzeige: Chromium; vollständige Anmeldung **nicht getestet** (Zugangsdaten werden nie eingegeben); Token-Endpunkt antwortet `authorization_pending` |
| Web-Sitzung (Cookie `auth-token`) | `TwitchWebAuthManager.swift` | D | eine fremde Seite kann twitch.tv-Cookies nicht lesen | – |
| Gefolgte Kanäle des Kontos | `getFollowedLogins` | A | umgesetzt (Helix, nur lesen) | nicht getestet |
| Auf Twitch folgen/entfolgen | `FollowService` | D | GQL-Mutation braucht Web-Sitzung und Integritäts-Token; Helix hat keinen Endpunkt mehr | – |
| Lokales Folgen ohne Konto | `isLocallyFollowed` | A | umgesetzt | Sim |
| Gefolgte Kategorien | `getFollowedCategoriesGQL` | D | braucht die Web-Sitzung | – |
| Kanalpunkte: Truhe automatisch, Kontostand, Watch Streak | `ChannelPointsService.swift`, `PointsTracker.swift`, `ChannelPointsView.swift` | D | Web-Sitzung und Integritäts-Token nötig | – |
| Drops: automatisch einlösen, Seite, Konto-Verknüpfungen | `Drops.swift`, `DropsView.swift` | D | Web-Sitzung und Integritäts-Token nötig; Verknüpfungen öffnen Seiten der Publisher mit twitch.tv-Cookies | – |

## Entdecken und Kanalseite

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Startseite mit Regalen (Jetzt live · Du folgst, Ansehen fortsetzen, Clips, Top-Streams mit Sprache, Offline) und „Alle“-Listen | `HomeView.swift` | A | umgesetzt | Sim |
| Durchsuchen: Kanäle, Kategorien, Links (VOD, Clip, Kanal), Suchverlauf | `SearchView.swift` | A | umgesetzt | Chromium |
| Top-Kategorien als Raster, Kategorie mit Sprachfilter | `CategoriesView.swift` | A | umgesetzt | Sim (Raster), Chromium (Kategorie) |
| „Deine Kategorien“ | `CategoriesView.swift` | D/B | Twitch-Kategorien brauchen die Web-Sitzung; lokale Kategorie-Favoriten wären möglich, sind aber nicht umgesetzt | – |
| Kanalseite (Banner, Avatar mit Live-Ring, Partner, Follower, Beschreibung, Links, Panels, Tabs Übersicht/VODs/Clips/Highlights/Playlists, VOD-Filter) | `ChannelView.swift`, `ChannelAboutView.swift` | A | umgesetzt | Sim (Übersicht, VODs, Clips) |
| Kanäle und Kategorien ausblenden | `HiddenContent.swift`, `HiddenContentSheet.swift` | A | umgesetzt, Liste in den Einstellungen | nicht getestet |
| Seiten nach Seite 1 (Android-Client-ID) | `gqlNextRequest` | A | übernommen | nicht getestet |

## Mitteilungen, Einstellungen, Sonstiges

| Funktion | Swift | Kat. | Web-App | Test |
|---|---|---|---|---|
| Live-Mitteilung für gefolgte Kanäle | `LiveNotifier.swift` | C | nur solange die App offen ist (Abfrage alle 2 min, `showNotification`), nur als Home-Bildschirm-App | nicht getestet |
| Mitteilungen im Hintergrund (ntfy über den Worker) | `NtfyNotifier.swift` | D | Web Push braucht einen eigenen Push-Server | – |
| Akzentfarbe, System-Hell/Dunkel | `Theme.swift`, `DesignSystem.swift` | A | umgesetzt | Sim (hell), Chromium (dunkel) |
| Sicherung | `Backup.swift` (lief über den Worker) | B | lokal als JSON-Datei exportieren/importieren | nicht getestet |
| Systemprotokolle | `Logger.swift`, `LogsView.swift` | B | nicht umgesetzt | – |
| Eigener Worker | `Constants.swift` `APIConfig` | D/X | nicht übernommen (Backend; der VOD-Teil fällt unter X) | – |
| App-Symbol wählen | `AppIcons.swift` | D | Web-Apps haben ein festes Symbol aus dem Manifest | – |
| Links von außen öffnen | URL-Schema `twitchunblock://` | B | Hash-Links `#/live/…`, `#/vod/…`, `#/clip/…`, `#/channel/…`, `#/multi/a,b` | Sim |
| Hinweise in der App | `InAppNotices.swift` | B | nicht umgesetzt | – |
| Apple-TV-App | `TV/` | D | tvOS hat keinen Browser | – |
| Signatur-Info | `SigningInfo.swift` | – | entfällt (kein Sideloading) | – |
