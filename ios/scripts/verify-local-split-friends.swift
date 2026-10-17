import Foundation

@main
struct LocalSplitFriendsTests {
    static func main() throws {
        let suite = "slippy-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = LocalSplitFriendStore(defaults: defaults)
        let first = try store.save(name: " Alice ", lineID: " alice-line ", accountID: "account-a")
        precondition(first.name == "Alice" && first.lineID == "alice-line")
        let otherAccount = try store.load(accountID: "account-b")
        precondition(otherAccount.isEmpty)
        let same = try store.save(name: "Alice", lineID: "alice-line", accountID: "account-a")
        precondition(first.id == same.id)
        let deduplicated = try store.load(accountID: "account-a")
        precondition(deduplicated.count == 1)
        let reopened = LocalSplitFriendStore(defaults: defaults)
        precondition(tryJSON(reopened, accountID: "account-a") == first.id)
        let other = try store.save(name: "Alice", lineID: "different", accountID: "account-a")
        precondition(first.id != other.id)
        do {
            _ = try store.save(name: " \n", lineID: "", accountID: "account-a")
            fatalError("Empty name accepted")
        } catch LocalSplitFriendStore.ValidationError.emptyName {}
        try store.remove(id: first.id, accountID: "account-a")
        let remaining = try store.load(accountID: "account-a")
        precondition(remaining.map(\.id) == [other.id])
        do {
            _ = try store.load(accountID: "")
            fatalError("Missing account accepted")
        } catch LocalSplitFriendStore.ValidationError.missingAccount {}
        defaults.set(Data("invalid-json".utf8), forKey: "slippy.local-split-friends.v1.corrupt")
        do {
            _ = try store.save(name: "New", lineID: "", accountID: "corrupt")
            fatalError("Corrupted store overwritten")
        } catch is DecodingError {}
        precondition(defaults.data(forKey: "slippy.local-split-friends.v1.corrupt") == Data("invalid-json".utf8))
        print("PASS: local friends trimming, account isolation, identity, validation, removal")
    }

    private static func tryJSON(_ store: LocalSplitFriendStore, accountID: String) -> UUID? {
        try? store.load(accountID: accountID).first?.id
    }
}
