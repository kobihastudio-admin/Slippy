import assert from "node:assert/strict"
import test from "node:test"

import {
  inviteDeepLink,
  isInviteToken,
  isLineInviteSource,
  isPublicInviteLanding,
  withLineSource,
} from "./friend-invite.ts"

const TOKEN = "0123456789ab"
const q = (s) => new URLSearchParams(s)

test("isInviteToken accepts exactly 12 lowercase hex characters", () => {
  assert.equal(isInviteToken(TOKEN), true)
  assert.equal(isInviteToken("abcdefabcdef"), true)
})

test("isInviteToken rejects everything else", () => {
  for (const bad of [
    "", "0123456789a", "0123456789abc", "0123456789AB", "0123456789ag",
    "0123456789a ", " 0123456789ab", "0123456789a\n", "../../etc/pw", "0123456789a/",
    "0123456789ab/", "0123456789ab?x=1", null, undefined, 123456789012, [TOKEN], {},
  ]) {
    assert.equal(isInviteToken(bad), false, `should reject ${JSON.stringify(bad)}`)
  }
})

test("inviteDeepLink builds the app URL only for a valid token", () => {
  assert.equal(inviteDeepLink(TOKEN), "slippy://friends/join/0123456789ab")
  assert.equal(inviteDeepLink("nope"), null)
  assert.equal(inviteDeepLink("0123456789AB"), null)
  assert.equal(inviteDeepLink('"><script>'), null)
})

test("isLineInviteSource is true only for the exact string line", () => {
  assert.equal(isLineInviteSource("line"), true)
  for (const other of ["LINE", "line,x", " line", "", "email", undefined, null, ["line"], ["line", "x"]]) {
    assert.equal(isLineInviteSource(other), false, `should reject ${JSON.stringify(other)}`)
  }
})

test("withLineSource adds src=line and keeps the rest of the URL", () => {
  assert.equal(
    withLineSource("https://dev.slippyai.app/friends/join/0123456789ab"),
    "https://dev.slippyai.app/friends/join/0123456789ab?src=line",
  )
  assert.equal(
    withLineSource("https://dev.slippyai.app/friends/join/0123456789ab?utm=a"),
    "https://dev.slippyai.app/friends/join/0123456789ab?utm=a&src=line",
  )
  assert.equal(
    withLineSource("https://dev.slippyai.app/friends/join/0123456789ab?src=email"),
    "https://dev.slippyai.app/friends/join/0123456789ab?src=line",
    "an existing src is replaced, not duplicated",
  )
  assert.equal(withLineSource("not a url"), "not a url", "unparseable input is returned unchanged")
})

test("only the exact landing URL shape is public", () => {
  assert.equal(isPublicInviteLanding(`/friends/join/${TOKEN}`, q("src=line")), true)
  assert.equal(isPublicInviteLanding(`/friends/join/${TOKEN}/`, q("src=line")), true)
  assert.equal(isPublicInviteLanding(`/friends/join/${TOKEN}`, q("utm=a&src=line")), true)
})

test("everything near the landing URL stays behind login", () => {
  const cases = [
    [`/friends/join/${TOKEN}`, ""],                         // the plain link: auto-join flow, needs a session
    [`/friends/join/${TOKEN}`, "src=email"],
    [`/friends/join/${TOKEN}`, "src=line,x"],
    [`/friends/join/${TOKEN}`, "src=LINE"],
    // A repeated src: the page (Next) sees an ARRAY and falls through to the database lookup, so
    // middleware must not let it through anonymously either (it would turn the page into a token oracle).
    [`/friends/join/${TOKEN}`, "src=line&src=x"],
    [`/friends/join/${TOKEN}`, "src=x&src=line"],
    [`/friends/join/${TOKEN}`, "src=line&src=line"],
    [`/friends/join/${TOKEN}`, "src="],
    [`/friends/join/${TOKEN}`, "xsrc=line"],
    [`/friends/join/${TOKEN}/extra`, "src=line"],
    [`/friends/join/${TOKEN}/../x`, "src=line"],
    ["/friends/join/", "src=line"],
    ["/friends/join", "src=line"],
    ["/friends/", "src=line"],
    ["/friends/joinX/" + TOKEN, "src=line"],
    ["/friends/join/0123456789AB", "src=line"],             // uppercase
    ["/friends/join/0123456789a", "src=line"],              // 11 chars
    ["/friends/join/0123456789abc", "src=line"],            // 13 chars
    ["/friends/join/%30123456789ab", "src=line"],           // encoded
    ["/social/friends", "src=line"],
    ["/api/friends/invite", "src=line"],
  ]
  for (const [path, search] of cases) {
    assert.equal(isPublicInviteLanding(path, q(search)), false, `${path}?${search} must not be public`)
  }
})
