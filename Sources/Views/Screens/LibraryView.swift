import SwiftUI

// ═══════════════════════════════════════════════════════════════════════════
//  Mes VODs : ce qu'on a regardé, avec la reprise de lecture.
//  Shelf of started VODs, downloads, then the history by day; long press removes one.
// ═══════════════════════════════════════════════════════════════════════════

struct LibraryView: View {
    let onPlayVod: (String, String?, String?, String?) -> Void
    /// VOD téléchargée : lue hors ligne, par le serveur local.
    var onPlayOffline: (RecoveredVod) -> Void = { _ in }

    @EnvironmentObject private var store: AppStore
    @ObservedObject private var metaStore = VodMetaStore.shared
    @ObservedObject private var downloads = VodDownloads.shared

    @State private var confirmClear = false
    /// Téléchargement touché, mais le serveur local de lecture n'a pas démarré.
    @State private var offlineFailed = false

    private var vods: [HistoryItem] { store.history.filter { $0.type == .vod } }

    /// Started (> 1 min) and not finished; an unknown length counts as not finished.
    private var resumable: [HistoryItem] {
        Array(vods.filter { item in
            let watched = store.getVodProgress(item.term)
            guard watched > 60 else { return false }
            guard let total = metaStore.meta(item.term)?.lengthSeconds, total > 0 else { return true }
            return watched / Double(total) < 0.95
        }.prefix(15))
    }

    /// History by day of watching, newest first (the history is already in that order).
    private var dayGroups: [(key: String, items: [HistoryItem])] {
        let cal = Calendar.current
        let now = Date()
        let week = cal.dateInterval(of: .weekOfYear, for: now)
        var groups: [(key: String, items: [HistoryItem])] = []
        for item in vods {
            let date = Date(timeIntervalSince1970: item.addedAt / 1000)
            let key = cal.isDateInToday(date) ? "day_today"
                : cal.isDateInYesterday(date) ? "day_yesterday"
                : week?.contains(date) == true ? "day_this_week" : "day_earlier"
            if groups.last?.key == key { groups[groups.count - 1].items.append(item) }
            else { groups.append((key, [item])) }
        }
        return groups
    }

    var body: some View {
        Group {
            if vods.isEmpty && downloads.items.isEmpty {
                VStack {
                    Spacer()
                    TEmptyState(icon: "film.stack",
                                title: store.t("history_vods_empty"),
                                message: store.t("history_vods_empty_msg"))
                    Spacer()
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: TSpace.xl) {
                        let started = resumable
                        if !started.isEmpty {
                            TShelf(title: store.t("continue_watching")) {
                                ForEach(started) { item in
                                    ResumeVodCard(item: item) {
                                        onPlayVod(item.term, item.display, item.thumb, item.streamer)
                                    }
                                }
                            }
                        }

                        if !downloads.items.isEmpty {
                            VStack(alignment: .leading, spacing: TSpace.md) {
                                sectionTitle("\(store.t("dl_section")) · \(ByteCountFormatter.string(fromByteCount: downloads.totalBytes, countStyle: .file))")
                                ForEach(downloads.items) { item in
                                    DownloadRow(item: item) { playOffline($0) }
                                }
                            }
                        }

                        if !vods.isEmpty {
                            VStack(alignment: .leading, spacing: TSpace.md) {
                                HStack {
                                    sectionTitle(store.t("history"))
                                    Spacer()
                                    Button(store.t("btn_clear")) { confirmClear = true }
                                        .font(.subheadline)
                                        .tint(.tDanger)
                                        .padding(.trailing, TSpace.lg)
                                }
                                ForEach(dayGroups, id: \.key) { group in
                                    Text(store.t(group.key))
                                        .font(.footnote.weight(.semibold))
                                        .foregroundColor(.tMuted)
                                        .padding(.horizontal, TSpace.lg)
                                        .padding(.top, TSpace.xs)
                                    ForEach(group.items) { item in
                                        row(item)
                                            .task { await metaStore.load(item.term) }
                                    }
                                }
                            }
                        }

                        Spacer(minLength: 40)
                    }
                    .padding(.top, TSpace.sm)
                }
                // Sur la liste, pas sur le Group : une seule alerte par vue.
                .alert(store.t("offline_play_failed"), isPresented: $offlineFailed) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(store.t("offline_play_failed_msg"))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.tDark)
        .alert(store.t("btn_clear"), isPresented: $confirmClear) {
            Button(store.t("cancel"), role: .cancel) {}
            Button(store.t("erase"), role: .destructive) {
                // Positions de reprise comprises, et envoyé tout de suite.
                store.clearVodHistory()
            }
        } message: {
            Text(store.t("confirm"))
        }
    }

