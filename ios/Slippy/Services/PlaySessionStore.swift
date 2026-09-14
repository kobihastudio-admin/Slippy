import Foundation

final class PlaySessionStore: ObservableObject {
    static let shared = PlaySessionStore()

    @Published var sessions: [SportSession] = []

    private let key = "slippy_play_sessions"

    private init() { load() }

    func save(session: SportSession) {
        var all = sessions
        if let idx = all.firstIndex(where: { $0.id == session.id }) {
            all[idx] = session
        } else {
            all.insert(session, at: 0)
        }
        sessions = all
        persist(all)
    }

    func delete(id: UUID) {
        sessions.removeAll { $0.id == id }
        persist(sessions)
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode([SportSession].self, from: data)
        else { return }
        sessions = decoded
    }

    private func persist(_ sessions: [SportSession]) {
        guard let data = try? JSONEncoder().encode(sessions) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    // Stats helpers
    var totalShotsThisWeek: Int {
        sessions.filter { isThisWeek($0.startedAt) }.reduce(0) { $0 + $1.totalShots }
    }

    var totalSmashThisWeek: Int {
        sessions.filter { isThisWeek($0.startedAt) }.reduce(0) { $0 + $1.smashCount }
    }

    var activeMinutesThisWeek: Int {
        sessions.filter { isThisWeek($0.startedAt) }
            .reduce(0) { $0 + (($1.durationSeconds ?? 0) / 60) }
    }

    private func isThisWeek(_ date: Date) -> Bool {
        Calendar.current.isDate(date, equalTo: .now, toGranularity: .weekOfYear)
    }
}
