import SwiftUI
import AVFoundation
import AVKit

// ═══════════════════════════════════════════════════════════════════════════
//  YouTube-style controls over the native player (live and VODs).
//
//  Apple's own bar could not be shaped: for a live stream it shows the clock
//  time, the LIVE badge had to sit in the header, and scrubbing or double taps
//  were out of reach. These controls read and drive the AVPlayer themselves:
//  red bar over the whole width, "2:21:36 / 2:21:46 · ● Live" while behind (tap: back to
//  live), "● Live" in red at the edge, "12:34 / 1:23:45" for a VOD, ±10 s and
//  play/pause in the middle, double tap left/right = ±10 s, fade-out after 3 s.
// ═══════════════════════════════════════════════════════════════════════════

/// Time of the player, apart from the visibility: it changes 4×/s and only the
/// bar and labels watch it, not the screens around the player.
@MainActor
final class PlayerClock: ObservableObject {
    @Published var time: Double = 0
    @Published var start: Double = 0
    @Published var end: Double = 0
}

/// Shown/hidden state and the player behind the controls (one per player screen).
@MainActor
final class PlayerControlsModel: ObservableObject {
    @Published private(set) var visible = true
    @Published private(set) var playing = false
    @Published private(set) var buffering = false
    let clock = PlayerClock()

    private weak var player: AVPlayer?
    private var timeObserver: Any?
    private weak var observed: AVPlayer?
    private var statusObs: NSKeyValueObservation?
    private var hideTask: Task<Void, Never>?
    private(set) var isLive = false
    /// Last end of the seekable range, and when it grew (live edge smoothing, see tick).
    private var edgeBase: Double = 0
    private var edgeBaseAt = Date.distantPast
    /// The real seekable end (the shown one runs ahead of it between playlist reloads).
    private var seekableEnd: Double = 0
    /// A seek of ours (bar, ±10 s, back to live) to this time: the live-edge keeping must
    /// not undo it.
    var onUserSeek: ((Double) -> Void)?

    /// Live within this many seconds of the edge counts as live (the edge itself moves). Under
    /// a ±10 s skip with room for the edge's jitter: at 8 a "-0:10" wobbled into "Live".
    static let edgeSlack: Double = 5

