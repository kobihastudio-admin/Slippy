import Foundation

/// Swift port of web/src/lib/trip-settlement.ts's `resolveExpenseSplits` —
/// keep the two in sync. Resolves one expense's split_mode + raw input into
/// a concrete per-person amount for every included participant.
enum TripSplitCalculator {
    struct ResolvedSplit {
        let participantId: String
        let amount: Double
    }

    enum SplitError: LocalizedError {
        case noParticipants
        case invalidAmount
        case missingValue
        case sumMismatch(String)

        var errorDescription: String? {
            switch self {
            case .noParticipants: return "ต้องเลือกคนที่ร่วมจ่ายอย่างน้อย 1 คน"
            case .invalidAmount:  return "จำนวนเงินต้องมากกว่า 0"
            case .missingValue:   return "ยังไม่ได้ระบุค่าของบางคน"
            case .sumMismatch(let msg): return msg
            }
        }
    }

    private static let roundTolerance = 0.5 // baht — slop allowed for user-entered totals

    /// Rounds to 2dp and nudges the last entry so the sum exactly equals `total`.
    private static func distributeWithRoundingFix(_ amounts: [Double], total: Double) -> [Double] {
        var rounded = amounts.map { (($0 * 100).rounded()) / 100 }
        let sum = rounded.reduce(0, +)
        let drift = ((total - sum) * 100).rounded() / 100
        if drift != 0, !rounded.isEmpty {
            rounded[rounded.count - 1] = ((rounded[rounded.count - 1] + drift) * 100).rounded() / 100
        }
        return rounded
    }

    static func resolve(
        totalAmount: Double,
        participantIds: [String],
        splitMode: TripSplitMode,
        splitValues: [String: Double]
    ) throws -> [ResolvedSplit] {
        guard !participantIds.isEmpty else { throw SplitError.noParticipants }
        guard totalAmount > 0 else { throw SplitError.invalidAmount }

        switch splitMode {
        case .equal:
            let each = totalAmount / Double(participantIds.count)
            let amounts = distributeWithRoundingFix(participantIds.map { _ in each }, total: totalAmount)
            return zip(participantIds, amounts).map { ResolvedSplit(participantId: $0, amount: $1) }

        case .individual:
            let amounts = try participantIds.map { id -> Double in
                guard let v = splitValues[id] else { throw SplitError.missingValue }
                return v
            }
            let sum = amounts.reduce(0, +)
            guard abs(sum - totalAmount) <= roundTolerance else {
                throw SplitError.sumMismatch(String(format: "ยอดที่ระบุรวมกัน (%.2f) ไม่ตรงกับยอดรวม (%.2f)", sum, totalAmount))
            }
            let fixed = distributeWithRoundingFix(amounts, total: totalAmount)
            return zip(participantIds, fixed).map { ResolvedSplit(participantId: $0, amount: $1) }

        case .percent:
            let pcts = try participantIds.map { id -> Double in
                guard let v = splitValues[id] else { throw SplitError.missingValue }
                return v
            }
            let sumPct = pcts.reduce(0, +)
            guard abs(sumPct - 100) <= 0.5 else {
                throw SplitError.sumMismatch(String(format: "เปอร์เซ็นต์รวมกันต้องเท่ากับ 100 (ตอนนี้รวมได้ %.0f%%)", sumPct))
            }
            let amounts = distributeWithRoundingFix(pcts.map { totalAmount * ($0 / 100) }, total: totalAmount)
            return zip(participantIds, amounts).map { ResolvedSplit(participantId: $0, amount: $1) }

        case .shares:
            let shares = try participantIds.map { id -> Double in
                guard let v = splitValues[id], v > 0 else { throw SplitError.missingValue }
                return v
            }
            let totalShares = shares.reduce(0, +)
            let amounts = distributeWithRoundingFix(shares.map { totalAmount * ($0 / totalShares) }, total: totalAmount)
            return zip(participantIds, amounts).map { ResolvedSplit(participantId: $0, amount: $1) }
        }
    }
}
