import SwiftUI
import NaturalLanguage
#if canImport(Translation)
import Translation
#endif

// ═══════════════════════════════════════════════════════════════════════════
//  Automatic chat translation (live and VOD): foreign messages get a grey line
//  with their German translation under them. The language is detected on the
//  device (NaturalLanguage). Apple's Translation framework translates on the
//  device when its model is there (iOS 18+); until then, or where it can't
//  (model declined, older iOS, Simulator), Google's free web translator does.
// ═══════════════════════════════════════════════════════════════════════════

@MainActor
final class ChatTranslator: ObservableObject {
    /// Source languages with a worker (one TranslationSession each).
    @Published private(set) var languages: [String] = []
    /// Translation found: message id, text. Set by the chat that owns this translator.
    var apply: (String, String) -> Void = { _, _ in }

    private var queues: [String: [(id: String, text: String)]] = [:]
    /// Confident detections per language in this chat: the main one becomes a hint, and a
    /// language whose model isn't on the device is only downloaded once the chat really uses
    /// it (a slang line read as Indonesian must not ask for a download).
    private var seen: [String: Int] = [:]
    /// Languages whose availability was asked: installed ones start at once.
    private var installed: Set<String> = []
    private var checking: Set<String> = []
    /// Same text, same translation (copypasta, spam).
    private var cache: [String: String] = [:]
    /// Languages Apple's on-device translator serves (model ready). All others go to the web.
    private var appleReady: Set<String> = []
    /// Languages Apple can't do here (no model, declined, error): the web translator only.
    private var appleFailed: Set<String> = []
    private var webTask: Task<Void, Never>?
    private let recognizer = NLLanguageRecognizer()

    /// Works on every iOS (the web translator needs nothing on the device).
    static let isAvailable = true

    private static var appleAvailable: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    /// Switched on: English first, so iOS asks for its language download right away.
    func prepare() {
        guard Self.appleAvailable, !languages.contains("en"), !appleFailed.contains("en") else { return }
        languages.append("en")
    }

    deinit { webTask?.cancel() }

    /// The languages Twitch chats are written in (and German, to recognise it).
    private static let candidates: [NLLanguage] = [
        .english, .german, .spanish, .french, .portuguese, .russian, .italian, .polish, .turkish,
        .japanese, .korean, .simplifiedChinese, .traditionalChinese, .arabic, .dutch, .ukrainian,
        .swedish, .czech, .indonesian, .vietnamese, .thai, .hindi, .danish, .finnish, .norwegian,
        .romanian, .hungarian, .greek, .hebrew,
    ]

    /// New messages: foreign ones are queued for their language.
    func submit(_ messages: [ChatMessage]) {
        guard Self.isAvailable else { return }
        for m in messages where m.systemMsg == nil && !m.isDeleted {
            let text = Self.plainText(m)
            guard Self.worthTranslating(text) else { continue }
            if let done = cache[text] { apply(m.id, done); continue }
            guard let lang = language(of: text), lang != "de" else { continue }
            var queue = queues[lang, default: []]
            queue.append((m.id, text))
            // A fast chat outruns any translator: the oldest unseen ones are dropped.
            if queue.count > 30 { queue.removeFirst(queue.count - 30) }
            queues[lang] = queue
            startIfReady(lang)
        }
        startWeb()
    }

    /// Up to `limit` queued messages of a language.
    /// A worker for `lang`: at once when its model is on the device, after three confident
    /// messages when iOS has to download it (and then asks).
    private func startIfReady(_ lang: String) {
        guard Self.appleAvailable, !appleFailed.contains(lang),
              !languages.contains(lang), languages.count < 8 else { return }
        if installed.contains(lang) || seen[lang, default: 0] >= 3 {
            languages.append(lang)
            return
        }
        guard #available(iOS 18.0, *), !checking.contains(lang) else { return }
        checking.insert(lang)
        Task {
            let status = await LanguageAvailability().status(from: Locale.Language(identifier: lang),
                                                             to: Locale.Language(identifier: "de"))
            switch status {
            case .installed: installed.insert(lang); startIfReady(lang)
            case .unsupported: appleFailedFor(lang)
            default: checking.remove(lang)   // download needed: wait for more of this language
            }
        }
    }

    func take(_ lang: String, limit: Int = 10) -> [(id: String, text: String)] {
        let queue = queues[lang, default: []]
        let batch = Array(queue.prefix(limit))
        queues[lang] = Array(queue.dropFirst(batch.count))
        return batch
    }

    func deliver(id: String, source: String, translation: String) {
        let t = translation.trimmingCharacters(in: .whitespacesAndNewlines)
        // Nothing gained: same text back (names, slang the model kept).
        guard !t.isEmpty, t.caseInsensitiveCompare(source) != .orderedSame else { return }
        cache[source] = t
        if cache.count > 500 { cache.removeAll() }
        apply(id, t)
    }

    /// Apple's model for `lang` is ready: its worker takes that queue from now on.
    func appleReadyFor(_ lang: String) {
        appleReady.insert(lang)
    }

    /// Apple can't translate `lang` here: the web translator keeps serving it.
    func appleFailedFor(_ lang: String) {
        guard !appleFailed.contains(lang) else { return }
        logger.info("CHAT", "Übersetzung über das Web", "\(lang): kein Apple-Modell")
        appleFailed.insert(lang)
        appleReady.remove(lang)
        checking.remove(lang)
        languages.removeAll { $0 == lang }
    }

