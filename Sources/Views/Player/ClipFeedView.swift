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

/// Time of the clip on screen, apart from the pool: it changes ~10×/s and only
/// the progress line watches it, not the whole feed.
@MainActor
final class ClipProgress: ObservableObject {
    @Published var time: Double = 0
    @Published var duration: Double = 0
}

/// Players of the clip on screen and its two neighbours, kept at feed level:
/// pages off screen don't exist yet (LazyVStack), so they can't preload
/// themselves. A swipe then lands on a player that has already buffered.
@available(iOS 17.0, *)
@MainActor
final class ClipFeedPlayers: ObservableObject {
    @Published private(set) var players: [String: AVPlayer] = [:]
    @Published private(set) var playbacks: [String: ClipPlayback] = [:]
    @Published private(set) var failed: Set<String> = []
    @Published private(set) var paused = false
    /// Sound off for the whole feed, the next clips included.
    @Published private(set) var muted = false
    /// Held down on the video: 2× while the finger stays.
    @Published private(set) var fast = false
    /// Top buttons and bottom info shown. In landscape they lie on the picture and fade out
    /// 3 s after the last touch; in portrait they sit on the black bars and stay.
    @Published private(set) var chromeVisible = true
    private var hideTask: Task<Void, Never>?
    let progress = ClipProgress()
    /// The clip on screen reached its end (the feed moves on).
    var onEnded: ((String) -> Void)?
    private var timeObservers: [String: Any] = [:]
    private var endObservers: [String: NSObjectProtocol] = [:]
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
        fast = false
        for k in Array(players.keys) where !kept.contains(k) { drop(k) }
        failed.subtract(keep)   // a failed clip is retried when swiped to again
        for k in keep where players[k] == nil { Task { await makePlayer(k) } }
        for k in links { Task { _ = await link(k) } }
        progress.time = 0
        progress.duration = players[id]?.currentItem?.duration.seconds.finiteOrZero ?? 0
        syncPlayback()
    }

    func togglePause() {
        paused.toggle()
        syncPlayback()
    }

    /// Shows the controls; `autoHide` (landscape) fades them out again after 3 s.
    func showChrome(autoHide: Bool) {
        chromeVisible = true
        hideTask?.cancel()
        guard autoHide else { return }
        hideTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.3)) { self?.chromeVisible = false }
        }
    }

    func toggleMute() {
        muted.toggle()
        players.values.forEach { $0.isMuted = muted }
    }

    func setFast(_ on: Bool) {
        fast = on
        syncPlayback()
    }

    /// Scrubbing the line: `fraction` of the clip on screen.
    func seek(_ fraction: Double) {
        guard let current, let p = players[current], progress.duration > 0 else { return }
        let t = max(0, min(1, fraction)) * progress.duration
        progress.time = t
        p.seek(to: CMTime(seconds: t, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    /// From the start again (last clip of the feed ended).
    func restart(_ id: String) {
        players[id]?.seek(to: .zero)
        syncPlayback()
    }

    func stopAll() {
        for k in Array(players.keys) { drop(k) }
        kept = []
    }

    private func drop(_ id: String) {
        guard let p = players[id] else { return }
        p.pause()
        if let o = timeObservers.removeValue(forKey: id) { p.removeTimeObserver(o) }
        if let o = endObservers.removeValue(forKey: id) { NotificationCenter.default.removeObserver(o) }
        players[id] = nil
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
        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        p.isMuted = muted
        // Its end moves the feed on (no looper any more).
        endObservers[id] = NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.current == id else { return }
                self.onEnded?(id)
            }
        }
        timeObservers[id] = p.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 10),
                                                      queue: .main) { [weak self, weak p] t in
            MainActor.assumeIsolated {
                guard let self, self.current == id else { return }
                self.progress.time = t.seconds.finiteOrZero
                self.progress.duration = p?.currentItem?.duration.seconds.finiteOrZero ?? 0
            }
        }
        players[id] = p
        syncPlayback()
    }

    /// Only the clip on screen plays; neighbours wait, buffered, at their start.
    private func syncPlayback() {
        for (k, p) in players {
            if k == current && !paused {
                p.rate = fast ? 2 : 1
            } else {
                p.pause()
                if k != current { p.seek(to: .zero) }
            }
        }
    }
}

private extension Double {
    var finiteOrZero: Double { isFinite ? self : 0 }
}

/// Clips as a full-screen vertical feed, swiped up/down like TikTok, always
/// showing the whole frame. A swipe from the left edge or the close button
/// closes it; at a clip's end the next one comes.
@available(iOS 17.0, *)
struct ClipFeedView: View {
    let load: (() async -> [ClipData])?
    let onClose: () -> Void
    /// The clip's channel page, or its whole VOD from the clip's moment (the feed closes first).
    var onOpenChannel: (String) -> Void = { _ in }
    /// `landscape`: the clip was watched sideways, the VOD stays sideways.
    var onOpenVod: (ClipPlayback, _ landscape: Bool) -> Void = { _, _ in }

