import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Recherche unifiée.
//
//  Avant, « Streamer » et « Lien / ID » étaient deux onglets distincts alors
//  que c'est le même geste : on cherche quelque chose. Ici un seul champ, et
//  c'est l'app qui reconnaît ce qu'on lui donne :
//    • un lien ou un identifiant numérique  → on ouvre la VOD directement
//    • n'importe quoi d'autre               → on cherche la chaîne
// ═══════════════════════════════════════════════════════════════════════════

struct SearchView: View {
    let onPlayVod:  (String, String?, String?, String?) -> Void
    let onPlayLive: (String) -> Void
    var onPlayClip: (String, String?) -> Void = { _, _ in }
    @EnvironmentObject private var store: AppStore

    @State private var query        = ""
    @State private var loading      = false
    @State private var errorMsg: String? = nil
    // Suggestions de chaînes pendant la frappe
    @State private var suggestions: [AutocompleteSuggestion] = []
    @State private var suggestTask: Task<Void, Never>? = nil
    /// Categories matching what is typed (same field as channels).
    @State private var categoryResults: [TwitchCategory] = []
    /// Category page pushed on the tab's stack (idle grid or search results).
    @State private var openedCategory: TwitchCategory? = nil
    /// System search field in use (iOS 17+ reports it; iOS 16: while there is text).
    @State private var searchActive = false
    private var queryFocused: Bool {
        if #available(iOS 17, *) { return searchActive }
        return !query.isEmpty
    }

    /// Le texte saisi désigne-t-il une VOD (lien twitch.tv/videos/… ou ID) ?
    /// Même règle que le « + » du multi-live (TwitchAPI).
    private var queryIsVod: Bool { isVodInput(query) }
    /// Lien de clip collé : il s'ouvre directement, comme sur le site.
    private var queryIsClip: Bool { clipSlugFromInput(query) != nil }

    var body: some View {
        searchBody
    }

