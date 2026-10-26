import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Channel page, like a YouTube channel: banner, avatar, name, followers,
//  description ("…mehr"), links, follow; tabs Übersicht / Videos / Clips /
//  Highlights / Playlists with Twitch's content. Pushed on the current tab's
//  stack (back arrow); tapping a stream or video plays it in the player.
// ═══════════════════════════════════════════════════════════════════════════

struct ChannelView: View {
    let login: String
    let onPlayVod:  (String, String?, String?, String?) -> Void
    let onPlayLive: (String) -> Void
    var onPlayClip: (String, String?) -> Void = { _, _ in }
    /// Clip tapped: the loaded list and the tapped index (clip feed).
    var onPlayClipList: (([ClipData], Int) -> Void)? = nil
    /// « Tout lire » d'une playlist : la liste, et le nom de la chaîne.
    var onPlayQueue: ([VodData], String?) -> Void = { _, _ in }
    /// VOD supprimée reconstruite : liens prêts à lire.
    var onRecovered: (RecoveredVod) -> Void = { _ in }

    @EnvironmentObject private var store: AppStore

    private enum Tab: CaseIterable { case overview, videos, clips, highlights, playlists }
    @State private var tab: Tab = .overview
    @State private var showAbout = false
    @State private var showFilter = false

    @State private var filterText   = ""
    @State private var loading      = false
    @State private var errorMsg: String? = nil
    /// Chaîne dont la page n'a pas pu se charger, Twitch n'ayant pas répondu :
    /// « Réessayer » la redemande (rien à refaire pour une chaîne introuvable).
    @State private var retryLogin: String? = nil
    @State private var searchedName = ""

    // Résultats « chaîne »
    @State private var liveData: LiveData? = nil
    /// Début du dernier live (même sans VOD), pour « hors ligne depuis ».
    @State private var lastBroadcastAt: String? = nil
    @State private var avatarURL = ""
    @State private var vods: [VodData] = []
    @State private var vodCursor: String? = nil
    @State private var hasMoreVods  = false
    @State private var isLoadingMore = false
    /// Suite des VODs : Twitch la refuse (message), ou panne réseau (bouton
    /// pour réessayer, le défilement infini ne relance pas seul).
    @State private var vodsRefused   = false
    @State private var vodsMoreFailed = false
    /// Filtre par mot-clé : pages suivantes demandées pour y chercher.
    @State private var searchingOlder = false

    // VODs non listées (supprimées ou masquées) : diffusions récentes connues
    // d'une source externe, sans VOD dans la liste de Twitch. Rangées à leur
    // date parmi les VODs, reconstruites au toucher.
    @StateObject private var recovery = VodRecoveryService()
    @State private var resolvingID: String? = nil   // diffusion en cours de reconstruction
    /// Reconstruction en cours : annulée si on ouvre une autre chaîne ou si
    /// la page se ferme, pour qu'elle n'ouvre pas le lecteur après coup.
    @State private var recoverTask: Task<Void, Never>? = nil
    /// Diffusions dont le CDN ne sert plus les segments.
    @State private var goneIDs: Set<String> = []
    @State private var highlights: [VodData] = []
    @State private var highlightsFor = ""
    @State private var loadingHighlights = false
    @State private var playlists: [PlaylistData] = []
    @State private var playlistsFor = ""
    @State private var loadingPlaylists = false

    // Clips de la chaîne (onglet « Clips »)
    @State private var clips: [ClipData] = []
    @State private var clipPeriod   = "LAST_WEEK"
    @State private var clipsFor     = ""
    @State private var loadingClips = false
    /// Suite des clips : GQL sans compte (Client-ID d'Android), ou Helix avec
    /// le compte si Twitch refuse GQL. nil : pas de suite.
    @State private var clipsCursor: ListCursor? = nil
    /// Twitch refuse la suite sans compte : un message remplace le bouton.
    @State private var clipsLocked  = false
    @State private var loadingMoreClips = false

    // Onglet « À propos » (description, réseaux, panneaux)
    @State private var about: ChannelAbout? = nil
    @State private var aboutFor     = ""
    @State private var loadingAbout = false

    private let columns = [GridItem(.flexible(), alignment: .top),
                           GridItem(.flexible(), alignment: .top)]

    private var channelName: String {
        searchedName.isEmpty ? "" : searchedName
    }

    private var filteredVods: [VodData] {
        let kw = filterText.trimmingCharacters(in: .whitespaces).lowercased()
        guard !kw.isEmpty else { return vods }
        return vods.filter { $0.title.lowercased().contains(kw) }
    }

