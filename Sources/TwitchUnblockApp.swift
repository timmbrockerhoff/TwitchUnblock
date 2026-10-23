import SwiftUI

@main
struct TwitchUnblockApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var store = AppStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            MainTabView()
                // Avis internes (drops,
                // téléchargements), par-dessus le lecteur compris.
                .inAppNoticeHost()
                .environmentObject(store)
                // Notification ntfy touchée : twitchunblock://live/<chaîne>.
                .onOpenURL { url in
                    guard url.scheme == "twitchunblock", url.host == "live",
                          let login = url.pathComponents.dropFirst().first, !login.isEmpty else { return }
                    NotificationCenter.default.post(name: .openLiveChannel, object: nil,
                                                    userInfo: ["login": login.lowercased()])
                }
                .onChange(of: scenePhase) { phase in
                    switch phase {
                    case .background:
                        // Dernier moment sûr pour sauvegarder : iOS peut
                        // fermer l'app ensuite sans prévenir.
                        store.flushToCloud(force: true)
                        LiveNotifier.schedule()
                        VodDownloads.shared.sceneInactive()
                    case .inactive:
                        // Téléchargements : ce qui manque passe à iOS, avant
                        // que l'app soit en arrière-plan (sinon iOS attend
                        // le Wi-Fi ou la charge pour s'y mettre).
                        VodDownloads.shared.sceneInactive()
                    case .active:
                        // Avis arrivés en arrière-plan sans permission de
                        // notifier : affichés maintenant, dans l'app.
                        InAppNotices.shared.showPending()
                        // Network refreshes as one batch: skipped while the
                        // previous batch runs or if it started < 30 s ago
                        // (Control Center / Notification Center come back here).
                        ForegroundRefresh.shared.run {
                            [
                                // Ce qui a été regardé ailleurs entre-temps (site,
                                // autre appareil) — au plus une lecture par 10 min.
                                Task { @MainActor in await store.refreshFromCloudIfStale() },
                                // Lives vus dans l'app : pas de notification en retard
                                // au prochain réveil pour un live déjà découvert ici.
                                Task { @MainActor in _ = await LiveNotifier.check(notify: false) },
                                // ntfy : chaînes suivies changées (ou une fois par jour).
                                Task { @MainActor in _ = await NtfyNotifier.sync(lang: store.lang) },
                                // Drops finished while no drops channel was playing: claimed on
                                // return, not only when the Drops page is opened.
                                Task { @MainActor in
                                    guard store.autoClaimDrops, let web = store.twitchWebToken,
                                          !web.isEmpty else { return }
                                    await DropsService.shared.refresh(token: web, autoClaim: true)
                                },
                            ]
                        }
                        // Téléchargements : l'app reprend la main sur iOS,
                        // redemande ce qui manque (app fermée en la
                        // balayant…) et reprend les chats inachevés.
                        VodDownloads.shared.sceneActive()
                    default:
                        break
                    }
                }
        }
    }
}

/// Foreground network refreshes: one batch at a time, at most one start per
/// `minInterval`. Each service still applies its own throttling.
@MainActor
private final class ForegroundRefresh {
    static let shared = ForegroundRefresh()
    private var running: Task<Void, Never>?
    private var lastStart = Date.distantPast
    private let minInterval: TimeInterval = 30
    /// A batch running longer than this (stuck request) no longer blocks.
    private let stuckAfter: TimeInterval = 120

    func run(_ batch: () -> [Task<Void, Never>]) {
        let elapsed = Date().timeIntervalSince(lastStart)
        guard elapsed >= minInterval, running == nil || elapsed >= stuckAfter else { return }
        let started = Date()
        lastStart = started
        let tasks = batch()
        running = Task { @MainActor in
            for task in tasks { await task.value }
            // Only the latest batch clears the handle.
            if self.lastStart == started { self.running = nil }
        }
    }
}
