import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showLogs        = false
    @State private var highlightDraft  = ""
    @State private var mutedDraft      = ""
    @State private var liveNotif       = LiveNotifier.isEnabled
    @State private var notifTestResult: String? = nil
    @State private var ntfyOn          = NtfyNotifier.isEnabled
    @State private var ntfyResult: String? = nil
    @State private var ntfyCopied      = false
    @State private var ntfySynced      = !NtfyNotifier.isPending
    @State private var appIcon: AppIconChoice = .standard
    @State private var appIconError: String? = nil
    // Réglages experts : Worker personnel.
    @AppStorage(APIConfig.customKey) private var customWorker = ""
    @AppStorage(APIConfig.allKey) private var customWorkerAll = false
    @State private var workerInput = ""
    @State private var workerChecking = false
    /// Dernière vérification du Worker personnel (nil : rien à dire).
    @State private var workerResult: APIConfig.CheckResult? = nil
    /// « Tout par ce Worker » refusé : il n'a pas de base D1.
    @State private var workerNoDatabase = false
    @State private var showLogoutAlert = false
    @State private var showClearAlert  = false
    @State private var showWebLogin    = false   // login web (points de chaîne)
    @State private var webLoginClear   = false
    @State private var apiLoggingIn    = false
    @State private var cacheBytes: Int64 = 0
    @State private var cacheFiles      = 0
    @ObservedObject private var sleepTimer = SleepTimerService.shared
    @Environment(\.dismiss) private var dismiss
    @State private var showSleepSheet  = false
    @State private var showHidden      = false   // chaînes et catégories masquées
    // Sauvegarde (export / import)
    @State private var exportDoc: BackupDocument? = nil
    @State private var showExporter    = false
    @State private var showImporter    = false
    @State private var backupMessage: String? = nil
    /// Page ouverte, nil = menu racine.
    /// Chat-size slider being dragged and its uncommitted value (see sliderRow).
    @State private var sliderDraft: (key: ReferenceWritableKeyPath<AppStore, Double>, value: Double)? = nil

    private var vodCount:     Int { store.history.filter { $0.type == .vod }.count }
    private var channelCount: Int { store.history.filter { $0.type == .channel }.count }

    var body: some View {
        // System navigation, like the Settings app: grouped list, pushed pages,
        // close button in the bar.
        NavigationStack {
            rootMenu
                .navigationTitle(store.t("settings"))
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { TCloseButton { dismiss() } }
                }
                .navigationDestination(for: Page.self) { section in
                    sectionPage(section)
                        .navigationTitle(store.t(section.titleKey))
                        .navigationBarTitleDisplayMode(.inline)
                }
        }
        .onAppear {
            refreshCacheInfo()
        }        .onAppear {
            refreshCacheInfo()
        }
        // ── Alerts ──────────────────────────────────────────────────
        .alert(store.t("btn_logout"), isPresented: $showLogoutAlert) {
            Button(store.t("cancel"), role: .cancel) {}
            Button(store.t("btn_logout"), role: .destructive) {
                logger.authLogout()
                store.logout()
            }
        } message: {
            Text(store.t("confirm_logout"))
        }
        .alert(store.t("btn_clear"), isPresented: $showClearAlert) {
            Button(store.t("cancel"), role: .cancel) {}
            Button(store.t("erase"), role: .destructive) {
                logger.historyCleared()
                store.clearHistory()
            }
        } message: {
            Text(store.t("confirm"))
        }
        // ── Login web Twitch (cookie auth-token pour les points) ─────
        .sheet(isPresented: $showWebLogin) {
            TwitchWebLoginSheet(
                clearSession: webLoginClear,
                expectedLogin: store.twitchLogin,
                onComplete: { webToken, webLogin in
                    showWebLogin = false
                    Task {
                        if await store.adoptWebToken(webToken, login: webLogin) {
                            logger.success("AUTH/WEB", "Session web connectée depuis les réglages", nil)
                        }
                    }
                },
                onCancel: { showWebLogin = false }
            )
        }
        // ── Minuteur de veille (préréglages + durée personnalisée) ───
        .sheet(isPresented: $showSleepSheet) {
            SleepTimerSheet()
                .presentationDetents([.medium, .large])
        }
        // ── Chaînes et catégories masquées ───────────────────────────
        .sheet(isPresented: $showHidden) {
            HiddenContentSheet().environmentObject(store)
        }
        // ── Logs sheet ───────────────────────────────────────────────
        .sheet(isPresented: $showLogs) {
            NavigationStack {
                LogsView()
                    .navigationTitle("Logs")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { TCloseButton { showLogs = false } }
                    }
            }
        }
    }


    // MARK: – Pages de réglages
    /// Les destinations du menu.
    enum Page: Hashable {
        case account, general, player, chat, drops, points, labs, other

        var titleKey: String {
            switch self {
            case .account:   return "twitch_account"
            case .general:   return "sec_general"
            case .player:    return "sec_player"
            case .chat:      return "sec_chat"
            case .drops:     return "drops"
            case .points:    return "points_tracker"
            case .labs:      return "debug_section"
            case .other:     return "sec_other"
            }
        }
        var subtitleKey: String {
            switch self {
            case .account:   return "sec_account_sub"
            case .general:   return "sec_general_sub"
            case .player:    return "sec_player_sub"
            case .chat:      return "sec_chat_sub"
            case .drops:     return "drops_sub"
            case .points:    return "points_tracker_sub"
            case .labs:      return "sec_labs_sub"
            case .other:     return "sec_other_sub"
            }
        }
        var icon: String {
            switch self {
            case .account:   return "person.crop.circle.fill"
            case .general:   return "gearshape.fill"
            case .player:    return "play.rectangle.fill"
            case .chat:      return "bubble.left.and.bubble.right.fill"
            case .drops:     return "shippingbox.fill"
            case .points:    return "circle.circle.fill"
            case .labs:      return "flask.fill"
            case .other:     return "info.circle.fill"
            }
        }
        /// Une teinte par domaine : on repère la ligne à la couleur avant
        /// d'avoir lu le libellé. System colors, as in the Settings app.
        var tint: Color {
            switch self {
            case .account:   return .purple
            case .general:   return .gray
            case .player:    return .blue
            case .chat:      return .green
            case .drops:     return .red
            case .points:    return .indigo
            case .labs:      return .orange
            case .other:     return .gray
            }
        }
    }

    // MARK: – Menu racine
    @ViewBuilder private var rootMenu: some View {
        List {
            if let login = store.twitchLogin {
                Section { accountBanner(login: login) }
            }
            Section {
                ForEach([Page.account, .general, .player, .chat, .drops, .points, .labs, .other], id: \.self) {
                    menuRow($0)
                }
            } footer: {
                Text(versionLabel)
                    .frame(maxWidth: .infinity)
                    .padding(.top, TSpace.sm)
            }
        }
        .listStyle(.insetGrouped)
    }

    /// Bandeau du compte connecté : une photo et un pseudo valent mieux qu'une
    /// ligne « Connecté » perdue au fond d'une page.
    @ViewBuilder
    private func accountBanner(login: String) -> some View {
        // Like the Apple Account row at the top of the Settings app.
        HStack(spacing: TSpace.md) {
            AsyncImage(url: URL(string: store.twitchAvatar ?? "")) { img in
                img.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: "person.crop.circle.fill")
                    .resizable()
                    .symbolRenderingMode(.hierarchical)
                    .foregroundColor(.tMuted)
            }
            .frame(width: 60, height: 60)
            .clipShape(Circle())

            // Session web seule (connexion depuis la page Drops) : le pseudo
            // est connu, mais pas de compte pour le chat ni les suivis.
            let full = store.twitchToken != nil
            VStack(alignment: .leading, spacing: 2) {
                Text(login).font(.title2.weight(.semibold)).foregroundColor(.tText).lineLimit(1)
                Text(store.t(full ? "connected" : "web_only")).font(.subheadline).foregroundColor(.tMuted)
            }
        }
        .padding(.vertical, TSpace.xs)
    }

    @ViewBuilder
    private func menuRow(_ section: Page) -> some View {
        NavigationLink(value: section) {
            HStack(spacing: TSpace.md) {
                // Settings-app icon: white symbol on a solid colored square.
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(section.tint)
                    .frame(width: 29, height: 29)
                    .overlay {
                        Image(systemName: section.icon)
                            .font(.subheadline.weight(.medium))
                            .foregroundColor(.white)
                    }
                Text(store.t(section.titleKey))
            }
        }
    }

    @ViewBuilder
    private func sectionPage(_ section: Page) -> some View {
        switch section {
        case .drops, .points:
            ScrollView {
                Group {
                    if section == .drops {
                        DropsPanel(onLogin: { startWebLogin() })
                    } else {
                        PointsTrackerPanel(onLogin: { startWebLogin() })
                    }
                }
                .padding(.horizontal, TSpace.lg)
                .padding(.vertical, TSpace.md)
            }
            .background(Color(.systemGroupedBackground))
        default:
            Form {
                // Une vue par ligne : dans un ViewBuilder, deux vues séparées
                // par un point-virgule sur la même ligne ne se composent pas.
                switch section {
                case .account:
                    webSessionCard
                    compteCard
                case .general:
                    langueCard
                    hiddenCard
                    apparenceCard
                    autoclaimCard
                    veilleCard
                    historiqueCard
                    backupCard
                    cacheCard
                case .player:
                    lecteurCard
                case .chat:
                    chatBehaviorCard
                    persoCard
                    tailleChatCard
                case .labs:
                    debugCard
                default:
                    aboutCard
                    expertCard
                }
            }
            // Several buttons share one row: borderless keeps each tappable on its own.
            .buttonStyle(.borderless)
        }
    }

    // ── Réglages experts : Worker personnel ──────────────────────────────
    @ViewBuilder private var expertCard: some View {
        settingCard {
            VStack(alignment: .leading, spacing: 12) {
                label("server.rack", store.t("expert"))
                Text(store.t("expert_worker")).font(.tCardTitle).foregroundColor(.tText)
                Text(store.t("expert_worker_sub"))
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
                TextField(store.t("expert_worker_ph"), text: $workerInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.done)
                    .onSubmit { checkWorker() }
                    .font(.tBody)
                    .foregroundColor(.tText)
                    .padding(10)
                    .background(Color.tSurface)
                    .cornerRadius(10)
                HStack(spacing: 16) {
                    Button { checkWorker() } label: {
                        HStack(spacing: 6) {
                            if workerChecking { ProgressView().scaleEffect(0.7) }
                            Text(store.t("expert_check"))
                        }
                    }
                    .disabled(workerChecking || workerInput.trimmingCharacters(in: .whitespaces).isEmpty)
                    if !customWorker.isEmpty {
                        Button(store.t("expert_reset"), role: .destructive) { resetWorker() }
                    }
                }
                .font(.tLabel)
                .buttonStyle(.borderless)
                if let result = workerResult {
                    // Ce qui a échoué (http://, pas de réponse, quota, pas un
                    // Worker TwitchUnblock), plus un seul message pour tout.
                    Text(store.t(result.messageKey))
                        .font(.tMeta).foregroundColor(result == .ok ? .tSuccess : .tDanger)
                        .fixedSize(horizontal: false, vertical: true)
                } else if !customWorker.isEmpty {
                    Text(store.t("expert_using").replacingOccurrences(of: "{u}", with: customWorker))
                        .font(.tMeta).foregroundColor(.tMuted)
                }
                if !customWorker.isEmpty {
                    Toggle(isOn: $customWorkerAll) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.t("expert_all")).font(.tCardTitle).foregroundColor(.tText)
                            Text(store.t("expert_all_sub"))
                                .font(.tMeta).foregroundColor(.tMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .tint(.tPrimary)
                    .onChange(of: customWorkerAll) { on in
                        logger.settingChanged("Tout par le Worker personnel", value: on ? "oui" : "non")
                        guard on, let base = APIConfig.custom else { return }
                        workerNoDatabase = false
                        // Sans base D1, sauvegarde, retours et notifications y
                        // échoueraient en silence, pour toujours : l'option
                        // reste coupée. (La sauvegarde, elle, relit et fusionne
                        // avant d'écrire sur un nouveau Worker.)
                        Task {
                            guard await APIConfig.hasDatabase(base) == false,
                                  customWorkerAll, APIConfig.custom == base else { return }
                            customWorkerAll = false
                            workerNoDatabase = true
                            logger.warn("SETTINGS", "Worker personnel sans base D1", base)
                        }
                    }
                    if workerNoDatabase {
                        Text(store.t("expert_all_no_db"))
                            .font(.tMeta).foregroundColor(.tDanger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .onAppear { if workerInput.isEmpty { workerInput = customWorker } }
    }

    /// Adresse vérifiée (c'est bien un Worker TwitchUnblock) avant d'être gardée.
    private func checkWorker() {
        guard let base = APIConfig.normalize(workerInput) else { workerResult = .notAWorker; return }
        workerChecking = true
        workerResult = nil
        Task {
            let result = await APIConfig.check(base)
            workerChecking = false
            workerResult = result
            guard result == .ok else {
                logger.warn("SETTINGS", "Worker personnel refusé (\(result))", base)
                return
            }
            customWorker = base
            workerInput = base
            workerNoDatabase = false
            logger.settingChanged("Worker personnel", value: base)
            // « Tout par ce Worker » déjà actif : le nouveau doit avoir sa base D1.
            if customWorkerAll, await APIConfig.hasDatabase(base) == false, APIConfig.custom == base {
                customWorkerAll = false
                workerNoDatabase = true
            }
        }
    }

    private func resetWorker() {
        customWorker = ""
        customWorkerAll = false
        workerInput = ""
        workerResult = nil
        workerNoDatabase = false
        logger.settingChanged("Worker personnel", value: "officiels")
    }

    @ViewBuilder private var langueCard: some View {
        // ── Langue ──────────────────────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 12) {
                topLangRow
                Divider().background(Color.tBorder)
                toggleRow(store.t("home_list"), store.t("home_list_sub"),
                          $store.homeListLayout, log: "Accueil en liste")
                Divider().background(Color.tBorder)
                toggleRow(store.t("show_recent"), store.t("show_recent_sub"),
                          $store.showRecentChannels, log: "Streamers récents")
            }
        }
    }

    /// Chaînes et catégories masquées du top et des catégories : combien, et
    /// la feuille pour les réafficher.
    @ViewBuilder private var hiddenCard: some View {
        settingCard {
            VStack(alignment: .leading, spacing: 12) {
                label("eye.slash", store.t("hidden_title"))
                Text(store.t("hidden_sub"))
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
                if store.hidden.isEmpty {
                    Text(store.t("hidden_empty"))
                        .font(.tMeta).foregroundColor(.tMuted)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    let channels = store.t("hidden_channels_n")
                        .replacingOccurrences(of: "{n}", with: "\(store.hidden.channels.count)")
                    let categories = store.t("hidden_categories_n")
                        .replacingOccurrences(of: "{n}", with: "\(store.hidden.categories.count)")
                    Button { showHidden = true } label: {
                        HStack(spacing: 8) {
                            Text("\(channels) · \(categories)")
                                .font(.tCardTitle).foregroundColor(.tText)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundColor(.tMuted)
                        }
                        .padding(12)
                        .background(Color.tSurface)
                        .cornerRadius(10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Couleur d'accent, fond, verre liquide (iOS 26) : voir Theme.swift.
    @ViewBuilder private var apparenceCard: some View {
        settingCard {
            VStack(alignment: .leading, spacing: 14) {
                label("paintpalette.fill", store.t("appearance"))
                VStack(alignment: .leading, spacing: 8) {
                    Text(store.t("accent_color"))
                        .font(.tCardTitle).foregroundColor(.tText)
                    HStack(spacing: 8) {
                        ForEach(AccentTheme.allCases) { a in
                            let on = store.accent == a
                            Button {
                                logger.settingChanged("Couleur d'accent", value: a.rawValue)
                                store.accent = a
                            } label: {
                                Circle().fill(a.color)
                                    .frame(width: 28, height: 28)
                                    .overlay(Circle().stroke(Color.white, lineWidth: on ? 2.5 : 0))
                                    .overlay {
                                        if on {
                                            Image(systemName: "checkmark")
                                                .font(.caption2.weight(.bold))
                                                .foregroundColor(.white)
                                        }
                                    }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(store.t(a.labelKey))
                        }
                    }
                }
                Divider().background(Color.tBorder)
                appIconRow
            }
        }
    }

    /// Icône de l'app : « Contraste » reste nette en icônes transparentes ou
    /// teintées (iOS 26), toutes ont leurs versions sombre et teintée.
    @ViewBuilder private var appIconRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.t("app_icon"))
                .font(.tCardTitle).foregroundColor(.tText)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(AppIconChoice.allCases) { choice in
                        let on = appIcon == choice
                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            appIconError = nil
                            choice.apply { error in
                                guard let error else {
                                    appIcon = choice
                                    logger.settingChanged("Icône de l'app", value: choice.rawValue)
                                    return
                                }
                                appIconError = error == AppIconChoice.unsupported
                                    ? store.t("app_icon_unsupported")
                                    : store.t("app_icon_failed").replacingOccurrences(of: "{e}", with: error)
                            }
                        } label: {
                            VStack(spacing: 6) {
                                Image(choice.previewName)
                                    .resizable()
                                    .frame(width: 58, height: 58)
                                    .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous)
                                        .stroke(on ? Color.tPrimary : Color.tBorder, lineWidth: on ? 3 : 1))
                                Text(store.t(choice.labelKey))
                                    .font(.tMeta)
                                    .foregroundColor(on ? .tText : .tMuted)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(store.t(choice.labelKey))
                    }
                }
                .padding(.vertical, 3)
            }
            if let appIconError {
                Text(appIconError)
                    .font(.tMeta).foregroundColor(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Signée avec l'identifiant générique d'un certificat (Feather sans
            // « Merge Entitlements ») : iOS refuse le changement d'icône.
            if SigningInfo.signedForOtherIdentifier, let id = SigningInfo.applicationIdentifier {
                Text(store.t("app_icon_wildcard").replacingOccurrences(of: "{id}", with: id))
                    .font(.tMeta).foregroundColor(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(store.t("app_icon_sub"))
                .font(.tMeta).foregroundColor(.tMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .onAppear { appIcon = AppIconChoice.current }
    }

    /// Langue des streamers dans « Top des lives » (appareil par défaut).
    @ViewBuilder private var topLangRow: some View {
        let device = TopLanguage.name(TopLanguage.device, in: store.lang)
        let options = TopLanguage.codes
            .map { ($0, TopLanguage.name($0, in: store.lang)) }
            .sorted { $0.1.localizedCompare($1.1) == .orderedAscending }
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.t("top_lang"))
                    .font(.tCardTitle)
                    .foregroundColor(.tText)
                Text(store.t("top_lang_sub").replacingOccurrences(of: "{l}", with: device))
                    .font(.tMeta)
                    .foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Menu {
                Button { store.topLang = nil } label: {
                    if store.topLang == nil { Label("\(store.t("lang_auto")) · \(device)", systemImage: "checkmark") }
                    else { Text("\(store.t("lang_auto")) · \(device)") }
                }
                Divider()
                ForEach(options, id: \.0) { code, name in
                    Button { store.topLang = code } label: {
                        if store.topLang == code { Label(name, systemImage: "checkmark") } else { Text(name) }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(store.topLang.map { TopLanguage.name($0, in: store.lang) } ?? store.t("lang_auto"))
                        .font(.tCardTitle)
                    Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold))
                }
                .foregroundColor(.tPrimary)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.tPrimary.opacity(0.12))
                .cornerRadius(10)
            }
        }
        .padding(.top, 6)
    }

    @ViewBuilder private var autoclaimCard: some View {
        // ── Auto-claim coffres ──────────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 8) {
                label("gift.fill", store.t("auto_claim"))
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.t("auto_claim"))
                            .font(.tCardTitle)
                            .foregroundColor(.tText)
                        Text(store.t("auto_claim_sub"))
                            .font(.tMeta)
                            .foregroundColor(.tMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    Toggle("", isOn: $store.autoClaimChest)
                        .labelsHidden()
                        .tint(.tPrimary)
                        .onChange(of: store.autoClaimChest) { val in
                            logger.settingChanged("Auto-claim coffres", value: val ? "activé" : "désactivé")
                        }
                }
            }
        }
    }

    @ViewBuilder private var persoCard: some View {
        // ── Personnalisation chat & lecteur ─────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 14) {
                label("paintbrush.fill", store.t("customize"))
                toggleRow(store.t("cfg_pinned"), store.t("cfg_pinned_sub"),
                          $store.showPinnedMessages, log: "Messages épinglés")
                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_drops_notice"), store.t("cfg_drops_notice_sub"),
                          $store.showDropsNotice, log: "Carte des drops")
                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_follow"), store.t("cfg_follow_sub"),
                          $store.showFollowButton,   log: "Bouton suivre")
                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_streak"), store.t("cfg_streak_sub"),
                          $store.showWatchStreak,    log: "Série de visionnage")
                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_events"), store.t("cfg_events_sub"),
                          $store.showLiveEvents,     log: "Événements live")
                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_raids"),  store.t("cfg_raids_sub"),
                          $store.enableRaids,        log: "Système de raid")
                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_land_notices"), store.t("cfg_land_notices_sub"),
                          $store.landscapeNoticesHidden, log: "Bandeaux repliés en paysage")
            }
        }
    }

    /// Test et état des notifications : savoir si iOS réveille bien l'app.
    @ViewBuilder private var liveNotifTools: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Task {
                    let ok = await LiveNotifier.sendTest(lang: store.lang)
                    await MainActor.run { notifTestResult = ok ? store.t("notif_test_sent") : store.t("notif_test_denied") }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "bell.badge.fill").font(.footnote.weight(.semibold))
                    Text(store.t("notif_test")).font(.subheadline.weight(.semibold))
                }
                .foregroundColor(.tPrimary)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color.tPrimary.opacity(0.12))
                .cornerRadius(10)
            }
            .buttonStyle(.plain)
            if let notifTestResult {
                Text(notifTestResult).font(.tMeta).foregroundColor(.tMuted)
            }
            Text(notifStatusLine).font(.tMeta).foregroundColor(.tMuted)
                .fixedSize(horizontal: false, vertical: true)
            if UIApplication.shared.backgroundRefreshStatus != .available {
                Text(store.t("notif_bg_off")).font(.tMeta).foregroundColor(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let err = UserDefaults.standard.string(forKey: LiveNotifier.submitErrorKey) {
                Text("\(store.t("notif_bg_refused")) (\(err))").font(.tMeta).foregroundColor(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.leading, 2)
    }

    // Reused (main thread only); the locale is reset only when the app language changes.
    private static let notifRelativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        return f
    }()

    private var notifStatusLine: String {
        guard let last = LiveNotifier.lastRun else { return store.t("notif_last_never") }
        let f = Self.notifRelativeFormatter
        let id = store.lang.rawValue
        if f.locale.identifier != id { f.locale = Locale(identifier: id) }
        let ok = UserDefaults.standard.bool(forKey: LiveNotifier.lastOkKey)
        return store.t("notif_last_run").replacingOccurrences(of: "{t}", with: f.localizedString(for: last, relativeTo: Date()))
            + (ok ? "" : " · " + store.t("notif_last_failed"))
    }

    @ViewBuilder private var chatBehaviorCard: some View {
        // ── Comportement du chat ────────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 14) {
                label("bubble.left.and.bubble.right.fill", store.t("chat_behavior"))
                toggleRow(store.t("cfg_recent"), store.t("cfg_recent_sub"),
                          $store.chatLoadRecent, log: "Messages récents")
                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_autocomplete"), store.t("cfg_autocomplete_sub"),
                          $store.chatAutocomplete, log: "Autocomplétion")
                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_deleted"), store.t("cfg_deleted_sub"),
                          $store.chatShowDeleted, log: "Messages supprimés")
                Divider().background(Color.tBorder)
                toggleRow(store.t("hide_bots"), store.t("hide_bots_sub"),
                          $store.chatHideBots, log: "Masquer les bots")
                Divider().background(Color.tBorder)
                toggleRow(store.t("hide_commands"), store.t("hide_commands_sub"),
                          $store.chatHideCommands, log: "Masquer les commandes")
                Divider().background(Color.tBorder)
                toggleRow(store.t("dbg_chat_delay"), store.t("dbg_chat_delay_sub"),
                          $store.autoChatDelay, log: "Synchro auto du chat")
                if store.autoChatDelay {
                    chatSyncNudgeRow
                }
                Divider().background(Color.tBorder)
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.t("muted_words"))
                        .font(.subheadline.weight(.semibold)).foregroundColor(.tText)
                    Text(store.t("muted_words_sub"))
                        .font(.caption).foregroundColor(.tMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    TextField("spoiler", text: $mutedDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.subheadline)
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .background(Color.tSurface).cornerRadius(8)
                        .onAppear { mutedDraft = store.chatMutedWords.joined(separator: ", ") }
                        .onChange(of: mutedDraft) { _ in
                            let w = Array(mutedDraft.split(separator: ",")
                                .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                                .filter { !$0.isEmpty }.prefix(50))
                            if w != store.chatMutedWords { store.chatMutedWords = w }
                        }
                }
                if !store.chatBlockedUsers.isEmpty {
                    Divider().background(Color.tBorder)
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(store.t("hidden_users").replacingOccurrences(of: "{n}", with: "\(store.chatBlockedUsers.count)"))
                                .font(.subheadline.weight(.semibold)).foregroundColor(.tText)
                            Text(store.chatBlockedUsers.suffix(6).joined(separator: ", "))
                                .font(.caption).foregroundColor(.tMuted).lineLimit(1)
                        }
                        Spacer()
                        Button(store.t("clear")) { store.chatBlockedUsers = [] }
                            .font(.footnote.weight(.bold)).foregroundColor(.tPrimary)
                    }
                }
                Divider().background(Color.tBorder)
                // Mots surlignés : en plus des mentions, séparés par des virgules.
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.t("highlight_words"))
                        .font(.subheadline.weight(.semibold)).foregroundColor(.tText)
                    Text(store.t("highlight_words_sub"))
                        .font(.caption).foregroundColor(.tMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    TextField("giveaway, tournoi", text: $highlightDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.subheadline)
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .background(Color.tSurface).cornerRadius(8)
                        .onAppear { highlightDraft = store.chatHighlightWords.joined(separator: ", ") }
                        .onSubmit { saveHighlightWords() }
                        .onChange(of: highlightDraft) { _ in saveHighlightWords() }
                }
            }
        }
    }

    private func saveHighlightWords() {
        let words = highlightDraft.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
        let capped = Array(words.prefix(30))
        if capped != store.chatHighlightWords { store.chatHighlightWords = capped }
    }

    @ViewBuilder private var tailleChatCard: some View {
        // ── Taille du chat ──────────────────────────────────
        // La bonne taille dépend de l'écran, de la distance de lecture et
        // de la vue de chacun : un aperçu en direct évite l'aller-retour
        // « je règle, je ferme, je regarde, je reviens ».
        settingCard {
            VStack(alignment: .leading, spacing: 14) {
                label("textformat.size", store.t("chat_sizing"))

                chatPreview

                Divider().background(Color.tBorder)
                toggleRow(store.t("cfg_timestamps"), store.t("cfg_timestamps_sub"),
                          $store.chatTimestamps, log: "Horodatage du chat")
                Divider().background(Color.tBorder)

                // Mêmes bornes que l'import d'une sauvegarde (AppStore).
                sliderRow(store.t("cfg_font_size"), key: \.chatFontSize,
                          range: AppStore.chatFontRange, step: 1) { String(format: "%.0f pt", $0) }
                sliderRow(store.t("cfg_msg_spacing"), key: \.chatSpacing,
                          range: AppStore.chatSpacingRange, step: 1) { String(format: "%.0f px", $0) }
                sliderRow(store.t("cfg_badge_scale"), key: \.chatBadgeScale,
                          range: AppStore.chatScaleRange, step: 0.05) { String(format: "%.2fx", $0) }
                sliderRow(store.t("cfg_emote_scale"), key: \.chatEmoteScale,
                          range: AppStore.chatScaleRange, step: 0.05) { String(format: "%.2fx", $0) }
                sliderRow(store.t("cfg_chat_width"), key: \.chatWidthRatio,
                          range: AppStore.chatWidthRange, step: 0.01) { String(format: "%.0f %%", $0 * 100) }

                Text(store.t("cfg_chat_width_sub"))
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    store.chatFontSize   = 13
                    store.chatSpacing    = 8
                    store.chatBadgeScale = 1
                    store.chatEmoteScale = 1
                    store.chatWidthRatio = 0.32
                    store.chatTimestamps = true
                } label: {
                    Text(store.t("reset_defaults"))
                        .font(.tLabel).foregroundColor(.tPrimary)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private var lecteurCard: some View {
        // ── Lecteur vidéo ───────────────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 14) {
                label("play.tv.fill", store.t("player_section"))
                toggleRow(store.t("immersive_player"), store.t("immersive_player_sub"),
                          $store.immersivePlayer, log: "Lecteur immersif")
                Divider().background(Color.tBorder)
                toggleRow(store.t("low_latency"), store.t("low_latency_sub"),
                          $store.lowLatency, log: "Mode faible latence")
                Divider().background(Color.tBorder)
                liveSourceRow
                Divider().background(Color.tBorder)
                preferredQualityRow
                Divider().background(Color.tBorder)
                toggleRow(store.t("fill_screen"), store.t("fill_screen_sub"),
                          $store.fillScreen, log: "Remplir l'écran")
                Divider().background(Color.tBorder)
                toggleRow(store.t("restore_muted"), store.t("restore_muted_sub"),
                          $store.restoreMutedAudio, log: "Rétablir le son des passages coupés")
                Divider().background(Color.tBorder)
                toggleRow(store.t("multi_chat"), store.t("multi_chat_sub"),
                          $store.multiLiveChat, log: "Chat dans le multi-live")
                Divider().background(Color.tBorder)
                spatialAudioRow
                Divider().background(Color.tBorder)
                toggleRow(store.t("dbg_latency"), store.t("dbg_latency_sub"),
                          $store.showLatency, log: "Afficher la latence")
            }
        }
    }

    /// Qualité préférée : celle qui démarre (ou la plus proche en dessous).
    @ViewBuilder private var preferredQualityRow: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.t("pref_quality"))
                    .font(.tCardTitle)
                    .foregroundColor(.tText)
                Text(store.t("pref_quality_sub"))
                    .font(.tMeta)
                    .foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Picker("", selection: $store.preferredQuality) {
                ForEach(kQualityPrefs, id: \.self) { pref in
                    Text(pref == "source" ? store.t("q_source")
                         : pref == "audio" ? store.t("q_audio") : "\(pref)p")
                        .tag(pref)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .tint(.tPrimary)
            .onChange(of: store.preferredQuality) { value in
                logger.settingChanged("Qualité préférée", value: value)
            }
        }
    }

    /// Audio spatial (AirPods) : seul choix qu'iOS laisse aux apps (voir SpatialAudio).
    @ViewBuilder private var spatialAudioRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.t("spatial_audio"))
                .font(.tCardTitle)
                .foregroundColor(.tText)
            Text(store.t("spatial_audio_sub"))
                .font(.tMeta)
                .foregroundColor(.tMuted)
                .fixedSize(horizontal: false, vertical: true)
            Picker("", selection: $store.spatialAudio) {
                Text(store.t("spatial_auto")).tag("auto")
                Text(store.t("spatial_off")).tag("off")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .onChange(of: store.spatialAudio) { value in
                logger.settingChanged("Audio spatial", value: value)
            }
        }
    }

    /// Ordre des sources du direct : getLive les essaie l'une après l'autre.
    /// Au-dessus, le direct par le compte pour les abonnés (sans pub), qui
    /// passe avant toutes les sources.
    @ViewBuilder private var liveSourceRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            toggleRow(store.t("sub_adfree"), store.t("sub_adfree_sub"),
                      $store.subAdFree, log: "Sans pub avec mon abonnement")
            // Il faut la session web : sans elle, de quoi l'ouvrir ici.
            if store.subAdFree, (store.twitchWebToken ?? "").isEmpty {
                Button { startWebLogin() } label: {
                    Label(store.t("sub_adfree_connect"), systemImage: "person.crop.circle.badge.plus")
                        .font(.tLabel)
                        .foregroundColor(.tPrimary)
                }
                .buttonStyle(.plain)
            }
            Divider().background(Color.tBorder)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.t("live_source_order"))
                    .font(.tCardTitle)
                    .foregroundColor(.tText)
                Text(store.t("live_source_order_sub"))
                    .font(.tMeta)
                    .foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(store.liveSourceOrder.enumerated()), id: \.element) { index, id in
                HStack(spacing: 10) {
                    Text("\(index + 1)")
                        .font(.tBadge)
                        .foregroundColor(.tPrimary)
                        .frame(width: 22, height: 22)
                        .background(Color.tPrimary.opacity(0.15))
                        .clipShape(Circle())
                    Text(store.t("src_\(id)"))
                        .font(.tCardTitle)
                        .foregroundColor(.tText)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    sourceArrow("chevron.up", label: "src_up", enabled: index > 0) {
                        store.moveLiveSource(id, by: -1)
                    }
                    sourceArrow("chevron.down", label: "src_down", enabled: index < store.liveSourceOrder.count - 1) {
                        store.moveLiveSource(id, by: 1)
                    }
                }
                .padding(.vertical, 3)
                .padding(.leading, 10)
                .padding(.trailing, 4)
                .background(Color.tSurface)
                .cornerRadius(10)
            }
            if store.liveSourceOrder != kLiveSources {
                Button(store.t("src_reset")) {
                    withAnimation { store.liveSourceOrder = kLiveSources }
                }
                .font(.tLabel)
                .foregroundColor(.tPrimary)
                .buttonStyle(.plain)
            }
        }
        .onChange(of: store.liveSourceOrder) { order in
            logger.settingChanged("Ordre des sources", value: order.joined(separator: ","))
        }
    }

    private func sourceArrow(_ icon: String, label: String, enabled: Bool,
                             action: @escaping () -> Void) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            withAnimation(.easeInOut(duration: 0.2)) { action() }
        } label: {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundColor(enabled ? .tPrimary : .tMuted.opacity(0.4))
                .frame(width: 34, height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(store.t(label))
    }

    @ViewBuilder private var veilleCard: some View {
        // ── Minuteur de veille ──────────────────────────────
        // Les durées (préréglages + durée personnalisée) sont réglées dans
        // la même feuille que depuis le lecteur : une seule UI à maintenir.
        settingCard {
            VStack(alignment: .leading, spacing: 12) {
                label("moon.zzz.fill", store.t("sleep_timer"))
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        if sleepTimer.isActive {
                            Text(store.t("sleep_remaining"))
                                .font(.tMeta).foregroundColor(.tMuted)
                            Text(sleepTimer.label)
                                .font(.title.weight(.bold).monospacedDigit())
                                .foregroundColor(.tPurple)
                        } else {
                            Text(store.t("sleep_timer_sub"))
                                .font(.tMeta).foregroundColor(.tMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 8)
                    Button { showSleepSheet = true } label: {
                        Text(sleepTimer.isActive ? store.t("sleep_edit")
                                                 : store.t("sleep_set"))
                            .font(.tLabel)
                            .foregroundColor(.tPrimary)
                            .fixedSize()
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(Color.tPrimary.opacity(0.15))
                            .cornerRadius(8)
                            .overlay(RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.tPrimary, lineWidth: 1))
                    }
                }
            }
        }
    }

    @ViewBuilder private var cacheCard: some View {
        // ── Cache emotes & badges ───────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 14) {
                label("externaldrive.fill", store.t("cache_section"))
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.t("cache_size"))
                            .font(.tCardTitle)
                            .foregroundColor(.tText)
                        Text("\(cacheSizeText) · \(cacheFiles) \(store.t("cache_files"))")
                            .font(.tMeta)
                            .foregroundColor(.tMuted)
                    }
                    Spacer(minLength: 8)
                    Button {
                        ImageCache.shared.purge()
                        refreshCacheInfo()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "trash")
                            Text(store.t("cache_clear"))
                                .font(.tLabel)
                        }
                        .foregroundColor(.tDanger)
                        .fixedSize()
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Color.tDanger.opacity(0.15))
                        .cornerRadius(8)
                        .overlay(RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.tDanger, lineWidth: 1))
                    }
                    .disabled(cacheBytes == 0)
                    .opacity(cacheBytes == 0 ? 0.4 : 1)
                }
                Divider().background(Color.tBorder)
                toggleRow(store.t("cache_auto"), store.t("cache_auto_sub"),
                          $store.autoPurgeImageCache, log: "Purge auto du cache")
            }
        }
    }

    /// Bandeau de session web expirée. Affiché seulement après un refus franc
    /// de Twitch : une session jamais utilisée n'a rien à signaler.
    @ViewBuilder private var webSessionCard: some View {
        if let other = store.webSessionMismatch {
            settingCard {
                VStack(alignment: .leading, spacing: TSpace.md) {
                    HStack(spacing: TSpace.sm) {
                        Image(systemName: "person.crop.circle.badge.exclamationmark")
                            .foregroundColor(.tWarning)
                        Text(store.t("web_mismatch"))
                            .font(.tCardTitle).foregroundColor(.tText)
                    }
                    Text(store.t("web_mismatch_sub")
                            .replacingOccurrences(of: "{w}", with: other)
                            .replacingOccurrences(of: "{a}", with: store.twitchLogin ?? "?"))
                        .font(.tMeta).foregroundColor(.tMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    // Le bandeau reste tant que la bonne session n'est pas
                    // là (adoptWebToken l'efface) : annuler ne le perd pas.
                    TPrimaryButton(title: store.t("web_reconnect")) { startWebLogin() }
                }
            }
        }
        if store.webSessionExpired {
            settingCard {
                VStack(alignment: .leading, spacing: TSpace.md) {
                    HStack(spacing: TSpace.sm) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.tWarning)
                        Text(store.t("web_expired"))
                            .font(.tCardTitle).foregroundColor(.tText)
                    }
                    Text(store.t("web_expired_sub"))
                        .font(.tMeta).foregroundColor(.tMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    TPrimaryButton(title: store.t("web_reconnect")) { startWebLogin() }
                }
            }
        }
    }

    @ViewBuilder private var compteCard: some View {
        // ── Compte Twitch ───────────────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 14) {
                label("person.crop.circle.fill", store.t("twitch_account"))

                // Connexion API (OAuth) — chat + chaînes suivies
                accountRow(
                    title: store.t("account_api"),
                    sub: store.t("account_api_sub"),
                    connected: store.twitchToken != nil,
                    busy: apiLoggingIn,
                    actionLabel: store.twitchToken != nil ? store.t("btn_logout")
                                                          : store.t("btn_login_twitch")
                ) {
                    if store.twitchToken != nil { showLogoutAlert = true }
                    else { Task { await handleApiLogin() } }
                }

                // Passer sur un autre compte sans repasser par Safari, qui
                // reconnectait aussitôt le compte dont il se souvient.
                if store.twitchToken != nil {
                    Button { Task { await switchAccount() } } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "arrow.left.arrow.right.circle.fill")
                                .font(.callout)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(store.t("switch_account")).font(.tLabel)
                                Text(store.t("switch_account_sub"))
                                    .font(.tMeta).foregroundColor(.tMuted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                        }
                        .foregroundColor(.tPrimary)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(apiLoggingIn)
                }

                Divider().background(Color.tBorder)

                // Session web — points de chaîne (cookie auth-token)
                accountRow(
                    title: store.t("account_web"),
                    sub: store.t("account_web_sub"),
                    connected: store.twitchWebToken != nil,
                    busy: false,
                    actionLabel: store.twitchWebToken != nil ? store.t("btn_logout")
                                                             : store.t("points_connect_btn")
                ) {
                    if store.twitchWebToken != nil {
                        logger.info("AUTH/WEB", "Déconnexion session web", nil)
                        store.twitchWebToken = nil
                        Task { await TwitchWebSession.clear() }
                    } else {
                        startWebLogin()
                    }
                }
            }
        }
    }

    @ViewBuilder private var historiqueCard: some View {
        // ── Historique ──────────────────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 12) {
                label("chart.bar.fill", store.t("history"))
                HStack(spacing: TSpace.sm) {
                    statBox(value: vodCount, label: store.t("vods"), icon: "film")
                    statBox(value: channelCount, label: store.t("channels"), icon: "person.fill")
                }
                if vodCount > 0 || channelCount > 0 {
                    TSecondaryButton(title: store.t("btn_clear"), icon: "trash",
                                     tint: .tDanger, fullWidth: true) {
                        showClearAlert = true
                    }
                }
            }
        }
    }

    @ViewBuilder private var backupCard: some View {
        // ── Sauvegarde ──────────────────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 12) {
                label("arrow.up.arrow.down.circle.fill", store.t("backup"))
                Text(store.t("backup_sub"))
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: TSpace.sm) {
                    TSecondaryButton(title: store.t("export_data"), icon: "square.and.arrow.up",
                                     tint: .tPrimary, fullWidth: true) {
                        exportDoc = BackupDocument(data: Backup.export(store: store))
                        showExporter = true
                    }
                    TSecondaryButton(title: store.t("import_data"), icon: "square.and.arrow.down",
                                     tint: .tPrimary, fullWidth: true) {
                        showImporter = true
                    }
                }
                if let backupMessage {
                    Text(backupMessage)
                        .font(.tMeta).foregroundColor(.tMuted)
                }
            }
        }
        .fileExporter(isPresented: $showExporter, document: exportDoc,
                      contentType: .json, defaultFilename: Backup.fileName()) { result in
            if case .success = result { backupMessage = store.t("export_done") }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url),
                  let result = try? Backup.importData(data, store: store) else {
                backupMessage = store.t("import_bad"); return
            }
            var message = String(format: store.t("import_done"), result.added)
            // Au-delà de 300 suivis sur l'appareil, le reste n'est pas pris :
            // dit, plutôt que compté comme ajouté.
            if result.skipped > 0 { message += " " + String(format: store.t("import_capped"), result.skipped) }
            backupMessage = message
            logger.info("SAUVEGARDE", "Import : \(result.added) chaîne(s) ajoutée(s)",
                        result.skipped > 0 ? "\(result.skipped) ignorée(s) (limite de 300)" : nil)
        }
    }

    @ViewBuilder private var debugCard: some View {
        // ── Fonctionnalités en test ─────────────────────────
        // Ce qui marche mais demande encore des retours avant d'être rangé
        // avec le reste (aujourd'hui : les notifications de live).
        settingCard {
            VStack(alignment: .leading, spacing: 14) {
                Text(store.t("debug_note"))
                    .font(.tMeta)
                    .foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
                // Notifications quand une chaîne suivie passe en live.
                toggleRow(store.t("notif_live"), store.t("notif_live_sub"),
                          Binding(get: { liveNotif }, set: { on in
                              liveNotif = on
                              if on {
                                  Task { let ok = await LiveNotifier.enable(); await MainActor.run { liveNotif = ok } }
                              } else {
                                  LiveNotifier.disable()
                              }
                          }), log: "Notifications de live")
                if liveNotif { liveNotifTools }
                Divider().background(Color.tBorder)
                // Instantanées, même app fermée : par l'app ntfy.
                toggleRow(store.t("ntfy_live"), store.t("ntfy_live_sub"),
                          Binding(get: { ntfyOn }, set: { on in
                              ntfyOn = on
                              ntfyResult = nil
                              Task {
                                  if on {
                                      // Reste activé même si le serveur ne répond pas
                                      // encore : nouvel essai à chaque retour dans l'app.
                                      let ok = await NtfyNotifier.enable(lang: store.lang)
                                      await MainActor.run {
                                          ntfySynced = ok
                                          if !ok { ntfyResult = ntfyPendingText }
                                      }
                                  } else {
                                      await NtfyNotifier.disable()
                                  }
                              }
                          }), log: "Notifications ntfy")
                if ntfyOn { ntfyTools }
            }
        }
    }

    /// Activé, mais pas encore accepté par le serveur : pourquoi, et la suite.
    private var ntfyPendingText: String {
        store.t(NtfyNotifier.serverNotReady ? "ntfy_not_ready" : "ntfy_pending")
    }

    /// ntfy : le sujet à ajouter dans l'app ntfy, l'installer, tester.
    @ViewBuilder private var ntfyTools: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(store.t("ntfy_steps"))
                .font(.tMeta).foregroundColor(.tMuted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Text(NtfyNotifier.topic)
                    .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                    .foregroundColor(.tText)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .textSelection(.enabled)
                Spacer(minLength: 4)
                Button {
                    UIPasteboard.general.string = NtfyNotifier.topic
                    ntfyCopied = true
                } label: {
                    Label(store.t(ntfyCopied ? "ntfy_copied" : "ntfy_copy"),
                          systemImage: ntfyCopied ? "checkmark" : "doc.on.doc")
                        .font(.footnote.weight(.semibold))
                        .foregroundColor(.tPrimary)
                }
                .buttonStyle(.plain)
            }
            .padding(10)
            .background(Color.tSurface)
            .cornerRadius(10)
            HStack(spacing: 8) {
                Link(destination: NtfyNotifier.appStoreURL) {
                    ntfyPill(store.t("ntfy_install"), icon: "arrow.down.app.fill")
                }
                Button {
                    ntfyResult = nil
                    Task {
                        let result = await NtfyNotifier.sendTest(lang: store.lang)
                        await MainActor.run { ntfyResult = store.t(result.textKey) }
                    }
                } label: {
                    ntfyPill(store.t("notif_test"), icon: "bell.badge.fill")
                }
                .buttonStyle(.plain)
            }
            if let ntfyResult {
                Text(ntfyResult).font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if ntfySynced {
                Text(store.t("ntfy_status").replacingOccurrences(
                    of: "{n}", with: "\(UserDefaults.standard.integer(forKey: NtfyNotifier.countKey))"))
                    .font(.tMeta).foregroundColor(.tMuted)
            } else if ntfyResult == nil {
                Text(ntfyPendingText).font(.tMeta).foregroundColor(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(store.t("ntfy_privacy"))
                .font(.tMeta).foregroundColor(.tMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, 2)
    }

    private func ntfyPill(_ title: String, icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.footnote.weight(.semibold))
            Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
        }
        .foregroundColor(.tPrimary)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.tPrimary.opacity(0.12))
        .cornerRadius(10)
    }

    private var versionLabel: String {
        // Même numéro que la source et les versions GitHub (1.1.4…).
        "\(store.t("version_label")) \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")"
    }

    /// Lien externe façon bouton (crédits).
    /// An unparsable URL hides the row instead of crashing on a force unwrap.
    @ViewBuilder
    private func creditLink(icon: String, title: String, url: String) -> some View {
        if let destination = URL(string: url) {
            Link(destination: destination) {
                HStack(spacing: TSpace.sm) {
                    Image(systemName: icon).font(.footnote.weight(.semibold))
                    Text(title).font(.tLabel)
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.caption.weight(.semibold))
                }
                .foregroundColor(.tText)
                .padding(.horizontal, TSpace.md)
                .frame(height: 44)
                .background(Color.tSurface)
                .cornerRadius(TRadius.control)
            }
        }
    }

    @ViewBuilder private var aboutCard: some View {
        // ── À propos / Logs ─────────────────────────────────
        settingCard {
            VStack(alignment: .leading, spacing: 12) {
                label("info.circle.fill", store.t("about"))
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("TwitchUnblock")
                            .font(.tSection)
                            .foregroundColor(.tText)
                        Text(versionLabel)
                            .font(.tMeta)
                            .foregroundColor(.tMuted)
                    }
                    Spacer()
                    Circle().fill(Color.tPrimary).frame(width: 26, height: 26)
                }

                Text(store.t("about_desc"))
                    .font(.tMeta)
                    .foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)

                // ── Crédits ──────────────────────────────────────
                HStack(spacing: 4) {
                    Text(store.t("made_by")).foregroundColor(.tMuted)
                    Link("MXFia19", destination: URL(string: "https://github.com/MXFia19")!)
                        .foregroundColor(.tPrimary)
                }
                .font(.subheadline.weight(.semibold))

                creditLink(icon: "chevron.left.forwardslash.chevron.right",
                           title: store.t("source_ios"),
                           url: "https://github.com/MXFia19/TwitchUnblock")
                Text(store.t("not_affiliated"))
                    .font(.tMeta)
                    .foregroundColor(.tMuted.opacity(0.8))

                Button {
                    showLogs = true
                } label: {
                    HStack(spacing: TSpace.sm) {
                        Image(systemName: "terminal")
                            .font(.footnote.weight(.semibold))
                        Text(store.t("show_logs")).font(.tLabel)
                        Spacer()
                        Text("\(AppLogger.shared.logs.count)")
                            .font(.tBadge)
                            .foregroundColor(.white)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.tPrimary)
                            .cornerRadius(8)
                    }
                    .foregroundColor(.tPrimary)
                    .padding(.horizontal, TSpace.md)
                    .frame(height: 44)
                    .background(Color.tPrimary.opacity(0.12))
                    .cornerRadius(TRadius.control)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func loyaltyRow(_ title: String, _ value: Int,
                            _ total: Int, _ tint: Color) -> some View {
        let ratio = total > 0 ? Double(value) / Double(total) : 0
        HStack(spacing: TSpace.sm) {
            Text(title)
                .font(.tMeta).foregroundColor(.tMuted)
                .frame(width: 92, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.tSurface)
                    Capsule().fill(tint)
                        .frame(width: max(value > 0 ? 4 : 0, geo.size.width * ratio))
                }
            }
            .frame(height: 8)

            Text("\(value)")
                .font(.tLabel).foregroundColor(value > 0 ? .tText : .tMuted)
                .frame(width: 28, alignment: .trailing)
        }
    }

    // MARK: – Cache
    private var cacheSizeText: String {
        ByteCountFormatter.string(fromByteCount: cacheBytes, countStyle: .file)
    }

    /// Lit la taille du cache hors du thread principal (parcours de dossier).
    private func refreshCacheInfo() {
        Task.detached(priority: .utility) {
            let bytes = ImageCache.shared.diskSize()
            let files = ImageCache.shared.fileCount()
            await MainActor.run { cacheBytes = bytes; cacheFiles = files }
        }
    }

    // MARK: – Actions login
    private func handleApiLogin() async {
        apiLoggingIn = true
        defer { apiLoggingIn = false }
        if let token = await TwitchAuthManager.shared.login() {
            store.adoptToken(token)
            logger.success("AUTH", "Connexion API réussie", nil)
        }
    }

    /// Changer de compte : Twitch demande les identifiants dans une session
    /// privée. Le compte actuel reste en place tant que le nouveau n'est pas
    /// connecté — annuler ne déconnecte pas.
    private func switchAccount() async {
        apiLoggingIn = true
        defer { apiLoggingIn = false }
        logger.info("AUTH", "Changement de compte…", nil)
        let previous = store.twitchUserId
        guard let token = await TwitchAuthManager.shared.login(chooseAccount: true) else { return }
        let user = await getTwitchUser(token: token)
        // Autre compte : la session web (points de chaîne) était celle de
        // l'ancien, et ses bandeaux (expirée, autre compte) avec elle.
        if user == nil || user?.id != previous {
            if store.twitchWebToken != nil {
                store.twitchWebToken = nil
                await TwitchWebSession.clear()
            }
            store.webSessionExpired = false
            store.webSessionMismatch = nil
        }
        store.adoptToken(token)
        if let user {
            store.twitchUserId = user.id
            store.twitchLogin  = user.login
            if !user.profileImageURL.isEmpty { store.twitchAvatar = user.profileImageURL }
        }
        logger.success("AUTH", "Compte changé", user?.login)
    }

    private func startWebLogin() {
        // Session refusée par Twitch ou d'un autre compte : cookies twitch.tv
        // effacés d'abord, sinon la page reprenait aussitôt l'ancienne
        // session au lieu de demander une connexion.
        webLoginClear = store.webSessionExpired || store.webSessionMismatch != nil
        showWebLogin = true
    }

    // MARK: – Aperçu du chat
    /// Deux lignes factices rendues par le vrai `ChatMessageRow` : ce qu'on voit
    /// ici est exactement ce que donnera le chat.
    private static let previewMessages: [ChatMessage] = [
        ChatMessage(id: "p1", userId: "0", userName: "lewdolas", displayName: "Lewdolas",
                    color: .tWarning, badges: [],
                    tokens: [.text("ça"), .text("va"), .text("y'a"), .text("des"),
                             .text("sourires")],
                    timestamp: Date()),
        ChatMessage(id: "p2", userId: "0", userName: "damonarix", displayName: "Damonarix",
                    color: .tOutplayer, badges: [],
                    tokens: [.text("L'honnêteté"), .text("d'un"), .text("Skaven"),
                             .mention("toi")],
                    timestamp: Date()),
    ]

    @ViewBuilder
    private var chatPreview: some View {
        let style = previewStyle()
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Self.previewMessages) { msg in
                    ChatMessageRow(message: msg, availableWidth: geo.size.width,
                                   style: style)
                }
            }
            .frame(width: geo.size.width, alignment: .leading)
        }
        // Hauteur tenue à la main : un GeometryReader n'en propose aucune. Large
        // de quatre lignes, pour le cas où les deux messages passent à la ligne
        // aux plus grosses tailles ; `clipped` évite tout débordement.
        .frame(height: sliderValue(\.chatFontSize) * 4 + sliderValue(\.chatSpacing) * 2 + 20)
        .clipped()
        .padding(TSpace.sm)
        .background(Color.tDark)
        .cornerRadius(TRadius.chip)
    }

    /// Store style with the live slider values, so the preview follows a drag.
    private func previewStyle() -> ChatStyle {
        var st = store.chatStyle(chrome: false, translucent: false)
        st.fontSize   = CGFloat(sliderValue(\.chatFontSize))
        st.rowPadding = CGFloat(sliderValue(\.chatSpacing)) / 2
        st.badgeScale = CGFloat(sliderValue(\.chatBadgeScale))
        st.emoteScale = CGFloat(sliderValue(\.chatEmoteScale))
        return st
    }

    /// Current value of a chat-size setting, preferring the in-progress drag.
    private func sliderValue(_ key: ReferenceWritableKeyPath<AppStore, Double>) -> Double {
        if let d = sliderDraft, d.key == key { return d.value }
        return store[keyPath: key]
    }

    // While dragging, the value lives in `sliderDraft` and is written to the
    // store only on release: each store write hits UserDefaults (didSet) and
    // invalidates every AppStore observer, ~60 times a second otherwise.
    // Same fix as the chat-resize drag in MainTabView.
    @ViewBuilder
    private func sliderRow(_ title: String, key: ReferenceWritableKeyPath<AppStore, Double>,
                           range: ClosedRange<Double>, step: Double,
                           format: @escaping (Double) -> String) -> some View {
        VStack(spacing: 2) {
            HStack {
                Text(title).font(.tCardTitle).foregroundColor(.tText)
                Spacer()
                Text(format(sliderValue(key)))
                    .font(.tMeta.monospacedDigit()).foregroundColor(.tMuted)
            }
            Slider(value: Binding(
                       get: { sliderValue(key) },
                       set: { v in
                           if let d = sliderDraft, d.key == key {
                               sliderDraft = (key: key, value: v)
                           } else {
                               // Changed without a drag (VoiceOver): commit now.
                               store[keyPath: key] = v
                           }
                       }),
                   in: range, step: step,
                   onEditingChanged: { editing in
                       if editing {
                           sliderDraft = (key: key, value: store[keyPath: key])
                       } else if let d = sliderDraft, d.key == key {
                           sliderDraft = nil
                           store[keyPath: key] = d.value
                       }
                   })
                .tint(.tPrimary)
        }
    }

    // MARK: – Subviews
    @ViewBuilder
    private func settingCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        // One grouped section per card, as in the Settings app.
        Section {
            VStack(alignment: .leading, spacing: 0) {
                content()
            }
            .padding(.vertical, TSpace.xs)
        }
    }

    /// Retouche de la synchro auto du chat, à la seconde (+ = chat plus tard).
    @ViewBuilder private var chatSyncNudgeRow: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(store.t("chat_sync_adjust"))
                    .font(.tCardTitle)
                    .foregroundColor(.tText)
                Text(store.t("chat_sync_adjust_sub"))
                    .font(.tMeta)
                    .foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Text(store.chatSyncNudge == 0 ? "0 s" : String(format: "%+.0f s", store.chatSyncNudge))
                .font(.subheadline.weight(.bold).monospacedDigit())
                .foregroundColor(store.chatSyncNudge == 0 ? .tMuted : .tPrimary)
            Stepper("", value: $store.chatSyncNudge, in: -20...20, step: 1)
                .labelsHidden()
                .onChange(of: store.chatSyncNudge) { v in
                    logger.settingChanged("Retouche de la synchro du chat", value: String(format: "%+.0f s", v))
                }
        }
        .padding(.leading, 4)
    }

    @ViewBuilder
    private func toggleRow(_ title: String, _ sub: String,
                           _ isOn: Binding<Bool>, log: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.tCardTitle)
                    .foregroundColor(.tText)
                Text(sub)
                    .font(.tMeta)
                    .foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Toggle("", isOn: isOn)
                .labelsHidden()
                .tint(.tPrimary)
                .onChange(of: isOn.wrappedValue) { v in
                    logger.settingChanged(log, value: v ? "activé" : "désactivé")
                }
        }
    }

    @ViewBuilder
    private func accountRow(title: String, sub: String, connected: Bool, busy: Bool,
                           actionLabel: String, action: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            Image(systemName: connected ? "checkmark.circle.fill" : "circle")
                .font(.body)
                .foregroundColor(connected ? .tSuccess : .tMuted)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.tCardTitle)
                    .foregroundColor(.tText)
                Text(connected ? store.t("connected") : sub)
                    .font(.tMeta)
                    .foregroundColor(connected ? .tSuccess : .tMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button(action: action) {
                if busy { ProgressView() } else { Text(actionLabel) }
            }
            .buttonStyle(.bordered)
            .tint(connected ? .tDanger : .tPrimary)
            .disabled(busy)
        }
    }

    /// Titre d'une carte de réglages.
    @ViewBuilder
    private func label(_ icon: String, _ text: String) -> some View {
        Label {
            Text(text).foregroundColor(.tText)
        } icon: {
            Image(systemName: icon).foregroundColor(.tPrimary)
        }
        .font(.headline)
        .padding(.bottom, 2)
    }

    @ViewBuilder
    private func statBox(value: Int, label: String, icon: String) -> some View {
        VStack(spacing: TSpace.xs) {
            Image(systemName: icon)
                .font(.callout)
                .foregroundColor(.tMuted)
            Text("\(value)")
                .font(.title.weight(.bold))
                .foregroundColor(.tPrimary)
            Text(label)
                .font(.tMeta)
                .foregroundColor(.tMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSpace.lg)
        .background(Color.tSurface)
        .cornerRadius(TRadius.control)
    }
}
