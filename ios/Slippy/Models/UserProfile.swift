import Foundation

struct UserProfile: Codable, Identifiable {
    let id: String
    let email: String
    let fullName: String?
    let avatarUrl: String?
    let dateOfBirth: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, email
        case fullName  = "full_name"
        case avatarUrl = "avatar_url"
        case dateOfBirth = "date_of_birth"
    }

    var displayName: String {
        fullName ?? email.components(separatedBy: "@").first ?? "—"
    }

    var initials: String {
        let words = displayName.split(separator: " ").map { String($0) }
        guard !words.isEmpty else { return "?" }
        if words.count == 1 { return String(words[0].prefix(1)).uppercased() }
        return (String(words[0].prefix(1)) + String(words[1].prefix(1))).uppercased()
    }
}
