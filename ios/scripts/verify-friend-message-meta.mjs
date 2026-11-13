// Host test for FriendMessage / FriendMessageMeta decoding (Slippy/Models/MessageModels.swift): `messages.meta` is a
// jsonb column that holds different keys for different message types, so a file message must read its
// {fileName, fileSize} and every other shape (null, {}, payment requests, odd types) must still decode.
// Run: node ios/scripts/verify-friend-message-meta.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const models = new URL('../Slippy/Models/MessageModels.swift', import.meta.url).pathname;
const paging = new URL('../Slippy/Utils/ChatPaging.swift', import.meta.url).pathname;
assert(readFileSync(models, 'utf8').includes('struct FriendMessageMeta'), 'FriendMessageMeta is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-message-meta-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

struct UserProfile: Codable {}   // stand-in: MessageModels.swift only embeds it in another model

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }

func decode(_ metaJSON: String?) -> FriendMessage? {
    let meta = metaJSON.map { ", \\"meta\\": " + $0 } ?? ""
    let json = """
    {"id":"m1","conversation_id":"c1","sender_id":"u1","body":"แผน.pdf","msg_type":"file",
     "attachment_url":"https://x.test/a.pdf","created_at":"2026-11-13T05:00:00Z"\\(meta)}
    """
    return try? JSONDecoder().decode(FriendMessage.self, from: Data(json.utf8))
}

// what the web chat writes
let file = decode(#"{"fileName":"แผน.pdf","fileSize":2048}"#)
check(file?.meta?.fileName == "แผน.pdf" && file?.meta?.fileSize == 2048, "web file meta: \\(String(describing: file?.meta))")
// number written as a decimal
check(decode(#"{"fileName":"a","fileSize":2048.0}"#)?.meta?.fileSize == 2048, "decimal size")
// no meta key, null, empty object: still a message
check(decode(nil) != nil && decode(nil)?.meta == nil, "no meta key")
check(decode("null") != nil && decode("null")?.meta == nil, "null meta")
let empty = decode("{}")
check(empty != nil && empty?.meta?.fileName == nil && empty?.meta?.fileSize == nil, "empty object")
// other message types keep other keys
check(decode(#"{"payment_request_id":"p1","amount":120.5,"title":"ค่าข้าว"}"#) != nil, "payment request meta still decodes")
// wrong types never fail the whole message
let odd = decode(#"{"fileName":42,"fileSize":"big"}"#)
check(odd != nil && odd?.meta?.fileName == nil && odd?.meta?.fileSize == nil, "wrong types are ignored")
check(decode(#"[1,2,3]"#) == nil || decode(#"[1,2,3]"#)?.meta == nil, "an array meta does not crash")
// the meta we send round-trips
let sent = FriendMessageMeta(fileName: "a.pdf", fileSize: 10)
let back = try? JSONDecoder().decode(FriendMessageMeta.self, from: JSONEncoder().encode(sent))
check(back == sent, "meta round-trips")
let encoded = String(data: try! JSONEncoder().encode(FriendMessageMeta(fileName: "a.pdf", fileSize: nil)), encoding: .utf8)!
check(encoded.contains("fileName") && !encoded.contains("fileSize"), "a missing size is not written: \\(encoded)")

if failures > 0 { print("\\(failures) failure(s)"); exit(1) }
print("PASS: friend message meta")
`);
  const bin = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', models, paging, main, '-module-cache-path', join(directory, 'modcache'), '-o', bin], { stdio: 'inherit' });
  process.stdout.write(execFileSync(bin, { encoding: 'utf8' }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
