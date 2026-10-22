import AVFoundation

// ═══════════════════════════════════════════════════════════════════════════
//  A running broadcast as one live playlist with its whole past, so Apple's
//  player shows its full bar (scrub back to the start) while the edge stays
//  the real live stream.
//
//  Twitch's live playlist only lists its last few 2 s segments; the running
//  recording (index-dvr.m3u8, EVENT, 10 s segments) covers the broadcast up
//  to a few seconds before live. Joined at their program-date-time:
//  recording segments (frozen when the stream is opened), a discontinuity,
//  then every live segment seen since, only ever appended (EVENT rule).
//
//  No recording (VODs turned off): the past is only what was seen live since the stream was
//  opened, kept by appending every live segment.
//
//  Ad breaks: Twitch replaces the live segments by ad segments. Those are left out; their
//  time is filled from a backup playlist of another player type that has no ad right
//  now (adFreeBackupPlaylist). Without one, playback waits at the gap and goes on after it
//  (`liveAdGap` tells the player view, for its hint).
//
//  Addresses `tudvr://<token>` point to a registered live/recording pair.
// ═══════════════════════════════════════════════════════════════════════════
final class LiveDVRPlaylist: NSObject, AVAssetResourceLoaderDelegate {
    static let shared = LiveDVRPlaylist()
    static let scheme = "tudvr"

    let queue = DispatchQueue(label: "twitchunblock.dvr")
    /// Live playlist refreshed often: no cache.
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    private struct Segment {
        let uri: String
        let duration: Double
        let date: Date
        /// From the ad-break backup playlist.
        var backup = false
        /// Origin changed from the segment before: a discontinuity.
        var disc = false
    }

    private final class Session {
        let live: URL
        let recording: URL?
        /// Channel and quality, for the ad-break backup; source, for the ad statistics.
        let login: String?
        let quality: String
        let source: String?
        var past: [Segment]? = nil
        var appended: [Segment] = []
        var backup: URL? = nil
        var backupTried = Date.distantPast
        var inBreak = false
        var lastReload = Date()
        init(live: URL, recording: URL?, login: String?, quality: String, source: String?) {
            self.live = live; self.recording = recording
            self.login = login; self.quality = quality; self.source = source
            if recording == nil { past = [] }
        }
    }

    private let lock = NSLock()
    private var sessions: [String: Session] = [:]

    // MARK: Addresses
    /// One `tudvr://` address per quality present in both link sets; nil when none match.
    /// `recording` nil: live only, its past built up from the moment the stream is opened.
    static func wrap(live: QualityLinks, recording: QualityLinks?,
                     login: String? = nil, source: String? = nil) -> QualityLinks? {
        var out: QualityLinks = [:]
        for (quality, link) in live {
            guard let liveURL = URL(string: link) else { continue }
            var recURL: URL? = nil
            if let recording {
                guard let rec = recording[quality], let url = URL(string: rec) else { continue }
                recURL = url
            }
            let token = UUID().uuidString
            let session = Session(live: liveURL, recording: recURL, login: login, quality: quality, source: source)
            shared.lock.withLock { shared.sessions[token] = session }
            out[quality] = "\(scheme)://\(token)/index.m3u8"
        }
        return out.isEmpty ? nil : out
    }

    /// Same live/recording pair under a new address. Twitch drops live segments after a few
    /// minutes (403 by 10 min), so the time since opening goes missing from the old playlist;
    /// the recording fetched again covers it. nil without a recording: nothing to refill from.
    static func reopen(_ url: URL) -> URL? {
        guard url.scheme == scheme, let old = url.host,
              let s = shared.lock.withLock({ shared.sessions[old] }), s.recording != nil else { return nil }
        let token = UUID().uuidString
        shared.lock.withLock {
            shared.sessions[token] = Session(live: s.live, recording: s.recording,
                                             login: s.login, quality: s.quality, source: s.source)
        }
        return URL(string: "\(scheme)://\(token)/index.m3u8")
    }

    /// Same per-item setup as VodUnmuteLoader's items.
    static func playerItem(url: URL) -> AVPlayerItem {
        let asset = AVURLAsset(url: url)
        asset.resourceLoader.setDelegate(shared, queue: shared.queue)
        let item = AVPlayerItem(asset: asset)
        SpatialAudio.apply(to: item)
        VodUnmuteLoader.keepPitch(item)
        AdBreakMonitor.attach(to: item)
        return item
    }

