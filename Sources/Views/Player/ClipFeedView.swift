import SwiftUI
import AVFoundation

/// A channel's clip list opened as a feed: what is presented, from where.
struct ClipFeedItem: Identifiable {
    let id = UUID()
    let clips: [ClipData]
    let start: Int
}

/// Clips as a full-screen vertical feed, swiped up/down like the Twitch and
/// TikTok apps. Only the clip on screen plays, and it loops.
@available(iOS 17.0, *)
struct ClipFeedView: View {
    let clips: [ClipData]
    let onClose: () -> Void

    @State private var current: String?
    /// Shared by all pages: muting one keeps the next ones muted.
    @State private var muted = false

    init(clips: [ClipData], start: Int, onClose: @escaping () -> Void) {
        self.clips = clips
        self.onClose = onClose
        _current = State(initialValue: clips.indices.contains(start) ? clips[start].id : clips.first?.id)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(clips) { clip in
                        ClipFeedPage(clip: clip, active: current == clip.id, muted: $muted)
                            .containerRelativeFrame([.horizontal, .vertical])
                            .id(clip.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $current)
            .scrollIndicators(.hidden)
            .onAppear { if let current { proxy.scrollTo(current) } }
        }
        .background(Color.black.ignoresSafeArea())
        .overlay(alignment: .topLeading) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.black.opacity(0.4), in: Circle())
            }
            .padding(.leading, TSpace.lg)
            .padding(.top, TSpace.sm)
            .accessibilityLabel(Text(translate("close", .de)))
        }
        .onAppear { PlaybackAudio.shared.claim("clips") }
        .onDisappear { PlaybackAudio.shared.release("clips") }
        .preferredColorScheme(.dark)
    }
}

@available(iOS 17.0, *)
private struct ClipFeedPage: View {
    let clip: ClipData
    let active: Bool
    @Binding var muted: Bool

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
        parts.append("\(formatViewers(clip.viewCount)) Aufrufe")
        return parts.joined(separator: " · ")
    }

    var body: some View {
        ZStack {
            Color.black
            if let player {
                PlayerLayerView(player: player)
            } else {
                AsyncImage(url: URL(string: clip.thumbnailURL)) { img in
                    img.resizable().aspectRatio(16/9, contentMode: .fit)
                } placeholder: { Color.black }
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
                    .font(.system(size: 54))
                    .foregroundColor(.white.opacity(0.85))
                    .allowsHitTesting(false)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard let player else { return }
            paused.toggle()
            paused ? player.pause() : player.play()
        }
        .overlay(alignment: .bottom) { infoBar }
        .task(id: active) {
            if active { await start() } else { stop() }
        }
        .onChange(of: muted) { _, m in player?.isMuted = m }
        .onDisappear { stop() }
    }

    private var infoBar: some View {
        HStack(alignment: .bottom, spacing: TSpace.md) {
            VStack(alignment: .leading, spacing: 4) {
                Text(playback?.broadcasterName ?? " ")
                    .font(.system(size: 16, weight: .bold))
                Text(clip.title)
                    .font(.system(size: 14))
                    .lineLimit(2)
                Text(meta)
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.75))
                    .lineLimit(1)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 22) {
                Button { muted.toggle() } label: {
                    Image(systemName: muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                }
                if let url = URL(string: "https://clips.twitch.tv/\(clip.id)") {
                    ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                }
            }
            .font(.system(size: 22, weight: .semibold))
            .foregroundColor(.white)
            .buttonStyle(.plain)
        }
        .padding(.horizontal, TSpace.lg)
        .padding(.bottom, TSpace.xl)
        .shadow(color: .black.opacity(0.6), radius: 4)
    }

    private func start() async {
        failed = false
        paused = false
        if playback == nil {
            playback = await getClip(slug: clip.id)
        }
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
