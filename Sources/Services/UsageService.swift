import Foundation
import Combine
import UIKit
import CryptoKit

// ═══════════════════════════════════════════════════════════════════════════
//  Comptage d'utilisation.
//
//  L'app signale « je suis vivante » au Worker, qui compte les identifiants
//  distincts. Ce qui part du téléphone :
//
//    • un identifiant tiré au hasard à la première ouverture, propre à cette
//      installation — aucun lien avec l'appareil (pas d'IDFV, pas de numéro
//      de série) ; connecté, une empreinte SHA-256 salée de l'identifiant du
//      compte Twitch (jamais le jeton), pour compter le compte une seule fois ;
//    • la version de l'app, « ios », la langue de l'app, iPhone ou iPad et la
//      version majeure d'iOS ;
//    • le nombre de lectures depuis le signal précédent : quelle source a
//      servi chaque live, combien ont échoué, combien de VODs (compteurs
//      seulement — aucune chaîne, aucun titre).
//
//  Pas d'historique. Le Worker ne conserve pas les adresses IP. Le comptage
//  est débrayable dans les Réglages, et le retrait efface tout côté serveur.
// ═══════════════════════════════════════════════════════════════════════════

/// Nombre d'installations actives sur une version donnée.
struct UsageVersion: Identifiable {
    var id: String { version }
    let version: String
    let count: Int
}

/// Fidélité : combien de JOURS DISTINCTS chaque installation a été utilisée.
struct UsageLoyalty {
    /// Ouverte un seul jour — quelqu'un qui a essayé puis n'est pas revenu.
    let once: Int
    /// 2 à 6 jours.
    let few: Int
    /// 7 à 29 jours.
    let regular: Int
    /// 30 jours et plus.
    let daily: Int

    var total: Int { once + few + regular + daily }
}

struct UsageStats {
    /// Identifiants distincts vus aujourd'hui / sur 7 jours / sur 30 jours.
    let today: Int
    let week:  Int
    let month: Int
    /// Installations connues sur la fenêtre de rétention (35 jours).
    let known: Int
    /// Installations revues au moins un deuxième jour.
    let returning: Int
    /// Répartition par nombre de jours d'utilisation.
    let loyalty: UsageLoyalty
    /// Moyenne de jours d'utilisation par installation.
    let avgDays: Double
    /// Date de la plus ancienne installation encore comptée (AAAA-MM-JJ).
    let oldestFirst: String?
    /// Répartition par version, la plus répandue en tête.
    let versions: [UsageVersion]

    /// Part des installations qui sont revenues au moins une fois, en %.
    var returnRate: Int {
        guard known > 0 else { return 0 }
        return Int((Double(returning) / Double(known) * 100).rounded())
    }
}

@MainActor
final class UsageService: ObservableObject {
    static let shared = UsageService()

    @Published private(set) var stats: UsageStats? = nil
    @Published private(set) var loading  = false
    /// Renseigné quand le Worker ne répond pas encore (routes non déployées).
    @Published private(set) var lastError: String? = nil

    /// Identifiant de cette installation. Tiré une fois, gardé localement.
    private(set) var installId: String

    private var lastPing: Date? = nil
    /// Un ping par heure au plus : le but est de compter des journées actives,
    /// pas de suivre les allers-retours dans l'app.
    private let pingInterval: TimeInterval = 3600

    /// Day counting only needs one ping per UTC day; extra pings are only worth
    /// sending when there are playback counters to deliver.
    private static func utcDay(_ d: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .current
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return "\(c.year ?? 0)-\(c.month ?? 0)-\(c.day ?? 0)"
    }