    // MARK: Player
    /// A new AVPlayer (opening, other quality): follow it instead.
    func attach(_ player: AVPlayer, isLive: Bool) {
        detach()
        self.player = player
        self.isLive = isLive
        edgeBase = 0
        edgeBaseAt = .distantPast
        observed = player
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4),
                                                      queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        statusObs = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] p, _ in
            let status = p.timeControlStatus
            DispatchQueue.main.async {
                guard let self else { return }
                self.playing = status != .paused
                self.buffering = status == .waitingToPlayAtSpecifiedRate
                // Paused: the controls stay; playing again: they fade out.
                if status == .paused { self.hideTask?.cancel() } else if self.visible { self.scheduleHide() }
            }
        }
    }

    func detach() {
        if let o = timeObserver { observed?.removeTimeObserver(o) }
        timeObserver = nil
        statusObs = nil
        observed = nil
    }

    private func tick() {
        guard let player, let item = player.currentItem else { return }
        let t = player.currentTime().seconds
        var start = 0.0, end = 0.0
        // All seekable ranges together: a recording joined to the live stream can come as two
        // (a small gap between them), and the last one alone is just the live part.
        let ranges = item.seekableTimeRanges.map(\.timeRangeValue)
        if let first = ranges.first, let last = ranges.last, last.end.seconds > first.start.seconds {
            start = first.start.seconds
            end = last.end.seconds
        }
        if !isLive, item.duration.seconds.isFinite, item.duration.seconds > 0 {
            start = 0
            end = item.duration.seconds
        }
        guard t.isFinite else { return }
        seekableEnd = end
        if isLive, end > 0 {
            // The playlist's end grows in steps (one reload adds several seconds), while the
            // real edge moves on all the time: "-0:10" counted down to "Live" and jumped back.
            // Between steps the edge advances with the clock, capped so a stalled playlist
            // doesn't run away.
            let now = Date()
            if end > edgeBase + 0.5 || end < edgeBase - 30 { edgeBase = end; edgeBaseAt = now }
            end = max(end, edgeBase + min(now.timeIntervalSince(edgeBaseAt), 15))
        }
        if abs(clock.time - t) > 0.05 { clock.time = t }
        if clock.start != start { clock.start = start }
        if clock.end != end { clock.end = end }
    }

    // MARK: Commands
    func togglePlay() {
        guard let player else { return }
        if player.timeControlStatus == .paused {
            // A VOD at its end starts over.
            if !isLive, clock.end > 0, clock.time >= clock.end - 0.5 { player.seek(to: .zero) }
            player.play()
        } else {
            player.pause()
        }
        poke()
    }

    func seek(to t: Double) {
        guard let player else { return }
        let target = max(clock.start, min(seekableEnd > 0 ? seekableEnd : clock.end, t))
        clock.time = target
        onUserSeek?(target)
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600),
                    toleranceBefore: .zero, toleranceAfter: .zero)
    }

    func skip(_ seconds: Double) {
        seek(to: clock.time + seconds)
    }

    func goLive() {
        guard let player, let edge = player.currentItem?.seekableTimeRanges.last?.timeRangeValue.end,
              edge.isNumeric else { return }
        clock.time = edge.seconds
        onUserSeek?(edge.seconds)
        player.seek(to: edge)
        player.play()
        poke()
    }

    /// Seconds behind the live edge (0 at the edge).
    var behind: Double { max(0, clock.end - clock.time) }

    // MARK: Visibility
    /// Tap on the picture: show, or hide when shown.
    func toggle() {
        if visible { hide() } else { poke() }
    }

    /// Shown, and the fade-out timer restarted (any touch on the controls).
    func poke() {
        if !visible { withAnimation(.easeInOut(duration: 0.2)) { visible = true } }
        scheduleHide()
    }

    func hide() {
        hideTask?.cancel()
        withAnimation(.easeInOut(duration: 0.25)) { visible = false }
    }

    private func scheduleHide() {
        hideTask?.cancel()
        guard playing else { return }
        hideTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled, let self, self.playing else { return }
            self.hide()
        }
    }
}

/// Clock time as YouTube writes it: "5:03", "1:05:03".
func playerClockText(_ seconds: Double) -> String {
    let s = Int(max(0, seconds).rounded(.down))
    let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
}

// MARK: – Overlay
struct PlayerControlsOverlay: View {
    @ObservedObject var model: PlayerControlsModel
    let isLive: Bool
    let landscape: Bool
    let onFullscreen: () -> Void

    @EnvironmentObject private var store: AppStore
    /// Side of the last double tap (−1 left, +1 right), for its "10 Sekunden" flash.
    @State private var ripple: Int? = nil
    @State private var rippleTask: Task<Void, Never>? = nil

    var body: some View {
        // Tap zones and the bottom strip side by side, never on top of each other: laid over
        // one another, the zones took the bar's touches.
        VStack(spacing: 0) {
            tapZones
            if model.visible {
                bottomRow.transition(.opacity)
                    .background(Color.black.opacity(0.001).onTapGesture { model.toggle() })
            }
            PlayerScrubBar(model: model, clock: model.clock, isLive: isLive,
                           expanded: model.visible, landscape: landscape)
        }
        // Middle buttons and the ±10 s flash over the whole picture, so they sit at its centre:
        // inside the tap area above the bottom strip they ended up too high.
        .overlay {
            ZStack {
                if model.visible { centerButtons.transition(.opacity) }
                rippleLabel
            }
        }
        .background {
            if model.visible {
                LinearGradient(colors: [.black.opacity(0.45), .black.opacity(0.1), .black.opacity(0.55)],
                               startPoint: .top, endPoint: .bottom)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
    }

    // MARK: Taps
    /// Left and right halves: one tap shows/hides the controls, two taps skip 10 s.
    private var tapZones: some View {
        HStack(spacing: 0) {
            tapZone(side: -1)
            tapZone(side: 1)
        }
    }

    private func tapZone(side: Int) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                // Live at the edge: nothing ahead.
                if side > 0, isLive, model.behind < PlayerControlsModel.edgeSlack { return }
                model.skip(Double(side) * 10)
                flash(side)
            }
            .onTapGesture { model.toggle() }
    }

