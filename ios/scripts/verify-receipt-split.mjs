import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const create = read('Slippy/Views/Split/CreateSplitView.swift');
const document = read('Slippy/Views/Documents/DocumentDetailView.swift');
const vm = read('Slippy/ViewModels/SplitViewModel.swift');
const picker = read('Slippy/Views/Split/SplitFriendPickerSheet.swift');
assert.match(picker, /func contactPickerDidCancel.*onCancel\(\)/);
assert.doesNotMatch(picker, /CNContactStore|phoneNumbers|requestAccess/);
assert.match(picker, /onAdd\(friend.name, value\)/);
function between(source, start, end) {
  const first = source.indexOf(start);
  assert.notEqual(first, -1, `Missing ${start}`);
  const last = source.indexOf(end, first);
  assert.notEqual(last, -1, `Missing ${end}`);
  return source.slice(first, last);
}
assert.match(document, /initialReceipt: splitExtraction, sourceDocumentID: doc.id/);
assert.match(document, /disabled\(isLoadingItems \|\| itemsLoadError != nil/);
assert.doesNotMatch(document, /qty:.*Int\(\$0.rounded\(\)\)/);
assert.match(vm, /document_id: documentID/);
assert.equal((create.match(/SplitBillAmounts\.itemShare/g) ?? []).length, 2);
assert.doesNotMatch(create, /Config\.defaultVatRatePct/);
assert.match(create, /documentID: receipts.compactMap\(\\.sourceDocumentID\).first/);
const initializer = between(create, '    init(vm: SplitViewModel, initialReceipt:', '\n    var totalAmount:');
const validation = between(create, '    private func validateFriends()', '\n    private var persistedNote:').replace('private func', 'mutating func');
assert.doesNotMatch(initializer, /runOCR|upload|Task\s*\{/);

// Compile the production initializer and receipt types. UI-only wrappers and
// image/QR dependencies are replaced with value stubs for a host-side test.
const extraction = between(read('Slippy/Services/SlipOCRService.swift'), 'struct LineItem:', '// MARK: – Server hint payload');
const item = between(create, 'struct DraftItem:', '\nenum CreateSplitStep');
const receipt = between(create, 'struct ScannedReceipt:', '// MARK: – Create Split View');
const taxModel = read('Slippy/Models/SplitBillVAT.swift');
const modes = between(create, 'enum SplitMode:', '// MARK: – Draft models');
const participant = between(create, 'struct DraftParticipant:', 'struct DraftItem:');
const taxCalculation = between(create, '    var totalAmount:', '    /// Once at least one bill').replaceAll('private ', '');
const amountLogic = between(create, '    private func amount(for participant:', '    private func scanTag').replaceAll('private ', '');
const billAmounts = between(read('Slippy/Models/SplitModels.swift'), 'enum SplitBillAmounts', 'struct SplitBill:');
const preserveManual = between(create, '    private func preserveManualItemsBeforeFirstReceipt()', '    @MainActor\n    private func runOCR').replace('private func', 'mutating func');
const source = `
import Foundation
typealias UIImage = NSObject
struct SlipQRData {}
typealias SplitViewModel = Int
${modes}
${taxModel}
${billAmounts}
@propertyWrapper struct State<Value> {
    var wrappedValue: Value
    init(initialValue: Value) { wrappedValue = initialValue }
    init(wrappedValue: Value) { self.wrappedValue = wrappedValue }
}
${extraction}
${item}
${participant}
${receipt}
struct CreateSplitView {
    var vm: SplitViewModel
    var sourceDocumentID: String?
    @State var receipts: [ScannedReceipt] = []
    @State var title = ""
    @State var totalAmountText = ""
    @State var draftItems: [DraftItem] = []
    @State var billDate = Date()
    var participants = [DraftParticipant(name: "Alice", amount: 0, percentage: 100, items: [])]
    var manualVATMode: SplitVATMode = .none
    var splitMode: SplitMode = .equal
    var manualVATRate = ""
    var usesPerReceiptSplit: Bool { !receipts.isEmpty }
    var testAmounts: [(name: String, amount: Double)] = []
    var validationError: String?
${taxCalculation}
${amountLogic}
    func effectiveAmounts() -> [(name: String, amount: Double)] { testAmounts }
${initializer}
${validation}
${preserveManual}
}
var input = SlipExtraction(vendorName: "Shop", totalAmount: 123.45,
    docDate: "2026-10-15", lineItems: [
        LineItem(name: "Meal", amount: 100),
        LineItem(name: "Meal", amount: 23.45),
        LineItem(name: "Cash", amount: 200, isLineItem: false)
    ], confidence: 0.9)
var draft = CreateSplitView(vm: 0, initialReceipt: input, sourceDocumentID: "document-1")
precondition(draft.title == "Shop" && draft.totalAmountText == "123.45")
precondition(draft.draftItems.count == 2)
precondition(draft.draftItems.allSatisfy { $0.sourceReceiptId == draft.receipts.first?.id })
precondition(draft.receipts.first?.sourceDocumentID == "document-1")
draft.testAmounts = [("Alice", 123.45)]
precondition(draft.validateFriends())
draft.testAmounts = [("Alice", 100)]
precondition(!draft.validateFriends())
draft.testAmounts = [("Alice", Double.nan)]
precondition(!draft.validateFriends())
draft.testAmounts = [("Alice", -1), ("Bob", 124.45)]
precondition(!draft.validateFriends())
let formatter = DateFormatter()
formatter.locale = Locale(identifier: "en_US_POSIX")
formatter.dateFormat = "yyyy-MM-dd"
precondition(formatter.string(from: draft.billDate) == "2026-10-15")
draft.receipts.removeAll()
precondition(draft.receipts.compactMap(\\.sourceDocumentID).first == nil)
let empty = CreateSplitView(vm: 0)
precondition(empty.receipts.isEmpty && empty.title.isEmpty)
input.totalAmount = nil
let missing = CreateSplitView(vm: 0, initialReceipt: input)
precondition(missing.totalAmountText.isEmpty)
var taxed = CreateSplitView(vm: 0, initialReceipt: SlipExtraction(vendorName: "VAT receipt", totalAmount: 107,
    lineItems: [LineItem(name: "Meal", amount: 40), LineItem(name: "Meal", amount: 60)], confidence: 1))
taxed.draftItems[1].isIncluded = false
precondition(taxed.totalAmount == 42.8)
taxed.receipts[0].vatMode = .excluded
taxed.receipts[0].vatRateText = "7"
precondition(taxed.totalAmount == 42.8)
taxed.receipts[0].vatMode = .included
precondition(taxed.totalAmount == 40)
precondition(taxed.taxCalculation(for: taxed.receipts[0])?.vat == 2.62)
taxed.receipts[0].vatMode = .none
precondition(taxed.totalAmount == 40)
taxed.receipts[0].splitMode = .item
precondition(!taxed.hasCompleteAssignments)
taxed.draftItems[0].assignedTo = [taxed.participants[0].id]
precondition(taxed.hasCompleteAssignments)
taxed.draftItems[0].assignedTo = [UUID()]
precondition(!taxed.hasCompleteAssignments)
taxed.receipts[0].vatMode = .excluded
taxed.receipts[0].vatRateText = ""
precondition(!taxed.hasValidTaxConfiguration)
var crossed = CreateSplitView(vm: 0, initialReceipt: SlipExtraction(totalAmount: 100, confidence: 1))
crossed.receipts[0].splitMode = .custom
crossed.receipts.append(ScannedReceipt(result: SlipExtraction(totalAmount: 100, confidence: 1), image: nil, splitMode: .custom))
let payer = crossed.participants[0].id
crossed.receipts[0].customAmounts[payer] = 120
crossed.receipts[1].customAmounts[payer] = 80
crossed.testAmounts = [("Alice", 200)]
precondition(!crossed.hasBalancedReceipts && !crossed.validateFriends())
var manual = CreateSplitView(vm: 0)
manual.totalAmountText = "107"
manual.manualVATMode = .excluded
manual.manualVATRate = "7"
manual.draftItems = [DraftItem(name: "Manual", price: 100, assignedTo: [])]
precondition(manual.totalAmount == 107)
manual.preserveManualItemsBeforeFirstReceipt()
precondition(manual.receipts.count == 1 && manual.totalAmount == 107)
precondition(manual.draftItems[0].sourceReceiptId == manual.receipts[0].id)
print("PASS: existing receipt seed amount, date, duplicate items, row exclusion, source identity, manual fallback")
print("PASS: selected-line VAT totals and active-friend assignment validation")
`;
const dir = mkdtempSync(join(tmpdir(), 'slippy-receipt-split-'));
try {
  writeFileSync(join(dir, 'main.swift'), source);
  execFileSync('swiftc', [join(dir, 'main.swift'), '-o', join(dir, 'verify')], { stdio: 'inherit' });
  execFileSync(join(dir, 'verify'), [], { stdio: 'inherit' });
} finally { rmSync(dir, { recursive: true, force: true }); }
