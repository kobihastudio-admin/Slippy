// Host test for Slippy/Utils/TripDocumentUploadRules.swift (Foundation only): size limit, names of photos taken or
// picked, the file type chosen for a photo, and the Thai wording of upload errors.
// Run: node ios/scripts/verify-trip-document-upload.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = new URL('../Slippy/Utils/TripDocumentUploadRules.swift', import.meta.url).pathname;
assert(readFileSync(source, 'utf8').includes('enum TripDocumentUploadRules'), 'TripDocumentUploadRules.swift is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-trip-doc-rules-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }
typealias R = TripDocumentUploadRules
let mb = 1024 * 1024

// --- size: the bucket allows 15 MB (migration 20260824160000), the web route the same ---
check(R.maxBytes == 15 * mb, "limit is 15 MB")
check(R.sizeProblem(bytes: 15 * mb) == nil, "exactly 15 MB is allowed")
check(R.sizeProblem(bytes: 1) == nil, "a small file is allowed")
check(R.sizeProblem(bytes: 15 * mb + 1) != nil, "one byte over is refused")
check(R.sizeProblem(bytes: 0) != nil, "an empty file is refused")
let big = R.sizeProblem(bytes: 20 * mb)!
check(big.contains("20.0 MB") && big.contains("15 MB"), "the message says how big it is and the limit: \\(big)")
check(R.sizeProblem(bytes: 20 * mb)!.contains("ไฟล์ใหญ่เกินไป"), "Thai wording")

// --- name of a photo: stable, sortable, safe, with the right extension ---
var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Bangkok")!
let date = cal.date(from: DateComponents(year: 2026, month: 11, day: 13, hour: 13, minute: 37, second: 5))!
check(R.photoFileName(date: date, ext: "jpg", timeZone: TimeZone(identifier: "Asia/Bangkok")!) == "รูปภาพ-20261113-133705.jpg", "photo name")
check(R.photoFileName(date: date, ext: "HEIC", timeZone: TimeZone(identifier: "Asia/Bangkok")!) == "รูปภาพ-20261113-133705.heic", "extension is lower-cased")
check(R.photoFileName(date: date, ext: "../x", timeZone: TimeZone(identifier: "Asia/Bangkok")!) == "รูปภาพ-20261113-133705.jpg", "a hostile extension falls back to jpg")
check(R.photoFileName(date: date, ext: "", timeZone: TimeZone(identifier: "Asia/Bangkok")!) == "รูปภาพ-20261113-133705.jpg", "no extension -> jpg")

// --- which format a picked photo is stored as ---
check(R.storedPhotoFormat(typeIdentifiers: ["public.heic", "public.jpeg"]) == .heic, "a heic original is kept as heic (the bucket and the table allow it)")
check(R.storedPhotoFormat(typeIdentifiers: ["public.png"]) == .png, "png is kept")
check(R.storedPhotoFormat(typeIdentifiers: ["public.jpeg"]) == .jpeg, "jpeg is kept")
check(R.storedPhotoFormat(typeIdentifiers: ["com.compuserve.gif"]) == .convertToJPEG, "a format the table does not allow is converted to jpeg")
check(R.storedPhotoFormat(typeIdentifiers: ["public.tiff", "public.heif"]) == .convertToJPEG, "tiff / heif are converted")
check(R.storedPhotoFormat(typeIdentifiers: []) == .convertToJPEG, "unknown -> converted")
check(R.PhotoFormat.heic.ext == "heic" && R.PhotoFormat.png.ext == "png" && R.PhotoFormat.jpeg.ext == "jpg" && R.PhotoFormat.convertToJPEG.ext == "jpg", "extensions")
check(R.PhotoFormat.heic.mime == "image/heic" && R.PhotoFormat.png.mime == "image/png" && R.PhotoFormat.jpeg.mime == "image/jpeg" && R.PhotoFormat.convertToJPEG.mime == "image/jpeg", "mime types")

// --- JPEG quality steps used when a photo is over the limit ---
check(R.jpegQualitySteps == [0.85, 0.6, 0.4], "quality steps, best first")

// --- Thai wording for errors from storage / the table / the network ---
check(R.friendlyError("The object exceeded the maximum allowed size").contains("ไฟล์ใหญ่เกินไป"), "storage size error")
check(R.friendlyError("Payload too large").contains("ไฟล์ใหญ่เกินไป"), "413 wording")
check(R.friendlyError("new row violates row-level security policy").contains("ผู้ร่วมทริป"), "RLS wording")
check(R.friendlyError("permission denied for table trip_documents").contains("ล็อกอิน"), "no session -> sign in")
check(R.friendlyError("The Internet connection appears to be offline.").contains("อินเทอร์เน็ต"), "offline")
check(R.friendlyError("The network connection was lost.").contains("อินเทอร์เน็ต"), "connection lost")
check(R.friendlyError("The request timed out.").contains("อินเทอร์เน็ต"), "timeout")
check(R.friendlyError("something unexpected").hasPrefix("อัปโหลดไม่สำเร็จ"), "unknown errors keep the original text after a Thai prefix")
check(R.friendlyError("something unexpected").contains("something unexpected"), "the original text is not lost")
check(R.friendlyError("รองรับเฉพาะไฟล์ PDF, JPG, PNG, HEIC") == "รองรับเฉพาะไฟล์ PDF, JPG, PNG, HEIC", "an already Thai message is shown as it is")
check(R.friendlyError("").hasPrefix("อัปโหลดไม่สำเร็จ"), "empty message")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: trip document upload rules (size, photo name/format, quality steps, Thai errors)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', source, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
