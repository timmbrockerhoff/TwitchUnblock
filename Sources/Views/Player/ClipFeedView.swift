import SwiftUI
import AVFoundation

/// Clips opened as a feed: a ready list (a channel's clips) or one to fetch
/// first (followed channels' clips from Home).
struct ClipFeedItem: Identifiable {
    let id = UUID()
    var clips: [ClipData] = []
    var start: Int = 0
    var load: (() async -> [ClipData])? = nil
}

/// Playback links of the feed's clips, fetched once; the next clip is asked
/// for ahead so a swipe starts playing without waiting for Twitch.
@MainActor
final class ClipPlaybackCache {
    private var tasks: [String: Task<ClipPlayback?, Never>] = [:]

    func playback(_ slug: String) async -> ClipPlayback? {
        if let task = tasks[slug] { return await task.value }
        let task = Task { await getClip(slug: slug) }
        tasks[slug] = task
        let result = await task.value
        if result == nil { tasks[slug] = nil }   // a failure may be retried
        return result
    }

    func prefetch(_ slug: String) {
        guard tasks[slug] == nil else { return }
        Task { _ = await playback(slug) }
    }
}

/// Clips as a full-screen vertical feed, swiped up/down like TikTok. The
/// video fills the screen (sides cropped); a button shows the whole frame.
/// Only the clip on screen has a player, and it loops.
@available(iOS 17.0, *)
struct ClipFeedView: View {
    let load: (() async -> [ClipData])?
    let onClose: () -> Void

    @EnvironmentObject private var store: AppStore
    @State private var clips: [ClipData]
    @State private var loading: Bool
    @State private var current: String?
    /// Shared by all pages: muting one keeps the next ones muted.
    @State private var muted = false
    @State private var wholeImage = false
    @State private var cache = ClipPlaybackCache()

    init(item: ClipFeedItem, onClose: @escaping () -> Void) {
        load = item.load
        self.onClose = onClose
        _clips = State(initialValue: item.clips)
        _loading = State(initialValue: item.load != nil)
        let start = item.clips.indices.contains(item.start) ? item.clips[item.start].id : item.clips.first?.id
        _current = State(initialValue: start)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black
                if loading {
                    ProgressView().tint(.white)
                } else if clips.isEmpty {
                    Text(store.t("no_clips"))
                        .font(.tBody).foregroundColor(.white.opacity(0.8))
                } else {
                    feed(insets: geo.safeAreaInsets)
                }
            }
            .ignoresSafeArea()
            .overlay(alignment: .topLeading) {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 40, height: 40)
                        .background(Color.black.opacity(0.35), in: Circle())
                }
                .padding(.leading, TSpace.lg)
                .padding(.top, TSpace.xs)
                .accessibilityLabel(store.t("close"))
            }
        }
        .statusBarHidden()
        .preferredColorScheme(.dark)
        .task {
            guard let load else { return }
            clips = await load()
            current = clips.first?.id
            loading = false
        }
        .onChange(of: current) { _, id in
            // Next clip's links asked for ahead of the swipe.
            guard let id, let i = clips.firstIndex(where: { $0.id == id }),
                  clips.indices.contains(i + 1) else { return }
            cache.prefetch(clips[i + 1].id)
        }
        .onAppear { PlaybackAudio.shared.claim("clips") }
        .onDisappear { PlaybackAudio.shared.release("clips") }
    }

    private func feed(insets: EdgeInsets) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(clips) { clip in
                        ClipFeedPage(clip: clip, active: current == clip.id, insets: insets,
                                     cache: cache, muted: $muted, wholeImage: $wholeImage)
                            .containerRelativeFrame([.horizontal, .vertical])
                            .id(clip.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $current)
            .scrollIndicators(.hidden)
            // Pages are full screen: no safe-area inset may shift the paging.
            .ignoresSafeArea()
            .onAppear { if let current { proxy.scrollTo(current) } }
        }
    }
}

@available(iOS 17.0, *)
private struct ClipFeedPage: View {
    let clip: ClipData
    let active: Bool
    /// Safe area of the screen: the page itself runs under the bars.
    let insets: EdgeInsets
    let cache: ClipPlaybackCache
    @Binding var muted: Bool
    @Binding var wholeImage: Bool

