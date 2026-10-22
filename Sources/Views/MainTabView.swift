import SwiftUI
import AVFoundation

struct MainTabView: View {
    @EnvironmentObject private var store: AppStore
    @State private var activeTab: TabName = .home

    // ── Player state ─────────────────────────────────────────────────────
    @State private var playerMode: PlayerMode? = nil
    /// Playlist lancée avec « Tout lire » : la VOD suivante démarre à la fin.
    @State private var vodQueue: [VodData] = []
    @State private var vodQueueStreamer: String? = nil
    /// Channel clip list the current clip was opened from: swipes and the
    /// arrows move through it, and the next clip starts when one ends.
    @State private var clipQueue: [ClipData] = []
    /// Channel clips opened as the vertical feed (iOS 17+).
    @State private var clipFeed: ClipFeedItem? = nil
    @State private var qualityLinks: QualityLinks? = nil
    /// Hauteur et cadence de chaque qualité (mêmes clés que `qualityLinks`),
    /// pour la qualité préférée ; vide quand la source ne les donne pas.
    @State private var qualityVariants: [String: VariantInfo] = [:]
    @State private var playerVisible = false
    @State private var loading = false
    @State private var errorMsg: String? = nil
    @State private var statusTitle = ""
    /// Source du direct en cours d'essai (écran de chargement) : elles sont
    /// essayées l'une après l'autre, l'attente peut durer.
    @State private var loadingSource: String? = nil
    /// Une image joue, d'après le lecteur (ni en pause, ni arrêtée ; le
    /// lecteur natif exclut aussi l'audio seul) : voir `keepScreenOn`.
    @State private var playerPlaying = false

    // ── Chat state ───────────────────────────────────────────────────────
    /// Le chat est affiché en permanence sous le lecteur (comme sur Twitch) ;
    /// « chat seul » masque la vidéo et lui laisse tout l'écran.
    @State private var chatOnly = false
    @State private var vodPlaybackTime: Double = 0   // pilote le chat des VODs
    // ── DVR (rembobiner un live) ─────────────────────────────────────────
    @State private var liveDvrVideoId: String? = nil    // VOD en cours du live regardé
    @State private var pendingDvrChannel: String? = nil // passe le relais à startPlayback
    @State private var dvrSourceChannel: String? = nil  // on regarde le DVR de cette chaîne
    @State private var currentChannelName: String? = nil
    @State private var currentChannelId: String? = nil   // ← branché sur data.userId

    // ── Live stats ────────────────────────────────────────────────────────
    @State private var liveViewerCount: Int = 0
    @State private var liveAvatar: String? = nil
    @State private var liveGame: String = ""
    /// Source qui sert le direct en cours (menu du lecteur).
    @State private var liveSourceUsed: String? = nil
    /// Feuille « Télécharger » (VOD en cours).
    @State private var showDownloadSheet = false
    /// Multi-live : la sélection, et la mosaïque ouverte.
    @ObservedObject private var multi = MultiLive.shared
    @State private var showMultiLive = false
    @State private var liveStartedAt: Date? = nil
    @State private var refreshTimer: Timer? = nil

    // ── Débogage / synchro ────────────────────────────────────────────────
    /// Latence mesurée du direct, arrondie à la seconde (affichée).
    @State private var liveLatency: Double = 0
    /// Distance au bord du direct, arrondie à la seconde (synchro auto du chat).
    @State private var liveBehind: Double = 0
    /// Glissé vers le bas du lecteur en cours : décalage suivi au doigt.
    /// Objet gardé en @State sans être observé ici : seul PlayerPullEffect
    /// se redessine pendant le geste (voir PlayerPull.swift).
    @State private var pull = PlayerPull()
    /// Glissé du bandeau du lecteur natif en cours (revient seul à faux,
    /// même si le geste est interrompu).
    @GestureState private var topBarDragging = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // ── Minuteur de veille ────────────────────────────────────────────────
    @ObservedObject private var sleepTimer = SleepTimerService.shared
    @State private var showSleepSheet  = false
    @State private var showSettings    = false
    @State private var showPlayerMenu  = false
    /// Qualité retenue par le lecteur immersif (vide = meilleure disponible).
    @State private var immersiveQuality = ""
    /// Portrait: chat hidden from the player's "⋯" menu, stream info in its place.
    @AppStorage("cfg_chat_hidden") private var chatHidden = false
    /// Landscape (Apple's player): header and timeline float over the video, shown by a tap.
    @State private var landscapeControls = true
    @State private var landscapeHideTask: Task<Void, Never>? = nil
    /// Landscape asked for from the "⋯" menu: undone when the player is reduced or closed,
    /// or the rest of the app would stay sideways with the rotation lock on.
    @State private var forcedLandscape = false
    /// Largeur du chat au début d'un glissement : la translation du geste est
    /// relative à son point de départ, que la vue ne connaît plus une fois
    /// qu'elle a commencé à rétrécir.
    @State private var chatDragStart: Double? = nil
    /// Largeur en cours de glissement. Tant qu'elle vaut nil, c'est le réglage
    /// mémorisé qui s'applique ; pendant le geste, cet état local évite de
    /// toucher à l'AppStore à chaque image (voir `playerBody`).
    @State private var chatDragRatio: Double? = nil
    /// Fermeture du lecteur en cours : le contenu survit le temps du fondu.
    @State private var closingPlayer = false
    /// Bascule entre le direct et son enregistrement, sur la même chaîne.
    /// On garde l'image à l'écran et on n'échange les liens qu'une fois les
    /// nouveaux prêts : vider `qualityLinks` faisait repasser par l'écran noir
    /// « Chargement de la VOD », alors qu'on ne change ni de chaîne ni de
    /// contexte — juste de source.
    @State private var switchingSource = false
    /// Contenu des liens donnés au lecteur (« live:… », « vod:… »), et s'ils
    /// sont ceux d'un direct. Pendant une bascule, `playerMode` désigne déjà
    /// la nouvelle source alors que le lecteur lit encore l'ancienne : une
    /// qualité choisie à ce moment passait pour un changement de source, et
    /// l'arrivée des nouveaux liens pour un simple changement de qualité
    /// (l'enregistrement s'ouvrait à la position du direct, pas à l'instant
    /// visé). Posés en même temps que `qualityLinks`.
    @State private var linksContentID = ""
    @State private var linksAreLive = false
    /// Live joined to its running recording (LiveDVRPlaylist, Apple's player): Apple's bar
    /// spans the whole broadcast, its edge is the real live stream.
    @State private var liveViaRecording = false
    /// Bumped by the header LIVE pill: the player jumps to the live edge.
    @State private var goLiveRequest = 0
    /// Incrémenté à chaque ouverture et fermeture du lecteur : la réponse
    /// d'un chargement dépassé (chaîne A arrivée après la chaîne B, lecteur
    /// déjà fermé) est ignorée au lieu d'écraser l'état ou de relancer les
    /// minuteries du direct sans lecteur.
    @State private var loadGeneration = 0
    /// Page d'une chaîne ouverte en feuille (sans passer par l'onglet Recherche).
    @State private var channelSheet: ChannelSheetItem? = nil
    /// Clip en cours : VOD d'origine et position, pour en rejouer le chat.
    @State private var clipVodId: String? = nil
    @State private var clipOffset: Double = 0
    /// Vitesse du clip en cours : un clip part toujours à 1×, et celle qu'on
    /// y choisit n'est pas retenue pour les VODs.
    @State private var clipSpeed: Double = 1
    /// Chapitres de la VOD en cours (changements de jeu).
    @State private var vodChapters: [VodChapter] = []
    /// Passages de la VOD dont Twitch a coupé le son (et que l'app n'a pas pu
    /// rétablir), et nombre de segments rétablis (VodUnmuteLoader).
    @State private var vodMuted: [MutedRange] = []
    @State private var vodUnmuted = 0

    /// Décalage à appliquer au chat, si la synchro est active : notre retard
    /// sur le bord du direct. Les messages viennent de spectateurs qui
    /// regardent eux-mêmes près de ce bord. La latence totale (horodatage de
    /// Twitch → écran) compte en plus leur propre retard et, surtout, le délai
    /// que certaines chaînes ajoutent à leur diffusion — que ces spectateurs
    /// subissent aussi : le chat arrivait alors 10 s trop tard, ou plus.
    private var chatDelay: Double {
        if liveViaRecording, isLivePlaying {
            // The picture runs `liveLatency` behind real time (its segment dates); the live chat
            // waits that long, minus the few seconds the plain live stream is behind anyway.
            return max(0, liveLatency - 6 + store.chatSyncNudge)
        }
        guard store.autoChatDelay, isLivePlaying else { return 0 }
        // Borne haute : évite un décalage absurde. La retouche manuelle
        // (pastille du chat, réglages) s'ajoute à l'estimation.
        return max(0, min(liveBehind + store.chatSyncNudge, 60))
    }

    /// Infos affichées par-dessus l'image en mode immersif.
    private var overlayInfo: PlayerOverlayInfo {
        PlayerOverlayInfo(
            channel: currentChannelName ?? statusTitle,
            avatar:  liveAvatar,
            title:   isLivePlaying ? statusTitle : "",
            game:    liveGame,
            viewers: liveViewerCount,
            startedAt: liveStartedAt,
            latency: liveLatency > 0 ? liveLatency : nil
        )
    }

    /// Écran verrouillé, centre de contrôle et Live Activity : quoi, de qui, et
    /// une image — l'aperçu du direct, la miniature de la VOD, sinon l'avatar.
    /// Un direct y ajoute sa catégorie, ses spectateurs et son heure de début.
    private var nowPlayingMeta: NowPlayingMeta {
        switch playerMode {
        case .live(let channel)?:
            return NowPlayingMeta(
                title: statusTitle.isEmpty ? channel : statusTitle,
                artist: channel,
                artworkURL: "https://static-cdn.jtvnw.net/previews-ttv/live_user_\(channel.lowercased())-640x360.jpg",
                game: liveGame,
                viewers: liveViewerCount,
                startedAt: liveStartedAt,
                liveLabel: store.t("live_on"))
        case .vod(_, let title, let thumb, let streamer)?:
            return NowPlayingMeta(title: title ?? statusTitle,
                                  artist: streamer ?? currentChannelName ?? "",
                                  artworkURL: thumb ?? liveAvatar,
                                  liveLabel: store.t("live_on"))
        case .clip(_, let title)?:
            return NowPlayingMeta(title: title ?? statusTitle,
                                  artist: currentChannelName ?? "",
                                  artworkURL: liveAvatar,
                                  liveLabel: store.t("live_on"))
        case .recovered(let rec)?:
            return NowPlayingMeta(title: rec.title.isEmpty ? statusTitle : rec.title,
                                  artist: rec.streamer,
                                  artworkURL: liveAvatar,
                                  liveLabel: store.t("live_on"))
        case nil:
            return NowPlayingMeta()
        }
    }

