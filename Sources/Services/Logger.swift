import Foundation
import Combine

final class AppLogger: ObservableObject {
    static let shared = AppLogger()
    private init() {}

    @Published private(set) var logs: [LogEntry] = []
    private var counter = 0
    private let maxLogs = 500
    /// Entries not yet in `logs`, oldest first (main thread only). Published
    /// in one batch: one log line used to mean one array insert at index 0
    /// and one publish.
    private var pending: [LogEntry] = []
    private var publishScheduled = false
    /// Delay before a batch reaches `logs` (and LogsView).
    private let publishDelay: TimeInterval = 0.25

    /// One formatter for all lines (DateFormatter is thread-safe, costly to create).
    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    // ─── Core add ───────────────────────────────────────────────
    private func add(_ level: LogLevel, _ category: String, _ message: String, _ detail: String? = nil) {
        let now = Date()
        let ms = Calendar.current.component(.nanosecond, from: now) / 1_000_000
        let timestamp = Self.timeFormatter.string(from: now) + String(format: ".%03d", ms)
        // Identifiant attribué sur le fil principal : incrémenté depuis
        // plusieurs fils, le compteur pouvait donner deux fois le même id.
        DispatchQueue.main.async {
            let entry = LogEntry(id: self.counter, timestamp: timestamp, level: level,
                                 category: category, message: message, detail: detail)
            self.counter += 1
            self.pending.append(entry)
            if self.pending.count > self.maxLogs {
                self.pending.removeFirst(self.pending.count - self.maxLogs)
            }
            guard !self.publishScheduled else { return }
            self.publishScheduled = true
            DispatchQueue.main.asyncAfter(deadline: .now() + self.publishDelay) {
                self.publishPending()
            }
        }
        #if DEBUG
        let icons = ["info": "ℹ️", "success": "✅", "warn": "⚠️", "error": "❌", "debug": "🔍"]
        let icon = icons[level.rawValue] ?? "•"
        print("\(icon) [\(category)] \(message)\(detail.map { " → \($0)" } ?? "")")
        #endif
    }

    /// Main thread: pending entries go to the top of `logs` (newest first,
    /// capped at `maxLogs`) in a single publish.
    private func publishPending() {
        publishScheduled = false
        guard !pending.isEmpty else { return }
        var batch: [LogEntry] = pending.reversed()
        pending.removeAll(keepingCapacity: true)
        batch.append(contentsOf: logs.prefix(max(0, maxLogs - batch.count)))
        logs = batch
    }

    func info   (_ c: String, _ m: String, _ d: String? = nil) { add(.info,    c, m, d) }
    func success(_ c: String, _ m: String, _ d: String? = nil) { add(.success, c, m, d) }
    func warn   (_ c: String, _ m: String, _ d: String? = nil) { add(.warn,    c, m, d) }
    func error  (_ c: String, _ m: String, _ d: String? = nil) { add(.error,   c, m, d) }
    func debug  (_ c: String, _ m: String, _ d: String? = nil) { add(.debug,   c, m, d) }
    func clear() {
        DispatchQueue.main.async {
            self.pending.removeAll()
            self.logs = []
        }
    }

    // ─── Auth ────────────────────────────────────────────────────
    func authLogin(user: String) {
        success("AUTH", "🟣 Connexion Twitch réussie", "Utilisateur : \(user)")
    }
    func authLogout() {
        warn("AUTH", "🚪 Déconnexion Twitch")
    }

    // ─── VOD ─────────────────────────────────────────────────────
    func vodUnlock(_ id: String, method: String, qualities: [String]) {
        success("VOD", "🔓 VOD \(id) déverrouillée via \(method)", "\(qualities.count) qualités : \(qualities.joined(separator: ", "))")
    }
    func vodFailed(_ id: String) {
        error("VOD", "❌ Impossible de débloquer VOD \(id)", "Toutes les méthodes ont échoué")
    }

    // ─── Settings ────────────────────────────────────────────────
    func settingChanged(_ key: String, value: String) {
        info("SETTINGS", "⚙️ \(key) → \(value)")
    }

    // ─── Historique ──────────────────────────────────────────────
    func historyCleared() {
        warn("HISTORIQUE", "🗑 Historique effacé")
    }

    // ─── Sync cloud ──────────────────────────────────────────────
    func syncPull(items: Int) {
        success("SYNC", "☁️ Sync cloud — \(items) éléments récupérés")
    }
    func syncPush(items: Int) {
        debug("SYNC", "☁️ Sync cloud — \(items) éléments envoyés")
    }
}

let logger = AppLogger.shared