    @EnvironmentObject private var store: AppStore
    @State private var clips: [ClipData]
    @State private var loading: Bool
    @State private var current: String?
    @StateObject private var pool = ClipFeedPlayers()
    /// Edge swipe in progress: the feed follows the finger to the right.
    @State private var dragX: CGFloat = 0
    /// Turned to landscape by the button: back to portrait on close.
    @State private var rotated = false

    init(item: ClipFeedItem, onClose: @escaping () -> Void,
         onOpenChannel: @escaping (String) -> Void = { _ in },
         onOpenVod: @escaping (ClipPlayback, Bool) -> Void = { _, _ in }) {
        load = item.load
        self.onClose = onClose
        self.onOpenChannel = onOpenChannel
        self.onOpenVod = onOpenVod
        _clips = State(initialValue: item.clips)
        _loading = State(initialValue: item.load != nil)
        let start = item.clips.indices.contains(item.start) ? item.clips[item.start].id : item.clips.first?.id
        _current = State(initialValue: start)
    }

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            ZStack {
                Color.black
                if loading {
                    ProgressView().tint(.white)
                } else if clips.isEmpty {
                    Text(store.t("no_clips"))
                        .font(.tBody).foregroundColor(.white.opacity(0.8))
                } else {
                    feed(insets: geo.safeAreaInsets, landscape: landscape)
                }
            }
            .offset(x: dragX)
            .overlay(alignment: .leading) { edgeSwipe(width: geo.size.width) }
            .overlay(alignment: .top) {
                topBar(insets: geo.safeAreaInsets, landscape: landscape)
                    .offset(x: dragX)
                    .opacity(pool.chromeVisible ? 1 : 0)
                    .allowsHitTesting(pool.chromeVisible)
            }
            .onChange(of: landscape, initial: true) { _, l in pool.showChrome(autoHide: l) }
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
        .onAppear {
            PlaybackAudio.shared.claim("clips")
            pool.onEnded = { id in advance(after: id) }
        }
        .onDisappear {
            pool.stopAll()
            PlaybackAudio.shared.release("clips")
            if rotated { rotate(toLandscape: false) }
        }
    }

    /// End of a clip: the next one, or this one again when it was the last.
    private func advance(after id: String) {
        guard let i = clips.firstIndex(where: { $0.id == id }) else { return }
        if clips.indices.contains(i + 1) {
            withAnimation(.easeInOut(duration: 0.35)) { current = clips[i + 1].id }
        } else {
            pool.restart(id)
        }
    }

    /// Closes, then `then` once a turn back to portrait has settled: the player opened during
    /// the turn came up reduced.
    private func leave(then: @escaping () -> Void) {
        let turning = rotated
        close()
        DispatchQueue.main.asyncAfter(deadline: .now() + (turning ? 0.6 : 0), execute: then)
    }

    private func close() {
        if rotated { rotate(toLandscape: false) }
        onClose()
    }

    /// Works with the rotation lock on too (same as the player's rotate item).
    private func rotate(toLandscape: Bool) {
        rotated = toLandscape
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: toLandscape ? .landscapeRight : .portrait)) { _ in }
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
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { close() }
                        } else {
                            withAnimation(.spring(duration: 0.25)) { dragX = 0 }
                        }
                    }
            )
            .accessibilityAction(named: Text(store.t("close")), close)
    }

    private var currentPlayback: ClipPlayback? { current.flatMap { pool.playbacks[$0] } }

    private func openChannel(_ login: String) { leave { onOpenChannel(login) } }

    // MARK: Top bar
    /// As in Apple's own full-screen video: close top left, sound and a "⋯" menu top right;
    /// the rarer actions live in the menu, nothing sits on the picture's sides.
    private func topBar(insets: EdgeInsets, landscape: Bool) -> some View {
        HStack(spacing: TSpace.sm) {
            TIconButton(icon: "xmark", tint: .white, size: 36) { close() }
                .accessibilityLabel(store.t("close"))
            Spacer()
            TIconButton(icon: pool.muted ? "speaker.slash.fill" : "speaker.wave.2.fill", tint: .white, size: 36) {
                pool.toggleMute()
                pool.showChrome(autoHide: landscape)
            }
            .accessibilityLabel(store.t(pool.muted ? "clip_sound_on" : "clip_sound_off"))
            Menu {
                if let pb = currentPlayback, pb.vodId != nil, pb.vodOffset != nil {
                    Button {
                        // Sideways: no turn back, the player takes the landscape over.
                        rotated = false
                        leave { onOpenVod(pb, landscape) }
                    } label: { Label(store.t("clip_full_vod"), systemImage: "play.rectangle") }
                }
                if let id = current, let url = URL(string: "https://clips.twitch.tv/\(id)") {
                    ShareLink(item: url) { Label(store.t("share"), systemImage: "square.and.arrow.up") }
                }
                Button { rotate(toLandscape: !landscape) } label: {
                    Label(store.t(landscape ? "rotate_portrait" : "rotate_landscape"),
                          systemImage: landscape ? "rectangle.portrait.rotate" : "rectangle.landscape.rotate")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .tGlass(in: Circle(), fallback: .black.opacity(0.4))
            }
            .accessibilityLabel(store.t("more"))
        }
        .padding(.horizontal, max(max(insets.leading, insets.trailing), TSpace.lg))
        .padding(.top, insets.top + TSpace.sm)
    }

    private func feed(insets: EdgeInsets, landscape: Bool) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(clips) { clip in
                        ClipFeedPage(clip: clip, isCurrent: current == clip.id, insets: insets,
                                     landscape: landscape, pool: pool,
                                     onOpenChannel: openChannel)
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
    let landscape: Bool
    @ObservedObject var pool: ClipFeedPlayers
    let onOpenChannel: (String) -> Void

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

    private var playback: ClipPlayback? { pool.playbacks[clip.id] }

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
        // Landscape with the controls faded out: a tap only brings them back.
        .onTapGesture {
            if landscape && !pool.chromeVisible { pool.showChrome(autoHide: true); return }
            if pool.players[clip.id] != nil { pool.togglePause() }
            pool.showChrome(autoHide: landscape)
        }
        // Held down: 2× until let go (a plain tap still pauses).
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.35)
                .sequenced(before: DragGesture(minimumDistance: 0))
                .onChanged { v in
                    if case .second(true, _) = v, isCurrent, !pool.fast, !pool.paused { pool.setFast(true) }
                }
                .onEnded { _ in if pool.fast { pool.setFast(false) } }
        )
        .overlay(alignment: .top) {
            if isCurrent && pool.fast {
                Label("2×", systemImage: "forward.fill")
                    .font(.subheadline.weight(.bold)).foregroundColor(.white)
                    .padding(.horizontal, TSpace.md).padding(.vertical, 6)
                    .background(Color.black.opacity(0.55), in: Capsule())
                    .padding(.top, insets.top + TSpace.lg)
                    .allowsHitTesting(false)
            }
        }
        .overlay(alignment: .bottom) {
            bottomBar
                .opacity(pool.chromeVisible ? 1 : 0)
                .allowsHitTesting(pool.chromeVisible)
        }
    }

    /// Channel, title and meta over a dark gradient, so the text stays
    /// readable on bright frames; the progress line above them.
    private var bottomBar: some View {
        VStack(alignment: .leading, spacing: 5) {
            // The channel's name opens it, like an artist's name in Apple Music.
            Button {
                if let login = playback?.broadcasterLogin, !login.isEmpty { onOpenChannel(login) }
            } label: {
                Text(playback?.broadcasterName ?? " ")
                    .font(.system(size: 17, weight: .bold))
            }
            .buttonStyle(.plain)
            Text(clip.title)
                .font(.system(size: 15))
                .lineLimit(landscape ? 1 : 2)
            if !meta.isEmpty {
                Text(meta)
                    .font(.system(size: 13))
                    .foregroundColor(.white.opacity(0.75))
                    .lineLimit(1)
            }
            if isCurrent {
                ClipProgressLine(progress: pool.progress) { pool.seek($0) }
                    .padding(.top, TSpace.xs)
            }
        }
        .foregroundColor(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .shadow(color: .black.opacity(0.7), radius: 4)
        .padding(.leading, max(insets.leading, TSpace.lg))
        .padding(.trailing, max(insets.trailing, TSpace.lg))
        .padding(.top, 60)
        .padding(.bottom, insets.bottom + (landscape ? TSpace.sm : TSpace.lg))
        .background(
            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                .allowsHitTesting(false)
        )
    }
}

/// Thin line of the clip's progress; dragged, it thickens and scrubs.
@available(iOS 17.0, *)
private struct ClipProgressLine: View {
    @ObservedObject var progress: ClipProgress
    let onSeek: (Double) -> Void
    @State private var dragging: Double? = nil

    var body: some View {
        GeometryReader { geo in
            let fraction = dragging ?? (progress.duration > 0 ? progress.time / progress.duration : 0)
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.3))
                Capsule().fill(Color.white)
                    .frame(width: geo.size.width * max(0, min(1, fraction)))
            }
            .frame(height: dragging == nil ? 3 : 8)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        let f = max(0, min(1, v.location.x / max(1, geo.size.width)))
                        dragging = f
                        onSeek(f)
                    }
                    .onEnded { _ in dragging = nil }
            )
            .animation(.easeOut(duration: 0.15), value: dragging == nil)
        }
        .frame(height: 28)
    }
}