    /// Pseudonymous account id for cross-device dedup: salted SHA-256 of the
    /// Twitch user id. Replaces the OAuth token the ping used to carry, which
    /// the analytics server has no business holding.
    private var accountHash: String? {
        guard let uid = UserDefaults.standard.string(forKey: "twitch_user_id"),
              !uid.isEmpty else { return nil }
        let digest = SHA256.hash(data: Data("twitchunblock-usage-v1:\(uid)".utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private init() {
        let ud = UserDefaults.standard
        // Trousseau d'abord : il survit à une réinstallation par l'outil de
        // sideload (UserDefaults non), sinon chaque réinstallation comptait
        // comme une nouvelle personne. Copie dans les deux pour la suite.
        if let kept = Keychain.get("usage_install_id") ?? ud.string(forKey: "usage_install_id") {
            installId = kept
        } else {
            installId = UUID().uuidString
        }
        ud.set(installId, forKey: "usage_install_id")
        if Keychain.get("usage_install_id") != installId { Keychain.set(installId, for: "usage_install_id") }
        if let t = ud.object(forKey: "usage_last_ping") as? Double {
            lastPing = Date(timeIntervalSince1970: t)
        }
    }

    var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    }

    /// Jeton de comptage propre au build officiel (clé `TUPingKey` d'Info.plist,
    /// posée par la CI depuis un secret). nil ou vide dans tout autre build.
    private var buildPingKey: String? {
        let key = (Bundle.main.infoDictionary?["TUPingKey"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return key.isEmpty ? nil : key
    }

    // MARK: – Compteurs de lecture
    /// Lectures depuis le dernier ping, par issue (« live_as », « vod_fail »…) :
    /// envoyées avec le ping suivant, puis retirées. Gardées sur l'appareil
    /// en attendant (un ping par heure au plus).
    private let eventsKey = "usage_events"

    private var pendingEvents: [String: Int] {
        UserDefaults.standard.dictionary(forKey: eventsKey) as? [String: Int] ?? [:]
    }

    /// Une lecture de plus pour /stats (santé du direct). Rien si le comptage
    /// est coupé.
    func count(_ event: String) {
        guard UserDefaults.standard.object(forKey: "cfg_share_usage") as? Bool ?? true else { return }
        var all = pendingEvents
        all[event, default: 0] += 1
        UserDefaults.standard.set(all, forKey: eventsKey)
    }

    // MARK: – Ping
    /// Signale l'installation au Worker. Sans effet si le comptage est coupé.
    func ping(enabled: Bool, force: Bool = false) async {
        guard enabled else { return }
        if !force, let last = lastPing {
            if Date().timeIntervalSince(last) < pingInterval { return }
            // Already counted today and nothing to deliver: skip.
            if pendingEvents.isEmpty, Self.utcDay(last) == Self.utcDay(Date()) { return }
        }
        guard let url = URL(string: "\(APIConfig.base)/api/ping") else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15
        // Jeton de build : seul le build officiel le porte (injecté par la CI
        // depuis un secret que les forks n'héritent pas). Le Worker ne compte
        // que les pings qui le présentent — un fork qui réutilise ce backend
        // n'alourdit ni la base ni le quota. Absent du build : pas d'en-tête.
        if let key = buildPingKey {
            req.setValue(key, forHTTPHeaderField: "X-TU-Key")
        }
        let events = pendingEvents
        var body: [String: Any] = [
            "id": installId,
            "version": appVersion,
            "platform": "ios",
            "lang": UserDefaults.standard.string(forKey: "lang") ?? "en",
            "os": String(UIDevice.current.systemVersion.split(separator: ".").first ?? ""),
            "device": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone",
        ]
        if !events.isEmpty { body["ev"] = events }
        // Signed in: the account is counted once (hash only, never the token).
        if let acct = accountHash { body["acct"] = acct }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200 else {
                logger.debug("USAGE", "Ping refusé par le serveur", "HTTP \(code)")
                return
            }
            lastPing = Date()
            UserDefaults.standard.set(lastPing!.timeIntervalSince1970, forKey: "usage_last_ping")
            // Partis : retirés (ceux arrivés pendant l'envoi restent).
            if !events.isEmpty {
                var left = pendingEvents
                for (key, n) in events {
                    let rest = (left[key] ?? 0) - n
                    left[key] = rest > 0 ? rest : nil
                }
                UserDefaults.standard.set(left, forKey: eventsKey)
            }
            logger.debug("USAGE", "Ping envoyé", "version \(appVersion)")
        } catch {
            logger.debug("USAGE", "Ping impossible", error.localizedDescription)
        }
    }

    // MARK: – Lecture des compteurs
    func loadStats() async {
        guard let url = URL(string: "\(APIConfig.base)/api/stats") else { return }
        loading = true
        lastError = nil
        defer { loading = false }

        // Sans cette politique, « Actualiser » peut resservir la copie locale
        // d'URLSession et afficher deux fois les mêmes chiffres.
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.timeoutInterval = 15

        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200 else {
                // 404 = le Worker n'a pas encore les routes de comptage.
                lastError = code == 404 ? "worker_missing" : "http_\(code)"
                return
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                lastError = "bad_payload"; return
            }
            let versions = (json["versions"] as? [[String: Any]] ?? []).compactMap {
                v -> UsageVersion? in
                guard let name = v["version"] as? String,
                      let n = v["count"] as? Int else { return nil }
                return UsageVersion(version: name, count: n)
            }
            // Champs absents si le Worker n'a pas encore la mesure de fidélité :
            // tout retombe alors sur zéro plutôt que d'échouer.
            let l = json["loyalty"] as? [String: Any] ?? [:]
            stats = UsageStats(
                today: json["today"] as? Int ?? 0,
                week:  json["week"]  as? Int ?? 0,
                month: json["month"] as? Int ?? 0,
                known: json["known"] as? Int ?? 0,
                returning: json["returning"] as? Int ?? 0,
                loyalty: UsageLoyalty(
                    once:    l["once"]    as? Int ?? 0,
                    few:     l["few"]     as? Int ?? 0,
                    regular: l["regular"] as? Int ?? 0,
                    daily:   l["daily"]   as? Int ?? 0
                ),
                avgDays: json["avgDays"] as? Double ?? 0,
                oldestFirst: json["oldestFirst"] as? String,
                versions: versions
            )
            logger.success("USAGE", "Compteurs reçus",
                           "aujourd'hui \(stats?.today ?? 0) · 30 j \(stats?.month ?? 0)")
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: – Retrait
    /// Efface cette installation côté serveur (quand on coupe le comptage).
    func forget() async {
        guard let url = URL(string: "\(APIConfig.base)/api/ping") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15
        // The account hash lets the server erase the per-account entry too.
        var body: [String: Any] = ["id": installId, "forget": true]
        if let acct = accountHash { body["acct"] = acct }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        _ = try? await URLSession.shared.data(for: req)
        lastPing = nil
        UserDefaults.standard.removeObject(forKey: "usage_last_ping")
        UserDefaults.standard.removeObject(forKey: eventsKey)
        logger.info("USAGE", "Retrait du comptage demandé", nil)
    }
}
