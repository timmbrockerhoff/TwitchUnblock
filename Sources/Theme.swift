import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Thèmes : couleur d'accent et verre liquide (iOS 26).
//
//  Les couleurs d'accent (`Color.tPrimary`, `.tPurple`) lisent la palette
//  en cours à chaque affichage ; les fonds sont ceux du système. Les réglages la remplacent ; les vues
//  se redessinent parce qu'elles observent l'AppStore, et MainTabView
//  reconstruit les onglets (`AppStore.themeID`) pour ne rien laisser en
//  retard.
// ═══════════════════════════════════════════════════════════════════════════

/// Couleur d'accent : boutons, onglet actif, liens.
enum AccentTheme: String, CaseIterable, Identifiable {
    case twitch, blue, green, pink, orange, red, teal
    var id: String { rawValue }
    /// Couleur principale, et sa version claire (textes mis en avant).
    var hex: (primary: String, light: String) {
        switch self {
        case .twitch: return ("9146ff", "bf94ff")
        case .blue:   return ("2f7cf6", "8ab8ff")
        case .green:  return ("10b981", "6ee7b7")
        case .pink:   return ("ec4899", "f9a8d4")
        case .orange: return ("f97316", "fdba74")
        case .red:    return ("e5484d", "ff9c9f")
        case .teal:   return ("06b6d4", "67e8f9")
        }
    }
    var color: Color { Color(hex: hex.primary) }
    var labelKey: String { "accent_\(rawValue)" }
}

/// Backgrounds follow the system (light/dark) since the Apple-style redesign;
/// only the accent is still the user's choice.
struct Palette {
    let primary, light: Color

    init(accent: AccentTheme) {
        primary = Color(hex: accent.hex.primary)
        // The pale variant only reads on dark grounds; light mode uses the accent itself.
        let pale = UIColor(Color(hex: accent.hex.light)), main = UIColor(primary)
        light = Color(UIColor { $0.userInterfaceStyle == .dark ? pale : main })
    }
}

/// Thème en cours, lu au lancement puis tenu à jour par l'AppStore.
enum Theme {
    static let accentKey = "cfg_accent"
    static let glassKey = "cfg_liquid_glass"

    static var storedAccent: AccentTheme {
        AccentTheme(rawValue: UserDefaults.standard.string(forKey: accentKey) ?? "") ?? .twitch
    }

    static var palette = Palette(accent: storedAccent)
    static var liquidGlass = UserDefaults.standard.bool(forKey: glassKey)

    /// Le verre liquide n'existe qu'à partir d'iOS 26.
    static var glassSupported: Bool {
        #if os(iOS)
        if #available(iOS 26, *) { return true }
        #endif
        return false
    }
    /// Verre liquide à dessiner : option cochée, sur un système qui le connaît.
    static var useGlass: Bool { liquidGlass && glassSupported }
}

// MARK: – Verre liquide
/// Verre purement visuel, pas « interactif » : la réaction du verre interactif
/// au toucher ignore le test de touche des vues — elle s'allumait même quand
/// l'appui n'atteignait pas le bouton, qui ne faisait alors rien.
#if os(iOS)
@available(iOS 26, *)
private func tuGlass(tint: Color?, clear: Bool) -> Glass {
    var g: Glass = clear ? .clear : .regular
    if let tint { g = g.tint(tint) }
    return g
}
#endif

extension View {
    #if os(iOS)
    /// Fond « verre liquide » (iOS 26) quand l'option est active ; sinon le
    /// fond plein d'avant, découpé à la même forme.
    /// - Parameter clear: verre plus transparent, pour les boutons posés sur
    ///   la vidéo.
    @ViewBuilder
    func tGlass<S: Shape>(in shape: S, fallback: Color, tint: Color? = nil,
                          clear: Bool = false) -> some View {
        if #available(iOS 26, *) {
            if Theme.useGlass {
                // `contentShape` : le verre, lui, ne reçoit pas les touchers.
                // Sans elle, seul le symbole d'un bouton répondait ; un appui
                // à côté traversait jusqu'au voile du lecteur, qui masquait
                // les commandes — boutons et retour à l'accueil inutilisables
                // pendant un live. Un fond plein, lui, comptait déjà.
                self.glassEffect(tuGlass(tint: tint, clear: clear), in: shape)
                    .contentShape(shape)
            } else {
                self.background(fallback).clipShape(shape)
            }
        } else {
            self.background(fallback).clipShape(shape)
        }
    }
    #else
    /// Apple TV : pas de verre liquide ici, le fond plein.
    func tGlass<S: Shape>(in shape: S, fallback: Color, tint: Color? = nil,
                          clear: Bool = false) -> some View {
        self.background(fallback).clipShape(shape)
    }
    #endif
}
