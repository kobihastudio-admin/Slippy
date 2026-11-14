// Run: cd web && node --experimental-strip-types --test src/lib/chat-attachment.test.mjs
import assert from "node:assert/strict"
import test from "node:test"

import {
  SIGNED_URL_RENEW_MARGIN_MS, SIGNED_URL_TTL_SECONDS, SignedUrlCache,
  buildChatAttachmentPath, chatAttachmentConversationId, chatAttachmentPath, chatMessageType,
  formatFileSize, isSafeAttachmentUrl, safeExtension,
} from "./chat-attachment.ts"

test("formatFileSize", () => {
  assert.equal(formatFileSize(12), "12 B")
  assert.equal(formatFileSize(2048), "2 KB")
  assert.equal(formatFileSize(1.5 * 1024 * 1024), "1.5 MB")
  for (const bad of [0, -1, NaN, Infinity, null, undefined, "12", {}]) assert.equal(formatFileSize(bad), "", String(bad))
})

test("chatMessageType splits like the iOS app and the API", () => {
  assert.equal(chatMessageType("image/heic"), "image")
  assert.equal(chatMessageType("VIDEO/mp4"), "video")
  assert.equal(chatMessageType("application/pdf"), "file")
  assert.equal(chatMessageType("application/vnd.ms-excel"), "file")
  assert.equal(chatMessageType(""), "file", "an unknown type (some browsers give none) is a file")
})

test("isSafeAttachmentUrl accepts only http(s)", () => {
  assert.equal(isSafeAttachmentUrl("https://x.supabase.co/storage/v1/object/public/chat-attachments/a.pdf"), true)
  assert.equal(isSafeAttachmentUrl("http://x.test/a"), true)
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "not a url", "", null, undefined, 5])
    assert.equal(isSafeAttachmentUrl(bad), false, String(bad))
})

const CONV = "6f2b7a10-3c4d-4e5f-8a9b-0c1d2e3f4a5b"
const PATH = `chat/${CONV}/1700000000123.jpg`
const PUBLIC_URL = `https://abc.supabase.co/storage/v1/object/public/chat-attachments/${PATH}`

test("chatAttachmentPath reads the object path from a stored path or from the old public URL", () => {
  assert.equal(chatAttachmentPath(PATH), PATH)
  assert.equal(chatAttachmentPath(`  ${PATH} `), PATH, "surrounding whitespace is ignored")
  assert.equal(chatAttachmentPath(PUBLIC_URL), PATH, "legacy public URL")
  assert.equal(chatAttachmentPath(PUBLIC_URL.replace("/public/", "/sign/") + "?token=abc"), PATH, "a signed URL")
  assert.equal(chatAttachmentPath(`chat/${CONV}/1700000000123.MOV`), `chat/${CONV}/1700000000123.MOV`, "upper-case extension (old files)")
  assert.equal(chatAttachmentPath(PUBLIC_URL.replace("/chat/", "/chat%2F")), PATH, "an encoded slash decodes to the same canonical path")
})

test("chatAttachmentPath refuses everything that is not a chat file", () => {
  for (const bad of [
    null, undefined, "", 5, {}, [], "photo.jpg", "chat/not-a-uuid/1.jpg", `chat/${CONV}/../x.jpg`, `chat/${CONV}/a/b.jpg`,
    `chat/${CONV}/noext`, `other/${CONV}/1.jpg`, `/chat/${CONV}/1.jpg`, `chat/${CONV}/1.toolongext1`,
    "https://x.test/other.jpg", "https://abc.supabase.co/storage/v1/object/public/documents/" + PATH,
    "https://abc.supabase.co/storage/v1/object/public/trip-photos/" + PATH, "javascript:alert(1)", "file:///etc/passwd",
    `https://abc.supabase.co/storage/v1/object/public/chat-attachments/chat/${CONV}/..%2F..%2Fx.jpg`,
  ]) assert.equal(chatAttachmentPath(bad), null, JSON.stringify(bad))
})

test("chatAttachmentConversationId", () => {
  assert.equal(chatAttachmentConversationId(PATH), CONV)
  assert.equal(chatAttachmentConversationId(PATH.replace(CONV, CONV.toUpperCase())), CONV, "lower-cased")
  for (const bad of [null, "", "chat/x/1.jpg", PUBLIC_URL, 3]) assert.equal(chatAttachmentConversationId(bad), null, String(bad))
})

test("safeExtension and buildChatAttachmentPath", () => {
  assert.equal(safeExtension("PDF"), "pdf")
  for (const bad of ["", "../etc", "a b", "verylongext", "ไทย"]) assert.equal(safeExtension(bad), "bin", bad)
  assert.equal(buildChatAttachmentPath(CONV.toUpperCase(), 1700000000123, "ใบเสนอราคา.PDF"), `chat/${CONV}/1700000000123.pdf`)
  assert.equal(buildChatAttachmentPath(CONV, 5, "noext"), `chat/${CONV}/5.bin`)
  assert.equal(buildChatAttachmentPath(CONV, 5, "a.tar.gz"), `chat/${CONV}/5.gz`)
  assert.equal(chatAttachmentPath(buildChatAttachmentPath(CONV, 1700000000123, "x.heic")) !== null, true, "what we build is accepted by what we read")
})

test("SignedUrlCache keeps a URL until shortly before it expires", () => {
  const cache = new SignedUrlCache()
  assert.equal(cache.get(PATH, 0), null, "empty")
  cache.set(PATH, "https://signed/1", 0)
  const life = SIGNED_URL_TTL_SECONDS * 1000
  assert.equal(cache.get(PATH, 1000), "https://signed/1")
  assert.equal(cache.get(PATH, life - SIGNED_URL_RENEW_MARGIN_MS), "https://signed/1", "still served while exactly the margin is left")
  assert.equal(cache.get(PATH, life - SIGNED_URL_RENEW_MARGIN_MS + 1), null, "renewed once LESS than the margin is left")
  assert.equal(cache.get(PATH, 1000), null, "an expired entry is dropped, not revived")
  cache.set(PATH, "https://signed/2", 0, 60)
  assert.equal(cache.get(PATH, 0), null, "a URL that lives less than the margin is never served from the cache")
  cache.set("a", "u", 0); cache.clear(); assert.equal(cache.get("a", 0), null)
})
