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
- Privacy: usage ping no longer sends the Twitch OAuth token (salted hash instead) and is
  opt-in (default off).
- Fork-specific: upstream update prompt disabled (`UpdateChecker.updateChecksEnabled = false`).
- New: swipe left/right (or arrows) between a channel's clips; auto-advance at clip end.
- Removed dead code and 51 unused localization keys; per-language string tables are typed.

## Open ideas (not done)
- Split the `AppStore` god object (64 `@Published`, observed by ~74 views) into smaller stores.
- Move strings to a String Catalog; share IRC parsing/image cache with the tvOS target.
- Merge the 3 duplicate integrity-token caches (TwitchGQL, ChannelPointsService, Drops).
- Feature ideas discussed: feed filter by words/channels, per-channel playback speed,
  quality by Wi-Fi/cellular.

## Working rules
- There is no way to run the app in this environment; verify by building (push → check.yml)
  and keep changes small and reviewable. The user tests on their iPhone.
- Commit messages: explain the bug/cost and the fix.
