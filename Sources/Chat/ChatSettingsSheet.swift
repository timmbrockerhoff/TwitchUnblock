import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Settings of the chat, opened by the gear in the "Live-Chat" header (as the
//  player's gear does for the video): what the chat shows, switched on the
//  spot, without going through the app's settings. Same store values as there.
// ═══════════════════════════════════════════════════════════════════════════

struct ChatSettingsSheet: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        NavigationStack {
            List {
                Section(store.t("chat_sec_messages")) {
                    toggle("clock", "cfg_timestamps", $store.chatTimestamps)
                    toggle("strikethrough", "cfg_deleted", $store.chatShowDeleted)
                    toggle("cpu", "hide_bots", $store.chatHideBots)
                    toggle("exclamationmark.bubble", "hide_commands", $store.chatHideCommands)
                }
                Section(store.t("chat_sec_top")) {
                    toggle("pin", "cfg_pinned", $store.showPinnedMessages)
                    toggle("chart.bar", "cfg_events", $store.showLiveEvents)
                    toggle("gift", "cfg_drops_notice", $store.showDropsNotice)
                    toggle("flame", "cfg_streak", $store.showWatchStreak)
                }
                Section {
                    Stepper(value: $store.chatFontSize, in: 10...20, step: 1) {
                        HStack {
                            Label(store.t("cfg_font_size"), systemImage: "textformat.size")
                            Spacer()
                            Text("\(Int(store.chatFontSize)) pt").foregroundColor(.secondary).monospacedDigit()
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color(.secondarySystemBackground))
            .navigationTitle(store.t("chat_settings"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .preferredColorScheme(.dark)
    }

    private func toggle(_ icon: String, _ key: String, _ value: Binding<Bool>) -> some View {
        Toggle(isOn: value) {
            Label(store.t(key), systemImage: icon).foregroundColor(.primary)
        }
        .tint(.tPrimary)
    }
}
