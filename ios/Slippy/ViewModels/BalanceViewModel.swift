import SwiftUI
import Supabase

/// Per-friend balances for the signed-in user. Reads two read-only RPCs
/// (`friend_balances`, `friend_balances_trips`). If the main call fails the
/// screens hide the balance UI (`loadFailed`) rather than show a misleading
/// zero. If only the trips call fails (for example the trips function is not
/// deployed) the rest still shows, flagged by `tripsIncluded == false`.
@MainActor
final class BalanceViewModel: ObservableObject {
    @Published private(set) var summaries: [String: BalancePresentation.Summary] = [:]
    @Published private(set) var loadFailed = false
    @Published private(set) var tripsIncluded = true

    #if DEBUG
    /// Synthetic-data mode for simulator screenshots: no network.
    var isFixture = false
    #endif

    private let db = SupabaseManager.shared.client

    func summary(for friendId: String) -> BalancePresentation.Summary? { summaries[friendId] }

    func load() async {
        #if DEBUG
        if isFixture { return }
        #endif
        let main: [BalancePresentation.Entry]
        do {
            main = try await db.rpc("friend_balances").execute().value
        } catch {
            // A cancelled load (the view went away, a newer load started) is not a
            // failure: keep what is on screen instead of hiding every chip.
            if Self.isCancellation(error) { return }
            loadFailed = true
            return
        }
        var trips: [BalancePresentation.Entry] = []
        do {
            trips = try await db.rpc("friend_balances_trips").execute().value
            tripsIncluded = true
        } catch {
            tripsIncluded = false
        }
        summaries = BalancePresentation.summaries(main + trips)
        loadFailed = false
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        return (error as NSError).domain == NSURLErrorDomain && (error as NSError).code == NSURLErrorCancelled
    }

    #if DEBUG
    static func fixture(failed: Bool = false, tripsIncluded: Bool = true) -> BalanceViewModel {
        let vm = BalanceViewModel()
        vm.isFixture = true
        vm.loadFailed = failed
        vm.tripsIncluded = tripsIncluded
        func entry(_ friend: String, _ direction: BalancePresentation.Direction, _ amount: Double,
                   _ kind: BalancePresentation.SourceKind, _ id: String, _ title: String,
                   _ date: String?, attributed: Bool = true) -> BalancePresentation.Entry {
            .init(counterpartUserId: friend, direction: direction, amount: amount, sourceKind: kind,
                  sourceId: id, title: title, occurredAt: date, attributed: attributed)
        }
        vm.summaries = BalancePresentation.summaries([
            entry(MessagesViewModel.fixtureFriendId, .theyOweMe, 300, .bill, "fx-b1", "ข้าวเย็นร้านชาบู", "2026-11-08T12:00:00+00:00"),
            entry(MessagesViewModel.fixtureFriendId, .theyOweMe, 150.5, .request, "fx-r1", "ค่าแท็กซี่", "2026-11-05T09:00:00+00:00"),
            entry(MessagesViewModel.fixtureFriendId, .iOweThem, 60, .sport, "fx-s1", "แบดมินตันวันศุกร์", "2026-11-03T11:00:00+00:00"),
            entry(MessagesViewModel.fixtureFriendId, .iOweThem, 500, .bill, "fx-b2", "ค่าเช่าบ้านพัก (ยังไม่ระบุผู้จ่าย)", nil, attributed: false),
            entry("fx-golf", .iOweThem, 1234.5, .trip, "fx-t1", "ทริปเชียงใหม่", "2026-10-20T08:00:00+00:00"),
        ])
        return vm
    }
    #endif
}
