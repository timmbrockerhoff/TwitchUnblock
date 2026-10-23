import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Settings of the native player, opened by the gear in the video (as on
//  YouTube): a short sheet from the bottom, one row per setting with its
//  value on the right; quality and speed open their own list.
// ═══════════════════════════════════════════════════════════════════════════

struct PlayerSettingsSheet: View {
    let qualities: [String]
    let quality: String
    var onQuality: (String) -> Void = { _ in }
    /// VODs and clips; nil hides the row (a live stream plays at 1×).
    var speed: Double? = nil
    var onSpeed: (Double) -> Void = { _ in }
    /// Portrait: chat shown or not. Landscape: its layout.
    let landscape: Bool
    @Binding var chatHidden: Bool
    var onSleepTimer: () -> Void = {}
    /// Live without its recording joined: open the recording from the start.
    var onRewind: (() -> Void)? = nil

    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if !qualities.isEmpty {
                    NavigationLink {
                        choiceList(title: store.t("quality"), values: qualities, selected: quality,
                                   label: { qualityText($0, store.lang) }, onPick: onQuality)
                    } label: {
                        row("slider.horizontal.3", store.t("quality"), qualityText(quality, store.lang))
                    }
                }
                if let speed {
                    NavigationLink {
                        choiceList(title: store.t("speed"), values: VodSpeed.all, selected: VodSpeed.nearest(speed),
                                   label: speedText, onPick: onSpeed)
                    } label: {
                        row("gauge.with.dots.needle.67percent", store.t("speed"), speedText(speed))
                    }
                }
                if landscape {
                    NavigationLink {
                        choiceList(title: "Chat", values: LandscapeChat.allCases, selected: store.landscapeChat,
                                   label: { store.t($0.labelKey) },
                                   onPick: { m in withAnimation { store.landscapeChat = m } })
                    } label: {
                        row("bubble.left.and.bubble.right", "Chat", store.t(store.landscapeChat.labelKey))
                    }
                } else {
                    Toggle(isOn: Binding(get: { !chatHidden }, set: { on in withAnimation { chatHidden = !on } })) {
                        Label("Chat", systemImage: "bubble.left.and.bubble.right").foregroundColor(.primary)
                    }
                    .tint(.tPrimary)
                }
                Button { dismiss(); onSleepTimer() } label: {
                    row("moon.zzz", store.t("sleep_timer"), nil)
                }
                if let onRewind {
                    Button { dismiss(); onRewind() } label: {
                        row("gobackward", store.t("rewind"), nil)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color(.secondarySystemBackground))
            .toolbar(.hidden, for: .navigationBar)
        }
        // As tall as its rows (YouTube's sheet ends under its last row), larger by dragging up.
        .presentationDetents([.height(CGFloat(76 + 52 * rowCount)), .large])
        .presentationDragIndicator(.visible)
        .preferredColorScheme(.dark)
    }

    private var rowCount: Int {
        (qualities.isEmpty ? 0 : 1) + (speed == nil ? 0 : 1) + 1 + 1 + (onRewind == nil ? 0 : 1)
    }

    private func speedText(_ v: Double) -> String {
        v == 1 ? store.t("speed_normal") : VodSpeed.label(v, store.lang)
    }

    /// Icon, title, and the current value in grey on the right (as on YouTube).
    private func row(_ icon: String, _ title: String, _ value: String?) -> some View {
        HStack {
            Label(title, systemImage: icon).foregroundColor(.primary)
            Spacer()
            if let value { Text(value).foregroundColor(.secondary) }
        }
    }

    /// One choice of a list, checked; picking it applies and closes the sheet.
    private func choiceList<T: Hashable>(title: String, values: [T], selected: T,
                                         label: @escaping (T) -> String,
                                         onPick: @escaping (T) -> Void) -> some View {
        List(values, id: \.self) { v in
            Button {
                onPick(v)
                dismiss()
            } label: {
                HStack {
                    Text(label(v)).foregroundColor(.primary)
                    Spacer()
                    if v == selected { Image(systemName: "checkmark").foregroundColor(.tPrimary) }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.secondarySystemBackground))
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
    }
}
