import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Accueil : ce qui est en direct maintenant.
//  Deux vues — les lives (suivies en direct, top, suivies hors ligne) et les
//  catégories.
// ═══════════════════════════════════════════════════════════════════════════

struct HomeView: View {
    let onPlayStream: (String) -> Void
    /// "Ansehen fortsetzen": a VOD from the history, resumed where it stopped.
    var onPlayVod: (String, String?, String?, String?) -> Void = { _, _, _, _ in }
    /// "Clips" chip: followed channels' clips in the full-screen feed.
    var onOpenClipFeed: (ClipFeedItem) -> Void = { _ in }

    @EnvironmentObject private var store: AppStore

    @State private var followedStreams: [TwitchStream] = []
    /// Lives des chaînes suivies sans compte (sur cet appareil).
    @State private var localLive: [TwitchStream] = []
    /// Chaînes suivies hors ligne (compte + appareil), pour ouvrir leur page.
    @State private var offlineChannels: [ChannelBrief] = []
    /// Toutes les chaînes suivies par le compte Twitch.
    @State private var twitchFollowLogins: [String] = []
    /// Liste des suivis (en live et hors ligne) lue au moins une fois, et
    /// échec de cette lecture quand rien n'est encore affiché.
    @State private var followsLoaded = false
    @State private var followsFailed = false
    /// Sous-onglet des lives : 0 = suivies en live, 1 = top, 2 = suivies hors ligne.
    /// Full list behind a shelf's "Alle" (the former tabs).
    enum Detail: Hashable { case followed, top, offline }
    @State private var detail: Detail? = nil
    /// Followed channels' clips for their shelf, loaded when it first shows.
    @State private var shelfClips: [ClipData] = []
    @State private var shelfClipsLoaded = false
    /// The shelf's clips per followed login (ClipData has no channel field).
    @State private var clipsByLogin: [String: [ClipData]] = [:]
    /// Channel picked in the shelf's menu (nil = all, mixed), and its own longer list.
    @State private var clipChannel: String? = nil
    @State private var channelClips: [ClipData] = []
    @State private var topStreams:      [TwitchStream] = []
    /// Sans compte : curseur de la page suivante du top (pages de 30,
    /// « Charger plus »), remis à zéro à chaque rechargement de la 1ʳᵉ page.
    @State private var topNext: String? = nil
    @State private var topRefused     = false
    @State private var loadingMoreTop = false
    /// Avec le compte : taille du dernier top Helix (50, ou 100 quand des
    /// chaînes ou des catégories sont masquées, pour qu'il reste plein).
    @State private var topFetchCount  = 50
    /// Numéro du dernier chargement du top : une réponse plus ancienne
    /// (top à 50 arrivé après celui à 100) n'écrase pas la plus récente.
    @State private var topGen = 0
    /// Feuille des chaînes et catégories masquées (ligne « N masqués · Gérer »).
    @State private var showHidden     = false
    @State private var topLang: TopLang = .local
    @State private var loadingFollowed = false
    /// Vrai d'emblée : l'accueil est recréé à chaque retour sur l'onglet, et
    /// le top se charge aussitôt (loadAll) ; sinon « Aucune chaîne en live »
    /// s'affichait le temps de la première réponse.
    @State private var loadingTop      = true
    @State private var errorFollowed: String? = nil
    @State private var showWebLogin = false
    @Environment(\.scenePhase) private var scenePhase
    /// Dernier chargement des lives : relus au retour dans l'app et toutes
    /// les 3 min à l'écran (l'app laissée ouverte gardait la liste d'avant).
    @State private var lastLoad = Date.distantPast
    /// Bandeau « session web » masqué jusqu'à cette date (bouton ✕).
    @AppStorage("web_banner_hidden_until") private var webBannerHiddenUntil: Double = 0
    @ObservedObject private var drops = DropsService.shared
    /// Links the ✕ hid: the card comes back only for another game.
    @AppStorage("drops_link_hidden") private var dropsLinkHidden = ""
    @State private var showDropsLinks = false

    enum TopLang: Hashable { case local, all }

    private let columns = [GridItem(.flexible(), alignment: .top),
                           GridItem(.flexible(), alignment: .top)]

