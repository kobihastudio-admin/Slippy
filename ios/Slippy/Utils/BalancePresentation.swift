import Foundation

/// Pure logic for the "ยอดค้าง" (friend balance) UI: decoding the RPC rows,
/// per-friend sums, and the Thai wording. Foundation only, so
/// `ios/scripts/verify-balance-presentation.mjs` can compile this file alone.
///
/// Rules that matter (see the spec): rows with `attributed == false` are
/// counted but NEVER added to an amount; sums are done in whole satang to avoid
/// floating-point drift; a net that rounds to 0.00 shows nothing.
enum BalancePresentation {

    enum Direction: String, Codable {
        case theyOweMe = "they_owe_me"
        case iOweThem  = "i_owe_them"
    }

    enum SourceKind: String, Codable { case bill, sport, trip, request }

    struct Entry: Codable, Equatable, Identifiable {
        let counterpartUserId: String?
        let direction: Direction
        let amount: Double
        let sourceKind: SourceKind
        let sourceId: String
        let title: String?
        let occurredAt: String?
        let attributed: Bool

        var id: String {
            "\(sourceKind.rawValue)|\(sourceId)|\(direction.rawValue)|\(counterpartUserId ?? "-")"
        }

        enum CodingKeys: String, CodingKey {
            case counterpartUserId = "counterpart_user_id"
            case direction, amount
            case sourceKind = "source_kind"
            case sourceId = "source_id"
            case title
            case occurredAt = "occurred_at"
            case attributed
        }
    }

    struct Summary: Equatable {
        let friendId: String
        let theyOweMe: Double
        let iOweThem: Double
        /// Attributed rows only, newest first; rows without a date last.
        let entries: [Entry]
        let unattributedCount: Int

        /// > 0: they owe me. < 0: I owe them. Computed in whole satang.
        var net: Double { Double(BalancePresentation.satang(theyOweMe) - BalancePresentation.satang(iOweThem)) / 100 }
    }

    // MARK: – Sums

    fileprivate static func satang(_ value: Double) -> Int { Int((value * 100).rounded()) }

    /// Rows with the same id are the same debt listed twice (for example one
    /// friend picked twice in a bill): add them, keep the first row's details.
    private static func merged(_ list: [Entry]) -> [Entry] {
        var order: [String] = []
        var byId: [String: Entry] = [:]
        for entry in list {
            if let first = byId[entry.id] {
                byId[entry.id] = Entry(
                    counterpartUserId: first.counterpartUserId, direction: first.direction,
                    amount: Double(satang(first.amount) + satang(entry.amount)) / 100,
                    sourceKind: first.sourceKind, sourceId: first.sourceId, title: first.title,
                    occurredAt: first.occurredAt, attributed: first.attributed)
            } else {
                order.append(entry.id)
                byId[entry.id] = entry
            }
        }
        return order.compactMap { byId[$0] }
    }

    static func summaries(_ entries: [Entry]) -> [String: Summary] {
        var grouped: [String: [Entry]] = [:]
        for entry in entries {
            guard let friend = entry.counterpartUserId else { continue }
            grouped[friend, default: []].append(entry)
        }
        var result: [String: Summary] = [:]
        for (friend, rawList) in grouped {
            let list = merged(rawList)
            let attributed = list.filter(\.attributed)
            let theyOweMe = attributed.filter { $0.direction == .theyOweMe }.reduce(0) { $0 + satang($1.amount) }
            let iOweThem  = attributed.filter { $0.direction == .iOweThem }.reduce(0) { $0 + satang($1.amount) }
            let sorted = attributed.sorted { lhs, rhs in
                switch (lhs.occurredAt, rhs.occurredAt) {
                case let (l?, r?): return l > r
                case (_?, nil):    return true
                default:           return false
                }
            }
            result[friend] = Summary(
                friendId: friend,
                theyOweMe: Double(theyOweMe) / 100,
                iOweThem: Double(iOweThem) / 100,
                entries: sorted,
                unattributedCount: list.count - attributed.count)
        }
        return result
    }

    // MARK: – Wording

    /// `฿1,234.50`; whole amounts without decimals; always the absolute value.
    static func money(_ value: Double) -> String {
        let total = abs(satang(value))
        let baht = total / 100, cents = total % 100
        var grouped = ""
        for (index, character) in String(baht).reversed().enumerated() {
            if index > 0 && index % 3 == 0 { grouped.append(",") }
            grouped.append(character)
        }
        let whole = String(grouped.reversed())
        return cents == 0 ? "฿\(whole)" : "฿\(whole).\(String(format: "%02d", cents))"
    }

    /// Friends-list chip. `nil` when there is nothing to say.
    static func chipText(net: Double) -> String? {
        switch satang(net) {
        case 1...:  return "ค้างคุณ \(money(net))"
        case ...(-1): return "คุณค้าง \(money(net))"
        default:    return nil
        }
    }

    /// Slim line under the chat title.
    static func chatLine(net: Double) -> String? {
        satang(net) == 0 ? nil : "ค้างกัน \(money(net)) · ดูรายละเอียด"
    }

    /// Headline of the detail screen.
    /// `hasBreakdown`: the screen lists rows. A net of zero with rows means the
    /// debts cancel out, which must not read as "no balance".
    static func sentence(name: String, net: Double, hasBreakdown: Bool = false) -> String {
        switch satang(net) {
        case 1...:  return "\(name) ค้างคุณ \(money(net))"
        case ...(-1): return "คุณค้าง \(name) \(money(net))"
        default:    return hasBreakdown ? "ยอดหักล้างกันพอดี" : "ยังไม่มียอดค้างกับ \(name)"
        }
    }

    static func kindTitle(_ kind: SourceKind) -> String {
        switch kind {
        case .bill:    return "บิล"
        case .sport:   return "นัดกีฬา"
        case .trip:    return "ทริป"
        case .request: return "ขอเงิน"
        }
    }
}
