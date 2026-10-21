import SwiftUI

// MARK: – API
let kAPIURL          = "https://test2.kurzmathis4.workers.dev"
let kHelixClientID   = "1e68ku2ehgzy5cy0di3xvfy82sxpf6"
let kGQLClientID     = "kimne78kx3ncx6brgo4mv6wki5h1ko"
/// Client-ID public de l'app Android de Twitch (technique d'Xtra). Twitch
/// n'exige le jeton d'intégrité dès la 2ᵉ page d'une liste que pour le
/// Client-ID web ; avec celui-ci, la suite passe sans compte (vérifié le
/// 2026-10-14). Seulement pour les pages suivantes des listes : jamais avec
/// un jeton, jamais pour les jetons de lecture. La page 1 reste sur le web.
let kGQLNextClientID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp"
let kRedirectURI     = "https://mxfia19.github.io/TwitchUnblock/auth.html"

/// Workers de secours, sur un autre compte Cloudflare : le principal est
/// limité à 100 000 requêtes par jour (« error code: 1027 » au-delà, jusqu'à
/// minuit UTC). Seules les routes sans base D1 y passent — VODs et lives — ;
/// sauvegarde, comptage et annonces restent sur le principal (README du site,
/// « Fallback Worker »).
let kAPIFallbackURLs: [String] = ["https://test2-fallback.vxcraftmanpetit.workers.dev"]

/// Worker à utiliser. Réglages experts : celui de l'utilisateur (déployé
/// depuis le dépôt du site, sur Cloudflare ou avec Docker), essayé en premier
/// pour la lecture — si les Workers officiels tombent, ou si le projet
/// disparaît, l'app continue de lire. Et, s'il le demande, pour tout le reste
/// aussi : sauvegarde (avec son jeton Twitch), retours, annonces, comptage,
/// notifications ntfy.
enum APIConfig {
    static let customKey = "cfg_custom_worker"
    static let allKey = "cfg_custom_worker_all"

    /// Adresse du Worker personnel (sans « / » final) ; nil sinon.
    static var custom: String? {
        guard let s = UserDefaults.standard.string(forKey: customKey), !s.isEmpty else { return nil }
        return s
    }

    /// Lecture (lives, VODs, playlists) : le Worker personnel d'abord, puis
    /// le principal et ses secours.
    static var lookupBases: [String] {
        var out: [String] = custom.map { [$0] } ?? []
        for base in [kAPIURL] + kAPIFallbackURLs where !out.contains(base) { out.append(base) }
        return out
    }

    /// Tout le reste : le principal, ou le Worker personnel si « tout passer
    /// par lui » est activé.
    static var base: String {
        if UserDefaults.standard.bool(forKey: allKey), let c = custom { return c }
        return kAPIURL
    }