    // MARK: Loading
    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        guard let url = loadingRequest.request.url, url.scheme == Self.scheme, let token = url.host else { return false }
        guard let session = lock.withLock({ sessions[token] }) else { return false }
        Task {
            if let text = await self.playlist(session) {
                loadingRequest.contentInformationRequest?.contentType = "public.m3u-playlist"
                loadingRequest.dataRequest?.respond(with: Data(text.utf8))
                loadingRequest.finishLoading()
            } else {
                loadingRequest.finishLoading(with: URLError(.badServerResponse))
            }
        }
        return true
    }

    private func fetch(_ url: URL) async -> String? {
        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        guard let (data, resp) = try? await self.session.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        let text = String(decoding: data, as: UTF8.self)
        return text.hasPrefix("#EXTM3U") ? text : nil
    }

    private func playlist(_ s: Session) async -> String? {
        async let liveText = fetch(s.live)
        let needsPast = lock.withLock { s.past == nil }
        let pastText = needsPast ? await s.recording.asyncMap(fetch) ?? nil : nil
        guard let liveText = await liveText else { return nil }
        let live = Self.segments(liveText, base: s.live, skipAds: true)
        // Ad segments in the live playlist (or a break announced): fill from the backup.
        let adsNow = liveText.contains("stitched-ad")
            || Self.segments(liveText, base: s.live, skipAds: false).count > live.count
        var fill: [Segment] = []
        if adsNow, let url = await backupURL(s), let text = await fetch(url) {
            fill = Self.segments(text, base: url, skipAds: true).map { var seg = $0; seg.backup = true; return seg }
            // The backup got the break too: a fresh one next time.
            if text.contains("stitched-ad") { lock.withLock { s.backup = nil } }
        }
        noteBreak(s, adsNow: adsNow, filled: !fill.isEmpty, liveText: liveText)

        let pastSegments = pastText.flatMap { t in s.recording.map { Self.segments(t, base: $0, skipAds: false) } }
        return lock.withLock { () -> String? in
            if s.past == nil {
                guard let pastSegments, !pastSegments.isEmpty else { return nil }
                s.past = pastSegments
            }
            let past = s.past ?? []
            // Live (and backup) segments after the recording's end, appended once each, in time
            // order; a backup segment for the same moment as a live one is a duplicate.
            let pastEnd = past.last.map { $0.date.addingTimeInterval($0.duration - 0.5) } ?? .distantPast
            var last = s.appended.last?.date ?? pastEnd
            for var seg in (live + fill).sorted(by: { $0.date < $1.date })
            where seg.date > last.addingTimeInterval(0.5) && seg.date > pastEnd {
                seg.disc = (s.appended.last?.backup ?? false) != seg.backup
                s.appended.append(seg)
                last = seg.date
            }
            return Self.render(past: past, live: s.appended)
        }
    }

    // MARK: Ad breaks
    /// The backup playlist for this session's channel, fetched once per break (retried at most
    /// every 20 s while none has been found).
    private func backupURL(_ s: Session) async -> URL? {
        guard let login = s.login else { return nil }
        let (cached, due) = lock.withLock { () -> (URL?, Bool) in
            if let b = s.backup { return (b, false) }
            guard Date().timeIntervalSince(s.backupTried) > 20 else { return (nil, false) }
            s.backupTried = Date()
            return (nil, true)
        }
        if let cached { return cached }
        guard due, let url = await adFreeBackupPlaylist(login: login, quality: s.quality) else { return nil }
        lock.withLock { s.backup = url }
        return url
    }

    /// Break start/end: statistics per source, and the player view's hint while the gap has
    /// no backup (`end` from the break's DATERANGE, nil once over or filled).
    private func noteBreak(_ s: Session, adsNow: Bool, filled: Bool, liveText: String) {
        let (started, watched) = lock.withLock { () -> (Bool, Double) in
            let started = adsNow && !s.inBreak
            if !adsNow { s.backup = nil; s.backupTried = .distantPast }
            s.inBreak = adsNow
            let watched = min(10, Date().timeIntervalSince(s.lastReload))
            s.lastReload = Date()
            return (started, watched)
        }
        if let source = s.source { LiveAdStats.record(source: source, watched: watched, breaks: started ? 1 : 0) }
        if started { logger.info("PUB", filled ? "Werbepause, mit Ersatz-Stream überbrückt" : "Werbepause ohne Ersatz", nil) }
        let end = adsNow && !filled ? Self.breakEnd(liveText) ?? Date().addingTimeInterval(30) : nil
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .liveAdGap, object: nil, userInfo: end.map { ["end": $0] })
        }
    }

    /// End of the latest stitched-ad break announced in the playlist (START-DATE + DURATION).
    private static func breakEnd(_ text: String) -> Date? {
        var end: Date? = nil
        for line in text.components(separatedBy: "\n") where line.hasPrefix("#EXT-X-DATERANGE") && line.contains("stitched-ad") {
            func attr(_ name: String) -> String? {
                guard let r = line.range(of: name + "=") else { return nil }
                return line[r.upperBound...].split(separator: ",", maxSplits: 1).first
                    .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\"")) }
            }
            guard let start = attr("START-DATE").flatMap({ dateParser.date(from: $0) ?? datePlain.date(from: $0) }),
                  let duration = attr("DURATION").flatMap(Double.init) else { continue }
            end = max(end ?? .distantPast, start.addingTimeInterval(duration))
        }
        return end
    }

    // MARK: Playlist text
    private static let dateParser: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let datePlain = ISO8601DateFormatter()

    /// Segments with absolute addresses and a date each (dates missing between two tags are
    /// carried forward by duration). Ads and announced-but-unfinished segments are left out.
    private static func segments(_ text: String, base: URL, skipAds: Bool) -> [Segment] {
        var out: [Segment] = []
        var nextDate: Date? = nil
        var pendingDuration: Double? = nil
        var pendingIsAd = false
        for raw in text.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("#EXT-X-PROGRAM-DATE-TIME:") {
                let v = String(line.dropFirst("#EXT-X-PROGRAM-DATE-TIME:".count))
                nextDate = dateParser.date(from: v) ?? datePlain.date(from: v)
            } else if line.hasPrefix("#EXTINF:") {
                let body = line.dropFirst(8)
                let parts = body.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false)
                pendingDuration = Double(parts.first ?? "") ?? 0
                let title = parts.count > 1 ? String(parts[1]) : ""
                pendingIsAd = skipAds && !title.isEmpty && title != "live"
            } else if !line.isEmpty, !line.hasPrefix("#"), let d = pendingDuration {
                defer { pendingDuration = nil }
                let date = nextDate ?? out.last.map { $0.date.addingTimeInterval($0.duration) }
                nextDate = nil
                guard let date, !pendingIsAd,
                      let abs = URL(string: line, relativeTo: base)?.absoluteString else { continue }
                out.append(Segment(uri: abs, duration: d, date: date))
            }
        }
        return out
    }

    private static func render(past: [Segment], live: [Segment]) -> String {
        let longest = (past + live).map(\.duration).max() ?? 10
        var lines = ["#EXTM3U", "#EXT-X-VERSION:3",
                     "#EXT-X-TARGETDURATION:\(max(1, Int(longest.rounded(.up))))",
                     "#EXT-X-PLAYLIST-TYPE:EVENT", "#EXT-X-MEDIA-SEQUENCE:0",
                     "#EXT-X-DISCONTINUITY-SEQUENCE:0"]
        func add(_ s: Segment) {
            if s.disc { lines.append("#EXT-X-DISCONTINUITY") }
            lines.append("#EXT-X-PROGRAM-DATE-TIME:" + dateParser.string(from: s.date))
            lines.append(String(format: "#EXTINF:%.3f,", s.duration))
            lines.append(s.uri)
        }
        past.forEach(add)
        if !past.isEmpty, !live.isEmpty { lines.append("#EXT-X-DISCONTINUITY") }
        live.forEach(add)
        return lines.joined(separator: "\n") + "\n"
    }
}

extension Notification.Name {
    /// Live ad break with no backup on screen soon: userInfo["end"] its end; none = over.
    static let liveAdGap = Notification.Name("tuLiveAdGap")
}

private extension Optional {
    func asyncMap<T>(_ f: (Wrapped) async -> T) async -> T? {
        guard let self else { return nil }
        return await f(self)
    }
}
