// Run: cd web && node --experimental-strip-types --test src/lib/invite-next.test.mjs
import assert from "node:assert/strict"
import test from "node:test"

import { inviteNextPath, loginPathFor, withNext } from "./invite-next.ts"

const T = "abcdef123456"

test("inviteNextPath accepts exactly the friend-invite path and returns it normalised", () => {
  assert.equal(inviteNextPath(`/friends/join/${T}`), `/friends/join/${T}`)
  assert.equal(inviteNextPath(`/friends/join/${T}/`), `/friends/join/${T}`)
  assert.equal(inviteNextPath(`/friends/join/${T}?src=line`), `/friends/join/${T}`, "the query is dropped")
  assert.equal(inviteNextPath(`/friends/join/${T}#x`), `/friends/join/${T}`, "the fragment is dropped")
})

test("inviteNextPath refuses everything else: other paths, bad tokens, other origins, tricks", () => {
  for (const bad of [
    null, undefined, "", "/", "/dashboard", "/social/friends", "/friends/join", "/friends/join/",
    "/friends/join/abc", "/friends/join/ABCDEF123456", "/friends/join/abcdef12345g", `/friends/join/${T}x`,
    `/friends/join/${T}/extra`, `/friends/join/${T}/../../etc`, `/friends/${T}`,
    `https://evil.example/friends/join/${T}`, `//evil.example/friends/join/${T}`, `/\\evil.example/friends/join/${T}`,
    `javascript:alert(1)`, `http://internal.invalid.evil.example/friends/join/${T}`, `friends/join/${T}@evil.example`,
    "x".repeat(500), 42, {}, [],
  ]) assert.equal(inviteNextPath(bad), null, JSON.stringify(bad))
})

test("loginPathFor keeps the invite token across the login redirect, and only for that path", () => {
  assert.equal(loginPathFor(`/friends/join/${T}`), `/login?next=${encodeURIComponent(`/friends/join/${T}`)}`)
  assert.equal(loginPathFor("/social/friends"), "/login")
  assert.equal(loginPathFor("/dashboard"), "/login")
  assert.equal(loginPathFor(`/friends/join/${T}/extra`), "/login")
  assert.equal(loginPathFor("/friends/join/ABC"), "/login")
  assert.equal(loginPathFor(""), "/login")
})

test("withNext appends the invite path to a link, or leaves the link alone", () => {
  assert.equal(withNext("/register", `/friends/join/${T}`), `/register?next=${encodeURIComponent(`/friends/join/${T}`)}`)
  assert.equal(withNext("/login", null), "/login")
  assert.equal(withNext("/api/auth/line", `/friends/join/${T}`), `/api/auth/line?next=${encodeURIComponent(`/friends/join/${T}`)}`)
})
