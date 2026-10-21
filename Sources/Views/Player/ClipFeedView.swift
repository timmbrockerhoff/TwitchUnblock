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

/// Clips as a full-screen vertical feed, swiped up/down like TikTok, always
/// showing the whole frame. No buttons: a swipe from the left edge closes it.
@available(iOS 17.0, *)
struct ClipFeedView: View {
    let load: (() async -> [ClipData])?
    let onClose: () -> Void

    @EnvironmentObject private var store: AppStore
    @State private var clips: [ClipData]
    @State private var loading: Bool
    @State private var current: String?
    @StateObject private var pool = ClipFeedPlayers()
    /// Edge swipe in progress: the feed follows the finger to the right.
    @State private var dragX: CGFloat = 0

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
            .offset(x: dragX)
            .overlay(alignment: .leading) { edgeSwipe(width: geo.size.width) }
            .ignoresSafeArea()
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

    /// Thin strip on the left edge, like the system back swipe: past a third
    /// of the screen (or flicked), the feed slides out and closes.
    private func edgeSwipe(width: CGFloat) -> some View {
        Color.clear
            .frame(width: 24)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 10)
                    .onChanged { v in dragX = max(0, v.translation.width) }
                    .onEnded { v in
                        if v.translation.width > width / 3 || v.predictedEndTranslation.width > width / 2 {
                            withAnimation(.easeOut(duration: 0.2)) { dragX = width }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { onClose() }
                        } else {
                            withAnimation(.spring(duration: 0.25)) { dragX = 0 }
                        }
                    }
            )
            .accessibilityAction(named: Text(store.t("close")), onClose)
    }

    private func feed(insets: EdgeInsets) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(clips) { clip in
                        ClipFeedPage(clip: clip, isCurrent: current == clip.id, insets: insets,
                                     pool: pool)
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

    @EnvironmentObject private var store: AppStore

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
            // Thumbnail under the clear video layer until the first frame. In
            // an overlay: a filled image laid out directly widened the page
            // past the screen and pushed the buttons on the right off it.
            Color.black
                .overlay {
                    AsyncImage(url: URL(string: clip.thumbnailURL)) { img in
                        img.resizable().aspectRatio(contentMode: .fit)
                    } placeholder: { Color.black }
                }
                .clipped()
            if let player = pool.players[clip.id] {
                PlayerLayerView(player: player, background: .clear)
            } else if isCurrent && !pool.failed.contains(clip.id) {
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
        .contentShape(Rectangle())
        .onTapGesture { if pool.players[clip.id] != nil { pool.togglePause() } }
        .overlay(alignment: .bottom) { bottomBar }
    }

    /// Channel, title and meta over a dark gradient, so the text stays
    /// readable on bright frames.
    private var bottomBar: some View {
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