    /// Adresse nettoyée (« https:// » ajouté, « / » et « /api » finaux ôtés) ;
    /// nil si elle n'en est pas une.
    static func normalize(_ raw: String) -> String? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "https://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        if s.lowercased().hasSuffix("/api") { s.removeLast(4) }
        guard let url = URL(string: s), let host = url.host, !host.isEmpty, url.query == nil else { return nil }
        return s
    }

    /// Résultat de la vérification d'un Worker personnel. Avant, un simple
    /// oui/non : délai, réseau, refus d'iOS ou quota disaient tous « ne répond
    /// pas comme un Worker TwitchUnblock ».
    enum CheckResult {
        case ok
        /// http:// vers un hôte qu'iOS ne tient pas pour local : l'ATS refuse
        /// la requête (seuls les médias et le réseau local y échappent).
        case insecureHTTP
        /// Pas de réponse : adresse, réseau, certificat, délai.
        case unreachable
        /// Quota atteint (Cloudflare : 429, « error code: 1027 » pour le jour).
        case quota
        /// Il répond, mais pas comme un Worker TwitchUnblock.
        case notAWorker

        /// Message affiché sous le champ (Réglages → Autres).
        var messageKey: String {
            switch self {
            case .ok:           return "expert_ok"
            case .insecureHTTP: return "expert_http"
            case .unreachable:  return "expert_unreachable"
            case .quota:        return "expert_quota"
            case .notAWorker:   return "expert_bad"
            }
        }
    }

    /// Un Worker TwitchUnblock répond à un nom de chaîne vide par une erreur
    /// JSON (400 « Nom invalide ») : c'est ce qu'on vérifie avant de s'en servir.
    static func check(_ base: String) async -> CheckResult {
        guard let url = URL(string: base + "/api/get-live?name=") else { return .notAWorker }
        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        let data: Data, code: Int
        do {
            let (d, resp) = try await URLSession.shared.data(for: req)
            data = d
            code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            // Refus de l'ATS : un Worker en http:// hors du réseau local (un
            // VPS avec Docker) ne marchera jamais tel quel, même si Safari
            // l'ouvre. Il lui faut du HTTPS (Caddy, Cloudflare Tunnel…).
            if (error as? URLError)?.code == .appTransportSecurityRequiresSecureConnection { return .insecureHTTP }
            return .unreachable
        }
        if code == 429 { return .quota }
        guard code == 400 || code == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .notAWorker }
        return json["error"] != nil || json["links"] != nil ? .ok : .notAWorker
    }

    /// Le Worker a-t-il sa base D1 (sauvegarde, retours, annonces,
    /// notifications) ? Sans elle, /api/sync/get répond 500 avant même de
    /// lire le jeton ; avec, une demande sans jeton est refusée (401).
    /// nil : pas de réponse claire.
    static func hasDatabase(_ base: String) async -> Bool? {
        guard let url = URL(string: base + "/api/sync/get?userId=0") else { return nil }
        let req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        guard let (_, resp) = try? await URLSession.shared.data(for: req),
              let code = (resp as? HTTPURLResponse)?.statusCode else { return nil }
        if code == 500 { return false }
        return [400, 401, 403].contains(code) ? true : nil
    }
}

/// Miroirs Luminous, essayés dans l'ordre : si l'un est indisponible on passe
/// au suivant. as = Asie (historique), eu/eu2/eu3 = Europe (recommandés pour
/// le mobile). Pas « sans pub » : les pré-rolls et les pauses pub de la chaîne
/// y arrivent comme sur Twitch (mesuré le 2026-10-14).
let kLuminousHosts = [
    "as.luminous.dev",
    "eu.luminous.dev",
    "eu2.luminous.dev",
    "eu3.luminous.dev"
]

/// Proxys au format TTV.LOL v1, essayés après Luminous. Celui-ci est en
/// Albanie ; ses variantes se lisent de n'importe quelle adresse et annoncent
/// leurs segments d'avance. Les pauses pub de la chaîne y passent aussi.
let kTTVLOLHosts = ["twitch-al.nadeko.net"]

/// Sources du direct proposées dans les réglages et le menu du lecteur.
let kLiveSourceChoices = ["auto", "as", "al", "eu", "twitch"]
/// Sources du direct, dans l'ordre automatique : Luminous Asie, proxy
/// albanais (TTV.LOL), Luminous Europe, Twitch officiel (avec ses pubs).
let kLiveSources = ["as", "al", "eu", "twitch"]

