import SwiftUI
import Supabase

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * UploadTracker — ติดตามเอกสารที่อัพโหลดแล้วแต่ AI ยังอ่านไม่เสร็จ
 * =====================================================================
 * Uploading used to hold the user hostage: CameraPickerView polled the server
 * inside its own review screen for up to four minutes, and leaving that screen
 * deleted the document. The capture is the user's job; waiting is ours.
 *
 * So the picker now uploads and gets out of the way, handing the document ids
 * here. This object outlives the sheet (and tab switches) because it is a
 * singleton — the same reason GalleryStore is one — so the dashboard can show
 * progress and react to the outcome long after the picker is gone.
 *
 * There is no realtime subscription or push channel in this app, so "waiting"
 * means polling. Only the ids we are actually waiting on are polled, in one
 * batched query, and only while at least one is outstanding — this is not a
 * background refresh of the documents table.
 */
@MainActor
final class UploadTracker: ObservableObject {
    static let shared = UploadTracker()

    /// A document the server declined because it isn't a financial document.
    /// `reason` is the server's own Thai copy (documents.notes), which already
    /// explains what Slippy accepts and that the quota was handed back — see
    /// api/src/pipeline/scope-gate.ts. Repeating that here in Swift would mean
    /// two versions of the same sentence drifting apart.
    struct Rejection: Identifiable, Equatable {
        let id: String
        let reason: String
    }

    /// Document ids still being read by the server pipeline.
    @Published private(set) var pending: [String] = []
    /// Outcomes the user hasn't acknowledged yet, oldest first.
    @Published private(set) var rejections: [Rejection] = []
    /// Bumped whenever anything observable changes — newly tracked uploads
    /// included, so the dashboard reloads immediately and shows the new
    /// "ประมวลผล" row and the deducted credit, not just at the end.
    @Published private(set) var revision = 0

    private var pollTask: Task<Void, Never>?
    private var startedAt: [String: Date] = [:]
    private var isPaused = false

    /// Matches the pipeline's own 5-minute ceiling (api/src/pipeline/index.ts).
    /// Past that the server has given up too, so the document's real status —
    /// whatever it settled on — is already in the list; there is nothing left
    /// to wait for.
    private let trackingTimeout: TimeInterval = 300
    private let pollInterval: UInt64 = 3_000_000_000

    private init() {}

    var isProcessing: Bool { !pending.isEmpty }

    // MARK: – Tracking

    /// Starts (or extends) tracking for freshly uploaded documents.
    func track(documentIds: [String]) {
        let new = documentIds.filter { !pending.contains($0) }
        guard !new.isEmpty else { return }
        let now = Date()
        for id in new { startedAt[id] = now }
        pending.append(contentsOf: new)
        revision &+= 1
        startPolling()
    }

    func dismissRejection(_ id: String) {
        rejections.removeAll { $0.id == id }
    }

    /// Called when the app leaves/enters the foreground. Polling a suspended
    /// app just burns the first seconds after resume on stale results.
    func setPaused(_ paused: Bool) {
        guard isPaused != paused else { return }
        isPaused = paused
        if paused {
            pollTask?.cancel()
            pollTask = nil
        } else {
            startPolling()
        }
    }

    // MARK: – Polling

    private func startPolling() {
        guard pollTask == nil, !isPaused, !pending.isEmpty else { return }
        pollGeneration &+= 1
        let generation = pollGeneration
        // Inherits this object's MainActor isolation, so `pending` and the
        // task handle are touched on the same actor everywhere.
        pollTask = Task { [weak self] in
            while let strong = self, !strong.pending.isEmpty, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: strong.pollInterval)
                guard !Task.isCancelled else { break }
                await strong.pollOnce()
            }
            self?.finishPolling(generation: generation)
        }
    }

    /// Generation counter so a finishing poller can tell whether it is still
    /// the current one. Backgrounding and immediately foregrounding does this:
    /// `setPaused(true)` cancels task A and nils the handle, `setPaused(false)`
    /// starts task B — and only then does A's tail run. Clearing the handle
    /// unconditionally there would orphan B (still polling, no longer
    /// cancellable) and start a third, so two pollers would query in parallel
    /// and could both append the same rejection.
    private var pollGeneration = 0

    private func finishPolling(generation: Int) {
        guard generation == pollGeneration else { return }
        pollTask = nil
        // Paused mid-flight, or a new upload landed between the loop's exit
        // check and here — either way, don't strand outstanding documents.
        if !pending.isEmpty && !isPaused { startPolling() }
    }

    private struct StatusRow: Decodable {
        let id: String
        let status: String?
        let notes: String?
        let extracted_at: String?
    }

    private func pollOnce() async {
        let ids = pending
        guard !ids.isEmpty else { return }

        // A failed request is not an answer. Treating it as one would let a
        // dropped connection look identical to "these documents are gone",
        // which is the difference between waiting three more seconds and
        // silently abandoning an upload that is being read right now.
        guard let rows: [StatusRow] = try? await SupabaseManager.shared.client
            .from("documents")
            .select("id,status,notes,extracted_at")
            .in("id", values: ids)
            .execute()
            .value
        else { return }

        var settled: [String] = []
        var changed = false

        for row in rows {
            // A rejected document is finished even though extracted_at was
            // never written — the scope gate returns before the pipeline gets
            // that far. Checking extracted_at alone (what the old in-picker
            // poll did) meant these ran the full timeout and then reported an
            // AI failure, which is the one thing that did NOT happen.
            if row.status == "rejected" {
                rejections.append(Rejection(id: row.id, reason: row.notes ?? Self.fallbackRejectionReason))
                settled.append(row.id)
                changed = true
            } else if row.status == "failed" || row.extracted_at != nil {
                settled.append(row.id)
                changed = true
            }
        }

        // A row that vanished (deleted elsewhere) never settles on its own.
        let seen = Set(rows.map(\.id))
        let now = Date()
        for id in ids where !settled.contains(id) {
            let expired = now.timeIntervalSince(startedAt[id] ?? now) > trackingTimeout
            if expired || !seen.contains(id) {
                settled.append(id)
                changed = true
            }
        }

        guard changed else { return }
        pending.removeAll { settled.contains($0) }
        for id in settled { startedAt[id] = nil }
        revision &+= 1
    }

    /// Only used if the server rejected a document without writing `notes` —
    /// it always does, but an empty alert would be worse than a generic one.
    private static let fallbackRejectionReason =
        "ไฟล์นี้ไม่ใช่เอกสารทางการเงิน จึงไม่ได้บันทึกเข้าระบบ และไม่ถูกหักโควตาเอกสารของคุณ"
}
