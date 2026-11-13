// Host test for Slippy/Utils/ChatAttachmentRules.swift (Foundation only): size limit, message type split, storage
// path, names of captured files, what can be forwarded / shared, and the Thai wording of send errors.
// Run: node ios/scripts/verify-chat-attachment-rules.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = new URL('../Slippy/Utils/ChatAttachmentRules.swift', import.meta.url).pathname;
assert(readFileSync(source, 'utf8').includes('enum ChatAttachmentRules'), 'ChatAttachmentRules.swift is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-chat-attachment-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }
typealias R = ChatAttachmentRules
let mb = 1024 * 1024

// --- size: the bucket allows 50 MB (migration 077) ---
check(R.maxBytes == 50 * mb, "limit is 50 MB")
check(R.sizeProblem(bytes: 50 * mb) == nil, "exactly 50 MB is allowed")
check(R.sizeProblem(bytes: 1) == nil, "a small file is allowed")
check(R.sizeProblem(bytes: 50 * mb + 1) != nil, "one byte over is refused")
check(R.sizeProblem(bytes: 0) != nil, "an empty file is refused")
let big = R.sizeProblem(bytes: 80 * mb)!
check(big.contains("80.0 MB") && big.contains("50 MB"), "the message says how big it is and the limit: \\(big)")

// --- message type ---
check(R.messageType(mime: "image/heic") == "image", "image")
check(R.messageType(mime: "IMAGE/PNG") == "image", "image, upper-case")
check(R.messageType(mime: "video/quicktime") == "video", "video")
check(R.messageType(mime: "application/pdf") == "file", "pdf is a file")
check(R.messageType(mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document") == "file", "docx is a file")
check(R.messageType(mime: "application/octet-stream") == "file", "unknown is a file")
check(R.messageType(mime: "") == "file", "empty is a file")

// --- size label ---
check(R.sizeLabel(bytes: 12) == "12 B", "bytes")
check(R.sizeLabel(bytes: 2048) == "2 KB", "kilobytes")
check(R.sizeLabel(bytes: 3 * mb / 2) == "1.5 MB", "megabytes")
check(R.sizeLabel(bytes: -5) == "0 B", "negative size")

// --- extension and storage path ---
check(R.safeExtension("PDF") == "pdf", "extension is lower-cased")
check(R.safeExtension("") == "bin", "no extension")
check(R.safeExtension("../etc") == "bin", "path characters are refused")
check(R.safeExtension("a b") == "bin", "spaces are refused")
check(R.safeExtension("verylongext") == "bin", "more than 8 characters is refused")
check(R.safeExtension("ไทย") == "bin", "non-ASCII is refused")
let date = Date(timeIntervalSince1970: 1_700_000_000.123)
check(R.storagePath(conversationId: "ABCDEF12-0000-0000-0000-000000000001", date: date, fileName: "ใบเสนอราคา.PDF")
      == "chat/abcdef12-0000-0000-0000-000000000001/1700000000123.pdf", "path: \\(R.storagePath(conversationId: "ABCDEF12-0000-0000-0000-000000000001", date: date, fileName: "ใบเสนอราคา.PDF"))")
check(R.storagePath(conversationId: "c1", date: date, fileName: "noext") == "chat/c1/1700000000123.bin", "no extension -> bin")
check(R.storagePath(conversationId: "c1", date: date, fileName: "a.tar.gz") == "chat/c1/1700000000123.gz", "last extension only")

// --- names of captured / picked media (Gregorian digits whatever the calendar) ---
let bangkok = TimeZone(identifier: "Asia/Bangkok")!
check(R.capturedFileName(kind: "image", date: Date(timeIntervalSince1970: 1_700_000_000), ext: "HEIC", timeZone: bangkok) == "รูปภาพ-20231115-051320.heic", "photo name")
check(R.capturedFileName(kind: "video", date: Date(timeIntervalSince1970: 1_700_000_000), ext: "mov", timeZone: bangkok) == "วิดีโอ-20231115-051320.mov", "video name")
check(R.capturedFileName(kind: "image", date: Date(timeIntervalSince1970: 1_700_000_000), ext: "??", timeZone: bangkok) == "รูปภาพ-20231115-051320.bin", "hostile ext")

// --- forward / share ---
for kind in ["text", "image", "video", "file"] { check(R.isForwardable(msgType: kind), "\\(kind) can be forwarded") }
for kind in ["payment_request", "slip", "system", ""] { check(!R.isForwardable(msgType: kind), "\\(kind) is not forwarded") }
check(R.isShareableFile(msgType: "file", attachmentUrl: "https://x.supabase.co/storage/v1/object/public/chat-attachments/chat/c/1.pdf"), "https file shareable")
check(!R.isShareableFile(msgType: "text", attachmentUrl: "https://x.test/a.pdf"), "text is not a file")
check(!R.isShareableFile(msgType: "file", attachmentUrl: nil), "no url")
check(!R.isShareableFile(msgType: "file", attachmentUrl: "file:///etc/passwd"), "file:// is refused")
check(!R.isShareableFile(msgType: "image", attachmentUrl: "javascript:alert(1)"), "javascript: is refused")
check(!R.isShareableFile(msgType: "image", attachmentUrl: "not a url"), "garbage is refused")

// --- local file name ---
check(R.safeLocalFileName("แผนเที่ยว.pdf", fallback: "ไฟล์") == "แผนเที่ยว.pdf", "Thai name is kept")
check(R.safeLocalFileName("../../etc/passwd", fallback: "ไฟล์") == "..-..-etc-passwd" || !R.safeLocalFileName("../../etc/passwd", fallback: "ไฟล์").contains("/"), "no slashes survive")
check(R.safeLocalFileName("   ", fallback: "ไฟล์") == "ไฟล์", "blank -> fallback")
check(R.safeLocalFileName("a:b*c?.txt", fallback: "x") == "a-b-c-.txt", "illegal characters")
check(R.safeLocalFileName(String(repeating: "ก", count: 300), fallback: "x").count == 120, "long names are cut")

// --- icons ---
check(R.iconName(forFileName: "a.PDF") == "doc.richtext", "pdf icon")
check(R.iconName(forFileName: "a.xlsx") == "tablecells", "sheet icon")
check(R.iconName(forFileName: "a.zip") == "doc.zipper", "zip icon")
check(R.iconName(forFileName: "noext") == "doc", "default icon")

// --- error wording ---
check(R.friendlyError("The object exceeded the maximum allowed size").contains("50 MB"), "too large")
check(R.friendlyError("new row violates row-level security policy").contains("ไม่มีสิทธิ์"), "rls")
check(R.friendlyError("The Internet connection appears to be offline.").contains("อินเทอร์เน็ต"), "offline")
check(R.friendlyError("ไฟล์เสีย") == "ไฟล์เสีย", "Thai text is kept")
check(R.friendlyError("boom").hasPrefix("ส่งไฟล์ไม่สำเร็จ"), "unknown keeps the original text")

if failures > 0 { print("\\(failures) failure(s)"); exit(1) }
print("PASS: chat attachment rules")
`);
  const bin = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', source, main, '-module-cache-path', join(directory, 'modcache'), '-o', bin], { stdio: 'inherit' });
  process.stdout.write(execFileSync(bin, { encoding: 'utf8' }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
