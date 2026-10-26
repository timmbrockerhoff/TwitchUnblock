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
            if !languages.contains(lang), languages.count < 4 { languages.append(lang) }
        }
    }

    /// Up to `limit` queued messages of a language.
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
        blocked.insert(lang)
        queues[lang] = nil
        languages.removeAll { $0 == lang }
    }

    // MARK: Detection
    private func language(of text: String) -> String? {
        recognizer.reset()
        recognizer.processString(text)
        guard let best = recognizer.languageHypotheses(withMaximum: 1).first, best.value >= 0.8 else { return nil }
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

    /// Long enough to say something and to be recognised: three words or twelve letters,
    /// not a bot command.
    static func worthTranslating(_ text: String) -> Bool {
        guard !text.hasPrefix("!") else { return false }
        let letters = text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
        let words = text.split(whereSeparator: \.isWhitespace).count
        return letters >= 12 || (words >= 3 && letters >= 8)
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
        .frame(width: 0, height: 0)
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
        } catch {
            logger.warn("CHAT", "Übersetzung nicht verfügbar", "\(lang): \(error.localizedDescription)")
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