    private func playOffline(_ item: VodDownload) {
        Task { @MainActor in
            // Serveur local pas prêt (port pris, app relancée en arrière-plan) :
            // une seconde demande le relance, sur un autre port au besoin ;
            // sinon un message, au lieu d'un toucher sans effet.
            var rec = await downloads.playback(item)
            if rec == nil { rec = await downloads.playback(item) }
            if let rec { onPlayOffline(rec) } else { offlineFailed = true }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.tSection).foregroundColor(.tText)
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, TSpace.lg)
    }

    // MARK: – Ligne
    @ViewBuilder private func row(_ item: HistoryItem) -> some View {
        HStack(spacing: TSpace.md) {
            // La taille est portée par le ZStack, pas par l'image : un
            // GeometryReader prend toute la largeur qu'on lui propose, donc
            // l'apparition de la barre de progression (après le chargement
            // des métadonnées) élargissait le ZStack et décalait la ligne.
            ZStack(alignment: .bottom) {
                AsyncImage(url: URL(string: vodThumb(item, meta: metaStore.meta(item.term)))) { img in
                    img.resizable().aspectRatio(16/9, contentMode: .fill)
                } placeholder: {
                    Rectangle().fill(Color.tSurface)
                        .overlay(Image(systemName: "film")
                            .font(.callout).foregroundColor(.tMuted))
                }

                if let ratio = progressRatio(item.term) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Color.black.opacity(0.5)
                            Color.tPrimary.frame(width: geo.size.width * ratio)
                        }
                    }
                    .frame(height: 3)
                }
            }
            .frame(width: 116, height: 65)
            .clipped()
            .cornerRadius(TRadius.chip)

            VStack(alignment: .leading, spacing: TSpace.xs) {
                Text(item.display)
                    .font(.tCardTitle)
                    .foregroundColor(.tText)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                if let streamer = item.streamer {
                    Text(streamer)
                        .font(.tMeta).foregroundColor(.tPurple).lineLimit(1)
                }

                metaLine(item.term)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, TSpace.lg)
        .contentShape(Rectangle())
        .onTapGesture {
            onPlayVod(item.term, item.display, item.thumb, item.streamer)
        }
        // Appui long : le multi-live (`streamer` peut être un nom affiché : la
        // chaîne est complétée au démarrage de la tuile), et la retirer de l'historique.
        .contextMenu {
            MultiVodMenuButton(vodId: item.term, title: item.display, thumb: item.thumb,
                               name: item.streamer ?? "", login: "")
            Button(role: .destructive) {
                withAnimation(.easeInOut(duration: 0.2)) {
                    store.removeFromHistory(term: item.term)
                }
            } label: {
                Label(store.t("delete_vod"), systemImage: "trash")
            }
        }
    }

    /// Part de la VOD déjà vue, nil si on n'en sait pas assez pour l'afficher.
    private func progressRatio(_ vodId: String) -> Double? {
        let watched = store.getVodProgress(vodId)
        guard watched > 1, let total = metaStore.meta(vodId)?.lengthSeconds, total > 0
        else { return nil }
        return min(1, watched / Double(total))
    }

    /// Durée vue / totale et nombre de vues. Les métadonnées arrivent du réseau :
    /// la hauteur est réservée d'avance pour que la liste ne saute pas à l'arrivée.
    @ViewBuilder private func metaLine(_ vodId: String) -> some View {
        let watched = store.getVodProgress(vodId)
        let total   = metaStore.meta(vodId)?.lengthSeconds ?? 0
        let views   = metaStore.meta(vodId)?.viewCount ?? 0

        HStack(spacing: TSpace.md) {
            if total > 0 {
                TMeta(icon: "clock.fill",
                      text: "\(formatDuration(Int(watched))) / \(formatDuration(total))")
            }
            if views > 0 {
                TMeta(icon: "eye.fill", text: formatViewers(views))
            }
            Spacer(minLength: 0)
        }
        .lineLimit(1)
        .frame(height: 16)
    }
}
