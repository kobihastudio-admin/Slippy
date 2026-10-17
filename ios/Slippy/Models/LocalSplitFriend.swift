import Foundation

struct LocalSplitFriend: Codable, Identifiable {
    let id: UUID
    var name: String
    var lineID: String
}

/// Device-only address book. No phone numbers or account credentials are stored.
struct LocalSplitFriendStore {
    enum ValidationError: LocalizedError {
        case emptyName, missingAccount
        var errorDescription: String? {
            switch self {
            case .emptyName: return "กรุณาใส่ชื่อ"
            case .missingAccount: return "กรุณาเข้าสู่ระบบอีกครั้ง"
            }
        }
    }

    var defaults: UserDefaults = .standard

    private func key(_ accountID: String) throws -> String {
        guard !accountID.isEmpty else { throw ValidationError.missingAccount }
        return "slippy.local-split-friends.v1.\(accountID)"
    }

    func load(accountID: String) throws -> [LocalSplitFriend] {
        guard let data = defaults.data(forKey: try key(accountID)) else { return [] }
        return try JSONDecoder().decode([LocalSplitFriend].self, from: data)
    }

    @discardableResult
    func save(name: String, lineID: String, accountID: String) throws -> LocalSplitFriend {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let lineID = lineID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw ValidationError.emptyName }
        var friends = try load(accountID: accountID)
        if let existing = friends.first(where: { $0.name == name && $0.lineID == lineID }) {
            return existing
        }
        let friend = LocalSplitFriend(id: UUID(), name: name, lineID: lineID)
        friends.append(friend)
        defaults.set(try JSONEncoder().encode(friends), forKey: try key(accountID))
        return friend
    }

    func remove(id: UUID, accountID: String) throws {
        let friends = try load(accountID: accountID).filter { $0.id != id }
        defaults.set(try JSONEncoder().encode(friends), forKey: try key(accountID))
    }
}
