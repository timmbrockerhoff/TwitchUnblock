import SwiftUI
import NaturalLanguage
#if canImport(Translation)
import Translation
#endif

// ═══════════════════════════════════════════════════════════════════════════
//  Automatic chat translation (live and VOD): foreign messages get a grey line
//  with their German translation under them. Free and offline: the language is
//  detected by NaturalLanguage, the text translated by Apple's Translation
//  framework on the device (iOS 18+). Below iOS 18 nothing happens.
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
    /// Languages the device can't translate to German, or whose download was declined.
    private var blocked: Set<String> = []
    private let recognizer = NLLanguageRecognizer()

    /// Translation is only offered from iOS 18 on.
    static var isAvailable: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    /// Switched on: English first, so iOS asks for its language download right away.
    func prepare() {
        guard Self.isAvailable, !languages.contains("en") else { return }
        languages.append("en")
    }

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
            guard let lang = language(of: text), lang != "de", !blocked.contains(lang) else { continue }
            var queue = queues[lang, default: []]
            queue.append((m.id, text))
            // A fast chat outruns any translator: the oldest unseen ones are dropped.
            if queue.count > 30 { queue.removeFirst(queue.count - 30) }
            queues[lang] = queue
            startIfReady(lang)
        }
    }

    /// Up to `limit` queued messages of a language.
    /// A worker for `lang`: at once when its model is on the device, after three confident
    /// messages when iOS has to download it (and then asks).
    private func startIfReady(_ lang: String) {
        guard !languages.contains(lang), languages.count < 8 else { return }
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
            case .unsupported: block(lang)
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

    func block(_ lang: String) {
        logger.info("CHAT", "Übersetzung aus dieser Sprache nicht möglich", lang)
        blocked.insert(lang)
        queues[lang] = nil
        languages.removeAll { $0 == lang }
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
        guard status != .unsupported else { translator.block(lang); return }
        do {
            // Missing language: iOS shows its download sheet once.
            try await session.prepareTranslation()
            logger.success("CHAT", "Übersetzung bereit", "\(lang) → de")
        } catch {
            logger.warn("CHAT", "Übersetzung nicht verfügbar (Download abgelehnt?)", "\(lang): \(error.localizedDescription)")
            translator.block(lang)
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
            guard let responses = try? await session.translations(from: requests) else { continue }
            for r in responses {
                guard let id = r.clientIdentifier else { continue }
                translator.deliver(id: id, source: r.sourceText, translation: r.targetText)
            }
        }
    }
}
