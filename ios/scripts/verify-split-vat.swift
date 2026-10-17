import Foundation

@main struct VerifySplitVAT {
    static func main() {
        func check(_ base: Double, _ mode: SplitVATMode, _ rate: Double?, _ total: Double, _ vat: Double?) {
            let result = SplitBillVAT.calculate(base: base, mode: mode, rate: rate,
                                               referenceTotal: 107, referenceBase: 100)!
            precondition(abs(result.total - total) < 0.000001)
            if let vat { precondition(abs(result.vat! - vat) < 0.000001) }
            else { precondition(result.vat == nil) }
            if let net = result.net, let tax = result.vat {
                precondition(abs(net + tax - result.total) < 0.000001)
            }
        }
        check(107, .included, 7, 107, 7)
        check(100, .excluded, 7, 107, 7)
        check(100, .none, nil, 100, 0)
        check(50, .receiptTotal, nil, 53.5, nil)
        check(100, .receiptTotal, nil, 107, nil)
        check(0, .excluded, 7, 0, 0)
        check(0.05, .excluded, 7, 0.05, 0)
        for rate in [nil, -1, 101, Double.nan, Double.infinity] as [Double?] {
            precondition(SplitBillVAT.calculate(base: 100, mode: .excluded, rate: rate) == nil)
            precondition(SplitBillVAT.calculate(base: 100, mode: .included, rate: rate) == nil)
        }
        precondition(SplitBillVAT.calculate(base: .nan, mode: .none) == nil)
        precondition(SplitBillVAT.calculate(base: -1, mode: .none) == nil)
        precondition(SplitBillVAT.rate(from: "") == nil)
        precondition(SplitBillVAT.rate(from: "7,5") == 7.5)
        print("PASS: explicit inclusive/exclusive/no VAT, source-total allocation, satang rounding and invalid-rate guards")
    }
}
