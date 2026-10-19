import UIKit
import ImageIO
import CryptoKit

// MARK: – Image décodée (statique ou animée)
/// Une seule frame ⇒ statique. Plusieurs ⇒ emote animée (GIF / WebP animé / APNG).
final class CachedImage {
    let frames: [UIImage]
    let duration: TimeInterval     // durée totale de l'animation (0 si statique)
    let bytes: Int
    init(frames: [UIImage], duration: TimeInterval, bytes: Int) {
        self.frames = frames; self.duration = duration; self.bytes = bytes
    }
    var isAnimated: Bool { frames.count > 1 }
    var first: UIImage? { frames.first }
    /// Ratio largeur/hauteur, borné pour éviter les emotes délirantes.
    var aspect: CGFloat {
        guard let s = first?.size, s.height > 0 else { return 1 }
        return min(4, max(0.25, s.width / s.height))
    }
}

// MARK: – Cache d'images emotes / badges (mémoire + disque)
//
// Objectif : zéro temps de chargement quand le chat défile vite. Une emote déjà
// vue est lue **en mémoire de façon synchrone** (pas d'AsyncImage, pas de clignotement).
// Le disque évite de re-télécharger dans la session, et vit dans Caches/ (donc
// iOS peut le récupérer tout seul sous pression de stockage).
final class ImageCache {
    static let shared = ImageCache()

    private let memory = NSCache<NSString, CachedImage>()
    private let dir: URL
    private let fm = FileManager.default
    private let lock = NSLock()
    private var inFlight: [String: Task<CachedImage?, Never>] = [:]

    /// Nb max de frames gardées par emote (sous-échantillonnage au-delà).
    /// Every kept frame is a decoded bitmap held by the UIImageView animation:
    /// 40 stays smooth at chat size and bounds each emote's memory.
    private let maxFrames = 40
    /// Longest side (px) an image is decoded at. Emote and badge sources are
    /// at most 128 px high, so this only shrinks oversized images (local
    /// files, odd sources), whose full-size frames would cost megabytes each.
    private static let maxPixelSize = 512
    /// Disk cache cap, for when it is not purged at app exit (setting off).
    private static let maxDiskBytes: Int64 = 200 * 1024 * 1024

    private init() {
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        dir = caches.appendingPathComponent("emote-cache", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        // Cost = decoded bytes of all frames (it used to be the compressed
        // file size, which let animated emotes grow far past this limit).
        memory.totalCostLimit = 64 * 1024 * 1024   // ~64 Mo décodés en RAM
        DispatchQueue.global(qos: .utility).async { [weak self] in self?.trimDisk() }
    }

    // MARK: Lecture rapide (synchrone, mémoire uniquement)
    func cached(_ url: String) -> CachedImage? { memory.object(forKey: url as NSString) }

    // MARK: Chargement (mémoire → disque → réseau)
    func image(for url: String) async -> CachedImage? {
        if let hit = cached(url) { return hit }

        // Dédoublonne les demandes concurrentes sur la même URL (chat qui spamme
        // la même emote ⇒ un seul téléchargement/décodage).
        lock.lock()
        if let running = inFlight[url] { lock.unlock(); return await running.value }
        let task = Task<CachedImage?, Never>.detached(priority: .userInitiated) { [weak self] in
            await self?.load(url) ?? nil
        }
        inFlight[url] = task
        lock.unlock()

        let result = await task.value
        lock.lock(); inFlight[url] = nil; lock.unlock()
        return result
    }

    private func load(_ url: String) async -> CachedImage? {
        let file = dir.appendingPathComponent(Self.key(url))

        // 1) Disque
        if let data = try? Data(contentsOf: file), let img = Self.decode(data, maxFrames: maxFrames) {
            memory.setObject(img, forKey: url as NSString, cost: img.bytes)
            return img
        }

        // 2) Réseau (ou fichier gardé avec une VOD téléchargée : file://)
        guard let u = URL(string: url),
              let (data, resp) = try? await URLSession.shared.data(from: u),
              (resp as? HTTPURLResponse)?.statusCode == 200 || u.isFileURL,
              let img = Self.decode(data, maxFrames: maxFrames) else { return nil }

        if !u.isFileURL { try? data.write(to: file, options: .atomic) }
        memory.setObject(img, forKey: url as NSString, cost: img.bytes)
        return img
    }

    // MARK: Décodage (gère GIF / WebP animé / APNG via ImageIO)
    private static func decode(_ data: Data, maxFrames: Int) -> CachedImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = CGImageSourceGetCount(src)

        if count <= 1 {
            guard let cg = frame(src, 0) else { return nil }
            return CachedImage(frames: [UIImage(cgImage: cg)], duration: 0, bytes: decodedBytes(cg))
        }

        // Animée : on sous-échantillonne si l'emote a trop de frames.
        let step = max(1, Int(ceil(Double(count) / Double(maxFrames))))
        var frames: [UIImage] = []
        var bytes = 0
        var i = 0
        while i < count {
            if let cg = frame(src, i) {
                frames.append(UIImage(cgImage: cg))
                bytes += decodedBytes(cg)
            }
            i += step
        }
        guard !frames.isEmpty else { return nil }
        if frames.count == 1 { return CachedImage(frames: frames, duration: 0, bytes: max(1, bytes)) }
        // Length of the whole animation: the kept frames are spread over it
        // evenly, so sampling keeps the original speed.
        var total: TimeInterval = 0
        for j in 0..<count { total += delay(src, j) }
        if total <= 0 { total = Double(frames.count) * 0.1 }
        return CachedImage(frames: frames, duration: total, bytes: max(1, bytes))
    }

