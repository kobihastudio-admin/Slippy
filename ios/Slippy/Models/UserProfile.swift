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

    /// The name, else the email's local part. `get_related_profiles` gives an empty email to people who are not
    /// accepted friends, so with no name either there is nothing to show but a placeholder.
    var displayName: String {
        if let name = fullName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { return name }
        if let local = email.components(separatedBy: "@").first, !local.isEmpty { return local }
        return "ผู้ใช้ Slippy"
    }

    var initials: String {
        let words = displayName.split(separator: " ").map { String($0) }
        guard !words.isEmpty else { return "?" }
        if words.count == 1 { return String(words[0].prefix(1)).uppercased() }
        return (String(words[0].prefix(1)) + String(words[1].prefix(1))).uppercased()
    }
}
