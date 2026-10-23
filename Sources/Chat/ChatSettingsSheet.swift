import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Settings of the chat, opened by the gear in the "Live-Chat" header (as the
//  player's gear does for the video): what the chat shows, switched on the
//  spot, without going through the app's settings. Same store values as there.
// ═══════════════════════════════════════════════════════════════════════════

/// The live chat's own actions (the former "⋯" menu of its input bar); nil for a VOD's chat.
struct ChatActions {
    let channelName: String
    let isAuthenticated: Bool
    let chatOnly: Binding<Bool>
    let chat: ChatService
    let onReloadEmotes: () -> Void
    let onReconnect: () -> Void
    /// Bot command picked: put in the chat field (nil = copied).
    var onUseCommand: ((String) -> Void)? = nil
}

struct ChatSettingsSheet: View {
    var actions: ChatActions? = nil

    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var showChatters = false
    @State private var showBotCommands = false
    @State private var showColors = false

    var body: some View {
        NavigationStack {
            List {
                if let actions { actionsSection(actions) }
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
        .sheet(isPresented: $showChatters) {
            if let actions { ChattersSheet(chat: actions.chat).presentationDetents([.medium, .large]) }
        }
        .sheet(isPresented: $showBotCommands) {
            if let actions {
                BotCommandsSheet(channelName: actions.channelName, onUse: actions.onUseCommand.map { use in
                    { (cmd: String) in use(cmd); dismiss() }
                })
                .presentationDetents([.medium, .large])
            }
        }
        .sheet(isPresented: $showColors) {
            UsernameColorSheet { color in
                // Since 2023 IRC `/color` is refused: Helix (user:manage:chat_color) only.
                guard let token = store.twitchToken, let uid = store.twitchUserId else {
                    return "color_needs_relogin"
                }
                return await setChatColor(token: token, userId: uid, color: color)
            }
            .presentationDetents([.medium, .large])
        }
    }

    /// Chat only, refresh, reconnect, name colour, chatters, bot commands.
    @ViewBuilder private func actionsSection(_ a: ChatActions) -> some View {
        Section("Chat") {
            Toggle(isOn: a.chatOnly) {
                Label(store.t("menu_chat_only"), systemImage: "bubble.left").foregroundColor(.primary)
            }
            .tint(.tPrimary)
            Button { a.onReloadEmotes(); dismiss() } label: {
                actionLabel("arrow.triangle.2.circlepath", "menu_reload_emotes")
            }
            Button { a.onReconnect(); dismiss() } label: {
                actionLabel("wifi.exclamationmark", "menu_reconnect")
            }
            Button { showColors = true } label: {
                actionLabel("paintpalette", "menu_color", chevron: true)
            }
            .disabled(!a.isAuthenticated)
            Button { showChatters = true } label: {
                actionLabel("person.2", "menu_chatters", chevron: true)
            }
            Button { showBotCommands = true } label: {
                actionLabel("terminal", "bot_commands", chevron: true)
            }
        }
    }

    private func actionLabel(_ icon: String, _ key: String, chevron: Bool = false) -> some View {
        HStack {
            Label(store.t(key), systemImage: icon).foregroundColor(.primary)
            Spacer()
            if chevron {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundColor(.secondary)
            }
        }
    }

    private func toggle(_ icon: String, _ key: String, _ value: Binding<Bool>) -> some View {
        Toggle(isOn: value) {
            Label(store.t(key), systemImage: icon).foregroundColor(.primary)
        }
        .tint(.tPrimary)
    }
}
