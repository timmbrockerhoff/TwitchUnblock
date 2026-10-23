# TwitchUnblock (fork of MXFia19/TwitchUnblock) — notes for Claude Code

Native SwiftUI Twitch client: iOS 16+ app (`Sources/`, `Shared/`), Live Activity widget
(`Widgets/`), and a tvOS app (`TV/` plus the `Sources/` files listed under `TwitchUnblockTV`
in `project.yml`). Swift 5.9. Code comments in the original code are French; new comments in
English, short, explaining *why*.

## Where things are
- Repo: github.com/timmbrockerhoff/TwitchUnblock
- Work branch: **`optimize`** (all changes so far). `master` = unchanged upstream copy.
- Upstream: github.com/MXFia19/TwitchUnblock (do not push there).

## Building
- No `.xcodeproj` is maintained: CI runs `xcodegen generate --spec project.yml`. The tracked
  `TwitchUnblock.xcodeproj` is stale; do not rely on it.
- Requires **Xcode 26** (iOS 26 APIs are used behind `#available`).
- Every push to a branch other than `master`/`test-17d298` runs `.github/workflows/check.yml`:
  builds the iOS IPA (unsigned) and the tvOS app on `macos-15-intel` runners (the arm64 pool was
  often out of capacity), and turns compiler errors into workflow annotations.
- On `optimize`, the check build also uploads the IPA to the pre-release **`latest-optimize`**:
  `https://github.com/timmbrockerhoff/TwitchUnblock/releases/download/latest-optimize/TwitchUnblock.ipa`
- `build.yml` (master/test) is the upstream release pipeline; it commits `apps.json` and creates
  releases — don't trigger it from the fork.
