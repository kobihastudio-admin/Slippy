// Host test for the Foundation-only helpers behind the document footer actions (ดาวน์โหลด / แชร์ / รายงานปัญหา):
//   Slippy/Utils/DocumentFileSupport.swift    (the downloaded file's name and extension)
//   Slippy/Utils/DocumentReportSupport.swift  (report categories, validation, the row that is inserted)
// Run: node ios/scripts/verify-document-actions.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const sources = ['DocumentFileSupport.swift', 'DocumentReportSupport.swift'].map((name) => {
  const path = new URL(`../Slippy/Utils/${name}`, import.meta.url).pathname;
  assert(readFileSync(path, 'utf8').length > 0, `${name} is missing`);
  return path;
});

const directory = mkdtempSync(join(tmpdir(), 'slippy-document-actions-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }
let id = "0a1b2c3d-1111-4222-8333-444455556666"

// --- file name: keep the stored name, make it safe, and always end up with a real extension ---
check(DocumentFileSupport.fileName(filePath: "org/2026/receipt-001.jpg", mimeType: nil, fallbackId: id) == "receipt-001.jpg", "keeps a normal name")
check(DocumentFileSupport.fileName(filePath: "org/2026/RECEIPT.JPG", mimeType: nil, fallbackId: id) == "RECEIPT.jpg", "extension is lower-cased")
check(DocumentFileSupport.fileName(filePath: "a/b/invoice.pdf", mimeType: "application/pdf", fallbackId: id) == "invoice.pdf", "pdf stays pdf")
check(DocumentFileSupport.fileName(filePath: "a/b/scan", mimeType: "image/png", fallbackId: id) == "scan.png", "no extension: taken from the mime type")
check(DocumentFileSupport.fileName(filePath: "a/b/scan", mimeType: "application/pdf", fallbackId: id) == "scan.pdf", "no extension, pdf mime")
check(DocumentFileSupport.fileName(filePath: "a/b/scan.bin", mimeType: "image/jpeg", fallbackId: id) == "scan.jpg", "an unknown extension is replaced by the mime type's")
check(DocumentFileSupport.fileName(filePath: "a/b/photo.heic", mimeType: "image/heic", fallbackId: id) == "photo.heic", "heic is kept")
check(DocumentFileSupport.fileName(filePath: "a/b/scan", mimeType: nil, fallbackId: id) == "scan.jpg", "no extension and no mime type: documents are scanned photos, jpg")
check(DocumentFileSupport.fileName(filePath: "a/b/x.weird", mimeType: nil, fallbackId: id) == "x.jpg", "unknown extension and no mime type: jpg")
check(DocumentFileSupport.fileName(filePath: "", mimeType: "image/png", fallbackId: id) == "document-0a1b2c3d.png", "empty path: document-<id prefix>")
check(DocumentFileSupport.fileName(filePath: "a/b/", mimeType: nil, fallbackId: id) == "document-0a1b2c3d.jpg", "a path that ends in a slash has no name")
check(DocumentFileSupport.fileName(filePath: "a/b/..", mimeType: nil, fallbackId: id) == "document-0a1b2c3d.jpg", "'..' is not a name")
check(DocumentFileSupport.fileName(filePath: "a/b/we ird:na*me?.png", mimeType: nil, fallbackId: id) == "we_ird_na_me_.png", "characters that are unsafe in a file name become _")
check(DocumentFileSupport.fileName(filePath: "a/b/ใบเสร็จ 7-11.jpg", mimeType: nil, fallbackId: id) == "ใบเสร็จ_7-11.jpg", "Thai letters are kept")
let long = String(repeating: "a", count: 200)
check(DocumentFileSupport.fileName(filePath: "a/\\(long).png", mimeType: nil, fallbackId: id).count == 60 + 4, "a long stem is cut to 60 characters")
check(!DocumentFileSupport.fileName(filePath: "../../etc/passwd", mimeType: nil, fallbackId: id).contains("/"), "never contains a path separator")
check(DocumentFileSupport.fileExtension(forMimeType: "image/jpeg") == "jpg", "jpeg -> jpg")
check(DocumentFileSupport.fileExtension(forMimeType: "IMAGE/PNG; charset=binary") == "png", "mime parameters and case are ignored")
check(DocumentFileSupport.fileExtension(forMimeType: "text/html") == nil, "an error page is not a document type")
check(DocumentFileSupport.fileExtension(forMimeType: nil) == nil, "no mime type")
check(DocumentFileSupport.isDocumentMimeType("image/webp") && DocumentFileSupport.isDocumentMimeType("application/pdf"), "images and pdf are documents")
check(!DocumentFileSupport.isDocumentMimeType("text/html") && !DocumentFileSupport.isDocumentMimeType("application/json"), "html/json (a storage error body) is not a document")
check(DocumentFileSupport.isDocumentMimeType(nil), "an unknown mime type is given the benefit of the doubt")

// --- report categories: raw values are what the database CHECK lists ---
check(DocumentReportCategory.allCases.map(\\.rawValue) == ["wrong_amount", "wrong_vendor", "wrong_date", "wrong_tax", "unreadable", "duplicate", "other"], "categories match the migration, in order")
check(DocumentReportCategory.allCases.allSatisfy { !$0.label.isEmpty }, "every category has a Thai label")
check(DocumentReportCategory.other.requiresNote && !DocumentReportCategory.wrongAmount.requiresNote, "only 'other' needs a note")

// --- note and validation ---
check(DocumentReport.cleanNote("  hello \\n") == "hello", "note is trimmed")
check(DocumentReport.cleanNote("   \\n ") == nil, "a blank note is no note")
check(DocumentReport.validate(category: .other, note: "  ") == .noteRequired, "'other' with a blank note is refused")
check(DocumentReport.validate(category: .other, note: "something") == nil, "'other' with a note is fine")
check(DocumentReport.validate(category: .wrongAmount, note: "") == nil, "a specific category needs no note")
check(DocumentReport.validate(category: .wrongAmount, note: String(repeating: "x", count: 1000)) == nil, "1000 characters is allowed")
check(DocumentReport.validate(category: .wrongAmount, note: String(repeating: "x", count: 1001)) == .noteTooLong, "1001 characters is too long")
check(DocumentReport.validate(category: .wrongAmount, note: String(repeating: "ก", count: 1000)) == nil, "length counts characters, not bytes")

// --- the row that is inserted ---
let insert = DocumentReport.makeInsert(documentId: id, organizationId: "o1", reporterId: "u1", category: .wrongAmount, note: "  total is off  ", appVersion: "1.0.0", context: ["vendor": "KOFUKU"])
check(insert != nil, "a valid report builds a row")
let json = String(data: try JSONEncoder().encode(insert!), encoding: .utf8)!
check(json.contains("\\"document_id\\":\\"\\(id)\\""), "document_id key")
check(json.contains("\\"organization_id\\":\\"o1\\"") && json.contains("\\"reporter_id\\":\\"u1\\""), "organization_id and reporter_id keys")
check(json.contains("\\"category\\":\\"wrong_amount\\""), "category is the raw value")
check(json.contains("\\"note\\":\\"total is off\\""), "note is the trimmed text")
check(json.contains("\\"app_version\\":\\"1.0.0\\""), "app_version key")
check(json.contains("\\"vendor\\":\\"KOFUKU\\""), "context is carried")
check(!json.contains("status"), "status is never sent (the database defaults it to open)")
let noNote = DocumentReport.makeInsert(documentId: id, organizationId: "o1", reporterId: "u1", category: .duplicate, note: "   ", appVersion: "1.0.0", context: [:])!
check(!String(data: try JSONEncoder().encode(noNote), encoding: .utf8)!.contains("\\"note\\""), "a blank note is left out, not sent as empty (the CHECK needs 1..1000)")
check(DocumentReport.makeInsert(documentId: id, organizationId: "o1", reporterId: "u1", category: .other, note: " ", appVersion: "1.0.0", context: [:]) == nil, "an invalid report builds nothing")

// --- context ---
let ctx = DocumentReport.makeContext(vendorName: "KOFUKU", totalAmount: 1234.5, status: "reviewing", source: "ios", docType: nil, validationIssues: ["total_mismatch", "low_confidence"])
check(ctx["vendor_name"] == "KOFUKU" && ctx["total_amount"] == "1234.50" && ctx["status"] == "reviewing" && ctx["source"] == "ios", "context carries what the team needs to find the problem")
check(ctx["validation_issues"] == "total_mismatch,low_confidence", "validation issues are joined")
check(ctx["doc_type"] == nil, "missing values are left out")
check(DocumentReport.makeContext(vendorName: " ", totalAmount: nil, status: "x", source: "", docType: nil, validationIssues: []).keys.sorted() == ["status"], "blank values are left out")

// --- duplicate report ---
check(DocumentReport.isAlreadyReported(code: "23505"), "unique violation means this exact report is already open")
check(!DocumentReport.isAlreadyReported(code: "42501") && !DocumentReport.isAlreadyReported(code: nil), "other errors are real failures")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: document actions (file name, report validation, report row)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', ...sources, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
