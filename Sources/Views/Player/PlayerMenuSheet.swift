import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Menu « ⋯ » du lecteur immersif : ce que la barre en surimpression ne peut
//  pas porter sans encombrer l'image.
//  A grouped system list: pop-up pickers for quality, speed and source,
//  plain rows for the actions.
// ═══════════════════════════════════════════════════════════════════════════

struct PlayerMenuSheet: View {
    let qualities: [String]
    let selected: String
    let canRewind: Bool
    /// On regarde déjà le DVR d'un direct : proposer le retour au direct.
    let isDvr: Bool

    var onSelectQuality: (String) -> Void = { _ in }
    /// Vitesse de lecture en cours ; nil masque la section (direct).
    var speed: Double? = nil
    var onSelectSpeed: (Double) -> Void = { _ in }
    var onRewind:      () -> Void = {}
    var onBackToLive:  () -> Void = {}
    var onSleepTimer:  () -> Void = {}
    var onSettings:    () -> Void = {}
    /// Direct : source qui sert le flux (« as », « al »…) ; nil hors direct.
    var liveSource: String? = nil
    /// Changer de source : le direct est relancé par elle.
    var onSelectSource: ((String) -> Void)? = nil
    /// VOD : télécharger un passage pour le regarder hors ligne.
    var onDownload: (() -> Void)? = nil
    /// Direct ou VOD (pas le rembobinage) : l'ajouter au multi-live (ou
    /// l'en retirer). Mêmes libellés pour les deux.
    var onMultiLive: (() -> Void)? = nil
    var multiLiveOn = false
    var multiLiveFull = false

    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            // Qualité : le lecteur immersif n'a pas de sélecteur à l'écran,
            // c'est ici qu'on change de piste.
            Section {
                if !qualities.isEmpty {
                    Picker(selection: Binding(get: { selected }, set: { onSelectQuality($0) })) {
                        ForEach(qualities, id: \.self) { Text(qualityText($0, store.lang)).tag($0) }
                    } label: {
                        Label(store.t("quality"), systemImage: "film")
                    }
                    .pickerStyle(.menu)
                }

                // Vitesse : VODs et clips. Un direct reste à 1×.
                if let speed {
                    Picker(selection: Binding(get: { VodSpeed.nearest(speed) }, set: { onSelectSpeed($0) })) {
                        ForEach(VodSpeed.all, id: \.self) { s in
                            Text(s == 1 ? store.t("speed_normal") : VodSpeed.label(s, store.lang)).tag(s)
                        }
                    } label: {
                        Label(store.t("speed"), systemImage: "speedometer")
                    }
                    .pickerStyle(.menu)
                }

                // Source du direct : le proxy qui sert le flux, et de quoi en
                // changer (le direct repart aussitôt). Dans l'ordre des réglages ;
                // en choisir une la met en tête.
                if let onSelectSource, let used = liveSource {
                    Picker(selection: Binding(get: { used }, set: { onSelectSource($0) })) {
                        // Lecture par le compte ou par le Worker : aucune n'est
                        // cochée, le libellé de la ligne la nomme.
                        if !store.liveSourceOrder.contains(used) {
                            Text(store.t("src_\(used)")).tag(used)
                        }
                        ForEach(store.liveSourceOrder, id: \.self) { Text(store.t("src_\($0)")).tag($0) }
                    } label: {
                        Label(store.t("live_source"), systemImage: "antenna.radiowaves.left.and.right")
                    }
                    .pickerStyle(.menu)
                }
            }

            Section {
                if isDvr {
                    Button(action: onBackToLive) {
                        Label(store.t("back_to_live"), systemImage: "dot.radiowaves.left.and.right")
                    }
                    .tint(.tLive)
                } else if canRewind {
                    actionRow(store.t("rewind"), detail: store.t("rewind_sub"),
                              icon: "gobackward", action: onRewind)
                }
                if let onDownload {
                    actionRow(store.t("dl_download"), detail: store.t("dl_download_sub"),
                              icon: "arrow.down.circle", action: onDownload)
                }
                if let onMultiLive {
                    actionRow(store.t(multiLiveOn ? "multi_remove" : "multi_add"),
                              detail: store.t(multiLiveFull && !multiLiveOn ? "multi_full" : "multi_add_sub"),
                              icon: multiLiveOn ? "minus.square" : "square.grid.2x2", action: onMultiLive)
                }
            }

            Section {
                Button(action: onSleepTimer) { Label(store.t("sleep_timer"), systemImage: "moon.zzz") }
                Button(action: onSettings) { Label(store.t("settings"), systemImage: "gearshape") }
            }
        }
        .listStyle(.insetGrouped)
        .tint(.tPrimary)
        .tSheetBar(store.t("player_section")) { dismiss() }
    }

    /// Action with a one-line explanation under its title.
    private func actionRow(_ title: String, detail: String, icon: String,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundColor(.tText)
                    Text(detail).font(.footnote).foregroundColor(.tMuted)
                }
            } icon: {
                Image(systemName: icon)
            }
        }
    }
}
