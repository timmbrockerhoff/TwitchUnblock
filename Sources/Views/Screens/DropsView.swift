import SwiftUI
import UserNotifications
import WebKit

// ═══════════════════════════════════════════════════════════════════════════
//  Réglages → Drops : réglages, drop en cours, campagnes et réclamation.
//  Tout passe par la session web, comme les points de chaîne (voir Drops.swift).
// ═══════════════════════════════════════════════════════════════════════════

struct DropsPanel: View {
    /// Ouvre la connexion à la session web (gérée par SettingsView).
    var onLogin: () -> Void = {}

    @EnvironmentObject private var store: AppStore
    @ObservedObject private var drops = DropsService.shared
    @ObservedObject private var heartbeat = DropsHeartbeat.shared
    /// Mode d'emploi déplié (replié une fois lu, et ça reste).
    @AppStorage("drops_help_open") private var helpOpen = true
    /// Campagnes ouvertes dépliées (récompenses affichées).
    @State private var expanded: Set<String> = []
    /// Campaigns waiting for a game account link: folded under the ready ones.
    @State private var linkGroupOpen = false
    @State private var showLinks = false

    private var webToken: String? {
        guard let t = store.twitchWebToken, !t.isEmpty else { return nil }
        return t
    }

    var body: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 14) {
                toggleRow(store.t("drops_progress"), store.t("drops_progress_sub"), $store.dropsProgress)
                Divider().background(Color.tBorder)
                toggleRow(store.t("drops_autoclaim"), store.t("drops_autoclaim_sub"), $store.autoClaimDrops)
                Divider().background(Color.tBorder)
                toggleRow(store.t("drops_notify"), store.t("drops_notify_sub"), $store.dropsNotify)
            }
            .tCard()

            if webToken != nil { statusCard }
            helpCard

            if let token = webToken {
                if let notice = drops.notice {
                    Text(notice.text)
                        .font(.tMeta.weight(.semibold))
                        .foregroundColor(notice.ok ? .tSuccess : .tLive)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .tCard()
                }
                if let s = drops.session { sessionCard(s) }
                campaignsList(token: token)
                availableList
            } else {
                VStack(alignment: .leading, spacing: TSpace.md) {
                    // Session web d'un autre compte : refusée, à reconnecter.
                    Text(store.webSessionMismatch.map {
                            store.t("web_mismatch_sub")
                                .replacingOccurrences(of: "{w}", with: $0)
                                .replacingOccurrences(of: "{a}", with: store.twitchLogin ?? "?")
                         } ?? store.t("drops_login"))
                        .font(.tMeta).foregroundColor(.tMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    TPrimaryButton(title: store.t("web_banner_btn")) { onLogin() }
                }
                .tCard()
            }
        }
        .task { await reload() }
        .onChange(of: store.twitchWebToken) { _ in Task { await reload() } }
        .onChange(of: store.dropsProgress) { on in
            logger.settingChanged("Drops : progression", value: on ? "activée" : "désactivée")
            if !on { DropsHeartbeat.shared.stop() }
        }
        .onChange(of: store.autoClaimDrops) { on in
            logger.settingChanged("Drops : réclamation auto", value: on ? "activée" : "désactivée")
        }
        .onChange(of: store.dropsNotify) { on in
            logger.settingChanged("Drops : notifications", value: on ? "activées" : "désactivées")
            if on { askNotificationPermission() }
        }
        .onDisappear { drops.notice = nil }
        .sheet(isPresented: $showLinks) {
            DropsLinkSheet { Task { await reload() } }
        }
    }

    /// iOS ne demande qu'une fois : sans effet si l'autorisation est déjà réglée.
    private func askNotificationPermission() {
        Task { _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) }
    }

    private func reload() async {
        if store.dropsNotify, webToken != nil { askNotificationPermission() }
        guard let token = webToken else { return }
        await drops.refresh(token: token, autoClaim: store.autoClaimDrops)
        // Après l'inventaire : un seul jeton d'intégrité pour les deux.
        await drops.refreshAvailable(token: token)
    }

    // MARK: Campagnes ouvertes (tous les jeux)
    @ViewBuilder private var availableList: some View {
        let started = Set(drops.campaigns.map(\.id))
        // Usable right away (Twitch badges, emotes) first; game account links last.
        let open = drops.available.filter { !started.contains($0.id) }
            .sorted { !$0.needsAccountLink && $1.needsAccountLink }
        HStack {
            Text(store.t("drops_available"))
                .font(.tSection).foregroundColor(.tText)
            Spacer()
            if drops.availableLoading { ProgressView().tint(.tPrimary) }
        }
        .padding(.horizontal, 4)
        .padding(.top, 6)

        if open.isEmpty {
            Text(drops.availableFailed ? store.t("drops_error")
                 : (drops.availableLoaded ? store.t("drops_available_empty") : store.t("loading")))
                .font(.tMeta).foregroundColor(.tMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .tCard()
        } else {
            Text(store.t("drops_available_sub"))
                .font(.tMeta).foregroundColor(.tMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
            LazyVStack(spacing: 8) {
                ForEach(open) { c in availableRow(c) }
            }
        }
    }

    private func availableRow(_ c: DropCampaign) -> some View {
        let isOpen = expanded.contains(c.id)
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    if isOpen { expanded.remove(c.id) } else { expanded.insert(c.id) }
                }
            } label: {
                HStack(spacing: TSpace.md) {
                    AsyncImage(url: URL(string: c.boxArtURL)) { img in
                        img.resizable().aspectRatio(3/4, contentMode: .fill)
                    } placeholder: {
                        Rectangle().fill(Color.tSurface)
                    }
                    .frame(width: 30, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.gameName)
                            .font(.tCardTitle).foregroundColor(.tText)
                            .lineLimit(1)
                        Text(c.name)
                            .font(.tMeta).foregroundColor(.tMuted)
                            .lineLimit(1)
                        Text(c.isUpcoming
                             ? store.t("drops_starts").replacingOccurrences(of: "{d}", with: c.startAt.map(relative) ?? "—")
                             : store.t("drops_ends").replacingOccurrences(of: "{d}", with: c.endAt.map(relative) ?? "—"))
                            .font(.tMeta).foregroundColor(c.isUpcoming ? .tWarning : .tMuted)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: isOpen ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.semibold)).foregroundColor(.tMuted)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isOpen {
                if c.needsAccountLink, let link = c.accountLinkURL, URL(string: link) != nil {
                    HStack(alignment: .top, spacing: TSpace.sm) {
                        Image(systemName: "link")
                            .font(.footnote.weight(.semibold)).foregroundColor(.tWarning)
                        Text(store.t("drops_link"))
                            .font(.tMeta).foregroundColor(.tMuted)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        Button(store.t("drops_link_btn")) { showLinks = true }
                            .font(.tMeta.weight(.semibold))
                            .foregroundColor(.tPrimary)
                            .buttonStyle(.plain)
                    }
                }
                ForEach(c.drops) { d in
                    HStack(spacing: TSpace.md) {
                        AsyncImage(url: URL(string: d.imageURL ?? "")) { img in
                            img.resizable().scaledToFit()
                        } placeholder: {
                            RoundedRectangle(cornerRadius: 8).fill(Color.tSurface)
                        }
                        .frame(width: 36, height: 36)
                        Text(d.name)
                            .font(.tMeta).foregroundColor(.tText)
                            .lineLimit(2)
                        Spacer(minLength: 8)
                        Text(store.t("drops_minutes_req").replacingOccurrences(of: "{t}", with: "\(d.requiredMinutes)"))
                            .font(.tMeta).foregroundColor(.tMuted)
                    }
                }
            }
        }
        .tCard()
    }

    // MARK: État en direct
    /// Ce que fait la progression maintenant : pas de live, chaîne sans
    /// drops, progression active, ou bloquée.
    private var statusCard: some View {
        let (icon, color, text) = statusInfo
        return HStack(spacing: TSpace.md) {
            Image(systemName: icon)
                .font(.callout.weight(.semibold)).foregroundColor(color)
                .frame(width: 22)
            Text(text)
                .font(.tMeta).foregroundColor(.tText)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .tCard()
    }

    private var statusInfo: (String, Color, String) {
        if !store.dropsProgress { return ("pause.circle.fill", .tMuted, store.t("drops_status_off")) }
        func line(_ key: String, _ login: String) -> String {
            store.t(key).replacingOccurrences(of: "{c}", with: login)
        }
        switch heartbeat.status {
        case .idle:            return ("tv", .tMuted, store.t("drops_status_idle"))
        case .checking(let l): return ("hourglass", .tMuted, line("drops_status_checking", l))
        case .noDrops(let l):  return ("xmark.circle", .tWarning, line("drops_status_none", l))
        case .active(let l):   return ("checkmark.circle.fill", .tSuccess, line("drops_status_active", l))
        case .failing(let l):  return ("exclamationmark.triangle.fill", .tLive, line("drops_status_failing", l))
        }
    }

    // MARK: Mode d'emploi
    private var helpCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { helpOpen.toggle() }
            } label: {
                HStack(spacing: TSpace.sm) {
                    Image(systemName: "questionmark.circle.fill")
                        .font(.callout).foregroundColor(.tPrimary)
                    Text(store.t("drops_help_title"))
                        .font(.tCardTitle).foregroundColor(.tText)
                    Spacer()
                    Image(systemName: helpOpen ? "chevron.up" : "chevron.down")
                        .font(.caption.weight(.semibold)).foregroundColor(.tMuted)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if helpOpen {
                ForEach(1...5, id: \.self) { step in
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(step)")
                            .font(.caption.weight(.bold))
                            .foregroundColor(.white)
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(Color.tPrimary))
                        Text(store.t("drops_help_\(step)"))
                            .font(.tMeta).foregroundColor(.tMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .tCard()
    }

    // MARK: Drop en cours
    private func sessionCard(_ s: DropSession) -> some View {
        HStack(spacing: TSpace.md) {
            Image(systemName: "dot.radiowaves.left.and.right")
                .font(.callout.weight(.semibold)).foregroundColor(.tLive)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.t("drops_now").replacingOccurrences(of: "{c}", with: s.channelName ?? "—"))
                    .font(.tCardTitle).foregroundColor(.tText)
                Text(minutes(s.currentMinutes, s.requiredMinutes))
                    .font(.tMeta).foregroundColor(.tMuted)
            }
            Spacer(minLength: 0)
        }
        .tCard()
    }

    // MARK: Campagnes
    @ViewBuilder
    private func campaignsList(token: String) -> some View {
        HStack {
            Text(store.t("drops_in_progress"))
                .font(.tSection).foregroundColor(.tText)
            Spacer()
            if drops.isLoading {
                ProgressView().tint(.tPrimary)
            } else {
                Button { Task { await reload() } } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.subheadline.weight(.semibold)).foregroundColor(.tPrimary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(store.t("drops_refresh"))
            }
        }
        .padding(.horizontal, 4)

        if drops.campaigns.isEmpty {
            Text(drops.failed ? store.t("drops_error") : (drops.loaded ? store.t("drops_empty") : store.t("loading")))
                .font(.tMeta).foregroundColor(.tMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .tCard()
        }
        let ready = drops.campaigns.filter { !$0.needsAccountLink }
        let waiting = drops.campaigns.filter(\.needsAccountLink)
        ForEach(ready) { c in campaignCard(c, token: token) }
        if !waiting.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { linkGroupOpen.toggle() }
                } label: {
                    HStack(spacing: TSpace.sm) {
                        Image(systemName: "link").font(.footnote.weight(.semibold)).foregroundColor(.tWarning)
                        Text(store.t("drops_link_group").replacingOccurrences(of: "{n}", with: "\(waiting.count)"))
                            .font(.tCardTitle).foregroundColor(.tText)
                        Spacer()
                        Image(systemName: linkGroupOpen ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.semibold)).foregroundColor(.tMuted)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Text(store.t("drops_link"))
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button(store.t("drops_link_all")) { showLinks = true }
                    .tProminentStyle().tCapsuleShape().controlSize(.small).tint(.tPrimary)
            }
            .tCard()
            if linkGroupOpen {
                ForEach(waiting) { c in campaignCard(c, token: token) }
            }
        }
    }

    private func campaignCard(_ c: DropCampaign, token: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: TSpace.md) {
                AsyncImage(url: URL(string: c.boxArtURL)) { img in
                    img.resizable().aspectRatio(3/4, contentMode: .fill)
                } placeholder: {
                    Rectangle().fill(Color.tSurface)
                }
                .frame(width: 36, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text(c.name)
                        .font(.tCardTitle).foregroundColor(.tText)
                        .lineLimit(2)
                    Text(c.gameName)
                        .font(.tMeta).foregroundColor(.tPurple)
                        .lineLimit(1)
                    if let end = c.endAt {
                        // "Endet vor 6 Tagen" read as nonsense for a campaign that is over.
                        Text(store.t(end < Date() ? "drops_ended" : "drops_ends")
                                .replacingOccurrences(of: "{d}", with: relative(end)))
                            .font(.tMeta).foregroundColor(.tMuted)
                    }
                }
                Spacer(minLength: 0)
            }

            // Sans liaison du compte de jeu, Twitch ne donne plus la récompense.
            if c.needsAccountLink {
                HStack(alignment: .top, spacing: TSpace.sm) {
                    Image(systemName: "link")
                        .font(.footnote.weight(.semibold)).foregroundColor(.tWarning)
                    Text(store.t("drops_link"))
                        .font(.tMeta).foregroundColor(.tMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    if c.accountLinkURL != nil {
                        Button(store.t("drops_link_btn")) { showLinks = true }
                            .font(.tMeta.weight(.semibold))
                            .foregroundColor(.tPrimary)
                            .buttonStyle(.plain)
                    }
                }
            }

            ForEach(c.drops) { d in dropRow(d, campaign: c, token: token) }
        }
        .tCard()
    }

    private func dropRow(_ d: TimedDrop, campaign c: DropCampaign, token: String) -> some View {
        HStack(spacing: TSpace.md) {
            AsyncImage(url: URL(string: d.imageURL ?? "")) { img in
                img.resizable().scaledToFit()
            } placeholder: {
                RoundedRectangle(cornerRadius: 8).fill(Color.tSurface)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 4) {
                Text(d.name)
                    .font(.tCardTitle).foregroundColor(.tText)
                    .lineLimit(2)
                ProgressView(value: d.progress)
                    .tint(d.isClaimed ? .tSuccess : .tPrimary)
                Text(d.hasPreconditionsMet ? minutes(d.currentMinutes, d.requiredMinutes) : store.t("drops_locked"))
                    .font(.tMeta).foregroundColor(.tMuted)
            }

            Spacer(minLength: 8)

            if d.isClaimed {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title3).foregroundColor(.tSuccess)
                    .accessibilityLabel(store.t("drops_claimed"))
            } else if d.canClaim && !c.needsAccountLink {
                Button {
                    Task {
                        if await drops.claim(d, token: token) {
                            await drops.refresh(token: token, autoClaim: false)
                        }
                    }
                } label: {
                    Group {
                        if drops.claiming.contains(d.id) {
                            ProgressView().tint(.white)
                        } else {
                            Text(store.t("drops_claim"))
                        }
                    }
                    .font(.tMeta.weight(.bold))
                }
                .tProminentStyle()
                .tCapsuleShape()
                .controlSize(.small)
                .tint(.tPrimary)
                .disabled(drops.claiming.contains(d.id))
            }
        }
    }

    // MARK: Aides
    private func toggleRow(_ title: String, _ sub: String, _ isOn: Binding<Bool>) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.tCardTitle).foregroundColor(.tText)
                Text(sub)
                    .font(.tMeta).foregroundColor(.tMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Toggle("", isOn: isOn).labelsHidden().tint(.tPrimary)
        }
    }

    private func minutes(_ current: Int, _ required: Int) -> String {
        store.t("drops_minutes")
            .replacingOccurrences(of: "{n}", with: "\(required > 0 ? min(current, required) : current)")
            .replacingOccurrences(of: "{t}", with: "\(required)")
    }

    // Reused (main thread only); the locale is reset only when the app language changes.
    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        return f
    }()

    private func relative(_ date: Date) -> String {
        let f = Self.relativeFormatter
        let id = store.lang.rawValue
        if f.locale.identifier != id { f.locale = Locale(identifier: id) }
        return f.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: – Linking game accounts
/// Every game account still to link, one row per publisher page; its page opens here, signed
/// in to Twitch already (same web data as the app's login). Linked rows go away on return.
struct DropsLinkSheet: View {
    var onDone: () -> Void = {}

    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var drops = DropsService.shared
    @ObservedObject private var heartbeat = DropsHeartbeat.shared

    var body: some View {
        NavigationStack {
            List {
                let links = drops.linksNeeded
                if links.isEmpty {
                    Label(store.t("drops_link_done"), systemImage: "checkmark.circle.fill")
                        .foregroundColor(.tSuccess)
                } else {
                    Section {
                        ForEach(links) { link in
                            NavigationLink {
                                DropsLinkPage(url: link.url)
                                    .navigationTitle(link.games.joined(separator: ", "))
                                    .navigationBarTitleDisplayMode(.inline)
                                    .onDisappear { refresh() }
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(link.games.joined(separator: ", ")).foregroundColor(.primary)
                                    Text(link.url.host ?? "").font(.caption).foregroundColor(.secondary)
                                }
                            }
                        }
                    } footer: {
                        Text(store.t("drops_link_sheet_sub"))
                    }
                }
            }
            .navigationTitle(store.t("drops_link_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.t("done")) { dismiss() }
                }
            }
        }
        // Full height: the publishers' pages are cramped in half a screen.
        .presentationDetents([.large])
        .onDisappear { onDone() }
    }

    private func refresh() {
        guard let token = store.twitchWebToken, !token.isEmpty else { return }
        Task { await drops.refresh(token: token, autoClaim: store.autoClaimDrops) }
    }
}

/// A publisher's link page in a WebView sharing the app's twitch.tv cookies.
private struct DropsLinkPage: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let web = WKWebView(frame: .zero)
        web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 "
            + "(KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
        web.allowsBackForwardNavigationGestures = true
        web.load(URLRequest(url: url))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