    /// Entrée de la grille des VODs : une vraie VOD, ou une diffusion dont la
    /// VOD n'est pas listée.
    private enum VodEntry: Identifiable {
        case vod(VodData)
        case unlisted(RecoverableStream)
        var id: String {
            switch self {
            case .vod(let v):      return "v\(v.id)"
            case .unlisted(let s): return "u\(s.streamID)"
            }
        }
    }

    /// Diffusions récentes sans VOD dans la liste de Twitch. Une VOD les
    /// couvre si sa vignette porte leur id de diffusion, ou si elle commence
    /// à la même heure (vignette « en cours de traitement »). Plus ancienne
    /// que la dernière VOD chargée, une diffusion reste de côté tant que la
    /// liste n'est pas complète : sa VOD est peut-être à la page suivante.
    private var unlistedStreams: [RecoverableStream] {
        guard !channelName.isEmpty, recovery.channel == channelName.lowercased() else { return [] }
        let window: TimeInterval = 15 * 60
        var dated: [(vod: VodData, date: Date)] = []
        for v in vods {
            if let d = Self.vodDate(v.publishedAt) { dated.append((vod: v, date: d)) }
        }
        // Liste incomplète : suite à charger, en panne, ou refusée par Twitch.
        let oldest = vodCursor != nil || vodsRefused ? dated.map { $0.date }.min() : nil
        // Le direct en cours a sa propre page : pas une VOD perdue.
        let liveStart = liveData?.error == nil ? liveData?.startedAt : nil
        return recovery.streams.filter { s in
            if dated.contains(where: { $0.vod.previewThumbnailURL.contains("_\(s.streamID)_")
                                       || abs($0.date.timeIntervalSince(s.startedAt)) < window }) { return false }
            if let liveStart, abs(liveStart.timeIntervalSince(s.startedAt)) < window { return false }
            if let oldest, s.startedAt < oldest.addingTimeInterval(-window) { return false }
            return true
        }
    }

    // Same parsing as parseTwitchDate, with reused formatters: the VOD grid
    // parsed every VOD date (two new formatters each) on every render.
    private static let isoFractional: ISO8601DateFormatter = {
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return df
    }()
    private static let isoPlain = ISO8601DateFormatter()
    private static func vodDate(_ s: String) -> Date? {
        isoFractional.date(from: s) ?? isoPlain.date(from: s)
    }

    /// VODs et diffusions non listées, de la plus récente à la plus ancienne,
    /// filtrées par le mot-clé. `unlisted` : `unlistedStreams`, computed once
    /// per render by the caller.
    private func vodEntries(unlisted: [RecoverableStream]) -> [VodEntry] {
        let kw = filterText.trimmingCharacters(in: .whitespaces).lowercased()
        let extra = unlisted.filter { kw.isEmpty || $0.title.lowercased().contains(kw) }
        guard !extra.isEmpty else { return filteredVods.map { VodEntry.vod($0) } }
        var items: [(date: Date, entry: VodEntry)] = []
        for v in filteredVods {
            items.append((date: Self.vodDate(v.publishedAt) ?? .distantPast, entry: .vod(v)))
        }
        for s in extra {
            items.append((date: s.startedAt, entry: .unlisted(s)))
        }
        return items.sorted { $0.date > $1.date }.map { $0.entry }
    }