    private func flash(_ side: Int) {
        rippleTask?.cancel()
        withAnimation(.easeOut(duration: 0.15)) { ripple = side }
        rippleTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.25)) { ripple = nil }
        }
    }

    @ViewBuilder private var rippleLabel: some View {
        if let side = ripple {
            HStack {
                if side > 0 { Spacer() }
                VStack(spacing: 4) {
                    Image(systemName: side < 0 ? "backward.fill" : "forward.fill")
                    Text(store.t("player_ten_seconds")).font(.caption.weight(.semibold))
                }
                .foregroundColor(.white)
                .padding(TSpace.lg)
                .background(Circle().fill(Color.white.opacity(0.18)).padding(-TSpace.lg))
                .frame(maxWidth: .infinity)
                if side < 0 { Spacer() }
            }
            .allowsHitTesting(false)
            .transition(.opacity)
        }
    }

    // MARK: Middle
    private var centerButtons: some View {
        HStack(spacing: landscape ? 56 : 36) {
            roundButton(icon: "gobackward.10", size: 44) { model.skip(-10); model.poke() }
                .accessibilityLabel(store.t("player_back_10"))
            Group {
                if model.buffering {
                    ProgressView().tint(.white).controlSize(.large)
                        .frame(width: 60, height: 60)
                } else {
                    roundButton(icon: model.playing ? "pause.fill" : "play.fill", size: 60) { model.togglePlay() }
                        .accessibilityLabel(store.t(model.playing ? "pause" : "play"))
                }
            }
            roundButton(icon: "goforward.10", size: 44) { model.skip(10); model.poke() }
                .accessibilityLabel(store.t("player_forward_10"))
                // Live at the edge: nothing ahead.
                .opacity(isLive && model.behind < PlayerControlsModel.edgeSlack ? 0.35 : 1)
                .disabled(isLive && model.behind < PlayerControlsModel.edgeSlack)
        }
    }

    private func roundButton(icon: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: size, height: size)
                .tGlass(in: Circle(), fallback: .black.opacity(0.35), clear: true)
        }
        .buttonStyle(.plain)
    }

    // MARK: Bottom
    private var bottomRow: some View {
        HStack(spacing: TSpace.sm) {
            if isLive {
                LiveTimeLabel(model: model, clock: model.clock)
            } else {
                VodTimeLabel(clock: model.clock)
            }
            Spacer(minLength: 0)
            AirPlayButton()
                .frame(width: 32, height: 32)
            Button(action: onFullscreen) {
                Image(systemName: landscape ? "arrow.down.right.and.arrow.up.left"
                                            : "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.t(landscape ? "rotate_portrait" : "rotate_landscape"))
        }
        // Lined up with the bar's ends below.
        .padding(.horizontal, PlayerScrubBar.inset(landscape) - 6)
    }
}

/// "2:21:36 / 2:21:46 · ● Live" behind, "● Live" (red dot) at the edge; the chip jumps to live.
private struct LiveTimeLabel: View {
    @ObservedObject var model: PlayerControlsModel
    @ObservedObject var clock: PlayerClock
    @EnvironmentObject private var store: AppStore

    var body: some View {
        let behind = max(0, clock.end - clock.time)
        let atEdge = behind < PlayerControlsModel.edgeSlack
        HStack(spacing: TSpace.sm) {
            if !atEdge {
                // Where in the broadcast / its length so far, both running on like a VOD's: the
                // distance to live ("-0:10") stays put while watching and looked frozen.
                (Text(playerClockText(clock.time - clock.start)).foregroundColor(.white)
                 + Text(" / " + playerClockText(clock.end - clock.start)).foregroundColor(.white.opacity(0.7)))
                    .font(.footnote.weight(.semibold).monospacedDigit())
            }
            Button { if !atEdge { model.goLive() } } label: {
                HStack(spacing: 5) {
                    Circle().fill(atEdge ? Color.tLive : Color.white.opacity(0.6)).frame(width: 7, height: 7)
                    Text(store.t("live_short")).font(.footnote.weight(.semibold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 9).padding(.vertical, 5)
                .background(Capsule().fill(Color.black.opacity(atEdge ? 0 : 0.35)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.t(atEdge ? "live_on" : "back_to_live_full"))
        }
    }
}

/// "12:34 / 1:23:45".
private struct VodTimeLabel: View {
    @ObservedObject var clock: PlayerClock

    var body: some View {
        (Text(playerClockText(clock.time)).foregroundColor(.white)
         + Text(" / " + playerClockText(clock.end)).foregroundColor(.white.opacity(0.7)))
            .font(.footnote.weight(.semibold).monospacedDigit())
    }
}

// MARK: – Bar
/// Bar over the whole width at the video's bottom edge, in the app's purple; dragged, it
/// thickens, shows a bubble with the target and jumps there on release. Hidden controls:
/// a thin line only (VODs), touches go to the picture.
private struct PlayerScrubBar: View {
    @ObservedObject var model: PlayerControlsModel
    @ObservedObject var clock: PlayerClock
    let isLive: Bool
    let expanded: Bool
    let landscape: Bool
    @State private var dragging: Double? = nil

    /// Controls shown: the track sits clear of the screen edges (at the very edge it was hard
    /// to grab, and its ends were out of reach), in a 44 pt tall touch strip, as on YouTube.
    static func inset(_ landscape: Bool) -> CGFloat { landscape ? 28 : 18 }
    private static let strip: CGFloat = 44
    /// Space under the strip: the home indicator in landscape.
    private var bottomGap: CGFloat { landscape ? 14 : 0 }

    private var span: Double { max(0.001, clock.end - clock.start) }

    var body: some View {
        let shown = expanded || dragging != nil
        GeometryReader { geo in
            let w = geo.size.width
            let inset = shown ? Self.inset(landscape) : 0
            let track = max(1, w - inset * 2)
            let current = isLive && clock.end - clock.time < PlayerControlsModel.edgeSlack
                ? 1 : (clock.time - clock.start) / span
            let fraction = max(0, min(1, dragging ?? current))
            let thick = dragging != nil
            let line: CGFloat = shown ? (thick ? 6 : 4) : 3
            let knob: CGFloat = thick ? 22 : 14
            // Line centred in the strip when shown; hidden, a thin line on the video's edge.
            let lineY = shown ? Self.strip / 2 : geo.size.height - line / 2
            ZStack(alignment: .topLeading) {
                Color.clear
                Capsule().fill(Color.white.opacity(shown ? 0.3 : 0.2))
                    .frame(width: track, height: line)
                    .position(x: inset + track / 2, y: lineY)
                Capsule().fill(Color.tPrimary)
                    .frame(width: max(line, track * fraction), height: line)
                    .position(x: inset + max(line, track * fraction) / 2, y: lineY)
                if shown {
                    Circle().fill(Color.tPrimary)
                        .frame(width: knob, height: knob)
                        .shadow(color: .black.opacity(0.3), radius: 2)
                        .position(x: inset + track * fraction, y: lineY)
                }
                if let d = dragging {
                    Text(bubble(d))
                        .font(.footnote.weight(.semibold).monospacedDigit())
                        .foregroundColor(.white)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(Color.black.opacity(0.75)))
                        .fixedSize()
                        .position(x: min(max(inset + track * d, 44), w - 44), y: lineY - 30)
                        .allowsHitTesting(false)
                }
            }
            .frame(width: w, height: geo.size.height)
            .contentShape(Rectangle())
            .highPriorityGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        dragging = max(0, min(1, (v.location.x - inset) / track))
                        model.poke()
                    }
                    .onEnded { _ in
                        if let d = dragging { model.seek(to: clock.start + d * span) }
                        dragging = nil
                        model.poke()
                    },
                including: shown ? .all : .none
            )
            .allowsHitTesting(shown)
            .opacity(shown || !isLive ? 1 : 0)
        }
        .frame(height: shown ? Self.strip + bottomGap : 3)
        .animation(.easeOut(duration: 0.15), value: dragging != nil)
    }

    /// Target while dragging, as a time in the broadcast or VOD ("1:20:00"); "Live" at the edge.
    private func bubble(_ fraction: Double) -> String {
        let t = clock.start + fraction * span
        if isLive, clock.end - t < PlayerControlsModel.edgeSlack { return "Live" }
        return playerClockText(t - clock.start)
    }
}




