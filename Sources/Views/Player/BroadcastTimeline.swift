import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Timeline of a running broadcast under Apple's player, from its start to
//  now, as in the Twitch and YouTube apps. The live stream itself only keeps
//  its last seconds; dragging back opens the broadcast's recording at that
//  point, the LIVE pill (or dragging to the end) returns to the live stream.
// ═══════════════════════════════════════════════════════════════════════════

struct BroadcastTimeline: View {
    let startedAt: Date
    /// Point being watched, in seconds since the start; nil while live.
    let position: Double?
    /// Jump to this many seconds since the start (in the recording).
    let onSeek: (Double) -> Void
    let onLive: () -> Void

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

            HStack(spacing: TSpace.sm) {
                Text(BroadcastTimeline.clock(shown))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundColor(drag == nil ? .tMuted : .tText)
                    .frame(minWidth: 52, alignment: .leading)

                scrubber(shown: shown, total: total, live: live)

                Button(action: { if position != nil { onLive() } }) {
                    Label(store.t("live_badge"), systemImage: "dot.radiowaves.left.and.right")
                        .font(.caption.weight(.bold))
                }
                .modifier(LivePillStyle(live: position == nil))
                .tCapsuleShape()
                .controlSize(.small)
                .tint(position == nil ? .tLive : .secondary)
                .accessibilityLabel(store.t(position == nil ? "live_on" : "back_to_live_full"))
            }
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

    /// Drawn like a system slider, driven by a DragGesture: SwiftUI's Slider (iOS 27) dropped
    /// the end of a drag whenever its view was rebuilt meanwhile — every second while the
    /// recording plays — and the jump never happened. A tap jumps too.
    private func scrubber(shown: Double, total: Double, live: Bool) -> some View {
        GeometryReader { geo in
            let w = max(1, geo.size.width)
            let knob: CGFloat = drag == nil ? 18 : 26
            let x = CGFloat(min(max(shown / total, 0), 1)) * w
            ZStack(alignment: .leading) {
                Capsule().fill(Color.tSurface).frame(height: 6)
                Capsule().fill(live ? Color.tLive : Color.tPrimary).frame(width: max(6, x), height: 6)
                Circle().fill(Color.white)
                    .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
                    .frame(width: knob, height: knob)
                    .offset(x: min(max(0, x - knob / 2), w - knob))
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { g in drag = Double(min(max(g.location.x / w, 0), 1)) * total }
                .onEnded { g in commit(Double(min(max(g.location.x / w, 0), 1)) * total, total: total) })
            .animation(.easeOut(duration: 0.12), value: drag == nil)
        }
        .frame(height: 36)
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

    /// Filled while live, outlined while watching the recording (tap = back to live).
    private struct LivePillStyle: ViewModifier {
        let live: Bool
        func body(content: Content) -> some View {
            if live { content.tProminentStyle() } else { content.tBorderedStyle() }
        }
    }
}