    private var offlineSinceText: String? {
        guard liveData?.error != nil else { return nil }
        // La dernière VOD, ou le dernier live s'il est plus récent (un live
        // sans VOD n'en laisse pas) : comme l'accueil, qui disait « 1 j »
        // quand la page disait « 21 j ».
        let first = vods.first
        // Chaîne vide = date illisible : on préfère ne rien dire plutôt
        // qu'afficher « Hors ligne depuis : » suivi de rien.
        guard let end = lastLiveEnd(publishedAt: first?.publishedAt,
                                    lengthSeconds: first?.lengthSeconds ?? 0,
                                    lastStart: lastBroadcastAt) else { return nil }
        let since = offlineLabel(since: end, store: store)
        return since.isEmpty ? nil : since
    }


    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: TSpace.lg) {
                if loading {
                    TLoader().padding(.top, 80)
                } else if let err = errorMsg {
                    TEmptyState(icon: "exclamationmark.triangle", title: err,
                                actionTitle: retryLogin == nil ? nil : store.t("retry"),
                                action: retryAction)
                } else if liveData != nil {
                    header
                    tabBar
                    tabContent
                }
                Spacer(minLength: 40)
            }
        }
        .background(Color.tDark)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Keyword filter of the videos (was a field always shown above them).
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    withAnimation { showFilter.toggle(); if showFilter { tab = .videos } else { filterText = "" } }
                } label: { Image(systemName: showFilter ? "xmark" : "magnifyingglass") }
                .accessibilityLabel(store.t("ph_keyword"))
            }
        }
        .sheet(isPresented: $showAbout) { aboutSheet }
        .task(id: login) {
            await searchChannel(login)
            // Header (banner, followers, description) and the overview's shelves.
            async let a: Void = loadAbout()
            async let c: Void = loadClips()
            async let h: Void = loadHighlights()
            async let p: Void = loadPlaylists()
            _ = await (a, c, h, p)
        }
        .onChange(of: tab) { t in
            if t == .clips { Task { await loadClips() } }
            if t == .highlights { Task { await loadHighlights() } }
            if t == .playlists { Task { await loadPlaylists() } }
        }
        // Page left: a recovery still running does not open the player afterwards.
        .onDisappear {
            recoverTask?.cancel()
            recoverTask = nil
        }
    }

    private var isLive: Bool { liveData?.error == nil }

    // MARK: Header
    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: TSpace.md) {
            if let banner = about?.bannerURL {
                AsyncImage(url: banner) { img in
                    img.resizable().scaledToFill()
                } placeholder: { Color.tSurface }
                .frame(height: 96)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: TRadius.card, style: .continuous))
            }

            HStack(spacing: TSpace.md) {
                AsyncImage(url: URL(string: avatarURL)) { img in
                    img.resizable().scaledToFill()
                } placeholder: { Circle().fill(Color.tSurface) }
                .frame(width: 76, height: 76)
                .clipShape(Circle())
                .overlay(Circle().stroke(isLive ? Color.tLive : .clear, lineWidth: 2.5).padding(-3))

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        Text(channelName).font(.title2.weight(.bold)).foregroundColor(.tText).lineLimit(1)
                        if about?.isPartner == true {
                            Image(systemName: "checkmark.seal.fill").foregroundColor(.tPrimary)
                        }
                    }
                    Text("@\(login)").font(.subheadline).foregroundColor(.tMuted)
                    statusLine
                }
            }

            if let text = about?.description, !text.isEmpty {
                Button { showAbout = true } label: {
                    // Cut by hand: with lineLimit the "…mehr" at the end was cut off too.
                    let flat = text.replacingOccurrences(of: "\n", with: " ")
                    let short = flat.count > 80 ? String(flat.prefix(80)) : flat
                    (Text(short).foregroundColor(.tMuted) + Text(" " + store.t("more")).bold().foregroundColor(.tText))
                        .font(.subheadline)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
            }
            if let socials = about?.socials, let first = socials.first {
                Button { showAbout = true } label: {
                    Label(socials.count > 1
                          ? store.t("links_more").replacingOccurrences(of: "{a}", with: first.title)
                              .replacingOccurrences(of: "{n}", with: "\(socials.count - 1)")
                          : first.title,
                          systemImage: "link")
                        .font(.subheadline.weight(.semibold)).foregroundColor(.tText)
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: TSpace.sm) {
                PlayerFollowButton(login: login, channelId: liveData?.userId)
                if let url = URL(string: "https://www.twitch.tv/\(login)") {
                    ShareLink(item: url) {
                        Label(store.t("share"), systemImage: "square.and.arrow.up")
                            .font(.subheadline.weight(.semibold))
                    }
                    .tBorderedStyle().tCapsuleShape().tint(.secondary)
                }
            }
        }
        .padding(.horizontal, TSpace.lg)
        .padding(.top, TSpace.sm)
    }

    /// "12.821 Follower · ● LIVE" or "· Offline seit 22 h".
    private var statusLine: some View {
        HStack(spacing: 5) {
            if let f = about?.followers {
                Text("\(formatViewers(f)) \(store.t("followers"))")
                Text("·")
            }
            if isLive {
                Circle().fill(Color.tLive).frame(width: 7, height: 7)
                Text(store.t("live_badge")).foregroundColor(.tLive).bold()
            } else if let since = offlineSinceText {
                Text(store.t("offline_since") + since)
            }
        }
        .font(.footnote).foregroundColor(.tMuted).lineLimit(1)
    }

    // MARK: Tabs
    private func title(_ t: Tab) -> String {
        switch t {
        case .overview:   return store.t("overview")
        case .videos:     return store.t("vods")
        case .clips:      return store.t("clips")
        case .highlights: return store.t("highlights")
        case .playlists:  return store.t("playlists")
        }
    }

    /// Underlined tabs, as on YouTube.
    private var tabBar: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSpace.lg) {
                    ForEach(Tab.allCases, id: \.self) { t in
                        Button { withAnimation(.easeInOut(duration: 0.15)) { tab = t } } label: {
                            VStack(spacing: 8) {
                                Text(title(t))
                                    .font(.subheadline.weight(tab == t ? .semibold : .regular))
                                    .foregroundColor(tab == t ? .tText : .tMuted)
                                Capsule().fill(tab == t ? Color.tText : .clear).frame(height: 2.5)
                            }
                            .fixedSize()
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, TSpace.lg)
            }
            Divider().background(Color.tBorder)
        }
    }

    @ViewBuilder private var tabContent: some View {
        switch tab {
        case .overview:   overview
        case .videos:     videosSection
        case .clips:      clipsSection
        case .highlights: highlightsSection
        case .playlists:  playlistsSection
        }
    }

    // MARK: Übersicht
    @ViewBuilder private var overview: some View {
        if isLive, let live = liveData {
            Button { leaveRecovery(); onPlayLive(login) } label: {
                VStack(alignment: .leading, spacing: TSpace.sm) {
                    AsyncImage(url: URL(string: live.thumbnail
                        .replacingOccurrences(of: "{width}", with: "640")
                        .replacingOccurrences(of: "{height}", with: "360"))) { img in
                        img.resizable().scaledToFill()
                    } placeholder: { Color.tSurface }
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay(alignment: .topLeading) { TLiveBadge().padding(TSpace.sm) }
                    .clipShape(RoundedRectangle(cornerRadius: TRadius.card, style: .continuous))
                    Text(live.title).font(.headline).foregroundColor(.tText).lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text([live.viewerCount > 0 ? "\(formatViewers(live.viewerCount)) \(store.t("viewers"))" : nil,
                          live.game.isEmpty ? nil : live.game].compactMap { $0 }.joined(separator: " · "))
                        .font(.footnote).foregroundColor(.tMuted)
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, TSpace.lg)
        } else if let vod = vods.first {
            VodCardView(vod: vod, progress: progress(vod)) { play(vod) }
                .contextMenu { multiMenu(vod) }
                .padding(.horizontal, TSpace.lg)
        }

        // Offline the newest VOD is the big card above: not again in the shelf.
        let featured = isLive ? nil : vods.first.map { "v\($0.id)" }
        let videos = Array(vodEntries(unlisted: unlistedStreams).filter { $0.id != featured }.prefix(12))
        if !videos.isEmpty {
            TShelf(title: store.t("vods"), onSeeAll: { tab = .videos }) {
                ForEach(videos) { entry in entryCard(entry).frame(width: 220) }
            }
        }
        if !clips.isEmpty {
            TShelf(title: store.t("clips"), onSeeAll: { tab = .clips }) {
                ForEach(clips.prefix(12)) { clip in ShelfClipCard(clip: clip) { playClip(clip) } }
            }
        }
        if !highlights.isEmpty {
            TShelf(title: store.t("highlights"), onSeeAll: { tab = .highlights }) {
                ForEach(highlights.prefix(12)) { vod in
                    VodCardView(vod: vod, progress: progress(vod)) { play(vod) }.frame(width: 220)
                }
            }
        }
        if !playlists.isEmpty {
            TShelf(title: store.t("playlists"), onSeeAll: { tab = .playlists }) {
                ForEach(playlists) { list in
                    if let first = list.videos.first {
                        VodCardView(vod: VodData(id: first.id, title: list.title,
                                                 previewThumbnailURL: first.previewThumbnailURL,
                                                 publishedAt: first.publishedAt,
                                                 lengthSeconds: first.lengthSeconds),
                                    progress: 0) { leaveRecovery(); onPlayQueue(list.videos, channelName) }
                            .frame(width: 220)
                    }
                }
            }
        }
        if vods.isEmpty, clips.isEmpty, highlights.isEmpty, !isLive {
            TEmptyState(icon: "film", title: store.t("no_vod"))
        }
    }

    private func progress(_ vod: VodData) -> Double {
        vod.lengthSeconds > 0 ? store.getVodProgress(vod.id) / Double(vod.lengthSeconds) : 0
    }

    private func play(_ vod: VodData) {
        leaveRecovery()
        onPlayVod(vod.id, vod.title, vod.previewThumbnailURL, channelName)
    }

    private func playClip(_ clip: ClipData) {
        leaveRecovery()
        if let onPlayClipList, let i = clips.firstIndex(where: { $0.id == clip.id }) {
            onPlayClipList(clips, i)
        } else {
            onPlayClip(clip.id, clip.title)
        }
    }

    @ViewBuilder private func entryCard(_ entry: VodEntry) -> some View {
        switch entry {
        case .vod(let vod):
            VodCardView(vod: vod, progress: progress(vod)) { play(vod) }
                .contextMenu { multiMenu(vod) }
        case .unlisted(let s):
            UnlistedVodCardView(stream: s, resolving: resolvingID == s.streamID,
                                gone: goneIDs.contains(s.streamID)) {
                // Une seule à la fois : la tâche gardée est celle qui tourne vraiment.
                guard resolvingID == nil else { return }
                recoverTask = Task { await recover(s) }
            }
        }
    }

    // MARK: Videos
    /// One column of large cards (unlisted ones at their date), more on scroll.
    @ViewBuilder private var videosSection: some View {
        if showFilter {
            TSearchField(text: $filterText, placeholder: store.t("ph_keyword"))
                .padding(.horizontal, TSpace.lg)
        }
        let entries = vodEntries(unlisted: unlistedStreams)
        if entries.isEmpty {
            TEmptyState(icon: filterText.isEmpty ? "film" : "line.3.horizontal.decrease.circle",
                        title: store.t(filterText.isEmpty ? "no_vod" : "no_result"))
        } else {
            ForEach(entries) { entry in
                entryCard(entry)
                    .padding(.horizontal, TSpace.lg)
                    .onAppear {
                        // Défilement infini : la suite quand la dernière VOD apparaît.
                        guard case .vod(let vod) = entry, vod.id == filteredVods.last?.id,
                              hasMoreVods, !isLoadingMore, !searchingOlder else { return }
                        isLoadingMore = true
                        Task { await loadMoreVods() }
                    }
            }
        }
        if isLoadingMore || searchingOlder {
            TLoader()
        } else if vodsMoreFailed {
            TLoadMoreButton(busy: false) {
                isLoadingMore = true
                Task { await loadMoreVods() }
            }
        } else if vodsRefused {
            TListEndNote(key: "more_unavailable")
        } else if !filterText.trimmingCharacters(in: .whitespaces).isEmpty, vodCursor != nil {
            // Le filtre ne voit que les VODs chargées : la suite à la demande.
            TLoadMoreButton(busy: false, titleKey: "vods_search_older") {
                Task { await searchOlderVods() }
            }
        }
    }

    // MARK: About sheet
    private var aboutSheet: some View {
        NavigationStack {
            ScrollView {
                if let about {
                    ChannelAboutView(about: about, name: channelName)
                        .padding(TSpace.lg)
                } else {
                    TEmptyState(icon: "info.circle", title: store.t("about_empty"))
                }
            }
            .background(Color.tDark)
            .navigationTitle(channelName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { TCloseButton { showAbout = false } } }
        }
        .presentationDetents([.medium, .large])
    }
    // MARK: – Highlights
    @ViewBuilder private var highlightsSection: some View {
        if loadingHighlights {
            TLoader()
        } else if highlights.isEmpty {
            TEmptyState(icon: "star", title: store.t("no_highlights"))
        } else {
            // One column of large cards, like the videos.
            ForEach(highlights) { vod in
                VodCardView(vod: vod, progress: progress(vod)) { play(vod) }
                    .contextMenu { multiMenu(vod) }
                    .padding(.horizontal, TSpace.lg)
            }
        }
    }

    /// Appui long sur une VOD (ou un temps fort) de la chaîne : le multi-live.
    private func multiMenu(_ vod: VodData) -> some View {
        MultiVodMenuButton(vodId: vod.id, title: vod.title, thumb: vod.previewThumbnailURL,
                           name: channelName, login: channelName)
    }

    @MainActor private func loadHighlights() async {
        let login = searchedName.lowercased()
        guard !login.isEmpty, highlightsFor != login else { return }
        loadingHighlights = true
        let result = await getHighlights(login: login)
        guard login == searchedName.lowercased() else { return }
        highlights = result
        highlightsFor = login
        loadingHighlights = false
    }

    // MARK: – Playlists
    @ViewBuilder private var playlistsSection: some View {
        if loadingPlaylists {
            TLoader()
        } else if playlists.isEmpty {
            TEmptyState(icon: "list.bullet.rectangle", title: store.t("no_playlists"))
        } else {
            VStack(alignment: .leading, spacing: TSpace.lg) {
                ForEach(playlists) { list in
                    VStack(alignment: .leading, spacing: TSpace.sm) {
                        HStack(alignment: .firstTextBaseline, spacing: TSpace.sm) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(list.title)
                                    .font(.callout.weight(.bold)).foregroundColor(.tText)
                                    .lineLimit(2)
                                Text(list.description.isEmpty
                                     ? String(format: store.t("videos_count"), list.total)
                                     : "\(list.description) · \(String(format: store.t("videos_count"), list.total))")
                                    .font(.caption).foregroundColor(.tMuted)
                                    .lineLimit(2)
                            }
                            Spacer(minLength: 0)
                            Button {
                                leaveRecovery()
                                onPlayQueue(list.videos, channelName)
                            } label: {
                                Label(store.t("play_all"), systemImage: "play.fill")
                                    .font(.footnote.weight(.semibold))
                            }
                            .tBorderedStyle()
                            .tCapsuleShape()
                            .controlSize(.small)
                            .tint(.tPrimary)
                        }
                        .padding(.horizontal, TSpace.lg)

                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(alignment: .top, spacing: TSpace.md) {
                                ForEach(list.videos) { vod in
                                    let saved = store.getVodProgress(vod.id)
                                    let progress = vod.lengthSeconds > 0 ? saved / Double(vod.lengthSeconds) : 0
                                    VodCardView(vod: vod, progress: progress) {
                                        leaveRecovery()
                                        onPlayVod(vod.id, vod.title, vod.previewThumbnailURL, channelName)
                                    }
                                    .contextMenu { multiMenu(vod) }
                                    .frame(width: 200)
                                }
                            }
                            .padding(.horizontal, TSpace.lg)
                        }
                    }
                }
            }
        }
    }

    @MainActor private func loadPlaylists() async {
        let login = searchedName.lowercased()
        guard !login.isEmpty, playlistsFor != login else { return }
        loadingPlaylists = true
        let result = await getCollections(login: login)
        guard login == searchedName.lowercased() else { return }
        playlists = result
        playlistsFor = login
        loadingPlaylists = false
    }

    // MARK: – Clips
    @ViewBuilder private var clipsSection: some View {
        VStack(alignment: .leading, spacing: TSpace.md) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach([("LAST_DAY", "period_day"), ("LAST_WEEK", "period_week"),
                             ("LAST_MONTH", "period_month"), ("ALL_TIME", "period_all")], id: \.0) { p in
                        TChip(title: store.t(p.1), isOn: clipPeriod == p.0) {
                            clipPeriod = p.0
                            Task { await loadClips() }
                        }
                    }
                }
                .padding(.horizontal, TSpace.lg)
            }
            if loadingClips {
                TLoader()
            } else if clips.isEmpty {
                TEmptyState(icon: "scissors", title: store.t("no_clips"))
            } else {
                LazyVGrid(columns: columns, spacing: TSpace.md) {
                    ForEach(clips) { clip in
                        ClipCardView(clip: clip) {
                            leaveRecovery()
                            if let onPlayClipList, let i = clips.firstIndex(where: { $0.id == clip.id }) {
                                onPlayClipList(clips, i)
                            } else {
                                onPlayClip(clip.id, clip.title)
                            }
                        }
                    }
                }
                .padding(.horizontal, TSpace.lg)

                // Au-delà des 100 premiers : GQL sans compte ; si Twitch le
                // refuse, Helix avec le compte, sinon un message.
                if clipsCursor != nil {
                    TLoadMoreButton(busy: loadingMoreClips) { Task { await loadMoreClips() } }
                } else if clipsLocked {
                    if store.twitchToken != nil {
                        // Connecté depuis le refus : Helix reprend du début.
                        TLoadMoreButton(busy: loadingMoreClips) {
                            clipsCursor = .helix(nil); clipsLocked = false
                            Task { await loadMoreClips() }
                        }
                    } else {
                        TListEndNote(key: "more_needs_login")
                    }
                }
            }
        }
    }

    @MainActor private func loadClips() async {
        let login = searchedName.lowercased()
        guard !login.isEmpty else { return }
        let key = "\(login)|\(clipPeriod)"
        // Retour sur la période déjà affichée (« 24 h » puis aussitôt
        // « Semaine ») : la demande en route pour l'autre sera écartée, rien
        // ne remettrait le chargeur à faux.
        if clipsFor == key, !clips.isEmpty { loadingClips = false; return }
        loadingClips = true
        let result = await getClipsPage(login: login, period: clipPeriod, after: nil)
        guard key == "\(searchedName.lowercased())|\(clipPeriod)" else { return }
        clips = result?.clips ?? []
        if let next = result?.next {
            clipsCursor = .gql(next)
        } else if result?.more == true, store.twitchToken != nil {
            // Suite annoncée sans curseur GQL : Helix la donne avec le compte.
            clipsCursor = .helix(nil)
        } else {
            clipsCursor = nil
        }
        clipsLocked = false
        clipsFor = key
        loadingClips = false
    }

    /// Clips au-delà des 100 premiers : GQL sans compte (Client-ID
    /// d'Android). Si Twitch le refuse, Helix avec le compte, qui repart du
    /// début (ses 100 premiers recouvrent ceux déjà là) : loadMorePages
    /// enchaîne jusqu'à 3 pages pour trouver du neuf.
    @MainActor private func loadMoreClips() async {
        guard let c = clipsCursor, !loadingMoreClips else { return }
        let key = clipsFor
        let login = searchedName.lowercased()
        let period = clipPeriod
        loadingMoreClips = true
        defer { loadingMoreClips = false }
        var broadcaster = liveData?.userId ?? ""
        let result = await loadMorePages(
            after: c, current: clips, token: store.twitchToken,
            gql: { after in
                guard let p = await getClipsPage(login: login, period: period, after: after) else { return nil }
                return (p.clips, p.next, p.refused)
            },
            helix: { token, after in
                if broadcaster.isEmpty { broadcaster = await getUserIdGQL(login: login) ?? "" }
                guard !broadcaster.isEmpty else { return nil }
                let p = await getClipsHelix(token: token, broadcasterId: broadcaster,
                                            period: period, cursor: after)
                return (p.clips, p.cursor)
            })
        guard key == clipsFor else { return }
        clips += result.fresh
        clipsCursor = result.cursor
        clipsLocked = result.locked
    }

    // MARK: – À propos
    @MainActor private func loadAbout() async {
        let login = searchedName.lowercased()
        guard !login.isEmpty, aboutFor != login else { return }
        loadingAbout = true
        let result = await getChannelAbout(login: login)
        guard login == searchedName.lowercased() else { return }
        about = result
        // Échec réseau : on retentera en revenant sur l'onglet.
        if result != nil { aboutFor = login }
        loadingAbout = false
    }

    // MARK: – VODs non listées (reconstruction)
    /// Reconstruit les liens d'une diffusion non listée, puis la lit. Si le CDN
    /// ne la sert plus, sa carte le dit ; un nouvel essai reste possible.
    @MainActor private func recover(_ s: RecoverableStream) async {
        guard resolvingID == nil else { return }
        let login = searchedName
        resolvingID = s.streamID
        goneIDs.remove(s.streamID)
        let links = await recovery.resolve(s)
        // Abandonnée (autre chaîne ouverte, page quittée) : rien ne s'ouvre,
        // et la carte n'est pas marquée perdue.
        guard !Task.isCancelled, login == searchedName else {
            if resolvingID == s.streamID { resolvingID = nil }
            return
        }
        resolvingID = nil
        recoverTask = nil
        if let links, !links.isEmpty {
            onRecovered(RecoveredVod(
                streamID: s.streamID,
                title: s.title.isEmpty ? s.login : s.title,
                streamer: s.login, links: links))
        } else {
            goneIDs.insert(s.streamID)
        }
    }

    /// Autre lecture lancée d'ici (direct, VOD, playlist, clip) : la
    /// reconstruction en cours est abandonnée. Dans l'onglet Recherche, la
    /// page reste sous le lecteur et rien ne l'annulait : en aboutissant, elle
    /// ouvrait la VOD retrouvée à la place de ce qu'on venait de lancer.
    private func leaveRecovery() {
        recoverTask?.cancel()
        recoverTask = nil
        resolvingID = nil
    }

    /// « Réessayer » sous l'erreur : la page de la même chaîne, redemandée.
    private var retryAction: (() -> Void)? {
        guard let login = retryLogin else { return nil }
        return { Task { await searchChannel(login) } }
    }

    @MainActor private func searchChannel(_ name: String) async {
        // Lien Twitch collé (« twitch.tv/xqc », « https://www.twitch.tv/xqc/clips ») :
        // on en garde la chaîne ; « @xqc » donne xqc (TwitchAPI).
        let login = loginFromInput(name)
        guard !login.isEmpty else { return }

        loading = true; errorMsg = nil; retryLogin = nil; liveData = nil; lastBroadcastAt = nil; vods = []
        filterText = ""; searchedName = login
        tab = .overview; clips = []; clipsFor = ""; loadingClips = false
        clipsLocked = false; clipsCursor = nil; loadingMoreClips = false
        about = nil; aboutFor = ""; loadingAbout = false
        // Reconstruction de la chaîne précédente : abandonnée.
        recoverTask?.cancel(); recoverTask = nil
        resolvingID = nil; goneIDs = []
        playlists = []; playlistsFor = ""; loadingPlaylists = false
        highlights = []; highlightsFor = ""; loadingHighlights = false
        vodCursor = nil; hasMoreVods = false; isLoadingMore = false
        vodsRefused = false; vodsMoreFailed = false; searchingOlder = false

        // Lien vers une page du site (« twitch.tv/settings »), ou saisie qui
        // ne peut pas être un nom de chaîne : inutile de demander à Twitch.
        guard isValidLogin(login) else {
            errorMsg = store.t("not_found")
            searchedName = ""
            loading = false
            return
        }

        // Le bandeau ne demande que les infos de la chaîne : plus de
        // résolution du direct (proxys, jusqu'à une minute par miroir muet),
        // que « Regarder » refait de toute façon.
        async let infoTask   = getChannelInfo(channelName: login)
        async let videosTask = getChannelVideos(channelName: login)
        let (info, ch) = await (infoTask, videosTask)
        let live = info.live

        // Une autre recherche est partie pendant l'attente (ou une VOD a été
        // ouverte) : c'est elle qui conclut ; ces résultats ne s'écrivent pas
        // sous son nom.
        guard login == searchedName else { return }

        avatarURL = live.avatar ?? ch.avatar ?? ""

        if live.error != nil && ch.error != nil && live.avatar == nil {
            // Twitch n'a pas répondu : ce n'est pas « introuvable », et on
            // peut réessayer.
            errorMsg = store.t(live.error == "network" ? "err_loading" : "not_found")
            if live.error == "network" { retryLogin = login }
            searchedName = ""
        } else {
            // Photo gardée dans l'historique, comme le site l'y met.
            store.saveToHistory(HistoryItem(
                term: login, type: .channel, display: login,
                thumb: nil, streamer: nil,
                addedAt: Date().timeIntervalSince1970 * 1000,
                avatar: avatarURL.isEmpty ? nil : avatarURL))
            liveData    = live
            lastBroadcastAt = info.lastStart
            vods        = ch.videos
            vodCursor   = ch.cursor
            hasMoreVods = ch.cursor != nil
            // VODs non listées : en arrière-plan, la grille s'affiche sans attendre.
            Task { await recovery.load(channel: login) }
        }
        loading = false
    }

    /// Suite des VODs (défilement infini) : au-delà des 100 premières, Twitch
    /// ne la donne qu'au Client-ID d'Android (getChannelVideosPage).
    @MainActor private func loadMoreVods() async {
        let login = searchedName.lowercased()
        guard let cursor = vodCursor, !login.isEmpty else {
            isLoadingMore = false; return
        }
        vodsMoreFailed = false
        let ch = await getChannelVideosPage(channelName: login, cursor: cursor)
        // Autre chaîne ouverte pendant l'attente : cette page n'est pas la sienne.
        guard login == searchedName.lowercased() else { return }
        isLoadingMore = false
        if ch.refused {
            // Se connecter n'y changerait rien : pas de secours Helix ici.
            vodCursor = nil; hasMoreVods = false; vodsRefused = true
            return
        }
        if ch.error != nil {
            // Panne réseau : on garde le curseur, un bouton permet de réessayer.
            hasMoreVods = false; vodsMoreFailed = true
            return
        }
        let known = Set(vods.map(\.id))
        let fresh = ch.videos.filter { !known.contains($0.id) }
        vods += fresh
        vodCursor   = ch.cursor
        hasMoreVods = ch.cursor != nil && !fresh.isEmpty
    }

    /// Filtre par mot-clé : il ne voit que les VODs chargées. Page après
    /// page (5 au plus par toucher, soit 500 VODs), jusqu'à ce que la suite
    /// apporte une nouvelle correspondance, s'arrête ou échoue.
    @MainActor private func searchOlderVods() async {
        let login = searchedName.lowercased()
        guard !login.isEmpty, !searchingOlder, !isLoadingMore else { return }
        searchingOlder = true
        defer { searchingOlder = false }
        let before = filteredVods.count
        for _ in 0..<5 {
            guard vodCursor != nil, login == searchedName.lowercased() else { break }
            isLoadingMore = true
            await loadMoreVods()
            guard login == searchedName.lowercased() else { break }
            if filteredVods.count > before || vodsMoreFailed || vodsRefused { break }
        }
    }

}
