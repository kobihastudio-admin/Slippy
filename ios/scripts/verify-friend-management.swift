import Foundation

@main
struct VerifyFriendManagement {
    static func main() throws {
        let suite = "friend-management-test-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = LocalSplitFriendStore(defaults: defaults)
        let friend = try store.save(name: "Original", lineID: "", accountID: "a")
        try store.update(id: friend.id, name: " Edited ", lineID: " line-note ", accountID: "a")
        let edited = try store.load(accountID: "a")
        precondition(edited.count == 1 && edited[0].id == friend.id)
        precondition(edited[0].name == "Edited" && edited[0].lineID == "line-note")
        let otherAccount = try store.load(accountID: "b")
        precondition(otherAccount.isEmpty)
        do {
            try store.update(id: friend.id, name: "", lineID: "", accountID: "a")
            preconditionFailure("Empty name accepted")
        } catch LocalSplitFriendStore.ValidationError.emptyName {}
        do {
            try store.update(id: friend.id, name: "Other", lineID: "", accountID: "b")
            preconditionFailure("Cross-account edit accepted")
        } catch LocalSplitFriendStore.ValidationError.missingFriend {}
        try store.remove(id: friend.id, accountID: "a")
        let remaining = try store.load(accountID: "a")
        precondition(remaining.isEmpty)
        print("PASS: local friend edit identity, trimming, validation, account isolation and removal")
    }
}
