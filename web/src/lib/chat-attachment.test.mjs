// Run: cd web && node --experimental-strip-types --test src/lib/chat-attachment.test.mjs
import assert from "node:assert/strict"
import test from "node:test"

import { chatMessageType, formatFileSize, isSafeAttachmentUrl } from "./chat-attachment.ts"

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
