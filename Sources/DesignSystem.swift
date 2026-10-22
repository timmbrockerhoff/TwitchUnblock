import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Socle visuel commun à toute l'app.
//
//  Avant, chaque écran redéfinissait ses tailles de police, ses marges et ses
//  cartes dans son coin : deux listes voisines n'avaient ni la même graisse de
//  titre ni le même rayon d'angle. Tout passe désormais par ces échelles.
//
//  Since the Apple-style redesign these are thin wrappers over the system:
//  Dynamic Type text styles, system button styles (Liquid Glass on iOS 26),
//  ContentUnavailableView. Screens keep calling `.tCardTitle`, `TPrimaryButton`…
//
//  Règle : un écran n'écrit plus `.font(.system(size: 13, weight: .bold))`,
//  il écrit `.font(.tCardTitle)`.
// ═══════════════════════════════════════════════════════════════════════════

// MARK: – Typographie
/// Text styles, so every label follows the iPhone's text size setting.
extension Font {
    /// Grand titre d'écran (en-tête de page).
    static let tScreenTitle = Font.title.weight(.bold)
    /// Titre de section dans une page.
    static let tSection     = Font.title3.weight(.bold)
    /// Titre d'une carte / d'une ligne de liste.
    static let tCardTitle   = Font.subheadline.weight(.semibold)
    /// Texte courant.
    static let tBody        = Font.subheadline
    /// Libellé de bouton ou de champ.
    static let tLabel       = Font.subheadline.weight(.semibold)
    /// Métadonnée secondaire (durée, vues, date…).
    static let tMeta        = Font.caption
    /// Pastille, badge, compteur.
    static let tBadge       = Font.caption2.weight(.bold)
}

// MARK: – Espacements
enum TSpace {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    /// Marge latérale de référence : toutes les pages s'alignent dessus.
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
}

// MARK: – Rayons
enum TRadius {
    static let card: CGFloat    = 14
    static let control: CGFloat = 10
    static let chip: CGFloat    = 8
}

// MARK: – Surface de carte
extension View {
    /// Fond de carte standard (listes, réglages, encarts), like an inset grouped cell.
    func tCard(padding: CGFloat = TSpace.lg) -> some View {
        self.padding(padding)
            .background(Color.tCard,
                        in: RoundedRectangle(cornerRadius: TRadius.card, style: .continuous))
    }

    /// Fond de contrôle (champ de saisie, tuile cliquable), like the system search field.
    func tControlSurface(focused: Bool = false) -> some View {
        self.background(Color.tSurface,
                        in: RoundedRectangle(cornerRadius: TRadius.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: TRadius.control, style: .continuous)
                .stroke(focused ? Color.tPrimary : .clear, lineWidth: 1))
    }
}

// MARK: – Styles de bouton système
extension View {
    /// Filled system button: glass on iOS 26, `.borderedProminent` before.
    @ViewBuilder func tProminentStyle() -> some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            self.buttonStyle(.glassProminent)
        } else {
            self.buttonStyle(.borderedProminent)
        }
        #else
        self.buttonStyle(.borderedProminent)
        #endif
    }

    /// Tinted system button: glass on iOS 26, `.bordered` before.
    @ViewBuilder func tBorderedStyle() -> some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            self.buttonStyle(.glass)
        } else {
            self.buttonStyle(.bordered)
        }
        #else
        self.buttonStyle(.bordered)
        #endif
    }

    /// Capsule shape where the system has it (iOS 17+).
    @ViewBuilder func tCapsuleShape() -> some View {
        if #available(iOS 17, tvOS 17, *) {
            self.buttonBorderShape(.capsule)
        } else {
            self
        }
    }
}

// MARK: – Titre de section
/// Titre d'une section de page, avec action optionnelle à droite.
struct TSectionHeader<Trailing: View>: View {
    let icon: String
    let title: String
    @ViewBuilder var trailing: Trailing

    init(_ title: String, icon: String, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.icon = icon
        self.trailing = trailing()
    }

    var body: some View {
        // Apple's content headers (App Store, Music): bold title, no icon.
        HStack(spacing: TSpace.sm) {
            Text(title)
                .font(.tSection)
                .foregroundColor(.tText)
            Spacer(minLength: TSpace.sm)
            trailing
        }
        .padding(.horizontal, TSpace.lg)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Variante sans action à droite. Init séparé plutôt qu'une valeur par défaut :
/// le type générique n'aurait rien pour être déduit à l'appel.
extension TSectionHeader where Trailing == EmptyView {
    init(_ title: String, icon: String) {
        self.init(title, icon: icon) { EmptyView() }
    }
}

// MARK: – Boutons
/// Bouton plein, action principale.
struct TPrimaryButton: View {
    let title: String
    var icon: String? = nil
    var fullWidth = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            label.frame(maxWidth: fullWidth ? .infinity : nil)
        }
        .tProminentStyle()
        .controlSize(.large)
        .tint(.tPrimary)
    }

    @ViewBuilder private var label: some View {
        if let icon { Label(title, systemImage: icon) } else { Text(title) }
    }
}

/// Bouton contour, action secondaire.
struct TSecondaryButton: View {
    let title: String
    var icon: String? = nil
    var tint: Color = .tPrimary
    var fullWidth = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            label.frame(maxWidth: fullWidth ? .infinity : nil)
        }
        .tBorderedStyle()
        .controlSize(.large)
        .tint(tint)
    }

    @ViewBuilder private var label: some View {
        if let icon { Label(title, systemImage: icon) } else { Text(title) }
    }
}

