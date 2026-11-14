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
// --- the stored value: an object path, or the bucket's old public URL ---
let conv = "6f2b7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b"
let objPath = "chat/\\(conv)/1700000000123.jpg"
let publicURL = "https://abc.supabase.co/storage/v1/object/public/chat-attachments/\\(objPath)"
check(R.attachmentPath(from: objPath) == objPath, "a stored path is kept")
check(R.attachmentPath(from: "  \\(objPath) ") == objPath, "surrounding whitespace is ignored")
check(R.attachmentPath(from: publicURL) == objPath, "the old public URL gives its path")
check(R.attachmentPath(from: publicURL.replacingOccurrences(of: "/public/", with: "/sign/") + "?token=abc") == objPath, "a signed URL gives its path")
check(R.attachmentPath(from: "chat/\\(conv)/1700000000123.MOV") == "chat/\\(conv)/1700000000123.MOV", "upper-case extension of an old video")
check(R.attachmentPath(from: publicURL.replacingOccurrences(of: "/chat/", with: "/chat%2F")) == objPath, "an encoded slash decodes to the same canonical path")
for bad in ["", "photo.jpg", "chat/not-a-uuid/1.jpg", "chat/\\(conv)/../x.jpg", "chat/\\(conv)/a/b.jpg", "chat/\\(conv)/noext", "other/\\(conv)/1.jpg",
            "/chat/\\(conv)/1.jpg", "chat/\\(conv)/1.toolongext1", "https://x.test/other.jpg",
            "https://abc.supabase.co/storage/v1/object/public/documents/\\(objPath)", "https://abc.supabase.co/storage/v1/object/public/trip-photos/\\(objPath)",
            "javascript:alert(1)", "file:///etc/passwd", "https://abc.supabase.co/storage/v1/object/public/chat-attachments/chat/\\(conv)/..%2F..%2Fx.jpg"] {
    check(R.attachmentPath(from: bad) == nil, "not a chat file: \\(bad)")
}
check(R.attachmentPath(from: nil) == nil, "nil is nothing")
check(R.conversationId(ofPath: objPath) == conv, "conversation of a path")
check(R.conversationId(ofPath: objPath.replacingOccurrences(of: conv, with: conv.uppercased())) == conv, "conversation is lower-cased")
check(R.conversationId(ofPath: "chat/x/1.jpg") == nil, "bad path has no conversation")

// --- open / share ---
for kind in ["image", "video", "file"] { check(R.isShareableFile(msgType: kind, attachmentUrl: objPath), "\\(kind) with a path is shareable") }
check(R.isShareableFile(msgType: "file", attachmentUrl: publicURL), "an old public URL is still shareable")
check(!R.isShareableFile(msgType: "text", attachmentUrl: objPath), "text is not a file")
check(!R.isShareableFile(msgType: "file", attachmentUrl: nil), "no value")
check(!R.isShareableFile(msgType: "file", attachmentUrl: "https://x.test/a.pdf"), "an outside URL is not a chat file")
check(!R.isShareableFile(msgType: "file", attachmentUrl: "file:///etc/passwd"), "file:// is refused")
check(!R.isShareableFile(msgType: "image", attachmentUrl: "javascript:alert(1)"), "javascript: is refused")

// --- forwarding copies the file into the target room's folder ---
let target = "11111111-2222-4333-8444-555555555555"
let fwd = R.forwardedPath(from: publicURL, toConversation: target.uppercased(), date: Date(timeIntervalSince1970: 1_700_000_999.5))
check(fwd == "chat/\\(target)/1700000999500.jpg", "forwarded path: \\(String(describing: fwd))")
check(R.forwardedPath(from: "chat/\\(conv)/5.MOV", toConversation: target, date: Date(timeIntervalSince1970: 1)) == "chat/\\(target)/1000.mov", "extension is lower-cased")
check(R.forwardedPath(from: "https://x.test/a.pdf", toConversation: target, date: Date()) == nil, "an outside URL is not forwarded")
check(R.forwardedPath(from: nil, toConversation: target, date: Date()) == nil, "nothing to forward")
check(R.attachmentPath(from: fwd) == fwd, "what we build is accepted by what we read")

// --- signed URL cache ---
var cache = R.SignedURLCache()
let t0 = Date(timeIntervalSince1970: 0)
let signed = URL(string: "https://abc.supabase.co/storage/v1/object/sign/chat-attachments/x?token=1")!
check(cache.url(forPath: objPath, now: t0) == nil, "empty cache")
cache.store(signed, forPath: objPath, now: t0)
check(cache.url(forPath: objPath, now: t0.addingTimeInterval(10)) == signed, "served while fresh")
check(cache.url(forPath: objPath, now: t0.addingTimeInterval(Double(R.signedURLLifetime) - R.signedURLRenewMargin)) == signed, "still served with exactly the margin left")
check(cache.url(forPath: objPath, now: t0.addingTimeInterval(Double(R.signedURLLifetime) - R.signedURLRenewMargin + 1)) == nil, "renewed once LESS than the margin is left")
check(cache.url(forPath: objPath, now: t0.addingTimeInterval(10)) == nil, "an expired entry is dropped, not revived")
cache.store(signed, forPath: objPath, now: t0, lifetime: 60)
check(cache.url(forPath: objPath, now: t0) == nil, "a URL that lives less than the margin is never served from the cache")
cache.store(signed, forPath: "a", now: t0); cache.removeAll()
check(cache.url(forPath: "a", now: t0) == nil, "removeAll")

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
