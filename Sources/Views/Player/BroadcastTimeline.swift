import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Timeline of a running broadcast under Apple's player, from its start to
//  now, styled like Apple Music's / Podcasts' scrubber: a thin bar that grows
//  while touched, the position under its left end and LIVE under its right.
//  The live stream only keeps its last seconds; dragging back opens the
//  broadcast's recording at that point, LIVE (or dragging to the end) returns.
// ═══════════════════════════════════════════════════════════════════════════

struct BroadcastTimeline: View {
    let startedAt: Date
    /// Point being watched, in seconds since the start; nil while live.
    let position: Double?
    /// Jump to this many seconds since the start (in the recording).
    let onSeek: (Double) -> Void
    let onLive: () -> Void

    /// Height it takes under the video (the player sizes its area with it).
    static let height: CGFloat = 44

    @EnvironmentObject private var store: AppStore
    @State private var drag: Double? = nil
    /// Advanced every second, but not while dragging (the bar keeps its length under the finger).
    @State private var now = Date()

    /// The recording ends about 30–60 s behind the live stream: a release this
    /// close to the end means "live", not "the recording's last seconds".
    private static let liveSnap: Double = 60

    var body: some View {
        let total = max(1, now.timeIntervalSince(startedAt))
        let shown = min(drag ?? position ?? total, total)
        let live = position == nil && drag == nil

        VStack(spacing: 0) {
            scrubber(shown: shown, total: total, live: live)
            HStack {
                Text(BroadcastTimeline.clock(shown))
                    .monospacedDigit()
                    .foregroundColor(drag == nil ? .tMuted : .tText)
                Spacer()
                // Live: a red marker. Behind: a button back to live.
                Button(action: { if position != nil { onLive() } }) {
                    HStack(spacing: 4) {
                        Circle().fill(position == nil ? Color.tLive : Color.tMuted)
                            .frame(width: 6, height: 6)
                        Text(store.t("live_badge"))
                    }
                    .foregroundColor(position == nil ? .tLive : .tMuted)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(position == nil)
                .accessibilityLabel(store.t(position == nil ? "live_on" : "back_to_live_full"))
            }
            .font(.caption2.weight(.semibold))
        }
        .padding(.horizontal, TSpace.lg)
        .frame(height: Self.height)
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { date in
            if drag == nil { now = date }
        }
    }

    private func commit(_ target: Double, total: Double) {
        drag = nil
        if target >= total - Self.liveSnap {
            if position != nil { onLive() }
        } else {
            onSeek(target)
        }
    }

    /// Driven by a DragGesture rather than Slider: SwiftUI's Slider (iOS 27) dropped the end
    /// of a drag whenever its view was rebuilt meanwhile — every second while the recording
    /// plays — and the jump never happened. A tap jumps too.
    private func scrubber(shown: Double, total: Double, live: Bool) -> some View {
        GeometryReader { geo in
            let w = max(1, geo.size.width)
            let x = CGFloat(min(max(shown / total, 0), 1)) * w
            let bar: CGFloat = drag == nil ? 4 : 10
            ZStack(alignment: .leading) {
                Capsule().fill(Color.tMuted.opacity(0.3))
                Capsule().fill(live ? Color.tLive : Color.tText.opacity(drag == nil ? 0.75 : 1))
                    .frame(width: max(bar, x))
            }
            .frame(height: bar)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { g in drag = Double(min(max(g.location.x / w, 0), 1)) * total }
                .onEnded { g in commit(Double(min(max(g.location.x / w, 0), 1)) * total, total: total) })
            .animation(.easeOut(duration: 0.15), value: drag == nil)
        }
        .frame(height: 22)
        .accessibilityElement()
        .accessibilityLabel(store.t("timeline"))
        .accessibilityValue(BroadcastTimeline.clock(shown))
        .accessibilityAdjustableAction { direction in
            let step: Double = direction == .increment ? 60 : -60
            commit(min(max(0, shown + step), total), total: total)
        }
    }

    static func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
                         : String(format: "%d:%02d", s / 60, s % 60)
    }
}
