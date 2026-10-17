import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const model = readFileSync(new URL('Slippy/Models/SplitModels.swift', root), 'utf8');
const vm = readFileSync(new URL('Slippy/ViewModels/SplitViewModel.swift', root), 'utf8')
  .replace('import SwiftUI', 'import Combine').replace('import Supabase', '');
assert.match(vm, /private let db = SupabaseManager.shared.client/);

// Run the production view model and Codable models without network, credentials
// or production records. Only the fluent database transport is replaced.
const harness = `
import Foundation
import Combine

enum StoreError: Error { case injected }
struct Response<T> { let value: T }

@MainActor final class SupabaseManager {
    static let shared = SupabaseManager()
    let client = MemoryDatabase()
}

@MainActor final class MemoryDatabase {
    var bills: [[String: Any]] = []
    var participants: [[String: Any]] = []
    var requests: [(String, String)] = []
    var failure: String?
    var emptyInsert = false

    func reset() {
        bills = []; participants = []; requests = []
        failure = nil; emptyInsert = false
    }

    func from(_ table: String) -> Query { Query(database: self, table: table) }

    func execute(_ query: Query) throws -> Data {
        requests.append((query.table, query.operation))
        if failure == query.table + ":" + query.operation { throw StoreError.injected }
        if query.operation == "insert" {
            if emptyInsert { return Data("[]".utf8) }
            guard let payload = query.payload else { preconditionFailure("Missing insert payload") }
            let decoded = try JSONSerialization.jsonObject(with: payload)
            let rows = (decoded as? [[String: Any]]) ?? [decoded as! [String: Any]]
            if query.table == "split_bills" {
                let inserted = rows.map { row -> [String: Any] in
                    var result = row
                    result["id"] = "bill-" + String(bills.count)
                    result["share_token"] = "share-" + String(bills.count)
                    result["created_at"] = "2026-10-15T00:00:00Z"
                    return result
                }
                bills += inserted
                return try JSONSerialization.data(withJSONObject: inserted)
            }
            precondition(query.table == "split_participants")
            participants += rows.enumerated().map { offset, row in
                var result = row
                result["id"] = "participant-" + String(participants.count + offset)
                result["created_at"] = "2026-10-15T00:00:00Z"
                return result
            }
            return Data("[]".utf8)
        }
        precondition(query.operation == "select" && query.table == "split_bills")
        precondition(query.columns == "*, split_participants(*), split_bill_receipts(*)")
        precondition(query.orderColumn == "created_at" && query.ascending == false)
        guard let org = query.filters["organization_id"] else {
            preconditionFailure("Organization filter missing")
        }
        let rows = bills.filter { $0["organization_id"] as? String == org }.map { row -> [String: Any] in
            var result = row
            result["split_participants"] = participants.filter { $0["split_bill_id"] as? String == row["id"] as? String }
            result["split_bill_receipts"] = []
            return result
        }
        return try JSONSerialization.data(withJSONObject: rows)
    }
}

@MainActor final class Query {
    let database: MemoryDatabase
    let table: String
    var operation = "select"
    var payload: Data?
    var columns: String?
    var filters: [String: String] = [:]
    var orderColumn: String?
    var ascending: Bool?
    init(database: MemoryDatabase, table: String) { self.database = database; self.table = table }
    func insert<T: Encodable>(_ input: T) throws -> Query {
        operation = "insert"; payload = try JSONEncoder().encode(input); return self
    }
    func select(_ columns: String) -> Query { self.columns = columns; return self }
    func eq(_ column: String, value: String) -> Query { filters[column] = value; return self }
    func order(_ column: String, ascending: Bool) -> Query {
        orderColumn = column; self.ascending = ascending; return self
    }
    func update<T: Encodable>(_ input: T) throws -> Query {
        operation = "update"; payload = try JSONEncoder().encode(input); return self
    }
    func delete() -> Query { operation = "delete"; return self }
    @discardableResult func execute<T: Decodable>() async throws -> Response<T> {
        Response(value: try JSONDecoder().decode(T.self, from: database.execute(self)))
    }
    @discardableResult func execute() async throws -> Response<Void> {
        _ = try database.execute(self); return Response(value: ())
    }
}

${model}
${vm}

@main struct VerifyPersistence {
    @MainActor static func main() async throws {
        let db = SupabaseManager.shared.client
        db.reset()
        let writer = SplitViewModel()
        let amounts = SplitBillAmounts.equalShares(total: 100, count: 3)
        let guests = zip(["Alice", "Bob", "Guest"], amounts).map { (name: $0.0, amount: $0.1) }
        let token = try await writer.createBill(orgId: "org-a", userId: "user-a", title: "Receipt bill",
            totalAmount: 100, note: "", documentID: "document-a", participants: guests)
        precondition(token == "share-0")
        precondition(db.bills[0]["document_id"] as? String == "document-a")
        precondition(db.bills[0]["creator_id"] as? String == "user-a")
        precondition(db.bills[0]["organization_id"] as? String == "org-a")
        precondition(db.bills[0]["total_amount"] as? Double == 100)
        precondition(db.bills[0]["note"] == nil)
        precondition(db.participants.count == 3)
        precondition(db.participants.allSatisfy { $0["split_bill_id"] as? String == "bill-0" })
        precondition(db.participants.allSatisfy { $0["line_id"] == nil && $0["phone"] == nil && $0["contact_id"] == nil })
        let reopened = SplitViewModel()
        await reopened.load(orgId: "org-a")
        precondition(!reopened.isLoading && reopened.error == nil)
        precondition(reopened.bills.count == 1 && reopened.bills[0].title == "Receipt bill")
        precondition(reopened.bills[0].totalAmount == 100)
        precondition(reopened.bills[0].participants?.map(\\.name) == guests.map(\\.name))
        precondition(reopened.bills[0].participants?.map(\\.amount) == amounts)
        precondition(abs(reopened.bills[0].participants!.reduce(0) { $0 + $1.amount } - 100) < 0.000001)
        let otherOrg = SplitViewModel()
        await otherOrg.load(orgId: "org-b")
        precondition(otherOrg.bills.isEmpty)

        _ = try await writer.createBill(orgId: "org-b", userId: "user-b", title: "Manual bill",
            totalAmount: 10, note: "Keep note", participants: [("Manual guest", 10)])
        precondition(db.bills[1]["document_id"] == nil)
        precondition(db.bills[1]["note"] as? String == "Keep note")
        precondition(db.bills[1]["organization_id"] as? String == "org-b")
        precondition(db.bills[1]["creator_id"] as? String == "user-b")
        precondition(db.bills[1]["total_amount"] as? Double == 10)
        await reopened.load(orgId: "org-a")
        await otherOrg.load(orgId: "org-b")
        precondition(reopened.bills.count == 1 && reopened.bills[0].title == "Receipt bill")
        precondition(otherOrg.bills.count == 1 && otherOrg.bills[0].title == "Manual bill")
        precondition(otherOrg.bills[0].totalAmount == 10)
        precondition(otherOrg.bills[0].participants?.map(\\.name) == ["Manual guest"])

        db.reset(); db.failure = "split_bills:insert"
        do {
            _ = try await writer.createBill(orgId: "org-a", userId: "user-a", title: "Failure",
                totalAmount: 10, note: nil, participants: [("Guest", 10)])
            preconditionFailure("Bill write failure was swallowed")
        } catch StoreError.injected {}
        precondition(db.requests.count == 1 && db.participants.isEmpty)

        db.reset(); db.failure = "split_participants:insert"
        do {
            _ = try await writer.createBill(orgId: "org-a", userId: "user-a", title: "Failure",
                totalAmount: 10, note: nil, participants: [("Guest", 10)])
            preconditionFailure("Participant write failure was swallowed")
        } catch StoreError.injected {}
        // Existing API uses separate writes, not an atomic transaction.
        precondition(db.bills.count == 1 && db.participants.isEmpty)

        db.reset(); db.emptyInsert = true
        let empty = try await writer.createBill(orgId: "org-a", userId: "user-a", title: "Empty",
            totalAmount: 10, note: nil, participants: [("Guest", 10)])
        precondition(empty == nil && db.requests.count == 1)
        db.failure = "split_bills:select"
        await reopened.load(orgId: "org-a")
        precondition(!reopened.isLoading && reopened.error != nil)
        print("PASS: production split view model payload/reopen contracts, org filtering, privacy, empty result and write/read failure propagation (offline transport)")
    }
}
`;

const directory = mkdtempSync(join(tmpdir(), 'slippy-split-persistence-'));
try {
  writeFileSync(join(directory, 'verify.swift'), harness);
  execFileSync('swiftc', ['-parse-as-library', join(directory, 'verify.swift'), '-o', join(directory, 'verify')], { stdio: 'inherit' });
  execFileSync(join(directory, 'verify'), [], { stdio: 'inherit' });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