    /// One frame, decoded right away in the loading task (off the main
    /// thread) instead of lazily at first draw on the main thread; oversized
    /// images are downsampled while decoding.
    private static func frame(_ src: CGImageSource, _ index: Int) -> CGImage? {
        let props = CGImageSourceCopyPropertiesAtIndex(src, index, nil) as? [CFString: Any]
        let w = props?[kCGImagePropertyPixelWidth] as? Int ?? 0
        let h = props?[kCGImagePropertyPixelHeight] as? Int ?? 0
        if max(w, h) > maxPixelSize {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
            ]
            return CGImageSourceCreateThumbnailAtIndex(src, index, options as CFDictionary)
        }
        let options: [CFString: Any] = [kCGImageSourceShouldCacheImmediately: true]
        return CGImageSourceCreateImageAtIndex(src, index, options as CFDictionary)
    }

    /// Memory a decoded frame really takes (the NSCache cost).
    private static func decodedBytes(_ cg: CGImage) -> Int {
        max(1, cg.bytesPerRow * cg.height)
    }

    private static func delay(_ src: CGImageSource, _ index: Int) -> TimeInterval {
        guard let props = CGImageSourceCopyPropertiesAtIndex(src, index, nil) as? [CFString: Any]
        else { return 0.1 }
        let candidates: [(CFString, CFString, CFString)] = [
            (kCGImagePropertyGIFDictionary,   kCGImagePropertyGIFUnclampedDelayTime,   kCGImagePropertyGIFDelayTime),
            (kCGImagePropertyWebPDictionary,  kCGImagePropertyWebPUnclampedDelayTime,  kCGImagePropertyWebPDelayTime),
            (kCGImagePropertyPNGDictionary,   kCGImagePropertyAPNGUnclampedDelayTime,  kCGImagePropertyAPNGDelayTime),
            (kCGImagePropertyHEICSDictionary, kCGImagePropertyHEICSUnclampedDelayTime, kCGImagePropertyHEICSDelayTime)
        ]
        for (dict, unclamped, clamped) in candidates {
            guard let d = props[dict] as? [CFString: Any] else { continue }
            if let v = d[unclamped] as? Double, v > 0.001 { return v }
            if let v = d[clamped]   as? Double, v > 0.001 { return v }
        }
        return 0.1
    }

    private static func key(_ url: String) -> String {
        let digest = SHA256.hash(data: Data(url.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Entretien
    /// Taille occupée sur le disque (octets).
    func diskSize() -> Int64 {
        guard let items = try? fm.contentsOfDirectory(at: dir,
                includingPropertiesForKeys: [.fileSizeKey], options: [.skipsHiddenFiles])
        else { return 0 }
        return items.reduce(0) { acc, f in
            acc + Int64((try? f.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
    }

    func fileCount() -> Int {
        (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil,
                                     options: [.skipsHiddenFiles]))?.count ?? 0
    }

    /// Vide tout (mémoire + disque).
    func purge() {
        let freed = diskSize()
        memory.removeAllObjects()
        try? fm.removeItem(at: dir)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        logger.info("CACHE", "Cache images vidé", ByteCountFormatter.string(fromByteCount: freed, countStyle: .file))
    }

    /// Oldest files first until the disk cache is back under 3/4 of its cap.
    /// Runs on a background queue.
    private func trimDisk() {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys,
                                                      options: [.skipsHiddenFiles]) else { return }
        var files: [(url: URL, size: Int64, date: Date)] = items.map { f -> (url: URL, size: Int64, date: Date) in
            let v = try? f.resourceValues(forKeys: Set(keys))
            return (url: f, size: Int64(v?.fileSize ?? 0), date: v?.contentModificationDate ?? .distantPast)
        }
        var total = files.reduce(Int64(0)) { $0 + $1.size }
        guard total > Self.maxDiskBytes else { return }
        files.sort { $0.date < $1.date }
        for f in files {
            guard total > Self.maxDiskBytes / 4 * 3 else { break }
            try? fm.removeItem(at: f.url)
            total -= f.size
        }
        logger.info("CACHE", "Cache images réduit", ByteCountFormatter.string(fromByteCount: total, countStyle: .file))
    }

    /// Vide seulement si l'utilisateur a activé la purge automatique (réglages).
    func purgeIfNeeded() {
        let auto = UserDefaults.standard.object(forKey: "cfg_purge_cache") as? Bool ?? true
        guard auto else { return }
        purge()
    }
}
