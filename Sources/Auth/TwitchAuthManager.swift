import Foundation
import AuthenticationServices

final class TwitchAuthManager: NSObject, ASWebAuthenticationPresentationContextProviding {

    static let shared = TwitchAuthManager()
    private override init() {}

    private var session: ASWebAuthenticationSession?

    /// Posé à la première déconnexion, jamais retiré : dès lors, chaque
    /// connexion se fait dans une session privée, sans les cookies de Safari.
    /// Twitch s'y souvient du compte et reconnectait aussitôt le même — se
    /// déconnecter pour passer sur un autre compte ramenait au premier.
    /// Gardé ensuite : une reconnexion ordinaire repasserait sinon par Safari,
    /// toujours connecté à l'ancien compte.
    static let privateSessionKey = "auth_private_session"

    // user:manage:chat_color : Twitch a retiré les commandes /color de l'IRC
    // en 2023, la couleur passe désormais par l'API Helix.
    static let scopes = "user:read:follows chat:read chat:edit user:manage:chat_color"

    /// Implicit-grant authorize URL of the app's client (Helix, IRC).
    static func authorizeURL(forceVerify: Bool, state: String) -> URL? {
        var comps = URLComponents(string: "https://id.twitch.tv/oauth2/authorize")
        comps?.queryItems = [
            .init(name: "client_id",     value: kHelixClientID),
            .init(name: "redirect_uri",  value: kRedirectURI),
            .init(name: "response_type", value: "token"),
            .init(name: "scope",         value: scopes),
            .init(name: "force_verify",  value: forceVerify ? "true" : "false"),
            // Valeur aléatoire vérifiée au retour : seul le retour de CETTE
            // demande de connexion est accepté.
            .init(name: "state",         value: state),
        ]
        return comps?.url
    }

    /// access_token / state / error of a redirect, from the fragment or the query.
    static func redirectValues(_ url: URL) -> [String: String] {
        var fragment = URLComponents()
        fragment.query = url.fragment
        let items = (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [])
            + (fragment.queryItems ?? [])
        var out: [String: String] = [:]
        for item in items { if let v = item.value, out[item.name] == nil { out[item.name] = v } }
        return out
    }

    /// Ouvre le flow OAuth Twitch et retourne le token si succès.
    /// - Parameter forceVerify: false = silencieux si déjà connecté dans Safari (< 1s)
    ///                          true  = re-login visible garanti (token fraîchement émis)
    /// - Parameter chooseAccount: session privée, identifiants demandés
    ///                            (changement de compte).
    func login(forceVerify: Bool = false, chooseAccount: Bool = false) async -> String? {
        let isPrivate = chooseAccount || UserDefaults.standard.bool(forKey: Self.privateSessionKey)
        if chooseAccount { UserDefaults.standard.set(true, forKey: Self.privateSessionKey) }
        let forceVerify = forceVerify || isPrivate
        let expectedState = UUID().uuidString
        guard let authURL = Self.authorizeURL(forceVerify: forceVerify, state: expectedState) else { return nil }

        logger.info("AUTH", forceVerify ? "Login Twitch (force_verify: true)…"
                                        : "Login Twitch silencieux (force_verify: false)…",
                    isPrivate ? "session privée" : nil)

        return await withCheckedContinuation { (cont: CheckedContinuation<String?, Never>) in
            // The completion handler and a failed start() could both resume.
            let continuation = OAuthResumeOnce(cont)
            let s = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "twitchunblock"
            ) { callbackURL, error in
                guard error == nil,
                      let url = callbackURL else {
                    logger.warn("AUTH", "OAuth annulé ou erreur",
                                error?.localizedDescription ?? "callbackURL nil")
                    continuation.resume(returning: nil)
                    return
                }

                // Paramètres lus proprement, dans le fragment (#access_token=…)
                // ou la query (?access_token=…). L'ancien découpage par texte
                // prenait l'adresse entière pour un jeton quand il manquait
                // (par ex. « twitchunblock://auth?error=… »).
                let values = Self.redirectValues(url)
                func value(_ name: String) -> String? { values[name] }
                if let token = value("access_token"), !token.isEmpty,
                   token.allSatisfy({ $0.isLetter || $0.isNumber }),
                   // Absent : ancienne page auth.html encore en cache, qui ne
                   // le transmettait pas. Présent, il doit correspondre.
                   value("state") == nil || value("state") == expectedState {
                    logger.debug("AUTH", "Token reçu", nil)
                    continuation.resume(returning: token)
                    return
                }

                // Autorisation refusée sur Twitch (« Annuler ») : auth.html
                // renvoie maintenant l'erreur à l'app, qui ferme la page.
                if let err = value("error") {
                    logger.warn("AUTH", "Connexion refusée sur Twitch",
                                value("error_description") ?? err)
                } else {
                    logger.error("AUTH", "Token absent ou state invalide", nil)
                }
                continuation.resume(returning: nil)
            }
            s.presentationContextProvider = self
            // false = partage la session Safari (l'utilisateur reste connecté
            // entre les logins) ; true après une déconnexion, voir plus haut.
            s.prefersEphemeralWebBrowserSession = isPrivate
            self.session = s
            DispatchQueue.main.async {
                // start() returns false without calling the handler (no window,
                // another session already shown): login would hang forever.
                if !s.start() {
                    logger.error("AUTH", "Impossible d'ouvrir la page de connexion", nil)
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    // MARK: – ASWebAuthenticationPresentationContextProviding
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.windows.first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}

/// Resumes a login continuation at most once.
private final class OAuthResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var cont: CheckedContinuation<String?, Never>?

    init(_ cont: CheckedContinuation<String?, Never>) { self.cont = cont }

    func resume(returning value: String?) {
        lock.lock()
        let c = cont
        cont = nil
        lock.unlock()
        c?.resume(returning: value)
    }
}