    /// Chaîne de ce qu'on regarde (direct, ou streamer de la VOD) : pour ouvrir
    /// sa page en touchant le pseudo.
    private var playerChannelLogin: String? {
        if let ch = currentChannelName { return ch }
        if case .vod(_, _, _, let streamer)? = playerMode, let s = streamer, !s.isEmpty { return s.lowercased() }
        if case .recovered(let rec)? = playerMode, !rec.streamer.isEmpty { return rec.streamer.lowercased() }
        return nil
    }

    /// Écran gardé allumé : seulement quand une vidéo joue (ou va jouer),
    /// lecteur affiché. Il l'était tant qu'un lecteur existait — en pause,
    /// réduit, en erreur, en audio seul : téléphone posé, jusqu'à vider la
    /// batterie. L'audio seul n'a rien à montrer : l'écran s'éteint comme
    /// d'habitude, le son continue écran verrouillé.
    private var keepScreenOn: Bool {
        guard playerMode != nil, playerVisible, !closingPlayer, !chatOnly,
              errorMsg == nil else { return false }
        if loading { return true }
        guard playerPlaying, let links = qualityLinks else { return false }
        // Le lecteur natif écarte déjà l'audio seul (VideoPlayerView).
        return !(store.immersivePlayer && isAudioQuality(currentQuality(links)))
    }

    /// Trois destinations seulement. « Streamer » et « Lien / ID » ont fusionné
    /// dans Recherche, et les Réglages sont passés derrière l'avatar de l'en-tête.
    enum TabName: String, CaseIterable {
        case home, search, library

        var icon: String {
            switch self {
            case .home:    return "house"
            case .search:  return "magnifyingglass"
            case .library: return "clock.arrow.circlepath"
            }
        }
        func label(_ store: AppStore) -> String {
            switch self {
            case .home:    return store.t("tab_home")
            case .search:  return store.t("tab_search")
            case .library: return store.t("tab_library")
            }
        }
    }