- Version shown in the app = `VERSION` file (`1.4`) + number of app commits since it changed.
- Local simulator build (Xcode 27.1 + `brew install xcodegen` on the user's Mac): generate into a
  scratch folder so the tracked project stays untouched, with symlinks to `Info.plist`, `Widgets`,
  `TV`, `Shared`, `Sources`, `assets`, `VERSION`, then
  `xcodebuild -scheme TwitchUnblock -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build` and
  launch the .app in the iOS Simulator. App icons are only generated in CI.

## Boundaries
- Do not modify, refactor or extend the code that lets users watch subscriber-only VODs without
  a subscription, rebuilds VOD playlists from Twitch's CDN, or restores copyright-muted audio:
  in `Sources/Services/TwitchAPI.swift` the block from `workerVariants` through `getM3U8`
  (incl. `storyboardHack`, `workerJSON`, `playableMutedLinks`, `proxiedPlaylistURL`,
  `workingProxyBase`, `getAccessToken`, `twitchGQL`), and the files
  `Sources/Services/VodRecoveryService.swift` and `Sources/Services/VodUnmute.swift`.
  Leave them as they are (don't delete them either).
- Ad avoidance for live streams (proxy sources) and everything else is fine to work on.

## Changes already made on `optimize` (see `git log master..optimize`)
- Chat: batched message insertion (~200 ms), de-dup by id, filter/mention flags computed at
  insert, Equatable rows, flow-layout cache, emote image cache costs decoded bytes (64 MB cap,
  ≤40 frames), disk cache trimmed oldest-first, receive loop cancelled on disconnect.
- AppStore: VOD progress no longer app-wide `@Published` per tick; history/progress/hidden saved
  debounced on a background queue (flush on background/terminate); timers handled.
- Views: sliders commit on release, static formatters, cached sorting, uptime via TimelineView,
  player progress callbacks ≤1/s, chapter ids by offset.
- Services: staggered live-source race (official Twitch only after proxies fail), parallel
  Luminous mirrors, 15 s request timeouts, parallel chunk fetches, login no longer hangs,
  download backoff with Retry-After.
- Removed dead code and 51 unused localization keys.
- German only (2026-10-21): `Sources/Localization/GermanStrings.swift` is the single string
  table; fr/en/es/ru and all language pickers are gone. `Lang` has one case (`.de`), kept only
  because formatters/backends take its locale code. New strings: add them there, in German.
- Removed upstream-developer features: bug report/feedback (form, inbox, admin), announcements,
  polls, update checker + changelog, usage ping/stats, Discord invite. Keep it that way; the
  MIT credit to MXFia19 + source link stays in Settings → Other.
- Apple-style redesign (2026-10-22, replaces the Twitch look-alike direction): system `TabView`
  + one `NavigationStack` per tab with large titles (`MainTabView.tabRoot`), avatar
  (`AccountButton`) in the nav bar opens settings; light/dark follows the system (`tDark`,
  `tCard`, `tSurface`, `tBorder`, `tText`, `tMuted` are system colors), only the accent stays a
  user choice; background themes removed. The player stays dark (`.environment(\.colorScheme, .dark)`).
  Then (same day): DesignSystem wraps system pieces (text styles, `tProminentStyle`/
  `tBorderedStyle` = glass on iOS 26, capsule `TChip`, segmented `TSegmented`,
  `ContentUnavailableView`, `TCloseButton`, `tSheetBar` for sheets); Liquid Glass opt-in removed;
  168 fixed font sizes → text styles (player/chat excluded: own font-size setting); Browse uses
  `.searchable`; Settings = NavigationStack + inset grouped List + Form sections.
  Player: glass `TIconButton`s in the top bar, quality as a system `Menu`/`Picker` under the
  video, immersive "⋯" sheet = grouped List with `.menu` pickers, chat follow/jump/send buttons
  in system style; mini player = `tabViewBottomAccessory` + `.tabBarMinimizeBehavior(.onScrollDown)`
  on iOS 26.1+ (`TabAccessory`), the old floating bar below that.
  Home (2026-10-22) = shelves like Apple's TV app (`TShelf`): Jetzt live · Du folgst, Ansehen
  fortsetzen, Clips deiner Kanäle (9:16, opens the clip feed), Top-Streams (language menu),
  Offline avatars; "Alle" pushes the old full lists (grid/list toggle in their toolbar).
  Browse (same day): one search field for channels, links and categories (category shelf under
  the channel suggestions); idle = "Deine Kategorien" shelf + top-category grid; a category is
  pushed on the tab stack (`openedCategory` in SearchView), follow/hide in its nav bar.
  Meine VODs: "Ansehen fortsetzen" shelf (started, < 95 %), downloads, history grouped by day
  (Heute/Gestern/Diese Woche/Früher); remove via long press. `ResumeVodCard` + `vodThumb` live
  in CardViews.swift.
- Earlier Twitch look-alike work (user sends screenshots of the Twitch iOS app as reference; viewer
  features only, no creator/upsell UI; hidden VODs and ad-free live must stay):
  - Browse tab: categories in a 3-column box-art grid under the search field; Home lost its
    Streams/Categories segment.
  - Clips: a channel's clip list opens `ClipFeedView` (iOS 17+), a vertical TikTok-style
    feed, one looping player at a time; iOS 16 keeps the old player path.
  - Home "Du folgst" ends with "Ansehen fortsetzen" (history VODs watched > 1 min, with
    progress bar); stream rows show the category as a grey pill.

## Open ideas (not done)
- Split the `AppStore` god object (64 `@Published`, observed by ~74 views) into smaller stores.
- Share IRC parsing/image cache with the tvOS target.
- Merge the 3 duplicate integrity-token caches (TwitchGQL, ChannelPointsService, Drops).
- Live in Apple's player: `LiveDVRPlaylist` (tudvr://) joins the running recording
  (`liveDvrVideoId`, frozen at open) + DISCONTINUITY + live segments appended on each reload (EVENT,
  PDT on every segment) → Apple's bar spans the whole broadcast; fullscreen shows Apple's red LIVE
  badge, the inline bar does not (AVKit design, no iOS API to add items). AVPlayer keeps 3 ×
  TARGETDURATION (10 s recording segments) from the end: ~30 s behind real live; tried and failed:
  configuredTimeOffsetFromLive (clamped), TARGETDURATION 2 (won't play), SERVER-CONTROL HOLD-BACK
  (won't play). Live chat delayed by `liveLatency` − 6 s; > 5 min → VOD chat replay.
  Channels without a recording (VODs off): `LiveDVRPlaylist.wrap(live:recording: nil)` keeps the
  live segments seen since opening → rewind back to that moment, 2 s segments so little delay.
  Twitch live segments expire (200 at 2 min, 403 at 10 min, measured 2026-10-22): scrubbing back
  > ~10 min into the time since opening errors/stalls → `NativeVideoPlayer.Coordinator.
  reopenDVRIfNeeded` swaps in `LiveDVRPlaylist.reopen` (recording fetched again) at the same
  date (not verified in the Simulator: its scrubbing is too coarse to land there; check on the
  iPhone). Without a recording nothing can refill it: rewind really reaches only ~10 min back.
  Ad breaks (2026-10-22): `LiveDVRPlaylist` drops ad segments and fills their time from a
  backup playlist of another player type (`adFreeBackupPlaylist`: embed → popout → autoplay
  tokens, the first without `stitched-ad`), with a DISCONTINUITY at each origin switch; no
  backup → the player waits at the gap and `liveAdGap` shows "Werbepause übersprungen · weiter
  in n s". `LiveAdStats` counts breaks per source per hour; the automatic source order puts the
  proxies with the fewest first (once two have 20+ min measured). Immersive/multi-live players
  still only mute + banner.
  Controls (2026-10-23): our own YouTube-style overlay (`PlayerControls.swift`) instead of
  Apple's (`showsPlaybackControls = false`, the UIKit view takes no touches): purple bar over the
  video's bottom edge (all seekable ranges), behind live "position / length so far · ● Live"
  (grey dot, tap = live edge; "-0:10" stood still and looked frozen; the edge advances with the
  clock between playlist reloads, "at the edge" < 5 s) /
  "● Live" red at the edge, VOD "t / total", ±10 s + play/pause, double tap ±10 s, fullscreen =
  `rotatePlayer` (bottom right), AirPlay + gear top right (gear → `PlayerSettingsSheet`:
  quality, speed, chat, sleep timer, rewind; no app settings row), fade-out 3 s while playing.
  The header ⋯ is for the immersive player only. Our seeks call
  `Coordinator.userSeeked(to:)` so the edge catch-up (`LiveLatencyController.userSeek`) and the
  dropped-segment reload leave them alone. fMP4 channels (EXT-X-MAP) need the MAP lines in
  `LiveDVRPlaylist.render` (VERSION 6). Never a second timeline around the video.
  Chat input (2026-10-23): no "⋯" and no status strip on top any more. One grey `infoLine` above
  the field (room modes, sync, streak, collapsed pin, closed banners), points as a capsule with
  the balance, emote button inside the field, send arrow only with text. The gear by "Live-Chat"
  opens `ChatSettingsSheet(actions:)` presented by ChatView (`showSettings` binding; VOD chat:
  display settings only); without that header (landscape, chat only, multi-live) the gear sits at
  the end of the info line.
  The sheet: Nur Chat, font size, timestamps, deleted, one "Bots und !Befehle" switch; then
  "Hinweise im Chat" (subpage: pinned, polls, drops, streak), chatters, bot commands, name colour
  (logged in only), "Chat neu laden" (emotes + reconnect). ChatView applies these switches live
  (`syncEvents`, pubsub/drops onChange); before, they only took effect on the next chat opening.
  Watch streak lives in the points capsule ("👑 20 · 🔥 5"); the info line shows it only when
  there is no capsule (landscape, logged out). User rejected it as a lone line twice.
- Rewards auto-claim (2026-10-23): chest = `ChannelPointsService` (runs inside ChatView, which
  stays mounted in every live layout; needs the web session `twitchWebToken` + an integrity
  token minted in an ephemeral WebView). A failed claim used to blacklist the chest for good →
  now retried by the 30 s check (≤ 5 tries, one immediate retry with a fresh integrity token).
  Drops: claimed by the heartbeat's 5-min inventory while a drops channel plays, on the Drops
  page, and now also on every app foreground (`TwitchUnblockApp`, ForegroundRefresh).
  Not verifiable in the Simulator (no web session there).
- Portrait player (Apple's): video edge to edge 16:9, nothing under it; no options
  bar any more — quality, "Chat ausblenden" (`cfg_chat_hidden`, portrait; landscape toggles
  `landscapeChat`) and sleep timer live in the top bar's "⋯" menu. Hidden chat stays alive
  (opacity 0, IRC keeps running); `streamInfo` shows in its place.
- Landscape player (Apple's): video column full height (vertical safe areas ignored, sides kept
  for the Dynamic Island), header as `landscapeOverlay` over the video, shown/hidden
  by taps via a UIKit recognizer on AVPlayerViewController (`NativeVideoPlayer.onTap`; SwiftUI
  gestures over it never fire), auto-hide after 4 s. "⋯" menu: chat mode picker (Daneben / Über
  dem Video / Aus) in landscape, "Querformat/Hochformat" (`requestGeometryUpdate`, works with the
  rotation lock — also the way to test landscape in the Simulator).
- Apple-style redesign: all text buttons now use system styles (`tProminentStyle`/
  `tBorderedStyle` + `tCapsuleShape`). Left custom on purpose: chat message rows (own font-size
  setting), thumbnail badges, toasts. Immersive overlay and MultiLive were not checked in the
  Simulator (the immersive toggle didn't stick there). Drops/points pages are still card stacks
  (on `tDark`, since `tCard` disappears on the grouped background in light mode), not Lists.
- Feature ideas discussed: feed filter by words/channels, per-channel playback speed,
  quality by Wi-Fi/cellular.

## Working rules
- Verify locally in the Simulator (see Building), then push for check.yml; keep changes small
  and reviewable. The user tests on their iPhone.
- Commit messages: explain the bug/cost and the fix.
- Pushing while a check build runs cancels it (`cancel-in-progress`): wait, or batch commits.
- The user sideloads the IPA from iCloud Drive. Since 2026-10-22 it is built **locally**
  (GitHub's macOS runners often queue for a long time): commit + push as usual (CI still runs
  as a check), then `./buildlocal.sh` — builds the last commit in a temp copy exactly like
  check.yml (icons, version, plist fixes, buildipa.sh) and copies it to
  `~/Library/Mobile Documents/com~apple~CloudDocs/TwitchUnblock.ipa` (~1 min). Don't copy the
  CI IPA there any more.
- The user's own app icon is Twitch's Glitch logo, kept **local only** in `assets/local/`
  (gitignored; from Twitch's brand ZIP, brand.twitch.com): `buildlocal.sh` swaps it in for
  `assets/icon.png` + dark/tinted. Never commit it (public repo); CI keeps the default icon.