    // MARK: Web translator
    /// Queues no Apple model serves, a few lines at a time, three in parallel.
    private func startWeb() {
        guard webTask == nil else { return }
        webTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let langs = self.queues.keys.filter { !self.appleReady.contains($0) && !(self.queues[$0]?.isEmpty ?? true) }
                guard let lang = langs.first else {
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    continue
                }
                let batch = self.take(lang, limit: 3)
                await withTaskGroup(of: (String, String, String?).self) { group in
                    for item in batch {
                        group.addTask { (item.id, item.text, await Self.webTranslate(item.text)) }
                    }
                    for await (id, text, result) in group {
                        if let result { self.deliver(id: id, source: text, translation: result) }
                    }
                }
            }
        }
    }

    /// Google's free web endpoint (no key): the source language detected there, German back.
    nonisolated static func webTranslate(_ text: String) async -> String? {
        var comps = URLComponents(string: "https://translate.googleapis.com/translate_a/single")!
        comps.queryItems = [.init(name: "client", value: "gtx"), .init(name: "sl", value: "auto"),
                            .init(name: "tl", value: "de"), .init(name: "dt", value: "t"),
                            .init(name: "q", value: text)]
        guard let url = comps.url,
              let (data, resp) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 8)),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [Any],
              let parts = json.first as? [Any] else { return nil }
        // Detected as German there too: nothing to show.
        if (json.count > 2 ? json[2] as? String : nil) == "de" { return nil }
        let out = parts.compactMap { ($0 as? [Any])?.first as? String }.joined()
        return out.isEmpty ? nil : out
    }

    // MARK: Detection
    /// Tested on real chats (es, fr, pt, ru, en, de): limited to chat languages, and biased to
    /// the chat's main language once known. A partial hint list must not be used: it pushes
    /// every unlisted language to zero (Spanish lines came out as English).
    private func language(of text: String) -> String? {
        recognizer.reset()
        recognizer.languageConstraints = Self.candidates
        if let main = seen.max(by: { $0.value < $1.value }), main.value >= 3 {
            var hints: [NLLanguage: Double] = [:]
            for l in Self.candidates { hints[l] = 0.02 }
            hints[NLLanguage(main.key)] = 0.5
            recognizer.languageHints = hints
        } else {
            recognizer.languageHints = [:]
        }
        recognizer.processString(text)
        guard let best = recognizer.languageHypotheses(withMaximum: 1).first, best.value >= 0.5 else { return nil }
        if best.value >= 0.9 { seen[best.key.rawValue, default: 0] += 1 }
        return best.key.rawValue
    }

    /// Written text only: emotes, links and @mentions say nothing about the language.
    static func plainText(_ m: ChatMessage) -> String {
        m.tokens.compactMap { token -> String? in
            if case .text(let t) = token { return t }
            return nil
        }
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Every written message (four letters at least), not a bot command.
    static func worthTranslating(_ text: String) -> Bool {
        guard !text.hasPrefix("!") else { return false }
        return text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count >= 4
    }
}

/// Invisible: one worker per source language, each holding its TranslationSession.
struct ChatTranslatorHost: View {
    @ObservedObject var translator: ChatTranslator

    var body: some View {
        ZStack {
            if #available(iOS 18.0, *) {
                ForEach(translator.languages, id: \.self) { lang in
                    TranslationWorker(lang: lang, translator: translator)
                }
            }
        }
        // A real (tiny) view: iOS anchors its language download sheet to it.
        .frame(width: 1, height: 1)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

@available(iOS 18.0, *)
private struct TranslationWorker: View {
    let lang: String
    let translator: ChatTranslator
    @State private var config: TranslationSession.Configuration?

    var body: some View {
        Color.clear
            .onAppear {
                config = .init(source: Locale.Language(identifier: lang), target: Locale.Language(identifier: "de"))
            }
            .translationTask(config) { session in
                await run(session)
            }
    }

    private func run(_ session: TranslationSession) async {
        let source = Locale.Language(identifier: lang)
        let status = await LanguageAvailability().status(from: source, to: Locale.Language(identifier: "de"))
        guard status != .unsupported else { translator.appleFailedFor(lang); return }
        do {
            // Missing language: iOS shows its download sheet once (the web serves meanwhile).
            try await session.prepareTranslation()
            logger.success("CHAT", "Übersetzung auf dem Gerät bereit", "\(lang) → de")
            translator.appleReadyFor(lang)
        } catch {
            logger.warn("CHAT", "Apple-Übersetzung nicht verfügbar (Download abgelehnt?)", "\(lang): \(error.localizedDescription)")
            translator.appleFailedFor(lang)
            return
        }
        // ponytail: polls its queue twice a second; a stream wake-up if that ever shows in energy use.
        while !Task.isCancelled {
            let batch = translator.take(lang)
            if batch.isEmpty {
                try? await Task.sleep(nanoseconds: 500_000_000)
                continue
            }
            let requests = batch.map { TranslationSession.Request(sourceText: $0.text, clientIdentifier: $0.id) }
            guard let responses = try? await session.translations(from: requests) else {
                // Session broken: the web translator takes over this language.
                translator.appleFailedFor(lang)
                return
            }
            for r in responses {
                guard let id = r.clientIdentifier else { continue }
                translator.deliver(id: id, source: r.sourceText, translation: r.targetText)
            }
        }
    }
}