    var body: some View {
        // Avec ou sans compte : sans, les lives passent par des requêtes
        // publiques, et l'accueil invite à se connecter.
        // Categories moved to the Browse tab, as in the Twitch app.
        liveSection
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.tDark)
        .onAppear {
            if followedStreams.isEmpty && localLive.isEmpty && topStreams.isEmpty {
                Task { await loadAll() }
            }
        }
        // Chaîne suivie ou retirée sur cet appareil : liste à jour.
        .onChange(of: store.localFollows) { _ in Task { await loadLocalFollows() } }
        // App reprise après un moment : lives relus (ceux qui ont commencé ou
        // fini entre-temps), sans avoir à tirer la liste ni relancer l'app.
        .onChange(of: scenePhase) { phase in
            if phase == .active, Date().timeIntervalSince(lastLoad) > 60 {
                Task { await loadAll(isRefresh: true) }
            }
        }
        // À l'écran, app au premier plan : relus toutes les 3 min.
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 180_000_000_000)
                guard !Task.isCancelled,
                      await MainActor.run(body: { UIApplication.shared.applicationState == .active }),
                      Date().timeIntervalSince(lastLoad) >= 170 else { continue }
                await loadAll(isRefresh: true)
            }
        }
        .sheet(isPresented: $showDropsLinks) { DropsLinkSheet() }
        // Login (or app start with a session): which drops need a game account, right away.
        .task(id: store.twitchWebToken) {
            guard let web = store.twitchWebToken, !web.isEmpty else { return }
            await drops.refresh(token: web, autoClaim: store.autoClaimDrops)
        }
        .sheet(isPresented: $showWebLogin) {
            TwitchWebLoginSheet(
                clearSession: store.webSessionExpired || store.webSessionMismatch != nil,
                expectedLogin: store.twitchLogin,
                // Not logged in yet: this one login also signs the app in.
                onAppToken: store.twitchToken == nil ? { store.adoptAppToken($0) } : nil,
                onComplete: { webToken, webLogin in
                    showWebLogin = false
                    Task {
                        if await store.adoptWebToken(webToken, login: webLogin) {
                            logger.success("AUTH/WEB", "Session web connectée depuis l'accueil", nil)
                        }
                    }
                },
                onCancel: { showWebLogin = false }
            )
        }
        .onChange(of: store.twitchToken) { token in
            // Déconnexion (sur un 401 aussi) ou autre compte : l'erreur de
            // l'ancien jeton ne reste pas à la place de l'invitation.
            errorFollowed = nil
            if token == nil { followedStreams = []; topStreams = [] }
            Task { await loadAll() }
        }
        // Chaîne suivie ou retirée sur Twitch (page d'une chaîne, chat) : les
        // suivis sont relus, un instant après, le temps que Helix en tienne
        // compte. Sans cela, elle n'apparaissait qu'au prochain rafraîchissement.
        .onReceive(NotificationCenter.default.publisher(for: .twitchFollowsChanged)) { _ in
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                await loadFollowedStreams()
                await loadLocalFollows()
            }
        }
        // Langue du top changée dans les réglages : on recharge tout de suite.
        .onChange(of: store.topLang) { _ in
            topLang = .local
            topStreams = []
            Task { await loadTopStreams(.local) }
        }
        // Chaîne ou catégorie masquée : le top se filtre tout seul ; il ne
        // reste qu'à le compléter s'il devient trop court.
        .onChange(of: store.hidden) { _ in Task { await refillTopIfNeeded() } }
        .sheet(isPresented: $showHidden) {
            HiddenContentSheet().environmentObject(store)
        }
    }

    // MARK: – Clips of followed channels
    /// Every clip of the last 24 hours of every followed channel, as the "24 Std." filter of a
    /// channel's clips shows them. A channel's page holds up to 100 (Twitch's first page).
    private func followedClips() async -> [String: [ClipData]] {
        var seen = Set<String>()
        let logins = (allFollowedLive.map { $0.userLogin.lowercased() } + twitchFollowLogins
                      + store.localFollows.map { $0.lowercased() })
            .filter { seen.insert($0).inserted }
        var byLogin: [String: [ClipData]] = [:]
        // A few at a time: hundreds of followed channels at once would flood the connection.
        for chunk in stride(from: 0, to: logins.count, by: 8).map({ Array(logins[$0..<min($0 + 8, logins.count)]) }) {
            await withTaskGroup(of: (String, [ClipData]).self) { group in
                for login in chunk {
                    group.addTask {
                        (login, (await getClipsPage(login: login, period: "LAST_DAY", after: nil))?.clips ?? [])
                    }
                }
                for await (login, list) in group where !list.isEmpty { byLogin[login] = list }
            }
        }
        return byLogin
    }

    /// All channels mixed, newest first.
    private func mixedClips(_ byLogin: [String: [ClipData]]) -> [ClipData] {
        var ids = Set<String>()
        return byLogin.values.joined().filter { ids.insert($0.id).inserted }
            .sorted { $0.createdAt > $1.createdAt }
    }

    /// One channel picked: its clips of the last 24 hours, newest first.
    private func pickClipChannel(_ login: String?) {
        clipChannel = login
        channelClips = login.map { (clipsByLogin[$0] ?? []).sorted { $0.createdAt > $1.createdAt } } ?? []
    }

    /// Display name of a followed login (live or offline list), else the login.
    private func channelName(_ login: String) -> String {
        allFollowedLive.first { $0.userLogin.lowercased() == login }?.userName
            ?? offlineChannels.first { $0.login.lowercased() == login }?.name
            ?? login
    }

    // MARK: – Accueil (avec ou sans compte)
    /// Suivis du compte Twitch et de cet appareil, sans doublon, mêlés et
    /// triés par audience comme sur Twitch (pas relégués en bas) ; les
    /// streamers épinglés passent devant, dans l'ordre d'épinglage.
    private var allFollowedLive: [TwitchStream] {
        let known = Set(followedStreams.map { $0.userLogin.lowercased() })
        let ranks = pinRanks()
        return (followedStreams + localLive.filter { !known.contains($0.userLogin.lowercased()) })
            .sorted { a, b in
                pinnedFirst(a.userLogin, b.userLogin, ranks) ?? (a.viewerCount > b.viewerCount)
            }
    }

    /// Pin rank per login, built once per sort so the comparator does an O(1)
    /// lookup instead of a linear `pinRank` search. Same result as
    /// `store.pinRank` (first occurrence wins).
    private func pinRanks() -> [String: Int] {
        var ranks: [String: Int] = [:]
        for (i, login) in store.pinnedStreamers.enumerated() where ranks[login] == nil {
            ranks[login] = i
        }
        return ranks
    }

    /// Ordre imposé par l'épinglage (nil : aucun des deux n'est épinglé).
    private func pinnedFirst(_ a: String, _ b: String, _ ranks: [String: Int]) -> Bool? {
        switch (ranks[a.lowercased()], ranks[b.lowercased()]) {
        case let (x?, y?): return x < y
        case (.some, nil): return true
        case (nil, .some): return false
        case (nil, nil): return nil
        }
    }

    /// Hors ligne : les épinglés d'abord, puis par nom.
    private var sortedOffline: [ChannelBrief] {
        let ranks = pinRanks()
        return offlineChannels.sorted { a, b in
            pinnedFirst(a.login, b.login, ranks)
                ?? (a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending)
        }
    }

    /// Grille de cartes ou liste, selon le réglage. `pinnable` : chaînes
    /// suivies, qu'on peut épingler en tête (appui long). `hideable` : top,
    /// où l'appui long propose de masquer la chaîne ou sa catégorie.
    @ViewBuilder private func streamsBlock(_ streams: [TwitchStream], pinnable: Bool = false,
                                           hideable: Bool = false) -> some View {
        if store.homeListLayout {
            LazyVStack(spacing: TSpace.md) {
                ForEach(streams) { stream in
                    StreamRowView(stream: stream, pinnable: pinnable, hideable: hideable) { onPlayStream(stream.userLogin) }
                }
            }
            .padding(.horizontal, TSpace.lg)
        } else {
            LazyVGrid(columns: columns, spacing: TSpace.md) {
                ForEach(streams) { stream in
                    StreamCardView(stream: stream, pinnable: pinnable, hideable: hideable) { onPlayStream(stream.userLogin) }
                }
            }
            .padding(.horizontal, TSpace.lg)
        }
    }

    /// Sans compte : invitation compacte (le reste de l'accueil marche sans).
    @ViewBuilder private var loginCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.title)
                .foregroundColor(.tPrimary)
            VStack(alignment: .leading, spacing: 6) {
                // Jeton refusé par Twitch (401) : on dit pourquoi on a été
                // déconnecté, même après un passage par un autre onglet.
                Text(store.t(store.oauthExpired ? "session_expired" : "login_prompt"))
                    .font(.tCardTitle).foregroundColor(.tText)
                Text(store.t("login_optional_msg"))
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button { showWebLogin = true } label: {
                    Text(store.t("btn_login_twitch"))
                }
                .tProminentStyle()
                .tCapsuleShape()
                .tint(.tPrimary)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Color.tCard)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: – Bandeau session web
    @ViewBuilder private var webSessionBanner: some View {
        let expired = store.webSessionExpired
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [Color.tPrimary, Color.tPurple],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 38, height: 38)
                Image(systemName: expired ? "exclamationmark.triangle.fill" : "sparkles")
                    .font(.callout.weight(.bold))
                    .foregroundColor(.white)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(store.t(expired ? "web_expired" : "web_banner_title"))
                    .font(.tCardTitle).foregroundColor(.tText)
                Text(store.t("web_banner_msg"))
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button { showWebLogin = true } label: {
                    Text(store.t(expired ? "web_reconnect" : "web_banner_btn"))
                }
                .tProminentStyle()
                .tCapsuleShape()
                .tint(.tPrimary)
                .padding(.top, 2)
            }
            Spacer(minLength: 0)
            // ✕ : masqué une semaine, puis il revient (la session reste utile).
            Button {
                withAnimation { webBannerHiddenUntil = Date().timeIntervalSince1970 + 7 * 86400 }
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.tMuted)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(Color.tCard)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(Color.tPrimary.opacity(0.3), lineWidth: 1))
    }

    private var dropsLinkKey: String { drops.linksNeeded.map(\.id).sorted().joined(separator: "|") }

    private var dropsLinkBanner: some View {
        let links = drops.linksNeeded
        let games = links.flatMap(\.games)
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: "link.circle.fill")
                .font(.title).foregroundColor(.tWarning)
            VStack(alignment: .leading, spacing: 6) {
                Text(links.count == 1 ? store.t("drops_link_banner_one")
                     : store.t("drops_link_banner").replacingOccurrences(of: "{n}", with: "\(links.count)"))
                    .font(.tCardTitle).foregroundColor(.tText)
                Text(store.t("drops_link_banner_sub")
                        .replacingOccurrences(of: "{g}", with: games.joined(separator: ", ")))
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button(store.t("drops_link_all")) { showDropsLinks = true }
                    .tProminentStyle().tCapsuleShape().tint(.tPrimary)
                    .padding(.top, 2)
            }
            Spacer(minLength: 0)
            Button {
                withAnimation { dropsLinkHidden = dropsLinkKey }
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold)).foregroundColor(.tMuted)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(Color.tCard)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: – Lives
    @ViewBuilder private var liveSection: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: TSpace.lg) {

                // ── Pas de compte : invitation compacte ──────────────
                if store.twitchToken == nil {
                    loginCard
                        .padding(.horizontal, TSpace.lg)
                        .padding(.top, TSpace.md)
                }

                // ── Session web absente : points, coffres, prédictions ──
                if store.twitchToken != nil && store.twitchWebToken == nil && Date().timeIntervalSince1970 > webBannerHiddenUntil {
                    webSessionBanner
                        .padding(.horizontal, TSpace.lg)
                        .padding(.top, TSpace.md)
                }

                // ── Game accounts to link for drops: asked once, right after login ──
                if store.twitchWebToken != nil, !dropsLinkKey.isEmpty, dropsLinkKey != dropsLinkHidden {
                    dropsLinkBanner
                        .padding(.horizontal, TSpace.lg)
                        .padding(.top, TSpace.md)
                }

                // ── Shelves, as in Apple's TV app: everything at a glance, "Alle"
                // opens the full list (grid/list, paging, hiding). ──
                liveShelf
                continueWatching
                clipsShelf
                topShelf
                offlineShelf

                Spacer(minLength: 40)
            }
        }
        // Tâche détachée : tirer pour rafraîchir annule sa propre tâche dès que
        // la vue se redessine, et la requête annulée vidait les suivis locaux.
        .refreshable { await Task { await loadAll(isRefresh: true) }.value }
        // Clips of the followed channels, once they are known (outside the lazy stack: a view of
        // zero height in it never ran its task).
        .task(id: followsLoaded) {
            guard followsLoaded, !shelfClipsLoaded else { return }
            shelfClipsLoaded = true
            clipsByLogin = await followedClips()
            shelfClips = mixedClips(clipsByLogin)
        }
        .navigationDestination(isPresented: Binding(get: { detail != nil },
                                                    set: { if !$0 { detail = nil } })) {
            detailPage
        }
    }

    // MARK: – Regale
    @ViewBuilder private var liveShelf: some View {
        let followed = allFollowedLive
        if followed.isEmpty {
            // Nothing followed yet: the login card above says it all. Otherwise one quiet line
            // (the full states stay behind "Alle").
            if store.twitchToken != nil || !store.localFollows.isEmpty {
                VStack(alignment: .leading, spacing: TSpace.xs) {
                    TSectionHeader(store.t("home_live_now"), icon: "dot.radiowaves.left.and.right")
                    Group {
                        if (loadingFollowed || !followsLoaded) && offlineChannels.isEmpty {
                            ProgressView()
                        } else {
                            Text(store.t(followsFailed || errorFollowed != nil ? "err_loading" : "no_followed_live"))
                        }
                    }
                    .font(.subheadline)
                    .foregroundColor(.tMuted)
                    .padding(.horizontal, TSpace.lg)
                }
            }
        } else {
            TShelf(title: "\(store.t("home_live_now")) · \(store.t("home_followed"))",
                   onSeeAll: { detail = .followed }) {
                ForEach(followed) { stream in
                    StreamCardView(stream: stream, pinnable: true) { onPlayStream(stream.userLogin) }
                        .frame(width: 300)
                }
            }
        }
    }

    @ViewBuilder private var clipsShelf: some View {
        // The clip feed needs iOS 17.
        if #available(iOS 17.0, *), !shelfClips.isEmpty {
            let clips = clipChannel == nil ? shelfClips : channelClips
            TShelf(title: store.t("home_clips")) {
                // One channel or all mixed, in a menu by the title (like Top-Streams' language).
                Menu {
                    Picker("", selection: Binding(get: { clipChannel }, set: { pickClipChannel($0) })) {
                        Text(store.t("clips_all_channels")).tag(String?.none)
                        ForEach(clipsByLogin.keys.sorted { channelName($0).localizedCaseInsensitiveCompare(channelName($1)) == .orderedAscending },
                                id: \.self) { login in
                            Text(channelName(login)).tag(String?.some(login))
                        }
                    }
                } label: {
                    HStack(spacing: 2) {
                        Text(clipChannel.map(channelName) ?? store.t("clips_all_channels"))
                            .lineLimit(1)
                        Image(systemName: "chevron.down").imageScale(.small)
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.tMuted)
                }
            } content: {
                if clips.isEmpty {
                    Text(store.t("no_clips"))
                        .font(.subheadline).foregroundColor(.tMuted)
                } else {
                    ForEach(Array(clips.enumerated()), id: \.element.id) { index, clip in
                        ShelfClipCard(clip: clip) {
                            onOpenClipFeed(ClipFeedItem(clips: clips, start: index))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var topShelf: some View {
        let top = HiddenContent.fill(top: topStreams, keep: store.showsStream, limit: 20)
        if loadingTop && topStreams.isEmpty {
            TLoader()
        } else if !top.streams.isEmpty {
            TShelf(title: store.t("top_streams"), onSeeAll: { detail = .top }) {
                // Language in a menu by the title, instead of two chips.
                Menu {
                    Picker("", selection: Binding(get: { topLang }, set: { lang in
                        topLang = lang
                        Task { await loadTopStreams(lang) }
                    })) {
                        Text(TopLanguage.name(TopLanguage.resolved(store.topLang), in: store.lang)).tag(TopLang.local)
                        Text(store.t("top_world")).tag(TopLang.all)
                    }
                } label: {
                    HStack(spacing: 2) {
                        Text(topLang == .local ? TopLanguage.name(TopLanguage.resolved(store.topLang), in: store.lang)
                                               : store.t("top_world"))
                        Image(systemName: "chevron.down").imageScale(.small)
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.tMuted)
                }
            } content: {
                ForEach(top.streams) { stream in
                    StreamCardView(stream: stream, hideable: true) { onPlayStream(stream.userLogin) }
                        .frame(width: 240)
                }
            }
        }
    }

    @ViewBuilder private var offlineShelf: some View {
        if !offlineChannels.isEmpty {
            TShelf(title: "\(store.t("offline_channels")) · \(offlineChannels.count)",
                   onSeeAll: { detail = .offline }) {
                ForEach(sortedOffline) { ch in
                    Button { store.openChannelPage(ch.login) } label: {
                        VStack(spacing: TSpace.xs) {
                            AsyncImage(url: URL(string: ch.avatar)) { img in
                                img.resizable().scaledToFill()
                            } placeholder: {
                                Circle().fill(Color.tSurface)
                            }
                            .frame(width: 64, height: 64)
                            .clipShape(Circle())
                            Text(ch.name)
                                .font(.caption)
                                .foregroundColor(.tText)
                                .lineLimit(1)
                        }
                        .frame(width: 72)
                    }
                    .buttonStyle(.plain)
                    .contextMenu { PinStreamerMenuButton(login: ch.login) }
                }
            }
        }
    }

    /// The former tabs, behind "Alle".
    @ViewBuilder private var detailPage: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: TSpace.lg) {
                switch detail {
                case .top:     topTab
                case .offline: offlineTab
                default:       followedTab
                }
                Spacer(minLength: 40)
            }
            .padding(.top, TSpace.sm)
        }
        .refreshable { await Task { await loadAll(isRefresh: true) }.value }
        .background(Color.tDark)
        .navigationTitle(detail == .top ? store.t("top_streams")
                         : detail == .offline ? store.t("offline_channels") : store.t("home_followed"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if detail != .offline {
                // Grille ou liste, au choix (aussi dans Réglages → Général).
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { store.homeListLayout.toggle() }
                    } label: {
                        Image(systemName: store.homeListLayout ? "square.grid.2x2" : "list.bullet")
                    }
                    .accessibilityLabel(store.t(store.homeListLayout ? "layout_grid" : "layout_list"))
                }
            }
        }
    }

    // MARK: – Onglet « Suivies » (en direct seulement)
    @ViewBuilder private var followedTab: some View {
        let followed = allFollowedLive
        if store.twitchToken == nil && store.localFollows.isEmpty && followed.isEmpty {
            // Rien à lire : l'invitation tout de suite, sans chargeur.
            TEmptyState(icon: "heart",
                        title: store.t("local_follow_empty"),
                        message: store.t("local_follow_empty_msg"))
        } else if (loadingFollowed || !followsLoaded) && followed.isEmpty && offlineChannels.isEmpty {
            // Suivis (du compte ou de l'appareil) pas encore lus : sans
            // compte, « aucune chaîne en direct » s'affichait le temps de la
            // lecture, puis la chaîne apparaissait.
            TLoader()
        } else if let err = errorFollowed, followed.isEmpty, offlineChannels.isEmpty {
            TEmptyState(icon: "exclamationmark.triangle", title: err)
        } else if !followed.isEmpty {
            streamsBlock(followed, pinnable: true)
        } else if followsFailed {
            // Lecture des suivis ratée, rien d'affiché : ce n'est pas
            // « personne en direct ».
            TEmptyState(icon: "exclamationmark.triangle", title: store.t("err_loading"))
        } else if !offlineChannels.isEmpty {
            // Personne en live : un pas vers l'onglet des chaînes hors ligne.
            TEmptyState(icon: "moon.zzz",
                        title: store.t("no_followed_live"),
                        message: store.t("no_followed_live_msg"),
                        actionTitle: "\(store.t("see_offline")) · \(offlineChannels.count)") { detail = .offline }
        } else {
            TEmptyState(icon: "moon.zzz",
                        title: store.t("no_followed_live"),
                        message: store.t("no_followed_live_msg"))
        }
    }

    // MARK: – Ansehen fortsetzen
    /// Started VODs from the history, newest first, as on Twitch's Home.
    /// ponytail: "started" = over a minute watched; finished ones stay until
    /// the history drops them (hiding them needs every VOD's duration first).
    @ViewBuilder private var continueWatching: some View {
        let items = Array(store.history
            .filter { $0.type == .vod && store.getVodProgress($0.term) > 60 }
            .prefix(10))
        if !items.isEmpty {
            TSectionHeader(store.t("continue_watching"), icon: "play.circle") { EmptyView() }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: TSpace.md) {
                    ForEach(items) { item in
                        ResumeVodCard(item: item) {
                            onPlayVod(item.term, item.display, item.thumb, item.streamer)
                        }
                    }
                }
                .padding(.horizontal, TSpace.lg)
            }
        }
    }

    // MARK: – Onglet « Hors ligne »
    /// Chaînes suivies hors ligne : accès direct à leur page (VODs, clips,
    /// diffusions supprimées) sans chercher.
    @ViewBuilder private var offlineTab: some View {
        if !offlineChannels.isEmpty {
            TSectionHeader("\(store.t("offline_channels")) · \(offlineChannels.count)", icon: "moon.fill")
            LazyVStack(spacing: 2) {
                ForEach(sortedOffline) { offlineRow($0) }
            }
            .padding(.horizontal, TSpace.lg)
        } else if !followsLoaded {
            TLoader()
        } else if followsFailed {
            TEmptyState(icon: "exclamationmark.triangle", title: store.t("err_loading"))
        } else if !followedStreams.isEmpty || !localLive.isEmpty {
            // Same test as `!allFollowedLive.isEmpty`, without merging and sorting.
            TEmptyState(icon: "dot.radiowaves.left.and.right", title: store.t("offline_all_live"))
        } else {
            TEmptyState(icon: "heart",
                        title: store.t("local_follow_empty"),
                        message: store.t("local_follow_empty_msg"))
        }
    }

    @ViewBuilder private func offlineRow(_ ch: ChannelBrief) -> some View {
        Button { store.openChannelPage(ch.login) } label: {
            HStack(spacing: TSpace.md) {
                AsyncImage(url: URL(string: ch.avatar)) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Circle().fill(Color.tSurface)
                }
                .frame(width: 36, height: 36)
                .clipShape(Circle())
                .opacity(0.75)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        if store.isPinned(ch.login) { PinnedMark() }
                        Text(ch.name)
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.tText)
                            .lineLimit(1)
                    }
                    if let end = ch.lastEnd {
                        let label = offlineLabel(since: end, store: store)
                        if !label.isEmpty {
                            Text(label)
                                .font(.caption)
                                .foregroundColor(.tMuted)
                                .lineLimit(1)
                        }
                    }
                }
                if store.isLocallyFollowed(ch.login) && !twitchFollowLogins.contains(ch.login) {
                    Image(systemName: "iphone")
                        .font(.caption2)
                        .foregroundColor(.tMuted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.tMuted)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu { PinStreamerMenuButton(login: ch.login) }
    }

    // MARK: – Onglet « Top »
    @ViewBuilder private var topTab: some View {
        HStack(spacing: TSpace.xs) {
            TChip(title: TopLanguage.name(TopLanguage.resolved(store.topLang), in: store.lang), isOn: topLang == .local) {
                topLang = .local
                Task { await loadTopStreams(.local) }
            }
            TChip(title: store.t("top_world"), isOn: topLang == .all) {
                topLang = .all
                Task { await loadTopStreams(.all) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSpace.lg)

        // Chaînes et catégories masquées écartées, dans l'ordre de Twitch.
        // Avec le compte, 50 au plus (Helix en donne 100 quand il y a des
        // masqués) ; sans, tout ce qui a été chargé, page après page.
        let top = HiddenContent.fill(top: topStreams, keep: store.showsStream,
                                     limit: store.twitchToken == nil ? nil : 50)
        if loadingTop {
            TLoader()
        } else if topStreams.isEmpty {
            TEmptyState(icon: "antenna.radiowaves.left.and.right",
                        title: store.t("no_live"))
        } else {
            if top.streams.isEmpty {
                TEmptyState(icon: "antenna.radiowaves.left.and.right",
                            title: store.t("no_live"))
            } else {
                streamsBlock(top.streams, hideable: true)
            }
            // Visible même si tout est masqué : sinon on croirait à une panne.
            if top.hidden > 0 {
                HiddenFooter(count: top.hidden) { showHidden = true }
            }
            if topNext != nil {
                TLoadMoreButton(busy: loadingMoreTop) { Task { await loadMoreTop() } }
            } else if topRefused {
                TListEndNote(key: "more_unavailable")
            }
        }
    }

    // MARK: – Chargements
    @MainActor private func loadFollowedStreams() async {
        guard let token = store.twitchToken else { return }
        if followedStreams.isEmpty { loadingFollowed = true }
        errorFollowed = nil

        do {
            let currentUserId: String
            if let existingId = store.twitchUserId, !existingId.isEmpty,
               store.twitchLogin != nil, store.twitchAvatar != nil {
                currentUserId = existingId
            } else {
                // Jeton refusé (401) : levé, donc déconnexion plus bas.
                guard let user = try await fetchTwitchUser(token: token) else {
                    errorFollowed = store.t("err_loading")
                    loadingFollowed = false
                    return
                }
                currentUserId      = user.id
                store.twitchUserId = user.id
                store.twitchLogin  = user.login
                store.twitchAvatar = user.profileImageURL   // ← avatar du header
                logger.authLogin(user: user.displayName)
            }
            // Dans les deux cas, et plus seulement au premier chargement du
            // profil : l'identifiant étant désormais gardé entre deux
            // lancements, la relecture n'aurait sinon plus jamais lieu. Sans
            // l'attendre : une relecture ratée se retente à chaque passage,
            // et les lives suivis attendaient sinon son délai (15 s) quand le
            // Worker ne répond pas.
            Task { await store.refreshFromCloudIfStale(userId: currentUserId) }
            followedStreams = try await getFollowedStreams(token: token, userId: currentUserId)
        } catch is CancellationError {
            loadingFollowed = false
            return
        } catch {
            errorFollowed = store.t("err_loading")
            if (error as? URLError)?.code == .userAuthenticationRequired {
                // Jeton refusé : déconnexion ; l'invitation à se reconnecter
                // remplace l'erreur (onChange du jeton).
                store.oauthExpired = true
                store.logout()
            }
        }
        loadingFollowed = false
    }

    /// Lives des chaînes suivies sur cet appareil (sans compte, GQL public).
    /// Suivis de l'appareil en live, et toutes les chaînes suivies hors ligne
    /// (compte Twitch + appareil), en une requête GQL publique.
    @MainActor private func loadLocalFollows() async {
        defer { followsLoaded = true }
        if let token = store.twitchToken, let uid = store.twitchUserId, !uid.isEmpty,
           let logins = await getFollowedLogins(token: token, userId: uid) {
            twitchFollowLogins = logins.map { $0.lowercased() }
        } else if store.twitchToken == nil {
            twitchFollowLogins = []
        }
        store.accountFollowLogins = twitchFollowLogins   // pour l'export
        var seen = Set<String>()
        let all = (twitchFollowLogins + store.localFollows).filter { seen.insert($0).inserted }
        // Échec réseau : on garde les listes affichées au lieu de les vider.
        guard let infos = await getChannelsGQL(logins: all) else {
            followsFailed = offlineChannels.isEmpty
            return
        }
        followsFailed = false
        localLive = infos.compactMap { $0.stream }
        offlineChannels = infos.filter { $0.stream == nil }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    @MainActor private func loadTopStreams(_ l: TopLang, isRefresh: Bool = false) async {
        let lang = l == .local ? TopLanguage.resolved(store.topLang) : nil
        topGen += 1
        let gen = topGen
        if topStreams.isEmpty && !isRefresh { loadingTop = true }
        // Plus de « Charger plus » pendant le rechargement : l'ancienne suite
        // n'est peut-être plus la bonne (autre langue), et la garde
        // `topNext == after` de loadMoreTop écarte une page déjà en route.
        topNext = nil
        topRefused = false
        guard let token = store.twitchToken else {
            // Sans compte : même top, par la requête publique, par pages de
            // 30 ; la suite passe par le Client-ID d'Android (loadMoreTop).
            // Chaque rechargement repart de la 1ʳᵉ page ; en cas d'échec, la
            // liste est gardée, sans suite.
            let page = await getTopStreamsPageGQL(lang: lang, after: nil)
            // Un chargement plus récent est parti : c'est lui qui conclut.
            guard gen == topGen else { return }
            if let page, !page.streams.isEmpty {
                topStreams = page.streams
                topNext = page.next
            }
            loadingTop = false
            await refillTopIfNeeded()
            return
        }
        // Avec le compte : Helix, 50 lives d'un coup (100 s'il y a des
        // masqués, filtrés à l'affichage), sans suite.
        let count = store.hidden.isEmpty ? 50 : 100
        var applied = false
        do {
            let fetched = try await getTopStreams(token: token, lang: lang, count: count)
            guard gen == topGen else { return }
            // Réseau capricieux : on ne vide jamais une liste déjà affichée.
            if !fetched.isEmpty {
                topStreams = fetched
                topFetchCount = count
                applied = true
            }
        } catch is CancellationError {
            if gen == topGen { loadingTop = false }
            return
        } catch {
            guard gen == topGen else { return }
            logger.warn("HELIX", "Top streams indisponible", error.localizedDescription)
            // Helix refuse ou ne répond pas (429, panne ; un jeton refusé
            // déconnecte par les suivis) : le top public plutôt qu'une liste
            // vide, sans suite (« Charger plus » est réservé au top sans compte).
            let page = await getTopStreamsPageGQL(lang: lang, after: nil)
            guard gen == topGen else { return }
            if let page, !page.streams.isEmpty { topStreams = page.streams }
        }
        loadingTop = false
        // Masquage fait pendant un tirage à 50 : on complète tout de suite
        // (une fois : le suivant est à 100 ; rien après un échec).
        if applied && count < 100 { await refillTopIfNeeded() }
    }

    /// Page suivante du top sans compte (30 lives), sans doublon : les lives
    /// bougent d'une page à l'autre. Si Twitch refuse la suite, un message.
    @MainActor private func loadMoreTop() async {
        guard let after = topNext, !loadingMoreTop, store.twitchToken == nil else { return }
        let l = topLang
        let lang = l == .local ? TopLanguage.resolved(store.topLang) : nil
        loadingMoreTop = true
        defer { loadingMoreTop = false }
        let result = await loadMorePages(
            after: .gql(after), current: topStreams, token: nil,
            gql: { cur in
                guard let p = await getTopStreamsPageGQL(lang: lang, after: cur) else { return nil }
                return (p.streams, p.next, p.refused)
            },
            helix: { _, _ in nil })
        // Top rechargé entre-temps (tirage, langue) : il est reparti de la 1ʳᵉ page.
        guard l == topLang, topNext == after else { return }
        topStreams += result.fresh
        if case .gql(let next)? = result.cursor { topNext = next } else { topNext = nil }
        topRefused = result.locked
    }

    /// Des lives du top sont masqués : de quoi le garder plein. Sans compte,
    /// la page suivante du top (Client-ID d'Android, exacte et dans l'ordre
    /// de Twitch) quand il en reste moins de 24 ; avec le compte, Helix à
    /// 100 au lieu de 50, une fois.
    @MainActor private func refillTopIfNeeded() async {
        guard !topStreams.isEmpty, !loadingTop, !store.hidden.isEmpty else { return }
        if store.twitchToken == nil {
            let visible = HiddenContent.fill(top: topStreams, keep: store.showsStream).streams.count
            guard visible < 24, topNext != nil, !loadingMoreTop else { return }
            await loadMoreTop()
        } else if topFetchCount < 100 {
            await loadTopStreams(topLang, isRefresh: true)
        }
    }

    /// Suivis du compte, puis ceux de l'appareil (qui demandent l'identifiant
    /// du compte) et les catégories suivies. Le top part en même temps : il
    /// ne dépend de rien, et l'onglet Top attendait sinon tous les suivis
    /// (jusqu'à 10 pages Helix et autant de requêtes GQL).
    @MainActor private func loadAll(isRefresh: Bool = false) async {
        lastLoad = Date()
        let lang = topLang
        async let top: Void = loadTopStreams(lang, isRefresh: isRefresh)
        await loadFollowedStreams()
        await loadLocalFollows()
        await loadAccountFollowedCategories()
        await top
    }

    /// Catégories suivies sur Twitch (session web), lues dès l'accueil : le
    /// top ne les masque pas et son menu ne propose pas de les masquer, même
    /// avant un passage par l'onglet Catégories. En cas d'échec, la liste
    /// déjà connue est gardée.
    @MainActor private func loadAccountFollowedCategories() async {
        guard let web = store.twitchWebToken,
              let list = await getFollowedCategoriesGQL(webToken: web),
              store.twitchWebToken == web else { return }
        store.accountFollowedCategoryIds = Set(list.map(\.id))
    }
}

/// Upright clip tile for the home shelf; opens the clip feed at this clip.
struct ShelfClipCard: View {
    let clip: ClipData
    let onPress: () -> Void

    var body: some View {
        Button(action: onPress) {
            VStack(alignment: .leading, spacing: TSpace.xs) {
                Color.tSurface
                    .aspectRatio(9 / 16, contentMode: .fit)
                    .overlay {
                        AsyncImage(url: URL(string: clip.thumbnailURL)) { img in
                            img.resizable().scaledToFill()
                        } placeholder: { EmptyView() }
                    }
                    .overlay(alignment: .bottomLeading) {
                        Label(formatViewers(clip.viewCount), systemImage: "eye.fill")
                            .font(.tBadge).foregroundColor(.white)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 4))
                            .padding(TSpace.sm)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: TRadius.control, style: .continuous))
                Text(clip.title)
                    .font(.tMeta).foregroundColor(.tText)
                    .lineLimit(2, reservesSpace: true)
                    .multilineTextAlignment(.leading)
            }
            .frame(width: 130)
            // The filled thumbnail is wider than the tile (16:9 into 9:16); clipShape only clips
            // drawing, so without this the next tile's picture took the taps meant for this one.
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

