import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Sub-sheets of the chat's settings (ChatSettingsSheet, gear by "Live-Chat"):
//  username colour and chatters. The former "⋯" menu itself is gone.
// ═══════════════════════════════════════════════════════════════════════════

// MARK: – Couleur du pseudo
/// Les couleurs nommées sont acceptées pour tous les comptes ; les teintes
/// libres (hex) restent réservées aux abonnés Turbo/Prime.
struct UsernameColorSheet: View {
    /// Applique la couleur et renvoie une clé d'erreur traduisible, ou nil.
    let apply: (String) async -> String?

    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var pending:  String? = nil
    @State private var applied:  String? = nil
    @State private var errorKey: String? = nil

    private let colors: [(name: String, hex: String)] = [
        ("blue", "0000FF"),          ("blue_violet", "8A2BE2"),
        ("cadet_blue", "5F9EA0"),    ("chocolate", "D2691E"),
        ("coral", "FF7F50"),         ("dodger_blue", "1E90FF"),
        ("firebrick", "B22222"),     ("golden_rod", "DAA520"),
        ("green", "008000"),         ("hot_pink", "FF69B4"),
        ("orange_red", "FF4500"),    ("red", "FF0000"),
        ("sea_green", "2E8B57"),     ("spring_green", "00FF7F"),
        ("yellow_green", "9ACD32"),
    ]

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: TSpace.sm)]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(store.t("menu_color")).font(.tSection).foregroundColor(.tText)
                Spacer()
                TIconButton(icon: "xmark") { dismiss() }
            }
            .padding(TSpace.lg)

            Divider().background(Color.tBorder)

            ScrollView {
                LazyVGrid(columns: columns, spacing: TSpace.sm) {
                    ForEach(colors, id: \.name) { c in
                        Button { pick(c.name) } label: {
                            HStack(spacing: TSpace.sm) {
                                Circle().fill(Color(hex: c.hex))
                                    .frame(width: 14, height: 14)
                                Text(c.name.replacingOccurrences(of: "_", with: " "))
                                    .font(.tMeta)
                                    .foregroundColor(.tText)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                                if pending == c.name {
                                    ProgressView().scaleEffect(0.6).tint(.tMuted)
                                } else if applied == c.name {
                                    Image(systemName: "checkmark")
                                        .font(.caption2.weight(.bold))
                                        .foregroundColor(.tSuccess)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, TSpace.md)
                            .frame(height: 38)
                            .background(Color.tSurface)
                            .cornerRadius(TRadius.chip)
                        }
                        .buttonStyle(.plain)
                        .disabled(pending != nil)
                    }
                }
                .padding(TSpace.lg)
            }

            if let errorKey {
                Text(store.t(errorKey))
                    .font(.tMeta).foregroundColor(.tWarning)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, TSpace.lg)
                    .padding(.bottom, TSpace.lg)
            }
        }
        .background(Color.tDark)
    }

    private func pick(_ name: String) {
        guard pending == nil else { return }
        pending = name; errorKey = nil
        Task {
            let err = await apply(name)
            await MainActor.run {
                pending = nil
                errorKey = err
                if err == nil { applied = name }
            }
        }
    }
}

// MARK: – Liste des chatteurs
/// Twitch n'expose plus d'API publique de présence (voir TwitchAPI.swift) : la
/// seule source restante est la capacité IRC `membership`, que Twitch n'honore
/// que sur les canaux de taille modeste. On affiche donc ce que le chat nous a
/// réellement annoncé, et on le dit clairement quand il ne dit rien.
struct ChattersSheet: View {
    @ObservedObject var chat: ChatService

    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var filter = ""

    private var logins: [String] {
        let kw = filter.trimmingCharacters(in: .whitespaces).lowercased()
        let all = chat.presentUsers.sorted()
        return kw.isEmpty ? all : all.filter { $0.contains(kw) }
    }

    var body: some View {
        sheetContent.tSheetBar(chat.presentUsers.isEmpty ? store.t("menu_chatters")
                               : "\(store.t("menu_chatters")) · \(chat.presentUsers.count)") { dismiss() }
    }

    private var sheetContent: some View {
        VStack(spacing: 0) {

            if chat.presentUsers.isEmpty {
                Spacer()
                TEmptyState(
                    icon: "person.2.slash",
                    title: store.t(chat.presenceSupported ? "menu_chatters_empty"
                                                          : "menu_chatters_waiting"),
                    message: store.t("menu_chatters_note")
                )
                .padding(.horizontal, TSpace.lg)
                Spacer()
            } else {
                TSearchField(text: $filter, placeholder: store.t("menu_chatters_search"))
                    .padding(.horizontal, TSpace.lg)
                    .padding(.vertical, TSpace.md)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(logins, id: \.self) { login in
                            HStack(spacing: TSpace.sm) {
                                Image(systemName: "person.fill")
                                    .font(.caption2).foregroundColor(.tMuted)
                                Text(login).font(.tBody).foregroundColor(.tText)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, TSpace.lg)
                            .padding(.vertical, 7)
                        }

                        Text(store.t("menu_chatters_note"))
                            .font(.tMeta).foregroundColor(.tMuted)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, TSpace.lg)
                            .padding(.top, TSpace.lg)
                    }
                    .padding(.bottom, TSpace.xl)
                }
            }
        }
        .background(Color.tDark)
    }
}