/// Bouton icône rond (fermer, corbeille, réglage…).
struct TIconButton: View {
    let icon: String
    var tint: Color = .tMuted
    var size: CGFloat = 34
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundColor(tint)
                .frame(width: size, height: size)
                .tGlass(in: Circle(), fallback: .tSurface)
        }
        .buttonStyle(.plain)
    }
}

// MARK: – Pastille sélectionnable
/// Filter chip as in Apple Music / Podcasts: filled capsule when on, tinted when off.
struct TChip: View {
    let title: String
    var icon: String? = nil
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if let icon { Label(title, systemImage: icon) } else { Text(title) }
            }
            .font(.tLabel)
            .lineLimit(1)
        }
        .modifier(ChipStyle(isOn: isOn))
        .tCapsuleShape()
        .controlSize(.small)
        .tint(isOn ? .tPrimary : .secondary)
    }

    private struct ChipStyle: ViewModifier {
        let isOn: Bool
        func body(content: Content) -> some View {
            if isOn { content.buttonStyle(.borderedProminent) } else { content.buttonStyle(.bordered) }
        }
    }
}

// MARK: – Sous-onglets (Streams / Catégories…)
/// System segmented control.
struct TSegmented<Item: Hashable>: View {
    let items: [Item]
    @Binding var selection: Item
    let label: (Item) -> String

    var body: some View {
        Picker("", selection: $selection) {
            ForEach(items, id: \.self) { item in
                Text(label(item)).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal, TSpace.lg)
        .padding(.vertical, TSpace.sm)
    }
}

// MARK: – Champ de recherche
/// Looks like the system search field; screens with one main search use `.searchable`.
struct TSearchField: View {
    @Binding var text: String
    let placeholder: String
    var submitLabel: SubmitLabel = .search
    var onSubmit: () -> Void = {}
    /// Recherche en cours : un indicateur à la place de la loupe.
    var busy = false

    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            if busy {
                ProgressView()
                    .scaleEffect(0.75)
                    .frame(width: 17, height: 17)
            } else {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.tMuted)
            }

            TextField(placeholder, text: $text)
                .foregroundColor(.tText)
                .focused($focused)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(submitLabel)
                .onSubmit(onSubmit)

            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.tMuted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, TSpace.sm)
        .frame(minHeight: 36)
        .background(Color.tSurface, in: RoundedRectangle(cornerRadius: TRadius.control, style: .continuous))
    }
}

// MARK: – État vide
/// Message d'écran vide : dit ce qui manque ET quoi faire ensuite.
/// ContentUnavailableView on iOS 17+, the same layout by hand before.
struct TEmptyState: View {
    let icon: String
    let title: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        if #available(iOS 17, tvOS 17, *) {
            ContentUnavailableView {
                Label(title, systemImage: icon)
            } description: {
                if let message { Text(message) }
            } actions: {
                if let actionTitle, let action {
                    TPrimaryButton(title: actionTitle, action: action)
                }
            }
        } else {
            VStack(spacing: TSpace.md) {
                Image(systemName: icon)
                    .font(.largeTitle)
                    .foregroundColor(.tMuted)
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundColor(.tText)
                    .multilineTextAlignment(.center)
                if let message {
                    Text(message)
                        .font(.subheadline)
                        .foregroundColor(.tMuted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let actionTitle, let action {
                    TPrimaryButton(title: actionTitle, action: action)
                        .padding(.top, TSpace.xs)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, TSpace.xl)
            .padding(.vertical, TSpace.xl)
        }
    }
}

// MARK: – Chargement
struct TLoader: View {
    var body: some View {
        ProgressView()
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSpace.xl)
    }
}

// MARK: – Badge de direct
struct TLiveBadge: View {
    var compact = false
    @EnvironmentObject private var store: AppStore

    var body: some View {
        HStack(spacing: TSpace.xs) {
            Circle().fill(Color.white).frame(width: 5, height: 5)
            Text(store.t("live_on"))
                .font(.system(size: compact ? 9 : 11, weight: .bold))
        }
        .foregroundColor(.white)
        .padding(.horizontal, compact ? 5 : 7)
        .padding(.vertical, compact ? 2 : 3)
        .background(Color.tLive)
        .cornerRadius(4)
        .fixedSize()
    }
}

// MARK: – Métadonnée avec icône (spectateurs, durée…)
struct TMeta: View {
    let icon: String
    let text: String
    var tint: Color = .tMuted

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: icon).imageScale(.small)
            Text(text)
        }
        .font(.tMeta)
        .foregroundColor(tint)
        .fixedSize()
    }
}

// MARK: – Bouton de pagination
struct TLoadMoreButton: View {
    let busy: Bool
    /// Clé de traduction du libellé (« Charger plus » par défaut).
    var titleKey = "load_more"
    let action: () -> Void
    @EnvironmentObject private var store: AppStore

    var body: some View {
        Button(action: action) {
            Group {
                if busy {
                    ProgressView()
                } else {
                    Text(store.t(titleKey))
                }
            }
            .frame(maxWidth: .infinity)
        }
        .tBorderedStyle()
        .controlSize(.large)
        .tint(.tPrimary)
        .disabled(busy)
        .padding(.horizontal, TSpace.lg)
        .padding(.top, TSpace.md)
    }
}

/// À la place de TLoadMoreButton quand Twitch refuse la suite d'une liste :
/// une ligne discrète qui dit pourquoi (`key` : clé de traduction).
struct TListEndNote: View {
    let key: String
    @EnvironmentObject private var store: AppStore

    var body: some View {
        Text(store.t(key))
            .font(.tMeta).foregroundColor(.tMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, TSpace.lg)
            .padding(.top, TSpace.sm)
    }
}
