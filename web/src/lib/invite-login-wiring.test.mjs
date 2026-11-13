// Static guard: the friend-invite token must survive sign-in and sign-up (lib/invite-next.ts).
// Run: cd web && node --test src/lib/invite-login-wiring.test.mjs
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8")
const middleware = read("../middleware.ts")
const login = read("../components/auth/login-form.tsx")
const register = read("../components/auth/register-form.tsx")
const callback = read("../app/auth/callback/route.ts")

test("the middleware sends a visitor without a session to loginPathFor(pathname), not a bare /login", () => {
  assert.match(middleware, /import \{ loginPathFor \} from "@\/lib\/invite-next"/)
  assert.match(middleware, /new URL\(loginPathFor\(pathname\), request\.url\)/)
  assert.doesNotMatch(middleware, /new URL\("\/login", request\.url\)/)
})

for (const [name, src] of [["login form", login], ["register form", register]]) {
  test(`${name}: reads the invite next-path and carries it through every sign-in route`, () => {
    assert.match(src, /import \{ inviteNextPath, withNext \} from "@\/lib\/invite-next"/)
    assert.match(src, /const inviteNext\s*=\s*inviteNextPath\(/)
    assert.match(src, /redirectTo: `\$\{location\.origin\}\$\{withNext\("\/auth\/callback", inviteNext\)\}`/, "Google / Facebook")
    assert.match(src, /withNext\("\/api\/auth\/line", inviteNext\)/, "LINE")
    assert.match(src, /window\.location\.href = inviteNext \?\? "\/dashboard"/, "after email sign-in / sign-up")
  })
}

test("the login form links to the register page (and the register form to login) with the same next-path", () => {
  assert.match(login, /href=\{withNext\("\/register", inviteNext\)\}/)
  assert.match(register, /href=\{withNext\("\/login", inviteNext\)\}/)
})

test("the login form's MFA step also goes to the invite", () => {
  assert.equal((login.match(/window\.location\.href = inviteNext \?\? "\/dashboard"/g) ?? []).length, 2)
})

test("the OAuth callback no longer appends an unchecked next to the origin", () => {
  assert.match(callback, /import \{ safeRedirectPath \}\s+from "@\/lib\/safe-redirect"/)
  assert.match(callback, /const next\s+= safeRedirectPath\(searchParams\.get\("next"\), "\/dashboard"\)/)
  assert.doesNotMatch(callback, /searchParams\.get\("next"\) \?\? "\/dashboard"/)
})