    @EnvironmentObject private var store: AppStore
    @State private var playback: ClipPlayback?
    @State private var player: AVQueuePlayer?
    @State private var looper: AVPlayerLooper?
    @State private var failed = false
    @State private var paused = false

    private static let isoFormatter = ISO8601DateFormatter()
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.locale = Locale(identifier: "de")
        return f
    }()

    private var meta: String {
        var parts: [String] = []
        if let d = Self.isoFormatter.date(from: clip.createdAt) {
            parts.append(Self.relativeFormatter.localizedString(for: d, relativeTo: Date()))
        }
        if let c = clip.curator, !c.isEmpty { parts.append("von \(c)") }
        if clip.viewCount > 0 { parts.append("\(formatViewers(clip.viewCount)) Aufrufe") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        ZStack {
            Color.black
            if let player {
                PlayerLayerView(player: player, fill: !wholeImage)
            } else {
                AsyncImage(url: URL(string: clip.thumbnailURL)) { img in
                    img.resizable().aspectRatio(contentMode: wholeImage ? .fit : .fill)
                } placeholder: { Color.black }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                if active && !failed { ProgressView().tint(.white) }
            }
            if failed {
                Text(store.t("err_clip"))
                    .font(.tBody).foregroundColor(.white)
                    .padding(TSpace.md)
                    .background(Color.black.opacity(0.6), in: Capsule())
            }
            if paused {
                Image(systemName: "play.fill")
                    .font(.system(size: 60))
                    .foregroundColor(.white.opacity(0.85))
                    .shadow(radius: 8)
                    .allowsHitTesting(false)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard let player else { return }
            paused.toggle()
            paused ? player.pause() : player.play()
        }
        .overlay(alignment: .bottom) { bottomBar }
        .task(id: active) {
            if active { await start() } else { stop() }
        }
        .onChange(of: muted) { _, m in player?.isMuted = m }
        .onDisappear { stop() }
    }

    /// Channel, title and meta on the left, actions on the right, over a
    /// dark gradient so the text stays readable on bright frames.
    private var bottomBar: some View {
        HStack(alignment: .bottom, spacing: TSpace.md) {
            VStack(alignment: .leading, spacing: 5) {
                Text(playback?.broadcasterName ?? " ")
                    .font(.system(size: 17, weight: .bold))
                Text(clip.title)
                    .font(.system(size: 15))
                    .lineLimit(2)
                if !meta.isEmpty {
                    Text(meta)
                        .font(.system(size: 13))
                        .foregroundColor(.white.opacity(0.75))
                        .lineLimit(1)
                }
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 26) {
                Button { muted.toggle() } label: {
                    Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                }
                Button { wholeImage.toggle() } label: {
                    Image(systemName: wholeImage ? "arrow.up.left.and.arrow.down.right"
                                                 : "arrow.down.right.and.arrow.up.left")
                }
                if let url = URL(string: "https://clips.twitch.tv/\(clip.id)") {
                    ShareLink(item: url) { Image(systemName: "arrowshape.turn.up.right.fill") }
                }
            }
            .font(.system(size: 26, weight: .semibold))
            .foregroundColor(.white)
            .buttonStyle(.plain)
        }
        .shadow(color: .black.opacity(0.7), radius: 4)
        .padding(.horizontal, TSpace.lg)
        .padding(.top, 60)
        .padding(.bottom, insets.bottom + TSpace.lg)
        .background(
            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                .allowsHitTesting(false)
        )
    }

    private func start() async {
        failed = false
        paused = false
        if playback == nil { playback = await cache.playback(clip.id) }
        guard !Task.isCancelled, active, player == nil else { return }
        guard let links = playback?.links,
              let url = URL(string: links[preferredQualityKey(Array(links.keys), pref: store.preferredQuality)] ?? "") else {
            failed = true
            return
        }
        let q = AVQueuePlayer()
        q.isMuted = muted
        looper = AVPlayerLooper(player: q, templateItem: AVPlayerItem(url: url))
        player = q
        q.play()
    }

    /// Off screen: drop the player so only one clip decodes at a time.
    private func stop() {
        player?.pause()
        looper = nil
        player = nil
        paused = false
    }
}
