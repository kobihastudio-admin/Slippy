import Foundation

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Thai 13-digit tax / national ID validation.
 *
 * Mirrors `api/src/pipeline/tax-id.ts` — keep the two in sync. The app checks
 * it too rather than leaving it to the server, because the tax id read from a
 * Bill-Payment QR is uploaded as an authoritative `userConfirmed` field: the
 * pipeline is told to keep it instead of re-reading it. Sending an unvalidated
 * one means a bad number overrides a good extraction, which is the opposite of
 * what that channel is for.
 */
enum ThaiTaxID {
    /// Validates the mod-11 check digit. Separators are ignored; content is not.
    static func isValid(_ value: String?) -> Bool {
        guard let value else { return false }
        let digits = value.filter(\.isNumber)
        guard digits.count == 13 else { return false }

        // Placeholders. "0000000000000" satisfies mod-11 (sum 0), so the
        // checksum alone would accept the exact value that reached production
        // on one restaurant receipt.
        if Set(digits).count == 1 { return false }

        let d = digits.compactMap { $0.wholeNumberValue }
        guard d.count == 13 else { return false }

        var sum = 0
        for i in 0..<12 { sum += d[i] * (13 - i) }
        let check = (11 - (sum % 11)) % 10
        return check == d[12]
    }
}
