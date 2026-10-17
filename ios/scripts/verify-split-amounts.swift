import Foundation

@main
struct SplitAmountTests {
    static func main() {
        for count in [1, 3, 6, 7, 100] {
            for total in [0.01, 100.0, 123.45] {
                let amounts = SplitBillAmounts.equalShares(total: total, count: count)
                precondition(amounts.count == count)
                let cents = amounts.map { Int(($0 * 100).rounded()) }
                precondition(cents.reduce(0, +) == Int((total * 100).rounded()))
                precondition((cents.max()! - cents.min()!) <= 1)
            }
        }
        precondition(SplitBillAmounts.equalShares(total: .infinity, count: 3).isEmpty)
        precondition(SplitBillAmounts.equalShares(total: -1, count: 3).isEmpty)
        precondition(SplitBillAmounts.equalShares(total: 1, count: 0).isEmpty)
        let thirds = SplitBillAmounts.roundedShares([100.0 / 3, 100.0 / 3, 100.0 / 3], total: 100)!
        precondition(thirds == [33.34, 33.33, 33.33])
        precondition(SplitBillAmounts.roundedShares([50, 50.01], total: 100) == nil)
        precondition(SplitBillAmounts.roundedShares([Double.nan], total: 100) == nil)
        precondition(SplitBillAmounts.itemShare(subtotal: 50, itemsSubtotal: 100, total: 100) == 50)
        precondition(SplitBillAmounts.itemShare(subtotal: 100, itemsSubtotal: 200, total: 214) == 107)
        precondition(SplitBillAmounts.itemShare(subtotal: 100, itemsSubtotal: 200, total: 180) == 90)
        precondition(SplitBillAmounts.itemShare(subtotal: 30, itemsSubtotal: 100, total: 105) == 31.5)
        precondition(SplitBillAmounts.itemShare(subtotal: 0, itemsSubtotal: 0, total: 100) == 0)
        for count in 1...20 {
            for total in [0.01, 1.01, 123.45] {
                let weight = Double(count * (count + 1)) / 2
                let raw = (1...count).map { total * Double($0) / weight }
                let rounded = SplitBillAmounts.roundedShares(raw, total: total)!
                precondition(rounded.map { Int(($0 * 100).rounded()) }.reduce(0, +) == Int((total * 100).rounded()))
                precondition(zip(raw, rounded).allSatisfy { abs($0 - $1) <= 0.010001 })
            }
        }
        print("PASS: 15 equal-share, 60 weighted-rounding, 5 item-allocation cases, thirds and invalid inputs")
    }
}
