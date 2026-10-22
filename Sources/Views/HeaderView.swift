import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Avatar en haut à droite de chaque onglet : ouvre les réglages, comme sur
//  les apps d'Apple (App Store, Musique). Le titre de l'écran est celui de la
//  barre de navigation du système (MainTabView.tabRoot).
// ═══════════════════════════════════════════════════════════════════════════

struct AccountButton: View {
    let action: () -> Void
    @EnvironmentObject private var store: AppStore

    var body: some View {
        Button(action: action) {
            avatar
        }
        .buttonStyle(.plain)
        .accessibilityLabel(store.t("settings"))
    }

    /// Photo de profil Twitch si on est connecté, silhouette sinon.
    /// Un liseré à la couleur d'accent signale que la session est active.
    @ViewBuilder private var avatar: some View {
        Group {
            if let url = store.twitchAvatar, let parsed = URL(string: url) {
                AsyncImage(url: parsed) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Circle().fill(Color.tSurface)
                }
            } else {
                Image(systemName: "person.crop.circle.fill")
                    .resizable()
                    .symbolRenderingMode(.hierarchical)
                    .foregroundColor(.tMuted)
            }
        }
        .frame(width: 32, height: 32)
        .clipShape(Circle())
        .overlay {
            if store.twitchToken != nil {
                Circle().stroke(Color.tPrimary, lineWidth: 2)
            }
        }
    }
}
