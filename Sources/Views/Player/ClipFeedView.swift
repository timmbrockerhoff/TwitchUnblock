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

/// Players of the clip on screen and its two neighbours, kept at feed level:
/// pages off screen don't exist yet (LazyVStack), so they can't preload
/// themselves. A swipe then lands on a player that has already buffered.
@MainActor
final class ClipFeedPlayers: ObservableObject {
    @Published private(set) var players: [String: AVQueuePlayer] = [:]
    @Published private(set) var playbacks: [String: ClipPlayback] = [:]
    @Published private(set) var failed: Set<String> = []
    @Published private(set) var paused = false
    /// Shared by all clips: muting one keeps the next ones muted.
    @Published var muted = false {
        didSet { players.values.forEach { $0.isMuted = muted } }
    }
    private var loopers: [String: AVPlayerLooper] = [:]
    private var linkTasks: [String: Task<ClipPlayback?, Never>] = [:]
    private var kept: Set<String> = []
    private var current: String?
    private var quality = "source"

    /// `keep`: clips that get a player (others are dropped); `links`: clips
    /// whose playback links are only fetched ahead.
    func focus(_ id: String, keep: [String], links: [String], quality: String) {
        current = id
        self.quality = quality
        kept = Set(keep)
        paused = false
        for (k, p) in players where !kept.contains(k) {
            p.pause()
            players[k] = nil
            loopers[k] = nil
        }
        failed.subtract(keep)   // a failed clip is retried when swiped to again
        for k in keep where players[k] == nil { Task { await makePlayer(k) } }
        for k in links { Task { _ = await link(k) } }
        syncPlayback()
    }

    func togglePause() {
        paused.toggle()
        syncPlayback()
    }

    func stopAll() {
        players.values.forEach { $0.pause() }
        players = [:]
        loopers = [:]
        kept = []
    }

    private func link(_ id: String) async -> ClipPlayback? {
        if let task = linkTasks[id] { return await task.value }
        let task = Task { await getClip(slug: id) }
        linkTasks[id] = task
        let result = await task.value
        if let result { playbacks[id] = result } else { linkTasks[id] = nil }
        return result
    }

    private func makePlayer(_ id: String) async {
        let pb = await link(id)
        // Swiped far away meanwhile, or another call already made it.
        guard kept.contains(id), players[id] == nil else { return }
        guard let links = pb?.links,
              let url = URL(string: links[preferredQualityKey(Array(links.keys), pref: quality)] ?? "") else {
            failed.insert(id)
            return
        }
        let q = AVQueuePlayer()
        q.isMuted = muted
        loopers[id] = AVPlayerLooper(player: q, templateItem: AVPlayerItem(url: url))
        players[id] = q
        syncPlayback()
    }

    /// Only the clip on screen plays; neighbours wait, buffered, at their start.
    private func syncPlayback() {
        for (k, p) in players {
            if k == current && !paused {
                p.play()
            } else {
                p.pause()
                if k != current { p.seek(to: .zero) }
            }
        }
    }
}

/// Clips as a full-screen vertical feed, swiped up/down like TikTok. The
/// whole frame shows over a blurred copy of it; pinching zooms in up to a
/// screen-filling crop, and the zoom is remembered.
@available(iOS 17.0, *)
struct ClipFeedView: View {
    let load: (() async -> [ClipData])?
    let onClose: () -> Void

    @EnvironmentObject private var store: AppStore
    @State private var clips: [ClipData]
    @State private var loading: Bool
    @State private var current: String?
    @StateObject private var pool = ClipFeedPlayers()
    /// 0 = whole frame, 1 = fills the screen (sides cropped).
    @AppStorage("clip_feed_zoom") private var zoom: Double = 0

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
        .onChange(of: current, initial: true) { _, id in
            guard let id, let i = clips.firstIndex(where: { $0.id == id }) else { return }
            let keep = clips[max(0, i - 1)...min(clips.count - 1, i + 1)].map(\.id)
            let links = clips.indices.contains(i + 2) ? [clips[i + 2].id] : []
            pool.focus(id, keep: keep, links: links, quality: store.preferredQuality)
        }
        .onAppear { PlaybackAudio.shared.claim("clips") }
        .onDisappear {
            pool.stopAll()
            PlaybackAudio.shared.release("clips")
        }
    }

    private func feed(insets: EdgeInsets) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(clips) { clip in
                        ClipFeedPage(clip: clip, isCurrent: current == clip.id, insets: insets,
                                     pool: pool, zoom: $zoom)
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
    let isCurrent: Bool
    /// Safe area of the screen: the page itself runs under the bars.
    let insets: EdgeInsets
    @ObservedObject var pool: ClipFeedPlayers
    @Binding var zoom: Double

    @EnvironmentObject private var store: AppStore
    /// Zoom when the pinch began.
    @State private var pinchStart: Double?

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
        GeometryReader { geo in
            // Scale at which a 16:9 frame fills the page's height.
            let fillScale = max(1, geo.size.height / (geo.size.width * 9 / 16))
            let scale = 1 + zoom * (fillScale - 1)
            ZStack {
                Color.black
                // Blurred copy behind the whole frame, as in TikTok.
                thumbnail(.fill)
                    .blur(radius: 30)
                    .overlay(Color.black.opacity(0.35))
                ZStack {
                    thumbnail(.fit)
                    if let player = pool.players[clip.id] {
                        PlayerLayerView(player: player, background: .clear)
                    }
                }
                .scaleEffect(scale)
                if isCurrent && pool.players[clip.id] == nil && !pool.failed.contains(clip.id) {
                    ProgressView().tint(.white)
                }
                if pool.failed.contains(clip.id) {
                    Text(store.t("err_clip"))
                        .font(.tBody).foregroundColor(.white)
                        .padding(TSpace.md)
                        .background(Color.black.opacity(0.6), in: Capsule())
                }
                if isCurrent && pool.paused {
                    Image(systemName: "play.fill")
                        .font(.system(size: 60))
                        .foregroundColor(.white.opacity(0.85))
                        .shadow(radius: 8)
                        .allowsHitTesting(false)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
            .contentShape(Rectangle())
            .onTapGesture { if pool.players[clip.id] != nil { pool.togglePause() } }
            .gesture(
                MagnifyGesture()
                    .onChanged { v in
                        let start = pinchStart ?? scale
                        pinchStart = start
                        let s = min(fillScale, max(1, start * v.magnification))
                        zoom = fillScale > 1 ? (s - 1) / (fillScale - 1) : 0
                    }
                    .onEnded { _ in pinchStart = nil }
            )
            .overlay(alignment: .bottom) { bottomBar }
        }
    }

    private func thumbnail(_ mode: ContentMode) -> some View {
        AsyncImage(url: URL(string: clip.thumbnailURL)) { img in
            img.resizable().aspectRatio(contentMode: mode)
        } placeholder: { Color.clear }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    /// Channel, title and meta on the left, actions on the right, over a
    /// dark gradient so the text stays readable on bright frames.
    private var bottomBar: some View {
        HStack(alignment: .bottom, spacing: TSpace.md) {
            VStack(alignment: .leading, spacing: 5) {
                Text(pool.playbacks[clip.id]?.broadcasterName ?? " ")
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
                Button { pool.muted.toggle() } label: {
                    Image(systemName: pool.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                }
                // Jumps between the whole frame and a filled screen; pinching
                // picks anything in between.
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { zoom = zoom > 0.5 ? 0 : 1 }
                } label: {
                    Image(systemName: zoom > 0.5 ? "arrow.down.right.and.arrow.up.left"
                                                 : "arrow.up.left.and.arrow.down.right")
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
}
