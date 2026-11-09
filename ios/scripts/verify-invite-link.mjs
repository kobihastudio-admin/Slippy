import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = new URL('../Slippy/Utils/InviteLink.swift', import.meta.url).pathname;
assert(readFileSync(source, 'utf8').includes('enum InviteLink'), 'InviteLink.swift is missing');

const directory = mkdtempSync(join(tmpdir(), 'slippy-invite-link-'));
try {
  const main = join(directory, 'main.swift');
  writeFileSync(main, `import Foundation

var failures = 0
func check(_ ok: Bool, _ message: String) { if !ok { failures += 1; print("FAIL: \\(message)") } }
func tok(_ s: String) -> String? { URL(string: s).flatMap { InviteLink.token(from: $0) } }
let T = "0123456789ab"

// --- accepted ---
check(tok("slippy://friends/join/\\(T)") == T, "plain deep link")
check(tok("slippy://friends/join/\\(T)/") == T, "trailing slash")
check(tok("slippy://friends/join/\\(T)?src=line") == T, "query ignored, token still exact")
check(tok("slippy://friends/join/\\(T)#x") == T, "fragment ignored")
check(tok("SLIPPY://FRIENDS/join/\\(T)") == T, "scheme and host are case-insensitive")
check(tok("slippy://friends/join/abcdefabcdef") == "abcdefabcdef", "all-letter hex token")

// --- rejected: bad tokens ---
// (A percent-encoded VALID token such as %30123456789ab decodes to "0123456789ab"; accepting it is harmless
// because the token that leaves the parser is identical, so it is deliberately not in this list.)
for bad in ["0123456789a", "0123456789abc", "0123456789AB", "0123456789ag", "", "0123456789a%20",
            "0123456789ab%2F..", "..", "0123456789ab%0A", "0123456789a%2F"] {
    check(tok("slippy://friends/join/\\(bad)") == nil, "must reject token [\\(bad)]")
}

// --- rejected: wrong shape ---
check(tok("slippy://friends/join/\\(T)/extra") == nil, "extra path segment")
check(tok("slippy://friends/join") == nil, "no token")
check(tok("slippy://friends/join/") == nil, "empty token")
check(tok("slippy://friends/\\(T)") == nil, "missing join segment")
check(tok("slippy://friends/leave/\\(T)") == nil, "wrong action")
check(tok("slippy://friend/join/\\(T)") == nil, "wrong host")
check(tok("slippy://import-shared") == nil, "the share-extension callback is not an invite")
check(tok("slippy://import-shared/join/\\(T)") == nil, "import-shared host with an invite-looking path")
check(tok("slippy://\\(T)") == nil, "token as host")
check(tok("https://friends/join/\\(T)") == nil, "other scheme")
check(tok("https://dev.slippyai.app/friends/join/\\(T)") == nil, "the web URL is not a deep link")
check(tok("line3rdp.app.slippy.ios://authorize?code=abc") == nil, "LINE SDK callback is not an invite")

// --- LINE share URL ---
func share(_ s: String) -> String { InviteLink.lineShareURL(URL(string: s)!).absoluteString }
check(share("https://dev.slippyai.app/friends/join/\\(T)") == "https://dev.slippyai.app/friends/join/\\(T)?src=line", "adds src=line")
check(share("https://dev.slippyai.app/friends/join/\\(T)?utm=a") == "https://dev.slippyai.app/friends/join/\\(T)?utm=a&src=line", "keeps other query")
check(share("https://dev.slippyai.app/friends/join/\\(T)?src=email") == "https://dev.slippyai.app/friends/join/\\(T)?src=line", "replaces an existing src")

// --- the share TEXT must be encoded like encodeURIComponent, or "?src=line" becomes the query of the
//     line:// URL instead of staying inside the message (and the recipient gets the old auto-join link) ---
let shareText = "มาเป็นเพื่อนกันใน Slippy กันเถอะ! https://dev.slippyai.app/friends/join/\\(T)?src=line&x=1#f"
let encoded = InviteLink.percentEncodedForLine(shareText)
for reserved in ["?", "&", "=", "#", "/", ":", " ", "+", "@"] {
    check(!encoded.contains(reserved), "encoded message must not contain a raw [\\(reserved)]")
}
check(encoded.contains("%3Fsrc%3Dline%26x%3D1%23f"), "?src=line&x=1#f survives inside the message, got \\(encoded)")
check(encoded.removingPercentEncoding == shareText, "decoding gives the original text back")
let lineURLs = InviteLink.lineMessageURLs(text: shareText)
check(lineURLs.app?.absoluteString == "line://msg/text/\\(encoded)", "app URL carries the encoded text as its path")
check(lineURLs.web?.absoluteString == "https://line.me/R/msg/text/?\\(encoded)", "web fallback carries the encoded text as its query")
check(URLComponents(url: lineURLs.web!, resolvingAgainstBaseURL: false)?.queryItems?.count == 1, "web fallback has exactly one query item (the text)")
check(InviteLink.percentEncodedForLine("") == "", "empty text")

// --- failure wording ---
func msg(_ s: String) -> String { InviteLink.failureMessage(s) }
check(msg("invite_not_found") == "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว", "not found")
check(msg("PostgrestError(message: \\"invite_expired\\")") == "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว", "expired inside a wrapped error")
check(msg("cannot_add_self") == "นี่คือลิงก์ของคุณเอง", "own link")
check(msg("The Internet connection appears to be offline.") == "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง", "anything else")
check(msg("") == "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง", "empty")
check(!InviteLink.isRetryable("invite_not_found"), "not found is final")
check(!InviteLink.isRetryable("invite_expired"), "expired is final")
check(!InviteLink.isRetryable("cannot_add_self"), "own link is final")
check(InviteLink.isRetryable("The Internet connection appears to be offline."), "network errors are retryable")

if failures > 0 { print("\\(failures) check(s) failed"); exit(1) }
print("PASS: invite link (token parsing, hostile URLs, LINE share URL, failure wording)")
`);
  const binary = join(directory, 'verify');
  execFileSync('xcrun', ['swiftc', source, main, '-module-cache-path', join(directory, 'modcache'), '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