    /// One tab: its own navigation stack with a large title, and the avatar
    /// (settings) at the top right as before.
    private func tabRoot<Content: View>(_ tab: TabName, @ViewBuilder _ content: () -> Content) -> some View {
        NavigationStack {
            content()
                .navigationTitle(tab.label(store))
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        AccountButton { showSettings = true }
                    }
                }
        }
        .tabItem { Label(tab.label(store), systemImage: tab.icon) }
        .tag(tab)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.tDark.ignoresSafeArea()

            // System tab bar and navigation bars: Liquid Glass on iOS 26 for free.
            TabView(selection: $activeTab) {
                // Les fermetures sont explicites : Swift n'applique pas les
                // valeurs par défaut (`soft:`) quand une méthode est passée
                // comme valeur, donc `playLive` vaudrait ici
                // `(String, Bool) -> Void` et ne collerait pas au callback.
                tabRoot(.home) {
                    HomeView(onPlayStream: { playLive($0) },
                             onPlayVod: { playVod($0, $1, $2, $3) },
                             onOpenClipFeed: { openClipFeed($0) })
                }
                tabRoot(.search) {
                    SearchView(onPlayVod: { playVod($0, $1, $2, $3) },
                               onPlayLive: { playLive($0) },
                               onPlayClip: { playClip($0, $1) },
                               onPlayClipList: { playClipQueue($0, $1) },
                               onPlayQueue: { playQueue($0, $1) },
                               onRecovered: { playRecovered($0) })
                }
                tabRoot(.library) {
                    LibraryView(onPlayVod: { playVod($0, $1, $2, $3) },
                                onPlayOffline: { playRecovered($0) })
                }
            }
            .tint(.tPrimary)
            // iOS 26.1+: the mini player docks on the tab bar, as in Apple Music.
            .modifier(TabAccessory(enabled: miniShown) { miniAccessory })
            // Thème changé dans les réglages : les onglets sont reconstruits,
            // pour qu'aucune vue ne garde les anciennes couleurs. Le lecteur et
            // la feuille des réglages, hors de ce bloc, restent en place.
            .id(store.themeID)

            // ── Mini bar ──────────────────────────────────────────────
            // `!closingPlayer` : sans lui, la mini-barre apparaîtrait le temps du
            // fondu de fermeture, le lecteur étant encore en place mais masqué.
            // Aussi pendant un chargement réduit (ou son erreur) : de quoi y
            // revenir.
            if miniShown && !TabAccessory<EmptyView>.available {
                miniBar.zIndex(99)
            }

            // ── Multi-live : directs choisis, prêts à être lancés ─────
            if !multi.entries.isEmpty && !playerVisible && !closingPlayer {
                multiBar.zIndex(98)
            }

            // ── Player overlay ────────────────────────────────────────
            if playerMode != nil {
                playerOverlay
                    // Video and chat stay dark, like any video app, whatever the system setting.
                    .environment(\.colorScheme, .dark)
                    // Home indicator fades out while watching, as in Apple's TV app.
                    .persistentSystemOverlays(playerVisible ? .hidden : .automatic)
                    .onChange(of: playerVisible) { visible in
                        if !visible && forcedLandscape { rotatePlayer(toLandscape: false) }
                    }
                    // Glissé vers le bas : le lecteur suit le doigt.
                    .modifier(PlayerPullEffect(pull: pull))
                    .opacity(playerVisible ? 1 : 0)
                    .allowsHitTesting(playerVisible)
                    .zIndex(100)
                    .transition(.opacity)
            }
        }
        // Menu « ⋯ » du lecteur immersif.
        .sheet(isPresented: $showPlayerMenu) {
            PlayerMenuSheet(
                qualities: sortQualities(Array((qualityLinks ?? [:]).keys), variants: qualityVariants),
                selected: currentQuality(qualityLinks ?? [:]),
                isDvr: dvrSourceChannel != nil,
                onSelectQuality: { q in
                    // Toucher la qualité déjà cochée ne change pas la préférence.
                    selectQuality(q, qualityLinks ?? [:])
                    showPlayerMenu = false
                },
                // Pas sur le direct lui-même ; son rembobinage (enregistrement)
                // l'a, de quoi rattraper le bord.
                speed: isLivePlaying ? nil : playbackSpeed,
                onSelectSpeed: { setPlaybackSpeed($0); showPlayerMenu = false },
                onBackToLive: { showPlayerMenu = false; backToLiveAction?() },
                onSleepTimer: { showPlayerMenu = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                                    showSleepSheet = true } },
                onSettings: { showPlayerMenu = false
                              DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                                  showSettings = true } },
                liveSource: menuLiveSource,
                onSelectSource: { id in
                    showPlayerMenu = false
                    // La source qui sert déjà le direct : rien à relancer. Une
                    // autre le relance par elle, même celle en tête de l'ordre
                    // quand c'est une suivante qui a répondu (la réessayer ne
                    // faisait rien). Lecture par le compte : un choix de source
                    // est respecté — le compte est mis de côté pour cette
                    // chaîne jusqu'au prochain lancement.
                    let fromAccount = liveSourceUsed == "account"
                    guard id != liveSourceUsed else { return }
                    if fromAccount, case .live(let ch)? = playerMode {
                        store.accountPlaybackSkipped.insert(ch.lowercased())
                        logger.info("LECTEUR", "Compte mis de côté pour \(ch)", "source choisie : \(id)")
                    }
                    if id != store.liveSourceOrder.first {
                        logger.settingChanged("Source du direct en tête", value: id)
                        store.preferLiveSource(id)
                    }
                    reloadCurrent()
                },
                onDownload: downloadAction,
                onMultiLive: multiLiveAction,
                multiLiveOn: menuMultiLiveOn,
                multiLiveFull: multi.isFull
            )
            .presentationDetents([.medium])
        }
        // Multi-live : jusqu'à quatre vidéos côte à côte, directs et VODs.
        .fullScreenCover(isPresented: $showMultiLive) {
            MultiLiveView(onWatch: { entry, at in
                showMultiLive = false
                if let id = entry.vodId {
                    // La VOD reprend où en était sa tuile (sinon à la progression
                    // enregistrée) ; playVod tient l'historique.
                    if let at { store.setVodProgress(id, time: at) }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        playVod(id, entry.title, entry.thumb,
                                entry.login.isEmpty ? (entry.name.isEmpty ? nil : entry.name) : entry.login)
                    }
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { playLive(entry.login) }
                }
            })
            // Avis internes : une feuille cache le bandeau de la racine.
            .inAppNoticeHost()
            .environmentObject(store)
        }
        // Télécharger un passage de la VOD en cours (menu ⋯ du lecteur).
        .sheet(isPresented: $showDownloadSheet) {
            if let ctx = downloadContext {
                VodDownloadSheet(context: ctx)
                    .inAppNoticeHost()
                    .environmentObject(store)
                    .presentationDetents([.large])
            }
        }
        // Réglages : ouverts depuis l'avatar de l'en-tête.
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .inAppNoticeHost()
        }
        // Notification « en live » touchée : on ouvre le direct.
        // Page d'une chaîne demandée (pseudo dans le lecteur, accueil…) :
        // ouverte dans une feuille par-dessus l'onglet en cours, sans passer
        // par Recherche ; le lecteur se réduit en mini-barre.
        .onChange(of: store.pendingChannel) { login in
            guard let login else { return }
            store.pendingChannel = nil
            withAnimation(.easeInOut(duration: 0.2)) { playerVisible = false }
            channelSheet = ChannelSheetItem(login: login)
        }
        .sheet(item: $channelSheet) { item in
            NavigationStack {
            SearchView(onPlayVod: { id, t, th, s in channelSheet = nil; playVod(id, t, th, s) },
                       onPlayLive: { l in channelSheet = nil; playLive(l) },
                       onPlayClip: { slug, t in channelSheet = nil; playClip(slug, t) },
                       onPlayClipList: { list, i in
                           // The feed is a full-screen cover: it can only
                           // open once the sheet is gone.
                           channelSheet = nil
                           DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { playClipQueue(list, i) }
                       },
                       onPlayQueue: { list, s in channelSheet = nil; playQueue(list, s) },
                       onRecovered: { rec in channelSheet = nil; playRecovered(rec) },
                       initialChannel: item.login,
                       onClose: { channelSheet = nil })
            }
                .inAppNoticeHost()
                .environmentObject(store)
                .presentationDragIndicator(.visible)
        }
        .onReceive(NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime)) { _ in
            playNextInQueue()
            // A clip from a channel's list: the next one follows (VODs above).
            if case .clip(_, _)? = playerMode { playAdjacentClip(1, keepVisibility: true) }
        }
        // Playlist réécrite par VodUnmuteLoader : passages encore muets (pour
        // la barre de lecture) et nombre de segments rétablis.
        .onReceive(NotificationCenter.default.publisher(for: VodUnmuteLoader.resultNotification)) { note in
            guard let url = note.userInfo?["url"] as? String,
                  let links = qualityLinks,
                  links.values.contains(where: { VodUnmuteLoader.unwrap($0) == url }) else { return }
            if let remaining = note.userInfo?["remaining"] as? [MutedRange] { vodMuted = remaining }
            vodUnmuted = note.userInfo?["restored"] as? Int ?? 0
        }
        // Notification touchée (direct) : ce qui est
        // ouvert ici se ferme d'abord (voir afterClosingPresentations).
        .onReceive(NotificationCenter.default.publisher(for: .openLiveChannel)) { note in
            guard let login = note.userInfo?["login"] as? String, !login.isEmpty else { return }
            afterClosingPresentations { playLive(login) }
        }
        .fullScreenCover(item: $clipFeed) { item in
            if #available(iOS 17.0, *) {
                ClipFeedView(item: item) {
                    // Already slid out by the edge swipe: no slide-down on top.
                    var t = Transaction()
                    t.disablesAnimations = true
                    withTransaction(t) { clipFeed = nil }
                }
                .environmentObject(store)
                // The app shows behind while the edge swipe pulls the feed away.
                .presentationBackground(.clear)
            }
        }
        // Réglage rapide du minuteur depuis le lecteur.
        .sheet(isPresented: $showSleepSheet) {
            SleepTimerSheet()
                .presentationDetents([.medium, .large])
        }
        // Session web : vérifiée une fois au lancement. Sans ça on ne s'aperçoit
        // de son expiration que quand les points cessent de répondre.
        .task { await store.validateWebSession() }
        // Session web changée (déconnexion, expiration, autre compte) pendant
        // un direct lu par le compte (abonné sans pub) : sa liste de lecture
        // est signée pour l'ancienne session, que Twitch continuerait de
        // compter (spectateur, drops) jusqu'à la fermeture. Le direct est
        // relu tout de suite, avec la nouvelle session ou le jeton anonyme,
        // sans bouger le lecteur (réduit, chat seul).
        .onChange(of: store.twitchWebToken) { _ in
            guard case .live(let channel)? = playerMode, dvrSourceChannel == nil,
                  liveSourceUsed == "account", !closingPlayer else { return }
            logger.info("LECTEUR", "Session web changée : direct relu", channel)
            let visible = playerVisible, onlyChat = chatOnly
            playLive(channel, soft: true)
            playerVisible = visible
            chatOnly = onlyChat
        }
        // Minuteur de veille écoulé → on coupe la lecture.
        .onChange(of: sleepTimer.fireCount) { _ in
            guard playerMode != nil else { return }
            logger.info("SLEEP", "Arrêt du lecteur par le minuteur de veille", nil)
            // On s'endort : la musique d'une autre app ne doit pas repartir.
            stopPlayer(wakeOthers: false)
        }
        .onChange(of: keepScreenOn) { ScreenAwake.set("player", $0) }
    }

    /// Feuilles et mosaïque attachées à cet écran : une notification touchée
    /// pendant que l'une d'elles est ouverte lançait le direct dessous (sous
    /// la mosaïque, caché, avec son son en plus des siens) ou rien du tout
    /// (SwiftUI refuse une seconde feuille, « Mes signalements » ne s'ouvrait
    /// pas). Tout se ferme, puis l'action part une fois la fermeture finie.
    private func afterClosingPresentations(_ action: @escaping () -> Void) {
        let open = showSettings || showPlayerMenu || clipFeed != nil
            || showDownloadSheet || showSleepSheet || channelSheet != nil || showMultiLive
        guard open else { action(); return }
        showSettings = false
        showPlayerMenu = false
        clipFeed = nil
        showDownloadSheet = false
        showSleepSheet = false
        channelSheet = nil
        showMultiLive = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { action() }
    }

    // MARK: – Lecteur
    @ViewBuilder
    private var playerOverlay: some View {
        // En paysage, la vidéo et le chat se partagent la largeur : empiler
        // verticalement ne laisserait qu'un timbre-poste à l'image.
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height

            ZStack(alignment: .top) {
                Color.tDark.ignoresSafeArea()
                    // Hauteur du lecteur : seuil du glissé et glissade finale.
                    .onAppear { pull.height = geo.size.height }
                    .onChange(of: geo.size.height) { pull.height = $0 }

                if loading {
                    // Les sources d'un direct sont essayées l'une après
                    // l'autre : on dit laquelle, et on peut réduire le lecteur
                    // ou le fermer sans attendre (un simple rond tournait,
                    // par-dessus tout, sans issue).
                    VStack(spacing: TSpace.md) {
                        ProgressView().tint(.tPrimary).scaleEffect(1.3)
                        Text(store.t(isLivePlaying ? "loading" : "loading_vod"))
                            .font(.tCardTitle).foregroundColor(.tMuted)
                        if let source = loadingSource {
                            Text(store.t("loading_source")
                                    .replacingOccurrences(of: "{s}", with: store.t("src_\(source)")))
                                .font(.tMeta).foregroundColor(.tMuted)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, TSpace.lg)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .overlay(alignment: .top) { loadingBar }

                } else if let err = errorMsg {
                    // Réessayer : une source a pu revenir, le direct a pu
                    // commencer. « Retour » ferme le lecteur, comme avant.
                    VStack(spacing: TSpace.sm) {
                        TEmptyState(icon: "exclamationmark.triangle", title: err,
                                    actionTitle: store.t("retry"), action: { reloadCurrent() })
                        // Recording of a live failed: the live itself still plays.
                        if let backLive = backToLiveAction {
                            Button(store.t("back_to_live_full"), action: backLive)
                                .font(.tLabel)
                                .buttonStyle(.plain)
                        }
                        Button(store.t("back")) { stopPlayer() }
                            .font(.tLabel)
                            .foregroundColor(.tMuted)
                            .buttonStyle(.plain)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                } else if let links = qualityLinks {
                    playerBody(links: links, size: geo.size, landscape: landscape)
                }
            }
            // Bascule direct ↔ enregistrement : une pastille discrète en haut,
            // pas un écran d'attente. L'image précédente continue de jouer
            // dessous jusqu'à ce que la nouvelle source soit prête.
            .overlay(alignment: .top) {
                if switchingSource {
                    HStack(spacing: TSpace.sm) {
                        ProgressView().tint(.white).scaleEffect(0.7)
                        Text(store.t("switching_source"))
                            .font(.tLabel).foregroundColor(.white)
                    }
                    .padding(.horizontal, TSpace.md)
                    .frame(height: 34)
                    .background(Color.black.opacity(0.65))
                    .clipShape(Capsule())
                    .padding(.top, TSpace.lg)
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: switchingSource)
        }
    }

    /// Une seule disposition pour les deux orientations.
    ///
    /// `AnyLayout` échange HStack et VStack **sans changer l'identité des vues** :
    /// avec deux branches `if`, tourner le téléphone détruisait le lecteur, donc
    /// son AVPlayer, et le direct se rechargeait à chaque rotation.
    ///
    /// Les tailles passent toutes par `frame(width:height:)` avec des optionnels
    /// (`nil` = libre) plutôt que par des modificateurs conditionnels, pour la
    /// même raison. En particulier on n'utilise plus `aspectRatio(nil)` en
    /// paysage : le ratio « idéal » y était calculé à partir des contrôles, d'où
    /// l'image réduite en vignette dès qu'on les affichait.
    @ViewBuilder
    private func playerBody(links: QualityLinks, size: CGSize, landscape: Bool) -> some View {
        // Le mode « chat seul » n'a pas de colonne vidéo : il reste empilé.
        let split  = landscape && !chatOnly
        let mode   = store.landscapeChat
        let layout = split ? AnyLayout(HStackLayout(spacing: 0))
                           : AnyLayout(VStackLayout(spacing: 0))
        // Portrait : hauteur 16:9 imposée, le chat prend le reste.
        // Paysage : libre, la colonne donne toute sa hauteur à l'image.
        // Apple's player: the timeline sits under the 16:9 video, outside it.
        let videoHeight: CGFloat? = split ? nil : size.width * 9 / 16
        let videoMaxHeight: CGFloat? = split ? CGFloat.infinity : nil
        // Largeur réglable, mais jamais sous 220 pt : en deçà les messages se
        // hachent en mots isolés, quel que soit le réglage.
        //
        // Pendant un glissement la valeur vient de `chatDragRatio`, un simple
        // @State. Écrire dans le store à chaque image passait par un `didSet`
        // qui enregistre dans UserDefaults — une écriture disque synchrone
        // soixante fois par seconde — et invalidait tout ce qui observe
        // l'AppStore, dont chaque ligne de message du chat. D'où les à-coups.
        let ratio = chatDragRatio ?? store.chatWidthRatio
        let chatWidth: CGFloat? = split ? max(size.width * CGFloat(ratio), 220) : nil
        // Place prise dans la rangée : seule la disposition « colonne » en
        // réclame. Superposé et replié laissent toute la largeur à l'image.
        let chatColumn: CGFloat? = {
            guard split, mode != .column else { return chatWidth }
            return CGFloat(0)
        }()
        let chatVisible = split ? mode != .hidden : !chatHidden
        let overlaying  = split && mode == .overlay
        // Le décor ne tient que dans le chat plein cadre ; la transparence ne
        // sert qu'au calque. Le reste (tailles) vient des réglages.
        let chatStyle = store.chatStyle(chrome: !split, translucent: overlaying)
        // Posé sur l'image, le chat couvre la droite de l'écran. Plutôt que de
        // se disputer les touchers avec les boutons du lecteur, on les écarte :
        // les barres du lecteur se replient de la largeur du chat et restent
        // donc entièrement visibles et cliquables, quelle que soit sa taille.
        let controlsInset: CGFloat = overlaying ? (chatWidth ?? 0) : 0

        layout {
            VStack(spacing: 0) {
                // En immersif, la barre est dessinée par-dessus l'image par le
                // lecteur lui-même : pas de bandeau séparé ici.
                // Landscape with Apple's player: the bar floats over the video instead.
                if (!store.immersivePlayer && !split) || chatOnly {
                    playerTopBar(landscape: split)
                }
                if !chatOnly {
                    videoSurface(links: links, landscape: split,
                                 controlsInset: controlsInset)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .frame(height: videoHeight)
                        .overlay {
                            if split && !store.immersivePlayer {
                                landscapeOverlay(inset: controlsInset)
                            }
                        }
                        // Full height (status bar and home indicator areas); the sides keep
                        // their safe area so the Dynamic Island never covers the picture.
                        .ignoresSafeArea(split ? .all : [], edges: .vertical)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(maxHeight: videoMaxHeight)
            .background(split ? Color.black : Color.clear)

            // Le chat n'est jamais retiré de la hiérarchie : le sortir ferait
            // mourir ChatView, donc couperait la connexion IRC à chaque bascule.
            // Les trois `frame` ne font pas doublon. Le premier fixe la largeur
            // de mise en page des messages (à zéro, chacun se replierait sur une
            // colonne d'un caractère). Le second donne la hauteur. Le troisième
            // fixe la place prise dans la rangée : à zéro et aligné à droite, le
            // contenu déborde vers la gauche — c'est ce qui le pose sur l'image
            // en mode superposé, sans que la vidéo ne rétrécisse.
            //
            // Replié, `opacity` le masque et `allowsHitTesting` coupe les
            // touchers : sans ça on appuyait encore sur un chat invisible, un
            // cadrage nul ne bornant pas les zones tactiles.
            chatPane(style: chatStyle)
                .frame(width: chatWidth)
                .frame(maxHeight: .infinity)
                // Bord du chat : une petite poignée pour régler sa largeur,
                // sans trait au repos (le chat se fond dans l'image).
                .overlay(alignment: .leading) {
                    if split { chatResizeHandle(totalWidth: size.width) }
                }
                .frame(width: chatColumn, alignment: .trailing)
                .opacity(chatVisible ? 1 : 0)
                .allowsHitTesting(chatVisible)
                .overlay { if !split && chatHidden { streamInfo } }
        }
    }

    /// Poignée du bord vidéo / chat, qui se saisit pour régler la largeur.
    ///
    /// Au repos, pas de trait (violet sur l'image, il coupait le chat de la
    /// vidéo) : seule une petite poignée discrète. Le trait n'apparaît que
    /// pendant qu'on tire. Une bande transparente de 28 pt reçoit le geste,
    /// sous peine de viser un fil avec un pouce.
    @ViewBuilder
    private func chatResizeHandle(totalWidth: CGFloat) -> some View {
        let dragging = chatDragRatio != nil
        Rectangle()
            .fill(dragging ? Color.tPrimary : Color.clear)
            .frame(width: dragging ? 2 : 1)
            .overlay {
                // Sans repère, personne ne devine qu'on peut tirer.
                Capsule()
                    .fill(Color.white.opacity(dragging ? 0.95 : 0.22))
                    .frame(width: dragging ? 5 : 3, height: dragging ? 48 : 28)
            }
            .overlay {
                Color.clear
                    .frame(width: 28)
                    .contentShape(Rectangle())
                    .gesture(
                        // Repère global : la poignée suit le bord du chat ;
                        // mesuré dans son propre repère, le déplacement
                        // retombait vers 0 à chaque image (largeur qui oscille,
                        // ou poignée qui reste en place).
                        DragGesture(minimumDistance: 2, coordinateSpace: .global)
                            .onChanged { value in
                                let start = chatDragStart ?? store.chatWidthRatio
                                if chatDragStart == nil { chatDragStart = start }
                                // Tirer vers la gauche élargit le chat.
                                let delta = -value.translation.width / totalWidth
                                chatDragRatio = min(max(start + Double(delta), 0.20), 0.60)
                            }
                            .onEnded { _ in
                                // Une seule écriture dans le store, donc un seul
                                // enregistrement disque, à la fin du geste.
                                if let final = chatDragRatio { store.chatWidthRatio = final }
                                chatDragStart = nil
                                chatDragRatio = nil
                            }
                    )
            }
            .animation(.easeOut(duration: 0.15), value: dragging)
    }

    /// Le chat, quelle que soit la disposition.
    @ViewBuilder
    private func chatPane(style: ChatStyle) -> some View {
        // Bascule douce vers un direct (« Retour au direct » depuis le DVR) :
        // le lecteur reste affiché, le chat attend l'id de la chaîne, qui
        // arrive avec les liens. Créé sans lui, il ne le prenait jamais (il se
        // configure une fois) : ni emotes de la chaîne, ni badges, ni points,
        // ni épinglé, ni raid jusqu'à la réouverture.
        if liveViaRecording, liveLatency > 300, let dvr = liveDvrVideoId {
            // Scrubbed back in the broadcast: the live chat has nothing from then, the replay does.
            VodChatView(videoId: dvr, playbackTime: vodPlaybackTime, style: style)
                .id("rec-\(dvr)")
                .frame(maxHeight: .infinity)

        } else if let channel = currentChannelName, currentChannelId != nil || !switchingSource {
            ChatView(
                channelName: channel,
                channelId: currentChannelId,
                token: store.twitchToken,
                login: store.twitchLogin,
                chatDelay: chatDelay,
                chatOnly: $chatOnly,
                style: style,
                onJoinChannel: { target in   // raid → suit la chaîne raidée
                    // Lecteur réduit : il le reste (on naviguait ailleurs).
                    playLive(target, keepVisibility: true)
                }
            )
            .id(channel)   // changement de chaîne → chat reconstruit à neuf
            .frame(maxHeight: .infinity)

        } else if let vid = currentVodId {
            VodChatView(videoId: vid, playbackTime: vodPlaybackTime, style: style)
                .id(vid)
                .frame(maxHeight: .infinity)

        } else if let cv = clipVodId {
            // Clip : le chat de la VOD d'origine, à l'instant du clip.
            VodChatView(videoId: cv, playbackTime: clipOffset + vodPlaybackTime, style: style)
                .id("clip-\(cv)-\(Int(clipOffset))")
                .frame(maxHeight: .infinity)

        } else if let file = offlineChatFile {
            // VOD téléchargée : le chat gardé avec elle, rejoué sans connexion.
            VodChatView(videoId: file.path, playbackTime: vodPlaybackTime, style: style, offlineFile: file)
                .id(file.path)
                .frame(maxHeight: .infinity)

        } else {
            Spacer()
        }
    }

    /// Surface vidéo : lecteur natif (contrôles Apple) ou immersif (contrôles maison).
    @ViewBuilder
    private func videoSurface(links: QualityLinks, landscape: Bool,
                              controlsInset: CGFloat = 0) -> some View {
        if store.immersivePlayer {
            ImmersivePlayer(
                url: URL(string: links[currentQuality(links)] ?? "") ?? URL(string: "about:blank")!,
                isLive: linksAreLive,
                dvrEnabled: linksAreLive,
                savedTime: currentVodId.map { store.getVodProgress($0) } ?? 0,
                contentID: linksContentID,
                info: overlayInfo,
                onChannel: playerChannelLogin.map { l in { store.openChannelPage(l) } },
                sleepLabel: sleepTimer.isActive ? sleepTimer.label : nil,
                chatMode: store.landscapeChat,
                isLandscape: landscape,
                controlsInset: controlsInset,
                fillScreen: store.fillScreen,
                canReturnToLive: dvrSourceChannel != nil,
                streamStartedAt: liveStartedAt,
                archiveAvailable: liveDvrVideoId != nil,
                chapters: vodChapters,
                mutedRanges: vodMuted,
                unmutedCount: vodUnmuted,
                nowPlaying: nowPlayingMeta,
                speed: playbackSpeed,
                onSpeedChange: { setPlaybackSpeed($0) },
                notice: accountNotice,
                onProgress: { time in
                    // Pendant une bascule, `playerMode` désigne déjà la
                    // nouvelle source alors que le lecteur en place joue encore
                    // l'ancienne. Sa position n'a aucun sens dans la nouvelle
                    // base de temps, et l'enregistrer écrasait précisément
                    // l'instant qu'on venait d'y viser — d'où un retour au
                    // début de l'enregistrement.
                    guard !switchingSource else { return }
                    vodPlaybackTime = time
                    if let id = currentVodId { store.setVodProgress(id, time: time) }
                },
                onLatency: { updateLatency($0) },
                onBehind: { updateBehind($0) },
                onPlaying: { playerPlaying = $0 },
                onPull: { pullPlayer($0) },
                onPullEnd: { endPull($0, predicted: $1) },
                onReduce: { reducePlayer() },
                onClose:  { stopPlayer() },
                onMenu:   { showPlayerMenu = true },
                onRefresh: { reloadCurrent() },
                onToggleChat: { withAnimation { store.landscapeChat = store.landscapeChat.next } },
                onToggleChatVisibility: { withAnimation { store.toggleLandscapeChatVisibility() } },
                onSleep: { showSleepSheet = true },
                onBackToLive: { backToLiveAction?() },
                onSeekToArchive: { offset in
                    // Le flux du direct ne sait pas remonter si loin : on ouvre
                    // l'enregistrement à cet instant. Passer par la progression
                    // enregistrée réutilise le chemin de reprise des VODs.
                    guard let ch = currentChannelName, let dvr = liveDvrVideoId else { return }
                    store.setVodProgress(dvr, time: offset)
                    pendingDvrChannel = ch
                    playVod(dvr, statusTitle, nil, ch, soft: true)
                },
                onPrevClip: prevClipAction,
                onNextClip: nextClipAction
            )
        } else {
            VideoPlayerView(
                qualityLinks: links,
                // Pas de VOD tant que le lecteur lit encore le direct (bascule) :
                // sa position partait comme reprise de l'enregistrement.
                vodId: linksAreLive ? nil : currentVodId,
                isLive: linksAreLive,
                contentID: linksContentID,
                variants: qualityVariants,
                quality: currentQuality(links),
                nowPlaying: nowPlayingMeta,
                speed: playbackSpeed,
                onSpeedChange: { setPlaybackSpeed($0) },
                onTime: { vodPlaybackTime = $0 },
                onLatency: { updateLatency($0) },
                onBehind: { updateBehind($0) },
                onPlaying: { playerPlaying = $0 },
                notice: accountNotice,
                onTap: landscape ? { showLandscapeControls(!landscapeControls) } : nil,
                goLiveRequest: goLiveRequest
            )
        }
    }

    /// Bandeau au-dessus de la vidéo (mode natif) : qui regarde-t-on, et quoi.
    @ViewBuilder
    private func playerTopBar(landscape: Bool) -> some View {
        HStack(spacing: TSpace.sm) {
            TIconButton(icon: "chevron.down", tint: .tText, size: 32) { reducePlayer() }
                .accessibilityLabel(store.t("reduce"))

            if isLivePlaying, let avatar = liveAvatar {
                AsyncImage(url: URL(string: avatar)) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Circle().fill(Color.tSurface)
                }
                .frame(width: 28, height: 28)
                .clipShape(Circle())
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(currentChannelName ?? statusTitle)
                    .font(.tCardTitle).foregroundColor(.tText).lineLimit(1)
                    // Toucher le pseudo : page de la chaîne.
                    .onTapGesture { if let l = playerChannelLogin { store.openChannelPage(l) } }

                HStack(spacing: TSpace.sm) {
                    if isLivePlaying {
                        if let start = liveStartedAt {
                            LiveUptimeLabel(startedAt: start) { uptime in
                                TMeta(icon: "dot.radiowaves.left.and.right",
                                      text: uptime, tint: .tLive)
                            }
                        }
                        if liveViewerCount > 0 {
                            TMeta(icon: "eye.fill", text: formatViewers(liveViewerCount))
                        }
                        if store.showLatency, liveLatency > 0 {
                            TMeta(icon: "waveform.path.ecg",
                                  text: String(format: "%.0f s", liveLatency))
                        }
                    } else {
                        Text(statusTitle).font(.tMeta).foregroundColor(.tMuted).lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Clip from a channel's list: previous / next. Apple's player has
            // no swipe for it, and the immersive one shows the same arrows.
            if clipQueueIndex != nil {
                clipArrowButton(icon: "backward.end.fill", action: prevClipAction)
                clipArrowButton(icon: "forward.end.fill", action: nextClipAction)
            }

            // Minuteur de veille : the remaining time shows while it runs.
            if sleepTimer.isActive {
                Button { showSleepSheet = true } label: {
                    Label(sleepTimer.label, systemImage: "moon.zzz.fill")
                        .font(.caption.weight(.bold).monospacedDigit())
                }
                .tBorderedStyle()
                .tCapsuleShape()
                .controlSize(.small)
                .tint(.tPurple)
            }

            // Live with its past (LiveDVRPlaylist): red while at the live edge, grey once scrubbed
            // back; a tap jumps to the edge. Apple's bar has no place for it on iOS.
            if liveViaRecording {
                // ponytail: "at the edge" = latency under 60 s (the edge sits ~30 s behind); measure
                // the edge's own latency if streams turn out to sit further back.
                let atEdge = liveLatency < 60
                Button { if !atEdge { goLiveRequest += 1 } } label: {
                    Label(store.t("live_badge"), systemImage: "dot.radiowaves.left.and.right")
                        .font(.caption.weight(.bold))
                }
                .modifier(LivePillStyle(live: atEdge))
                .tCapsuleShape()
                .controlSize(.small)
                .tint(atEdge ? .tLive : .secondary)
                .accessibilityLabel(store.t(atEdge ? "live_on" : "back_to_live_full"))
            }
            // Watching a running broadcast's recording: one tap back to live.
            if let backLive = backToLiveAction {
                Button(action: backLive) {
                    Label(store.t("live_badge"), systemImage: "dot.radiowaves.left.and.right")
                        .font(.caption.weight(.bold))
                }
                .tProminentStyle()
                .tCapsuleShape()
                .controlSize(.small)
                .tint(.tLive)
                .accessibilityLabel(store.t("back_to_live_full"))
            }

            playerMoreMenu(landscape: landscape)

            TIconButton(icon: "xmark", size: 32) { stopPlayer() }
                .accessibilityLabel(store.t("close"))
        }
        .padding(.horizontal, TSpace.md)
        .padding(.top, TSpace.sm)
        .padding(.bottom, TSpace.sm)
        .background(landscape ? Color.clear : Color.tCard)
        .overlay(alignment: .bottom) { if !landscape { Divider().background(Color.tBorder) } }
        .contentShape(Rectangle())
        .gesture(topBarPull)
        // Geste interrompu en plein glissé : le lecteur reprend sa place.
        .onChange(of: topBarDragging) { active in
            if !active, playerVisible, pull.y > 0 { pullPlayer(0) }
        }
    }

    /// "⋯" of Apple's player: quality, chat, sleep timer (the controls under the video are gone).
    private func playerMoreMenu(landscape: Bool) -> some View {
        let chatShown = landscape ? store.landscapeChat != .hidden : !chatHidden
        return Menu {
            if let links = qualityLinks, !links.isEmpty {
                Picker(selection: Binding(get: { currentQuality(links) },
                                          set: { selectQuality($0, links) })) {
                    ForEach(sortQualities(Array(links.keys), variants: qualityVariants), id: \.self) {
                        Text(qualityText($0, store.lang)).tag($0)
                    }
                } label: {
                    Label(store.t("quality"), systemImage: "slider.horizontal.3")
                    Text(qualityText(currentQuality(links), store.lang))
                }
                .pickerStyle(.menu)
            }
            if landscape {
                Picker(selection: Binding(get: { store.landscapeChat },
                                          set: { m in withAnimation { store.landscapeChat = m } })) {
                    ForEach(LandscapeChat.allCases, id: \.self) { m in
                        Label(store.t(m.labelKey), systemImage: m.icon).tag(m)
                    }
                } label: {
                    Label("Chat", systemImage: "bubble.left.and.bubble.right")
                    Text(store.t(store.landscapeChat.labelKey))
                }
                .pickerStyle(.menu)
            } else {
                Button {
                    withAnimation { chatHidden.toggle() }
                } label: {
                    Label(store.t(chatShown ? "chat_hide" : "chat_show"),
                          systemImage: chatShown ? "bubble.left.and.text.bubble.right" : "bubble.left.and.bubble.right.fill")
                }
            }
            if let rewind = rewindAction {
                Button(action: rewind) { Label(store.t("rewind"), systemImage: "gobackward") }
            }
            // Also works with the orientation lock on.
            Button { rotatePlayer(toLandscape: !landscape) } label: {
                Label(store.t(landscape ? "rotate_portrait" : "rotate_landscape"),
                      systemImage: landscape ? "rectangle.portrait.rotate" : "rectangle.landscape.rotate")
            }
            Button { showSleepSheet = true } label: {
                Label(store.t("sleep_timer"), systemImage: "moon.zzz")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.tText)
                .frame(width: 32, height: 32)
                .tGlass(in: Circle(), fallback: .tSurface)
        }
        .accessibilityLabel(store.t("player_section"))
    }

    /// Landscape controls over Apple's player: header on top, timeline at the bottom, on dark
    /// gradients. A tap shows or hides them; they fade out by themselves after a few seconds.
    private func landscapeOverlay(inset: CGFloat) -> some View {
        // Shown and hidden by taps on the video (NativeVideoPlayer.onTap, alongside Apple's).
        ZStack {
            if landscapeControls {
                VStack(spacing: 0) {
                    playerTopBar(landscape: true)
                        .background(LinearGradient(colors: [.black.opacity(0.7), .clear],
                                                   startPoint: .top, endPoint: .bottom))
                    Spacer(minLength: 0)
                }
                // Clear of a chat laid over the video.
                .padding(.trailing, inset)
                // Touching the controls keeps them up.
                .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in showLandscapeControls(true) })
                .transition(.opacity)
            }
        }
        .onAppear { showLandscapeControls(true) }
    }

    private func showLandscapeControls(_ show: Bool) {
        landscapeHideTask?.cancel()
        withAnimation(.easeInOut(duration: 0.2)) { landscapeControls = show }
        guard show else { return }
        landscapeHideTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.3)) { landscapeControls = false }
        }
    }

    private func rotatePlayer(toLandscape: Bool) {
        forcedLandscape = toLandscape
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first else { return }
        let target: UIInterfaceOrientationMask = toLandscape ? .landscapeRight : .portrait
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: target)) { error in
            logger.warn("LECTEUR", "Rotation refusée", error.localizedDescription)
        }
        UIViewController.attemptRotationToDeviceOrientation()
    }

    /// Same choice for both players: the preference is only changed when another one is picked.
    private func selectQuality(_ q: String, _ links: QualityLinks) {
        if q != currentQuality(links) {
            store.rememberQualityChoice(q, among: Array(links.keys), variants: qualityVariants)
        }
        immersiveQuality = q
    }

    /// Portrait with the chat hidden: who and what is on, like the info under a YouTube video.
    private var streamInfo: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSpace.md) {
                HStack(spacing: TSpace.md) {
                    AsyncImage(url: URL(string: liveAvatar ?? "")) { img in
                        img.resizable().scaledToFill()
                    } placeholder: {
                        Image(systemName: "person.crop.circle.fill").resizable()
                            .foregroundColor(.tMuted)
                    }
                    .frame(width: 44, height: 44)
                    .clipShape(Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(currentChannelName ?? playerChannelLogin ?? "")
                            .font(.headline).foregroundColor(.tText)
                        HStack(spacing: TSpace.md) {
                            if isLivePlaying, let start = liveStartedAt {
                                LiveUptimeLabel(startedAt: start) { uptime in
                                    TMeta(icon: "dot.radiowaves.left.and.right", text: uptime, tint: .tLive)
                                }
                            }
                            if isLivePlaying, liveViewerCount > 0 {
                                TMeta(icon: "eye.fill", text: formatViewers(liveViewerCount))
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }
                Text(statusTitle)
                    .font(.body).foregroundColor(.tText)
                    .fixedSize(horizontal: false, vertical: true)
                if !liveGame.isEmpty {
                    Text(liveGame)
                        .font(.footnote.weight(.semibold)).foregroundColor(.tText)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Color.tSurface, in: Capsule())
                }
                if let login = playerChannelLogin {
                    Button { store.openChannelPage(login) } label: {
                        Label(store.t("see_channel"), systemImage: "person.crop.square")
                    }
                    .tBorderedStyle()
                    .tCapsuleShape()
                    .tint(.tPrimary)
                }
            }
            .padding(TSpace.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.tDark)
    }

    /// Previous / next clip arrow of the top bar; dimmed at the list's ends.
    private func clipArrowButton(icon: String, action: (() -> Void)?) -> some View {
        TIconButton(icon: icon, tint: .tText, size: 32) { action?() }
            .disabled(action == nil)
        .opacity(action == nil ? 0.35 : 1)
    }

    /// Barre de l'écran de chargement : réduire (le chargement continue, la
    /// mini-barre y ramène) ou fermer.
    private var loadingBar: some View {
        HStack {
            TIconButton(icon: "chevron.down", tint: .tText, size: 32) { reducePlayer() }
                .accessibilityLabel(store.t("reduce"))
            Spacer()
            TIconButton(icon: "xmark", size: 32) { stopPlayer() }
                .accessibilityLabel(store.t("close"))
        }
        .padding(.horizontal, TSpace.md)
        .padding(.top, TSpace.sm)
    }

    /// Qualité en cours pour le lecteur immersif : celle choisie, sinon la
    /// qualité préférée (ou la plus proche en dessous).
    private func currentQuality(_ links: QualityLinks) -> String {
        if !immersiveQuality.isEmpty, links[immersiveQuality] != nil { return immersiveQuality }
        return preferredQualityKey(Array(links.keys), pref: store.preferredQuality, variants: qualityVariants)
    }

    /// Arrondi à la seconde : sinon la vue se recalculerait à chaque tick.
    private func updateLatency(_ value: Double?) {
        let rounded = (value ?? 0).rounded()
        if abs(rounded - liveLatency) >= 1 { liveLatency = rounded }
    }

    private func updateBehind(_ value: Double?) {
        let rounded = max(0, value ?? 0).rounded()
        if abs(rounded - liveBehind) >= 1 { liveBehind = rounded }
    }

    /// Réduit le lecteur en mini-barre (flèche, ou glissé vers le bas) : il
    /// file jusqu'en bas en s'effaçant, comme dans l'app Twitch. Avec
    /// « Réduire les animations », un simple fondu.
    private func reducePlayer() {
        if reduceMotion {
            withAnimation(.easeOut(duration: 0.15)) { playerVisible = false }
        } else {
            withAnimation(.spring(response: 0.35, dampingFraction: 1)) {
                pull.y = pull.height
                playerVisible = false
            }
        }
        // Le décalage retombe une fois le lecteur masqué, pour qu'il revienne
        // à sa place à la prochaine ouverture.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            if !playerVisible { pull.y = 0 }
        }
    }

    /// Doigt levé : assez loin (seuil selon la hauteur), ou lancé
    /// franchement, on réduit ; sinon le lecteur revient à sa place.
    private func endPull(_ distance: CGFloat, predicted: CGFloat) {
        let threshold = PlayerPull.threshold(for: pull.height)
        if distance >= threshold || (distance > 20 && predicted >= threshold * 1.8) {
            reducePlayer()
        } else {
            pullPlayer(0)
        }
    }

    /// Le lecteur suit le doigt ; 0 = relâché trop tôt, il revient en place.
    private func pullPlayer(_ y: CGFloat) {
        if y <= 0 {
            guard pull.y != 0 else { return }
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { pull.y = 0 }
        } else {
            pull.y = y
        }
    }

    /// Bandeau du lecteur natif : le tirer vers le bas réduit le lecteur.
    /// (Sur l'image, le lecteur d'Apple garde ses propres gestes.)
    /// Repère global : le bandeau descend avec le doigt ; mesuré dans son
    /// propre repère, le déplacement se fausserait à chaque image (à-coups).
    private var topBarPull: some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: CoordinateSpace.global)
            .updating($topBarDragging) { _, active, _ in active = true }
            .onChanged { v in pullPlayer(max(0, v.translation.height)) }
            .onEnded { v in
                endPull(max(0, v.translation.height), predicted: v.predictedEndTranslation.height)
            }
    }

    /// VOD en cours : de quoi proposer d'en télécharger un passage (liens
    /// directs, sans l'adresse maison des passages coupés).
    private var downloadContext: VodDownloadContext? {
        guard let links = qualityLinks?.mapValues({ VodUnmuteLoader.unwrap($0) }), !links.isEmpty else { return nil }
        switch playerMode {
        case .vod(let id, let title, let thumb, let streamer)?:
            return VodDownloadContext(vodId: id, title: title ?? statusTitle, streamer: streamer ?? "",
                                      thumbnail: thumb ?? "", links: links, position: vodPlaybackTime,
                                      variants: qualityVariants)
        case .recovered(let rec)? where !rec.streamID.hasPrefix("offline-"):
            // VOD supprimée retrouvée : la garder avant qu'elle ne quitte le CDN.
            return VodDownloadContext(vodId: "r\(rec.streamID)", title: rec.title.isEmpty ? statusTitle : rec.title,
                                      streamer: rec.streamer, thumbnail: "", links: links, position: vodPlaybackTime)
        default:
            return nil
        }
    }

    /// Direct ou VOD en cours : l'ajouter au multi-live, ou l'en retirer.
    /// Pas le rembobinage d'un direct (DVR).
    private var multiLiveAction: (() -> Void)? {
        guard dvrSourceChannel == nil else { return nil }
        switch playerMode {
        case .live(let ch)?:
            return {
                showPlayerMenu = false
                if multi.toggle(ch, name: ch) {
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            }
        case .vod(let id, let title, let thumb, let streamer)?:
            return {
                showPlayerMenu = false
                // La tuile reprendra ici. `streamer` peut être un nom affiché :
                // la chaîne est complétée au démarrage de la tuile.
                store.setVodProgress(id, time: vodPlaybackTime)
                if multi.toggleVod(id: id, name: streamer ?? "", title: title, thumb: thumb) {
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            }
        default:
            return nil
        }
    }

    private var menuMultiLiveOn: Bool {
        switch playerMode {
        case .live(let ch)?:              return multi.contains(ch)
        case .vod(let id, _, _, _)?:      return multi.containsVod(id)
        default:                          return false
        }
    }

    private var downloadAction: (() -> Void)? {
        guard downloadContext != nil else { return nil }
        return {
            showPlayerMenu = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { showDownloadSheet = true }
        }
    }

    /// Direct servi par le compte (abonné sans pub) : annoncé au lancement.
    private var accountNotice: String? {
        menuLiveSource == "account" ? store.t("src_account_toast") : nil
    }

    /// Source du direct pour le menu du lecteur : seulement pendant un direct
    /// (pas pendant son rembobinage, qui lit la VOD en cours).
    private var menuLiveSource: String? {
        guard case .live? = playerMode, dvrSourceChannel == nil else { return nil }
        return liveSourceUsed
    }

    /// Recharge le flux courant (bouton ⟳ du lecteur, « Réessayer »).
    private func reloadCurrent() {
        guard let mode = playerMode else { return }
        logger.info("LECTEUR", "Rechargement du flux demandé", nil)
        // Rembobinage d'un direct : il garde son « Retour au direct ».
        pendingDvrChannel = dvrSourceChannel
        startPlayback(mode)
    }

    // MARK: – Actions du lecteur (nil ⇒ bouton masqué)
    /// Timeline of a running broadcast (Apple's player): live with its recording known, or
    /// watching that recording. Dragging back from live opens the recording at that point
    /// (soft switch: same channel, only the source changes); inside the recording it seeks.
    /// Live with a recording: switch to it a little behind the live point, where Apple's own
    /// scrubber in the video spans the whole broadcast (the live stream itself has none).
    private var rewindAction: (() -> Void)? {
        guard case .live? = playerMode, !liveViaRecording, let ch = currentChannelName,
              let dvr = liveDvrVideoId, let start = liveStartedAt else { return nil }
        return {
            pendingDvrChannel = ch
            // The recording ends about a minute behind live.
            store.setVodProgress(dvr, time: max(0, Date().timeIntervalSince(start) - 120))
            playVod(dvr, statusTitle, nil, ch, soft: true)
        }
    }

    private var backToLiveAction: (() -> Void)? {
        guard let ch = dvrSourceChannel else { return nil }
        return { playLive(ch, soft: true) }
    }

    /// Place of the current clip in the channel clip list it was opened
    /// from; nil outside such a list (or a list of one).
    private var clipQueueIndex: Int? {
        guard clipQueue.count > 1, case .clip(let slug, _)? = playerMode else { return nil }
        return clipQueue.firstIndex(where: { $0.id == slug })
    }

    /// Previous / next clip of that list; nil at its ends.
    private var prevClipAction: (() -> Void)? {
        guard let i = clipQueueIndex, i > 0 else { return nil }
        return { playAdjacentClip(-1) }
    }

    private var nextClipAction: (() -> Void)? {
        guard let i = clipQueueIndex, i + 1 < clipQueue.count else { return nil }
        return { playAdjacentClip(1) }
    }

    /// VOD téléchargée en lecture : le chat gardé avec elle, s'il y en a un.
    private var offlineChatFile: URL? {
        guard case .recovered(let rec)? = playerMode, rec.streamID.hasPrefix("offline-") else { return nil }
        let file = VodDownloads.folder(String(rec.streamID.dropFirst("offline-".count)))
            .appendingPathComponent(VodChatArchive.fileName)
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }

    /// Ce qui se lit, quelle que soit la qualité : le lecteur immersif y
    /// distingue un changement de qualité (la lecture reste où elle en est)
    /// d'un changement de source (direct ↔ enregistrement).
    private var playerContentID: String {
        switch playerMode {
        case .live(let channel)?:     return "live:" + channel.lowercased()
        case .vod(let id, _, _, _)?:  return "vod:" + id
        case .clip(let slug, _)?:     return "clip:" + slug
        case .recovered(let rec)?:    return "rec:" + rec.streamID
        case nil:                     return ""
        }
    }

    /// Identifiant de la VOD en cours de lecture (nil en live).
    private var currentVodId: String? {
        if case .vod(let id, _, _, _) = playerMode { return id }
        return nil
    }

    // MARK: – Nature de la lecture en cours
    private var isLivePlaying: Bool {
        guard let mode = playerMode else { return false }
        if case .live = mode { return true }
        return false
    }

    private var isClipPlaying: Bool {
        if case .clip? = playerMode { return true }
        return false
    }

    /// Vitesse de ce qui se lit hors direct : celle des VODs (retenue d'une
    /// VOD à l'autre, seule source de vérité), ou celle du clip en cours.
    private var playbackSpeed: Double { isClipPlaying ? clipSpeed : store.vodSpeed }

    private func setPlaybackSpeed(_ v: Double) {
        let speed = VodSpeed.nearest(v)
        if isClipPlaying {
            clipSpeed = speed
        } else if speed != store.vodSpeed {
            store.vodSpeed = speed
            logger.settingChanged("Vitesse des VODs", value: String(format: "×%g", speed))
        }
    }

    // MARK: – Mini-barre (lecteur réduit)
    /// Player reduced: the mini player shows (tab bar accessory or floating bar).
    private var miniShown: Bool { playerMode != nil && !playerVisible && !closingPlayer }

    /// Chargement réduit : il tourne encore ; en échec, on le dit.
    @ViewBuilder private var miniStatusIcon: some View {
        if loading {
            ProgressView().scaleEffect(0.7)
                .frame(width: 16, height: 16)
        } else if errorMsg != nil {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.footnote.weight(.bold))
                .foregroundColor(.tWarning)
        } else {
            Image(systemName: isLivePlaying ? "dot.radiowaves.left.and.right" : "play.fill")
                .font(.footnote.weight(.bold))
                .foregroundColor(isLivePlaying ? .tLive : .tPrimary)
        }
    }

    /// Content of the tab bar accessory (iOS 26.1+); the system draws the glass.
    private var miniAccessory: some View {
        HStack(spacing: TSpace.md) {
            miniStatusIcon
            Text(statusTitle)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { stopPlayer() } label: {
                Image(systemName: "xmark").font(.body.weight(.semibold))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.t("close"))
        }
        .padding(.horizontal, TSpace.lg)
        .contentShape(Rectangle())
        .onTapGesture {
            pull.y = 0
            withAnimation { playerVisible = true }
        }
    }

    @ViewBuilder
    private var miniBar: some View {
        HStack(spacing: TSpace.md) {
            miniStatusIcon

            Text(statusTitle)
                .font(.tCardTitle)
                .foregroundColor(.tText)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            TIconButton(icon: "xmark", size: 30) { stopPlayer() }
        }
        .padding(.horizontal, TSpace.md)
        .padding(.vertical, TSpace.sm)
        .tGlass(in: RoundedRectangle(cornerRadius: TRadius.card, style: .continuous),
                fallback: .tCard)
        .overlay(RoundedRectangle(cornerRadius: TRadius.card, style: .continuous)
            .stroke(Color.tPrimary.opacity(Theme.useGlass ? 0.25 : 0.4), lineWidth: 1))
        // La zone tactile est fixée AVANT les marges : sinon le rectangle
        // tactile englobait les 92 pt de marge basse, qui recouvrent la barre
        // d'onglets — appuyer sur « Recherche » ou « VODs » rouvrait le lecteur
        // en plein écran au lieu de changer d'onglet.
        .contentShape(Rectangle())
        .onTapGesture {
            pull.y = 0
            withAnimation { playerVisible = true }
        }
        .padding(.horizontal, TSpace.md)
        .padding(.bottom, 92)
    }

    /// Multi-live en préparation : les vidéos choisies, et « Regarder ».
    /// Au-dessus du mini-lecteur quand il est là.
    private var multiBar: some View {
        let miniShown = playerMode != nil
        return HStack(spacing: TSpace.sm) {
            Image(systemName: "square.grid.2x2.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(.tPurple)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(store.t("multi_title")) · \(multi.entries.count)/\(MultiLive.max)")
                    .font(.tCardTitle).foregroundColor(.tText)
                Text(multi.entries.map(\.label).joined(separator: ", "))
                    .font(.tMeta).foregroundColor(.tMuted).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: openMultiLive) {
                Label(store.t("multi_watch"), systemImage: "play.fill")
                    .font(.system(size: 13, weight: .bold))
            }
            .tProminentStyle()
            .tCapsuleShape()
            .controlSize(.small)
            .tint(.tPrimary)
            TIconButton(icon: "xmark", size: 30) { multi.clear() }
        }
        .padding(.horizontal, TSpace.md)
        .padding(.vertical, TSpace.sm)
        .tGlass(in: RoundedRectangle(cornerRadius: TRadius.card, style: .continuous),
                fallback: .tCard)
        .overlay(RoundedRectangle(cornerRadius: TRadius.card, style: .continuous)
            .stroke(Color.tPurple.opacity(0.35), lineWidth: 1))
        .contentShape(Rectangle())
        .padding(.horizontal, TSpace.md)
        .padding(.bottom, miniShown ? 152 : 92)
    }

    /// Un seul son à la fois : le lecteur se ferme.
    private func openMultiLive() {
        if playerMode != nil { stopPlayer() }
        showMultiLive = true
    }

    // MARK: – Playback
    /// `keepVisibility` : enchaînement automatique (VOD suivante de « Tout
    /// lire », raid suivi) — un lecteur réduit le reste, au lieu de surgir en
    /// plein écran pendant qu'on navigue.
    private func playVod(_ id: String, _ title: String? = nil,
                         _ thumb: String? = nil, _ streamer: String? = nil,
                         soft: Bool = false, keepVisibility: Bool = false) {
        // Une VOD hors de la playlist en cours met fin à l'enchaînement.
        if !vodQueue.contains(where: { $0.id == id }) { vodQueue = [] }
        clipQueue = []
        // Historique des VODs vues : centralisé ici pour couvrir TOUS les points
        // d'entrée (Découverte, Streamer, Lien/ID, rembobinage…). Avant, seul
        // l'onglet Lien/ID enregistrait, donc l'onglet VODs restait vide.
        store.saveToHistory(HistoryItem(
            term: id, type: .vod,
            display: title ?? "VOD \(id)",
            thumb: thumb, streamer: streamer,
            addedAt: Date().timeIntervalSince1970 * 1000
        ))
        startPlayback(.vod(id: id, title: title, thumb: thumb, streamer: streamer),
                      soft: soft, keepVisibility: keepVisibility)
    }
    private func playQueue(_ list: [VodData], _ streamer: String?) {
        guard let first = list.first else { return }
        vodQueue = list
        vodQueueStreamer = streamer
        playVod(first.id, first.title, first.previewThumbnailURL, streamer)
    }
    /// Fin d'une vidéo : la suivante de la playlist, s'il y en a une. Pas
    /// pendant la fermeture du lecteur (fin arrivée pendant le fondu).
    private func playNextInQueue() {
        guard !closingPlayer, case .vod(let id, _, _, _) = playerMode,
              let i = vodQueue.firstIndex(where: { $0.id == id }) else { return }
        guard i + 1 < vodQueue.count else { vodQueue = []; return }
        let next = vodQueue[i + 1]
        playVod(next.id, next.title, next.previewThumbnailURL, vodQueueStreamer, keepVisibility: true)
    }
    private func playClip(_ slug: String, _ title: String?) {
        vodQueue = []
        clipQueue = []
        startPlayback(.clip(slug: slug, title: title))
    }
    /// Clip tapped in a channel's clip list: the list is kept so swipes, the
    /// arrows and the end of a clip move through it.
    private func playClipQueue(_ list: [ClipData], _ index: Int) {
        guard list.indices.contains(index) else { return }
        // Swipeable full-screen feed, like TikTok (iOS 17+).
        if #available(iOS 17.0, *) {
            openClipFeed(ClipFeedItem(clips: list, start: index))
            return
        }
        vodQueue = []
        clipQueue = list
        let clip = list[index]
        startPlayback(.clip(slug: clip.id, title: clip.title))
    }
    /// Clip feed over everything. Anything playing stops: two sounds at once
    /// otherwise.
    private func openClipFeed(_ item: ClipFeedItem) {
        if playerMode != nil { stopPlayer() }
        clipFeed = item
    }
    /// Neighbouring clip of the list (delta −1 / +1). `keepVisibility`: the
    /// automatic advance at the end of a clip leaves a reduced player reduced.
    private func playAdjacentClip(_ delta: Int, keepVisibility: Bool = false) {
        guard !closingPlayer, let i = clipQueueIndex,
              clipQueue.indices.contains(i + delta) else { return }
        let clip = clipQueue[i + delta]
        startPlayback(.clip(slug: clip.id, title: clip.title), keepVisibility: keepVisibility)
    }
    /// VOD supprimée déjà reconstruite (liens prêts) : on lit directement.
    private func playRecovered(_ rec: RecoveredVod) {
        vodQueue = []
        clipQueue = []
        startPlayback(.recovered(rec))
    }
    private func playLive(_ channel: String, soft: Bool = false, keepVisibility: Bool = false) {
        // Ce direct est déjà ouvert (mini-barre, puis sa notification ou sa
        // carte) : on le remontre. Tout recharger donnait un écran noir, et
        // flux et chat relus.
        if !soft, case .live(let current)? = playerMode,
           current.lowercased() == channel.lowercased(), errorMsg == nil, !closingPlayer {
            if !keepVisibility {
                pull.y = 0
                withAnimation { playerVisible = true }
            }
            return
        }
        vodQueue = []
        clipQueue = []
        startPlayback(.live(channelName: channel), soft: soft, keepVisibility: keepVisibility)
    }

    /// `soft` : on reste sur la même chaîne (direct ↔ enregistrement). Le
    /// lecteur en place continue de jouer pendant que la nouvelle source se
    /// résout, au lieu d'être démonté et remplacé par un écran d'attente.
    /// `keepVisibility` : voir playVod.
    private func startPlayback(_ mode: PlayerMode, soft: Bool = false, keepVisibility: Bool = false) {
        // Referme le clavier s'il était ouvert (recherche en cours) : sinon il
        // restait affiché par-dessus le lecteur.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder),
                                        to: nil, from: nil, for: nil)
        // Le son passe à l'app ; il est rendu aux autres apps à la fermeture
        // du lecteur (PlaybackAudio). Rien n'est relâché en changeant de
        // chaîne : le lecteur reste ouvert.
        PlaybackAudio.shared.claim("player")
        // Même direct relu en douce (session web changée) : ses minuteries
        // continuent, elles repartent avec lui. Sinon, celles de la lecture
        // précédente (spectateurs relus toutes les 30 s, durée chaque seconde)
        // et la pulsation des drops s'arrêtent ici : passer d'un direct à une
        // VOD, ou à un direct hors ligne, les laissait tourner pour l'ancienne
        // chaîne. Calculé avant que la chaîne en cours ne change.
        var sameLive = false
        if soft, case .live(let channel) = mode, channel.lowercased() == currentChannelName { sameLive = true }
        if !sameLive {
            stopLiveTimers()
            liveViewerCount = 0
            // Switching to this broadcast's recording: the timeline still spans it.
            if pendingDvrChannel == nil { liveStartedAt = nil }
        }
        playerMode    = mode
        if !keepVisibility { playerVisible = true }
        // Une fermeture en plein fondu est remplacée par cette lecture (voir
        // stopPlayer).
        closingPlayer = false
        errorMsg      = nil
        chatOnly      = false
        vodPlaybackTime = 0
        liveDvrVideoId  = nil
        liveLatency     = 0
        liveBehind      = 0
        pull.y          = 0
        loadingSource   = nil

        if soft {
            switchingSource = true
        } else {
            loading          = true
            playerPlaying    = false
            qualityLinks     = nil
            linksContentID   = ""
            linksAreLive     = false
            liveViaRecording = false
            qualityVariants  = [:]
            // Avatar, jeu et qualité retenue ne sont vidés qu'à l'ouverture
            // d'une autre chaîne : en bascule, ils sont toujours les bons, et
            // les effacer ne ferait que les faire clignoter.
            liveAvatar       = nil
            liveGame         = ""
            immersiveQuality = ""
            // Titre provisoire (mini-barre d'un chargement réduit) : le vrai
            // arrive avec les liens.
            switch mode {
            case .live(let channel):             statusTitle = channel
            case .vod(let id, let title, _, _):  statusTitle = title ?? "VOD \(id)"
            case .clip(_, let title):            statusTitle = title ?? "Clip"
            case .recovered(let rec):            statusTitle = rec.title.isEmpty ? store.t("recover_title") : rec.title
            }
        }
        // Un VOD lancé depuis le bouton Rembobiner garde le lien vers sa chaîne,
        // pour pouvoir revenir au direct. Un VOD normal, non.
        if case .live = mode { dvrSourceChannel = nil }
        else { dvrSourceChannel = pendingDvrChannel }
        pendingDvrChannel = nil

        if case .live(let channel) = mode {
            let login = channel.lowercased()
            // Autre chaîne : son id est vidé, rempli après getLive (le chat
            // l'attend en bascule douce, voir chatPane). Même chaîne (session
            // web changée) : il reste, le chat aussi.
            if currentChannelName != login { currentChannelId = nil }
            currentChannelName = login
        } else {
            currentChannelName = nil
            currentChannelId   = nil
        }

        loadGeneration += 1
        let gen = loadGeneration
        clipVodId = nil; clipOffset = 0; clipSpeed = 1
        vodChapters = []
        vodMuted = []
        vodUnmuted = 0
        Task {
            switch mode {
            case .clip(let slug, let title):
                let clip = await getClip(slug: slug)
                await MainActor.run {
                    guard gen == loadGeneration else { return }
                    guard let clip else {
                        errorMsg = store.t("err_clip"); loading = false; switchingSource = false
                        return
                    }
                    qualityLinks    = clip.links
                    linksContentID  = playerContentID
                    linksAreLive    = false
                    liveViaRecording = false
                    qualityVariants = [:]   // noms avec la hauteur (« 720p60 »)
                    statusTitle     = clip.title.isEmpty ? (title ?? "Clip") : clip.title
                    clipVodId       = clip.vodId
                    clipOffset      = clip.vodOffset ?? 0
                    loading         = false
                    switchingSource = false
                }
                if let who = clip?.broadcasterLogin {
                    let avatar = await channelAvatar(login: who, token: store.twitchToken)
                    await MainActor.run { if gen == loadGeneration { liveAvatar = avatar } }
                }

            case .vod(let id, let title, _, let streamer):
                // Le bandeau du lecteur montrait un rond gris sur les VODs :
                // `getM3U8` ne ramène aucune photo de profil. On la demande à
                // part, depuis le nom de chaîne que tous les points d'entrée
                // transmettent déjà.
                if let who = streamer, !who.isEmpty {
                    Task { @MainActor in
                        let avatar = await channelAvatar(login: who.lowercased(),
                                                         token: store.twitchToken)
                        if gen == loadGeneration { liveAvatar = avatar }
                    }
                }
                // Repères (chapitres, passages coupés) en même temps que les
                // liens : ils décident de la playlist à donner au lecteur.
                async let markersTask = getVodMarkers(vodId: id)
                let data = await getM3U8(vodId: id)
                let markers = await markersTask
                if let err = data.error, data.links.isEmpty {
                    await MainActor.run {
                        guard gen == loadGeneration else { return }
                        errorMsg = store.t(apiErrorKey(err)); loading = false; switchingSource = false
                    }
                } else {
                    // VOD récente avec des passages coupés : le son d'origine
                    // est peut-être encore sur le CDN (VodUnmuteLoader).
                    let unmute = store.restoreMutedAudio && VodUnmuteLoader.worthTrying(markers)
                    let links = unmute ? VodUnmuteLoader.wrap(data.links) : data.links
                    await MainActor.run {
                        guard gen == loadGeneration else { return }
                        vodChapters     = markers.chapters
                        vodMuted        = markers.muted
                        qualityLinks    = links
                        linksContentID  = playerContentID
                        linksAreLive    = false
                        liveViaRecording = false
                        qualityVariants = data.variants
                        statusTitle     = title ?? "VOD \(id)"
                        loading         = false
                        switchingSource = false
                    }
                }

            case .recovered(let rec):
                // Liens déjà reconstruits et validés : aucune requête de lecture.
                if !rec.streamer.isEmpty {
                    Task { @MainActor in
                        let avatar = await channelAvatar(login: rec.streamer.lowercased(),
                                                         token: store.twitchToken)
                        if gen == loadGeneration { liveAvatar = avatar }
                    }
                }
                await MainActor.run {
                    guard gen == loadGeneration else { return }
                    qualityLinks    = rec.links
                    linksContentID  = playerContentID
                    linksAreLive    = false
                    liveViaRecording = false
                    qualityVariants = [:]
                    statusTitle     = rec.title.isEmpty ? store.t("recover_title") : rec.title
                    loading         = false
                    switchingSource = false
                }

            case .live(let channel):
                // Abonné sans pub sur cette chaîne : le direct passe par son
                // compte (session web), sinon jeton anonyme comme avant.
                let web = store.accountPlaybackWebToken(for: channel)
                // Source essayée : dite par l'écran de chargement.
                let data = await getLive(channelName: channel, webToken: web,
                                         integrity: web.map { dropsIntegrity(for: $0) },
                                         onSource: { source in
                                             DispatchQueue.main.async {
                                                 if gen == loadGeneration { loadingSource = source }
                                             }
                                         })
                // Session refusée par Twitch : le circuit habituel l'efface et
                // affiche « session expirée ».
                if data.webSessionExpired {
                    Task { @MainActor in await store.validateWebSession() }
                }
                // Chaîne introuvable, réseau, ou aucune source n'a répondu
                // (Twitch la dit en direct) : dit tel quel, plus « hors ligne ».
                if let err = data.error, err != "offline" {
                    await MainActor.run {
                        guard gen == loadGeneration else { return }
                        errorMsg = store.t(apiErrorKey(err)); loading = false; switchingSource = false
                    }
                } else if let links = data.links, !links.isEmpty {
                    // Mode faible latence : playlist réécrite avec la vraie
                    // durée des segments (LivePlaylistLoader), relue toutes les
                    // 2 s au lieu de 6 — le lecteur peut tenir près du bord.
                    var playable = store.lowLatency ? LivePlaylistLoader.wrap(links) : links
                    var viaRecording = false
                    // Apple's player: live joined to its running recording (LiveDVRPlaylist), so
                    // Apple's bar spans the broadcast and its edge is the real live stream.
                    // No recording: the live stream keeps its own past from now on.
                    if !store.immersivePlayer {
                        var joined: QualityLinks? = nil
                        if let dvr = data.dvrVideoId {
                            let rec = await getM3U8(vodId: dvr)
                            joined = LiveDVRPlaylist.wrap(live: links, recording: rec.links)
                            if joined != nil { logger.info("LECTEUR", "Direct avec son passé (enregistrement)", dvr) }
                        }
                        if joined == nil {
                            joined = LiveDVRPlaylist.wrap(live: links, recording: nil)
                            if joined != nil { logger.info("LECTEUR", "Direct avec son passé (depuis l'ouverture)", nil) }
                        }
                        if let joined { playable = joined; viaRecording = true }
                    }
                    await MainActor.run {
                        guard gen == loadGeneration else { return }
                        qualityLinks      = playable
                        linksContentID    = playerContentID
                        linksAreLive      = true
                        liveViaRecording  = viaRecording
                        qualityVariants   = data.variants
                        statusTitle       = data.title.isEmpty ? channel : data.title
                        liveViewerCount   = data.viewerCount
                        liveStartedAt     = data.startedAt
                        // userId Twitch → emotes de la chaîne. Même chaîne relue
                        // sans réponse de GQL : l'id déjà connu reste.
                        if let uid = data.userId { currentChannelId = uid }
                        liveAvatar        = data.avatar
                        liveGame          = data.game
                        liveDvrVideoId    = data.dvrVideoId
                        liveSourceUsed    = data.source
                        loading           = false
                        switchingSource   = false
                        startLiveTimers(channel: channel)
                    }
                    // GQL ne rend pas toujours `profileImageURL` : repli Helix,
                    // plutôt qu'un rond gris pour le reste de la session.
                    if data.avatar == nil {
                        let fallback = await channelAvatar(login: channel.lowercased(),
                                                           token: store.twitchToken)
                        await MainActor.run { if gen == loadGeneration { liveAvatar = fallback } }
                    }
                } else {
                    await MainActor.run {
                        guard gen == loadGeneration else { return }
                        errorMsg = store.t("offline_msg")
                        loading = false; switchingSource = false
                    }
                }
            }
        }
    }

    /// `wakeOthers` faux (minuteur de veille) : la musique qu'une autre app
    /// jouait avant la vidéo ne reprend pas toute seule.
    private func stopPlayer(wakeOthers: Bool = true) {
        // Session audio relâchée : une musique coupée par la vidéo peut reprendre.
        // (L'écran, lui, peut de nouveau s'éteindre : voir keepScreenOn.)
        PlaybackAudio.shared.release("player", notifyOthers: wakeOthers)
        loadGeneration += 1   // un chargement encore en cours sera ignoré
        let gen = loadGeneration
        stopLiveTimers()
        // Fin de visionnage : la progression part maintenant, plutôt que
        // toutes les quelques secondes pendant la lecture.
        store.flushToCloud(force: true)

        // Le fondu d'abord, le ménage ensuite. Vider `qualityLinks` et
        // `playerMode` dans la même transaction escamotait l'animation : le
        // contenu disparaissait aussitôt et il ne restait qu'un cadre noir à
        // estomper, d'où la fermeture « instantanée » alors que l'ouverture
        // s'animait.
        closingPlayer = true
        withAnimation(.easeInOut(duration: 0.28)) { playerVisible = false }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            // Autre lecture lancée pendant le fondu (les onglets sont
            // touchables dès son début) : c'est elle qui compte. Le ménage
            // effaçait son état, alors que son chargement se poursuivait.
            guard gen == loadGeneration else { return }
            chatOnly           = false
            currentChannelName = nil
            currentChannelId   = nil
            liveDvrVideoId     = nil
            dvrSourceChannel   = nil
            pendingDvrChannel  = nil
            liveViewerCount    = 0
            liveStartedAt      = nil
            liveLatency        = 0
            liveBehind         = 0
            pull.y             = 0
            liveAvatar         = nil
            clipVodId          = nil
            clipOffset         = 0
            clipSpeed          = 1
            liveGame           = ""
            liveSourceUsed     = nil
            playerMode         = nil
            qualityLinks       = nil
            linksContentID     = ""
            linksAreLive       = false
            liveViaRecording = false
            qualityVariants    = [:]
            statusTitle        = ""
            loading            = false
            loadingSource      = nil
            errorMsg           = nil
            playerPlaying      = false
            // Rien ne doit survivre à la fermeture : une VOD de la playlist
            // rouverte plus tard depuis l'historique enchaînait sur la suivante.
            vodQueue           = []
            vodQueueStreamer   = nil
            clipQueue          = []
            switchingSource    = false
            vodChapters        = []
            vodMuted           = []
            vodUnmuted         = 0
            closingPlayer      = false
        }
    }

    // MARK: – Live timers
    private func startLiveTimers(channel: String) {
        stopLiveTimers()
        let gen = loadGeneration
        refreshTimer = Timer.scheduledCommon(every: 30) { _ in
            Task {
                // Rafraîchissement LÉGER : ne re-fetch PAS les liens du stream,
                // juste le nombre de viewers et l'uptime.
                let stats = await getStreamStats(channelName: channel)
                await MainActor.run {
                    // Autre lecture entre-temps : ces chiffres sont ceux
                    // d'une chaîne qu'on ne regarde plus.
                    guard gen == loadGeneration else { return }
                    if stats.viewerCount > 0  { liveViewerCount = stats.viewerCount }
                    if let s = stats.startedAt { liveStartedAt  = s }
                    // Recording created after the stream was opened.
                    if liveDvrVideoId == nil, let a = stats.archiveId {
                        liveDvrVideoId = a
                    }
                }
            }
        }
        // Drops : Twitch ne les compte que si la session du compte charge le
        // flux, ce que la lecture par proxy ne fait pas (voir DropsHeartbeat).
        // Direct lu par le compte : c'est déjà le cas, une seconde session du
        // compte ne servirait à rien ; la pulsation garde alors seulement
        // l'état de la page Drops et la réclamation automatique.
        if store.dropsProgress, let web = store.twitchWebToken, !web.isEmpty {
            DropsHeartbeat.shared.start(login: channel, token: web,
                                        pollSegments: liveSourceUsed != "account")
        }
    }

    private func stopLiveTimers() {
        refreshTimer?.invalidate(); refreshTimer = nil
        DropsHeartbeat.shared.stop()
    }
}

