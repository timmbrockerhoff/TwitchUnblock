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
    /// Emotes and badges fetched again, IRC reconnected.
    let onReload: () -> Void
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
                Section {
                    if let a = actions { toggle("bubble.left", "menu_chat_only", a.chatOnly) }
                    Stepper(value: $store.chatFontSize, in: 10...20, step: 1) {
                        HStack {
                            Label(store.t("cfg_font_size"), systemImage: "textformat.size")
                            Spacer()
                            Text("\(Int(store.chatFontSize)) pt").foregroundColor(.secondary).monospacedDigit()
                        }
                    }
                    if ChatTranslator.isAvailable {
                        toggle("translate", "chat_auto_translate", $store.chatAutoTranslate)
                    }
                    toggle("clock", "cfg_timestamps", $store.chatTimestamps)
                    toggle("strikethrough", "cfg_deleted", $store.chatShowDeleted)
                    // One switch for both: they hide the same kind of noise.
                    toggle("cpu", "chat_hide_noise", Binding(
                        get: { store.chatHideBots && store.chatHideCommands },
                        set: { store.chatHideBots = $0; store.chatHideCommands = $0 }))
                }
                if let a = actions {
                    Section {
                        NavigationLink { noticesPage } label: {
                            row("bell.badge", "chat_notices", "\(noticesOn) / 4")
                        }
                        Button { showChatters = true } label: { row("person.2", "menu_chatters", chevron: true) }
                        Button { showBotCommands = true } label: { row("terminal", "bot_commands", chevron: true) }
                        // Needs the account (Helix); a greyed row without a reason only confused.
                        if a.isAuthenticated {
                            Button { showColors = true } label: { row("paintpalette", "menu_color", chevron: true) }
                        }
                        Button { a.onReload(); dismiss() } label: { row("arrow.clockwise", "chat_reload") }
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

    private var noticesOn: Int {
        [store.showPinnedMessages, store.showLiveEvents, store.showDropsNotice, store.showWatchStreak]
            .filter { $0 }.count
    }

    /// Banners on top of the chat and the streak in the line above the field.
    private var noticesPage: some View {
        List {
            toggle("pin", "cfg_pinned", $store.showPinnedMessages)
            toggle("chart.bar", "cfg_events", $store.showLiveEvents)
            toggle("gift", "cfg_drops_notice", $store.showDropsNotice)
            toggle("flame", "cfg_streak", $store.showWatchStreak)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.secondarySystemBackground))
        .navigationTitle(store.t("chat_notices"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ icon: String, _ key: String, _ value: String? = nil, chevron: Bool = false) -> some View {
        HStack {
            Label(store.t(key), systemImage: icon).foregroundColor(.primary)
            Spacer()
            if let value { Text(value).foregroundColor(.secondary).monospacedDigit() }
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
