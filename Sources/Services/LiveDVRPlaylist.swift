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
    }

    private final class Session {
        let live: URL
        let recording: URL?
        var past: [Segment]? = nil
        var appended: [Segment] = []
        init(live: URL, recording: URL?) {
            self.live = live; self.recording = recording
            if recording == nil { past = [] }
        }
    }

    private let lock = NSLock()
    private var sessions: [String: Session] = [:]

    // MARK: Addresses
    /// One `tudvr://` address per quality present in both link sets; nil when none match.
    /// `recording` nil: live only, its past built up from the moment the stream is opened.
    static func wrap(live: QualityLinks, recording: QualityLinks?) -> QualityLinks? {
        var out: QualityLinks = [:]
        for (quality, link) in live {
            guard let liveURL = URL(string: link) else { continue }
            var recURL: URL? = nil
            if let recording {
                guard let rec = recording[quality], let url = URL(string: rec) else { continue }
                recURL = url
            }
            let token = UUID().uuidString
            shared.lock.withLock { shared.sessions[token] = Session(live: liveURL, recording: recURL) }
            out[quality] = "\(scheme)://\(token)/index.m3u8"
        }
        return out.isEmpty ? nil : out
    }

    static func playerItem(url: URL) -> AVPlayerItem {
        let asset = AVURLAsset(url: url)
        asset.resourceLoader.setDelegate(shared, queue: shared.queue)
        return AVPlayerItem(asset: asset)
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

        let pastSegments = pastText.flatMap { t in s.recording.map { Self.segments(t, base: $0, skipAds: false) } }
        return lock.withLock { () -> String? in
            if s.past == nil {
                guard let pastSegments, !pastSegments.isEmpty else { return nil }
                s.past = pastSegments
            }
            let past = s.past ?? []
            // Live segments after the recording's end, appended once each.
            let pastEnd = past.last.map { $0.date.addingTimeInterval($0.duration - 0.5) } ?? .distantPast
            let lastDate = s.appended.last?.date ?? pastEnd
            for seg in live where seg.date > lastDate && seg.date > pastEnd {
                s.appended.append(seg)
            }
            return Self.render(past: past, live: s.appended)
        }
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

private extension Optional {
    func asyncMap<T>(_ f: (Wrapped) async -> T) async -> T? {
        guard let self else { return nil }
        return await f(self)
    }
}