    private var searchBody: some View {
        VStack(spacing: 0) {

            if browsing {
                // Idle Browse tab shows the category grid, like Twitch's.
                CategoriesView(onOpen: { openedCategory = $0 })
            } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: TSpace.lg) {

                    // Indique ce qui va se passer : l'utilisateur n'a pas à deviner.
                    if !loading,
                       !query.trimmingCharacters(in: .whitespaces).isEmpty {
                        Label(store.t(queryIsClip ? "hint_is_clip" : queryIsVod ? "hint_is_vod" : "hint_is_channel"),
                              systemImage: queryIsClip ? "scissors" : queryIsVod ? "play.rectangle.fill" : "person.fill")
                            .font(.tMeta)
                            .foregroundColor(.tMuted)
                            .padding(.horizontal, TSpace.lg)
                    }

                    // ── Suggestions de chaînes ──────────────────────
                    if queryFocused, !suggestions.isEmpty, !queryIsVod {
                        suggestionList
                    }

                    // ── Catégories ──────────────────────────────────
                    if !loading, !categoryResults.isEmpty {
                        TShelf(title: store.t("categories")) {
                            ForEach(categoryResults) { cat in
                                CategoryCardView(category: cat, hideable: true) {
                                    dismissKeyboard()
                                    openedCategory = cat
                                }
                                .frame(width: 110)
                            }
                        }
                    }

                    // ── Chaînes récentes ────────────────────────────
                    if !loading, suggestions.isEmpty {
                        recentChannels
                    }

                    if loading {
                        TLoader()
                    } else if let err = errorMsg {
                        TEmptyState(icon: "exclamationmark.triangle", title: err)
                    }

                    Spacer(minLength: 40)
                }
                .padding(.top, TSpace.sm)
            }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.tDark)
        .modifier(SearchBar(enabled: true, text: $query, active: $searchActive,
                            prompt: store.t("ph_search")))
        .onSubmit(of: .search) { Task { await submit() } }
        .onChange(of: query) { text in
            suggest(text)
            // Cleared or cancelled: leave the channel page, back to browsing.
            if text.isEmpty {
                suggestions = []; categoryResults = []; errorMsg = nil
            }
        }
        .navigationDestination(isPresented: Binding(get: { openedCategory != nil },
                                                    set: { if !$0 { openedCategory = nil } })) {
            if let cat = openedCategory {
                CategoryStreamsView(category: cat,
                                    followedOnTwitch: store.accountFollowedCategoryIds.contains(cat.id),
                                    onPlayStream: onPlayLive)
            }
        }
    }

    /// Nothing searched and the field not in use: the tab browses categories.
    private var browsing: Bool {
        !queryFocused && query.isEmpty
            && !loading && errorMsg == nil
    }

    // MARK: – Suggestions
    @ViewBuilder private var suggestionList: some View {
        VStack(spacing: 0) {
            ForEach(suggestions) { s in
                Button {
                    query = s.login
                    dismissKeyboard()
                    suggestions = []
                    openChannel(s.login)
                } label: {
                    HStack(spacing: TSpace.md) {
                        AsyncImage(url: URL(string: s.avatar ?? "")) { img in
                            img.resizable().scaledToFill()
                        } placeholder: {
                            Circle().fill(Color.tSurface)
                        }
                        .frame(width: 32, height: 32)
                        .clipShape(Circle())
                        // Anneau rouge : la chaîne est en live.
                        .overlay(Circle().stroke(s.isLive ? Color.tLive : .clear, lineWidth: 2).padding(-2))

                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 5) {
                                Text(s.name).font(.tCardTitle).foregroundColor(.tText).lineLimit(1)
                                // Masquée des listes : la recherche la trouve quand même.
                                if store.hidden.hides(channel: s.login) {
                                    Image(systemName: "eye.slash")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundColor(.tMuted)
                                        .accessibilityLabel(store.t("hidden_badge"))
                                }
                            }
                            if let viewers = s.viewers {
                                HStack(spacing: 5) {
                                    Text("LIVE")
                                        .font(.system(size: 9, weight: .heavy))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 4).padding(.vertical, 1)
                                        .background(Color.tLive).cornerRadius(3)
                                    Text(formatViewers(viewers) + (s.game.map { " · \($0)" } ?? ""))
                                        .font(.tMeta).foregroundColor(.tMuted).lineLimit(1)
                                }
                            }
                        }
                        Spacer()
                        Image(systemName: "arrow.up.left")
                            .font(.caption2).foregroundColor(.tMuted)
                    }
                    .padding(.horizontal, TSpace.md)
                    .frame(height: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if s.id != suggestions.last?.id {
                    Divider().background(Color.tBorder).padding(.leading, 56)
                }
            }
        }
        .background(Color.tCard)
        .cornerRadius(TRadius.card)
        .padding(.horizontal, TSpace.lg)
    }

    // MARK: – Chaînes récentes
    private var recentChannelItems: [HistoryItem] {
        // Masquables dans les réglages (« Streamers récents »).
        guard store.showRecentChannels else { return [] }
        return store.history.filter { $0.type == .channel }.prefix(10).map { $0 }
    }

    @ViewBuilder private var recentChannels: some View {
        if !recentChannelItems.isEmpty {
            VStack(alignment: .leading, spacing: TSpace.md) {
                TSectionHeader(store.t("lbl_channel_history"), icon: "clock.arrow.circlepath") {
                    Button { store.clearChannelHistory() } label: {
                        Text(store.t("btn_clear"))
                            .font(.tMeta).foregroundColor(.tDanger)
                    }
                    .buttonStyle(.plain)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: TSpace.sm) {
                        ForEach(recentChannelItems) { item in
                            HStack(spacing: TSpace.sm) {
                                Text(item.display)
                                    .font(.tLabel).foregroundColor(.tText)
                                    .lineLimit(1)
                                Button {
                                    store.removeFromHistory(term: item.term)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundColor(.tMuted)
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.leading, TSpace.md).padding(.trailing, TSpace.sm)
                            .frame(height: 34)
                            .background(Color.tSurface)
                            .clipShape(Capsule())
                            .contentShape(Capsule())
                            .onTapGesture {
                                query = item.term
                                openChannel(item.term)
                            }
                        }
                    }
                    .padding(.horizontal, TSpace.lg)
                }
            }
        }
    }

    // MARK: – Actions
    /// Aiguille vers la VOD ou la chaîne selon ce qui a été saisi.
    @MainActor private func submit() async {
        let raw = query.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return }
        // Lien de clip : lu tout de suite. Avant, « clips.twitch.tv/Slug »
        // cherchait une chaîne « slug » et « twitch.tv/x/clip/… » ouvrait x.
        if let slug = clipSlugFromInput(raw) {
            suggestions = []
            onPlayClip(slug, nil)
            return
        }
        if queryIsVod { await openVod(raw) } else { openChannel(raw) }
    }

    /// A channel picked in the search tab: its channel page.
    private func openChannel(_ raw: String) {
        let login = loginFromInput(raw)
        guard isValidLogin(login) else { errorMsg = store.t("not_found"); return }
        suggestions = []
        dismissKeyboard()
        store.saveToHistory(HistoryItem(term: login, type: .channel, display: login,
                                        thumb: nil, streamer: nil,
                                        addedAt: Date().timeIntervalSince1970 * 1000))
        store.openChannelPage(login)
    }

    @MainActor private func openVod(_ raw: String) async {
        guard let vodId = extractVodId(raw) else {
            errorMsg = store.t("err_bad_vod"); return
        }
        loading = true; errorMsg = nil
        suggestions = []

        async let metaTask = getVodMetaGQL(vodId)
        async let m3u8Task = getM3U8(vodId: vodId)
        let (meta, m3u8) = await (metaTask, m3u8Task)
        loading = false

        guard !(m3u8.links.isEmpty && m3u8.error != nil) else {
            errorMsg = m3u8.error.map { store.t(apiErrorKey($0)) }; return
        }
        // « ?t=1h2m3s » du lien : la VOD part de là (le lecteur reprend à la
        // position enregistrée).
        if let start = vodStartFromInput(raw) { store.setVodProgress(vodId, time: start) }
        // La lecture passe par le lecteur global : l'historique y est enregistré.
        onPlayVod(vodId, meta?.title ?? "VOD \(vodId)", meta?.thumb,
                  meta.flatMap { $0.streamer.isEmpty ? nil : $0.streamer })
    }

    /// Suggestions de chaînes et catégories, différées de 300 ms pour ne pas appeler à chaque frappe.
    private func suggest(_ text: String) {
        suggestTask?.cancel()
        let t = text.trimmingCharacters(in: .whitespaces)
        guard t.count >= 2, !queryIsVod, !queryIsClip else { suggestions = []; categoryResults = []; return }
        suggestTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            async let users = searchUsersGQL(t)
            // GQL ranks like Twitch ("valorant" → VALORANT first); Helix only as a fallback.
            async let cats = searchCategoriesGQL(query: t)
            let found = await users
            var categories = await cats
            if categories == nil, let token = store.twitchToken {
                categories = try? await searchCategories(token: token, query: t)
            }
            guard !Task.isCancelled else { return }
            let ranked = rankCategories(categories ?? [], for: t)
            await MainActor.run {
                suggestions = Array(found.prefix(5))
                categoryResults = Array(ranked.prefix(12))
            }
        }
    }
}

/// `.searchable` in the navigation bar; on iOS 17+ it also reports whether the
/// field is in use, which decides between browsing and suggestions.
private struct SearchBar: ViewModifier {
    let enabled: Bool
    @Binding var text: String
    @Binding var active: Bool
    let prompt: String

    func body(content: Content) -> some View {
        if !enabled {
            content
        } else if #available(iOS 17, *) {
            content.searchable(text: $text, isPresented: $active,
                               placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
        } else {
            content.searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: prompt)
        }
    }
}

func dismissKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}