/// Récupération de VODs supprimées : distributions CloudFront où Twitch range
/// les VODs (les plus fréquentes d'abord), plus des hôtes historiques. Le
/// dossier d'une VOD vaut SHA1("login_streamID_epoch")[:20]_login_streamID_epoch
/// — on le reconstruit puis on cherche sa playlist. Observé en octobre 2026 ;
/// voir VodRecoveryService.
let kVodRecoveryHosts = [
    "d3vd9lfkzbru3h.cloudfront.net", "d2nvs31859zcd8.cloudfront.net",
    "d3stzm2eumvgb4.cloudfront.net", "d1m7jfoe9zdc1j.cloudfront.net",
    "d2vi6trrdongqn.cloudfront.net", "d3fi1amfgojobc.cloudfront.net",
    "dgeft87wbj63p.cloudfront.net", "ddacn6pr5v0tl.cloudfront.net",
    "d2e2de1etea730.cloudfront.net", "dqrpb9wgowsf5.cloudfront.net",
    "ds0h3roq6wcgc.cloudfront.net", "d2aba1wr3818hz.cloudfront.net",
    "d3c27h4odz752x.cloudfront.net", "d1ymi26ma8va5x.cloudfront.net",
    "d1mhjrowxxagfy.cloudfront.net", "d36nr0u3xmc4mm.cloudfront.net",
    "d1oca24q5dwo6d.cloudfront.net", "d2um2qdswy1tb0.cloudfront.net",
    "vod-secure.twitch.tv", "vod-metro.twitch.tv", "vod-pop-secure.twitch.tv",
]
/// Source externe des métadonnées (id de diffusion + heure de début) des lives
/// passés : nécessaire car Twitch efface ces infos une fois la VOD supprimée.
/// Seul le nom public de la chaîne lui est transmis (voir VodRecoveryService).
let kVodRecoveryMetaAPI = "https://api.vodvod.top/channels/@"

// MARK: – Colors
extension Color {
    // Couleurs du thème choisi (accent, fonds) : voir Theme.swift.
    static var tPrimary: Color { Theme.palette.primary }
    static var tDark:    Color { Theme.palette.dark }
    static var tCard:    Color { Theme.palette.card }
    static var tSurface: Color { Theme.palette.surface }
    static var tBorder:  Color { Theme.palette.border }
    /// Version claire de l'accent (violet clair avec le thème Twitch).
    static var tPurple:  Color { Theme.palette.light }
    // Couleurs fixes, quel que soit le thème.
    static let tText      = Color(hex: "efeff1")
    static let tMuted     = Color(hex: "888888")
    static let tDanger    = Color(hex: "ff4f4d")
    static let tLive      = Color(hex: "e91916")
    static let tSuccess   = Color(hex: "00ff88")
    static let tWarning   = Color(hex: "e6e619")
    static let tVLC       = Color(hex: "ff8800")
    static let tOutplayer = Color(hex: "007aff")

    init(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h = String(h.dropFirst()) }
        var rgb: UInt64 = 0
        Scanner(string: h).scanHexInt64(&rgb)
        self.init(
            red:   Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8)  & 0xFF) / 255,
            blue:  Double(rgb         & 0xFF) / 255
        )
    }

    /// Couleur de pseudo lisible sur fond sombre : éclaircit les couleurs trop
    /// sombres/noires (sinon un pseudo noir est illisible).
    static func readableChat(hex: String) -> Color {
        var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("#") { h = String(h.dropFirst()) }
        guard h.count == 6 else { return Color(hex: hex) }
        var rgb: UInt64 = 0
        Scanner(string: h).scanHexInt64(&rgb)
        var r = Double((rgb >> 16) & 0xFF) / 255
        var g = Double((rgb >> 8)  & 0xFF) / 255
        var b = Double(rgb         & 0xFF) / 255
        // Luminance perçue
        let lum = 0.299 * r + 0.587 * g + 0.114 * b
        let minLum = 0.45
        if lum < minLum {
            // Mélange vers le blanc pour remonter au seuil minimal
            let f = min(1, (minLum - lum) / minLum + 0.15)
            r += (1 - r) * f; g += (1 - g) * f; b += (1 - b) * f
        }
        return Color(red: r, green: g, blue: b)
    }
}

// MARK: – Language
/// The app ships in German only. The type stays because formatters and the
/// notification/feedback backends still take a locale code.
enum Lang: String {
    case de
}

// MARK: – Translations
// Strings live in Localization/GermanStrings.swift. A missing key shows the
// key itself.
func translate(_ key: String, _ lang: Lang) -> String {
    kGermanStrings[key] ?? key
}