/// Chaîne affichée dans la feuille « page de chaîne ».
struct ChannelSheetItem: Identifiable {
    let login: String
    var id: String { login }
}

/// Mise en veille de l'écran suspendue tant qu'un lecteur le demande :
/// l'écran du lecteur (« player », voir MainTabView.keepScreenOn) ou le
/// multi-live (« multi »). Chacun pour soi : passer de l'un à l'autre ne
/// rend pas la veille sous celui qui s'ouvre. Fil principal seulement.
enum ScreenAwake {
    private static var owners = Set<String>()

    static func set(_ owner: String, _ on: Bool) {
        if on { owners.insert(owner) } else { owners.remove(owner) }
        let wanted = !owners.isEmpty
        guard UIApplication.shared.isIdleTimerDisabled != wanted else { return }
        UIApplication.shared.isIdleTimerDisabled = wanted
    }
}

/// `tabViewBottomAccessory` where it exists (iOS 26.1), with the tab bar shrinking on scroll as in
/// Apple Music; older systems keep the floating mini bar.
struct TabAccessory<Accessory: View>: ViewModifier {
    let enabled: Bool
    @ViewBuilder let accessory: () -> Accessory

    // `isEnabled:` ships with the iOS 26.1 SDK (Swift 6.2.1); CI may still build with Xcode 26.0.
    static var available: Bool {
        #if compiler(>=6.2.1)
        if #available(iOS 26.1, *) { return true }
        #endif
        return false
    }

    func body(content: Content) -> some View {
        #if compiler(>=6.2.1)
        if #available(iOS 26.1, *) {
            content
                .tabViewBottomAccessory(isEnabled: enabled, content: accessory)
                .tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// Header LIVE pill: filled while live, outlined (tap = back to live) when behind.
private struct LivePillStyle: ViewModifier {
    let live: Bool
    func body(content: Content) -> some View {
        if live { content.tProminentStyle() } else { content.tBorderedStyle() }
    }
}
