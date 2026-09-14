import SwiftUI
import UIKit

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * GalleryStore — คลังพักเอกสาร (local staging inbox)
 * =====================================================================
 * A purely on-device holding area for scanned / imported document images that
 * the user wants to keep NOW and file into the system LATER. Nothing here
 * touches Supabase until the user explicitly commits an item (GalleryView →
 * "ส่งเข้าระบบ"), so it works fully offline and privately.
 *
 * Persistence: JPEG page files + a `manifest.json` index live under
 * Application Support/Gallery. A single shared instance (`.shared`) backs both
 * the gallery screen and the badge count on the add-document tile.
 */

struct GalleryItem: Identifiable, Codable, Equatable {
    let id: String
    var imageFilenames: [String]   // one entry per page, in order
    let createdAt: Date
    var category: String?          // pre-assigned expense_category name
    var note: String?
    let source: String             // "scan" | "photo"
}

@MainActor
final class GalleryStore: ObservableObject {
    static let shared = GalleryStore()

    @Published private(set) var items: [GalleryItem] = []

    private let dir: URL
    private let manifestURL: URL

    private init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = base.appendingPathComponent("Gallery", isDirectory: true)
        manifestURL = dir.appendingPathComponent("manifest.json")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        load()
    }

    var count: Int { items.count }

    // MARK: – Persistence

    private func load() {
        guard let data = try? Data(contentsOf: manifestURL),
              let decoded = try? Self.decoder.decode([GalleryItem].self, from: data) else { return }
        items = decoded.sorted { $0.createdAt > $1.createdAt }
    }

    private func persist() {
        guard let data = try? Self.encoder.encode(items) else { return }
        try? data.write(to: manifestURL, options: .atomic)
    }

    // MARK: – Mutations

    /// Adds one staged item from a capture/import session. A multi-page scan is
    /// kept as a single item (its pages committed as sibling documents later).
    @discardableResult
    func add(images: [UIImage], source: String) -> GalleryItem? {
        guard !images.isEmpty else { return nil }
        let id = UUID().uuidString
        var filenames: [String] = []
        for (i, img) in images.enumerated() {
            // Bake in orientation so thumbnails and the eventual upload are upright.
            guard let data = img.orientationNormalized().jpegData(compressionQuality: 0.9) else { continue }
            let name = "\(id)_p\(i).jpg"
            try? data.write(to: dir.appendingPathComponent(name), options: .atomic)
            filenames.append(name)
        }
        guard !filenames.isEmpty else { return nil }
        let item = GalleryItem(id: id, imageFilenames: filenames, createdAt: Date(),
                               category: nil, note: nil, source: source)
        items.insert(item, at: 0)
        persist()
        return item
    }

    func setCategory(_ category: String?, for item: GalleryItem) {
        guard let idx = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[idx].category = category
        persist()
    }

    func delete(_ item: GalleryItem) { delete(ids: [item.id]) }

    func delete(ids: Set<String>) {
        for item in items where ids.contains(item.id) {
            for f in item.imageFilenames {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(f))
            }
        }
        items.removeAll { ids.contains($0.id) }
        persist()
    }

    // MARK: – Image access

    func image(_ filename: String) -> UIImage? {
        UIImage(contentsOfFile: dir.appendingPathComponent(filename).path)
    }

    func firstImage(for item: GalleryItem) -> UIImage? {
        item.imageFilenames.first.flatMap(image)
    }

    func images(for item: GalleryItem) -> [UIImage] {
        item.imageFilenames.compactMap(image)
    }

    // MARK: – Coders

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d
    }()
    private static let encoder: JSONEncoder = {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e
    }()
}
