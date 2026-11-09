# Friend Invite From LINE Opens the Slippy iOS App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A friend-invite link shared from LINE opens a small landing page with an "เปิดใน Slippy" button; tapping it opens the iOS app on a confirmation sheet, and only an explicit confirm creates the friendship (existing `accept_friend_invite` RPC).

**Architecture:** A Foundation-only `InviteLink` parser (iOS) and a pure `friend-invite.ts` helper (web) own every decision about what a valid token / landing URL is, and each has a host test. The web `friends/join/[token]` page gets a static landing branch for `?src=line` (no database access); middleware lets exactly that URL shape through anonymously. On iOS a `PendingInviteStore` holds the token in memory, a sheet asks for confirmation, and the existing `SocialViewModel.acceptInvite` redeems it. A DEBUG fixture screen lets the whole URL → sheet → result flow run on the simulator without credentials or network.

**Tech Stack:** Next.js 15 / TypeScript (web, Node `--test` with `--experimental-strip-types`), Swift 5 / SwiftUI (iOS 17), supabase-swift 2.48.0 (unchanged), `swiftc` host scripts, `xcodebuild` + `simctl`.

**Spec:** `docs/superpowers/specs/2026-11-09-line-invite-open-in-app-design.md` (approved 2026-11-09). Section "Planning amendments" appended to it in Task 0 lists what changed while planning — read it.

## Global Constraints

- Scope: deep-link handling + landing page + `?src=line` on LINE shares. **No schema, RLS, RPC, credential, entitlement, universal-link, signing, provider, LIFF or LINE-SDK change.** No Android, no App Store link, no inviter name before accepting (needs a new read RPC).
- **No `git commit`, `git push`, merge, branch change, deploy.** Commit authority is a separate approval. "Checkpoint" steps only list changed files. The web deploy to the NAS is run by the user; do not attempt it.
- **The middleware edit is a security-model change** (one URL shape becomes reachable without a session). It is implemented here but must be called out for explicit approval in the final report before anyone deploys it.
- Work in place at `/Users/chainimitsakhorn/Documents/Project/Slippy`. Pre-existing dirty files stay byte-for-byte untouched (50 entries at planning time, plus this plan = 51), **including `web/package.json`** (dirty from other work: do **not** add an npm script; run the web test with the explicit `node` command) and the Trip files. The only edits to a dirty file are additive hunks in `ios/Slippy/App/SlippyApp.swift` (Task 4).
- Host scripts: `PATH=/usr/local/bin:$PATH node …` (nvm node is x86_64). `xcodegen` does not run on this Mac (Intel, no Rosetta): register new Swift files with `$SCRATCH/add_files2.rb` (Preflight Step 3) and say so in the final report. `web/node_modules` is incomplete (no `tsc`, no `next`): web type-check, lint and a rendered check are **not obtainable** here — say so; do not claim them.
- Token rule (both platforms): exactly 12 lowercase hex characters, `^[0-9a-f]{12}$` (what `friend_invite_links.token` generates). Anything else never reaches a store, an RPC, an `href` or the database.
- **Never auto-accept.** Opening `slippy://friends/join/<token>` only stores the token; `acceptInvite` runs only from the confirmation sheet's "รับคำเชิญ" button.
- Strings (Thai, exact):
  - landing: title `เป็นเพื่อนกันใน Slippy`, buttons `เปิดใน Slippy` / `ดำเนินการต่อบนเว็บ`, hint `ถ้ากด “เปิดใน Slippy” แล้วไม่มีอะไรเกิดขึ้น แสดงว่ายังไม่ได้ติดตั้งแอป ใช้ทางเว็บแทนได้เลย`, invalid `ลิงก์หมดอายุหรือไม่ถูกต้อง`
  - sheet: title `เพิ่มเพื่อนจากลิงก์เชิญ`, body `คุณได้รับลิงก์เชิญเป็นเพื่อนใน Slippy ต้องการรับคำเชิญนี้ไหม?`, buttons `รับคำเชิญ` / `ยกเลิก`, success `เพิ่ม <ชื่อ> เป็นเพื่อนแล้ว 🎉` + `เสร็จสิ้น`
  - failures: `ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว` (`invite_not_found`, `invite_expired`), `นี่คือลิงก์ของคุณเอง` (`cannot_add_self`), `ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง` (anything else, retryable)
- Palette: adaptive colors from `SlippyColors.swift` only on iOS; existing Tailwind tokens on web (`bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`).
- Do not read or write real friendships/invites while verifying; fixtures only. Never enter credentials.
- Deployment order is part of the design: **ship the iOS build first, then the web landing.** An older app build ignores `slippy://friends/join/…`, so a landing deployed first would show a button that does nothing.

## Review Focus

1. **Accidental friendship.** Any path that calls `acceptInvite` without the explicit tap (on URL open, on sign-in, on a second link, on foreground) is a defect. A page or app can open `slippy://` URLs silently. → Task 4 sheet test + code review.
2. **Hostile / malformed URLs.** `slippy://friends/join/<11 or 13 chars>`, uppercase, non-hex, `../`, an extra path segment, another host, `slippy://import-shared`, a LINE SDK callback: none may become a token, and the last two must still reach their existing handlers. → Task 3 tests.
3. **Anonymous landing is not an oracle.** The public `src=line` page must not query the database or reveal whether a token exists; only that exact URL shape is public; the plain `/friends/join/<token>` stays behind login. → Task 1 tests + Task 2 review.
4. **Pending-token lifecycle.** Signed out → sign in → sheet shown; cold start from the link; a second link replaces the first (except while a redeem is in flight); swipe-down while redeeming must not leave a stale success; cancel clears. → Task 4.
5. **LINE's in-app browser vs custom schemes.** The button is a plain tap target (no auto-redirect) and the page tells the user what to do if nothing happens. → Task 2.
6. **Existing web fallback for signed-out users is already broken (pre-existing, not fixed here):** middleware redirects an anonymous `/friends/join/<token>` to `/login` without the token, and `/login` ignores `next`. Disclose it; do not "fix" it in this increment.

---

## Task 0: Preflight and spec amendments (do once, before Task 1)

**Files:**
- Modify: `docs/superpowers/specs/2026-11-09-line-invite-open-in-app-design.md` (append a section)

- [ ] **Step 1: Confirm target files are clean**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git status --short web/src/middleware.ts web/src/app/friends "web/src/app/(app)/social/friends" web/src/lib/friend-invite.ts web/src/lib/friend-invite.test.mjs ios/Slippy/Utils ios/Slippy/ViewModels/SocialViewModel.swift ios/Slippy/Views/Social ios/scripts/verify-invite-link.mjs
git status --short | wc -l
git log --oneline -1
```

Expected: the first command prints nothing; the count is `51` (record the actual number — the baseline for Task 5); HEAD is `dbd4def` or a descendant on `feat/ios-friend-management`. If the first command prints anything, stop and report `CHECKPOINT_DRIFT`.

- [ ] **Step 2: Baselines**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
./scripts/build-simulator.sh > /private/tmp/slippy-invite-baseline.log 2>&1; echo "exit=$?"; grep -E "BUILD (SUCCEEDED|FAILED)" /private/tmp/slippy-invite-baseline.log
cd ../web && PATH=/usr/local/bin:$PATH node --experimental-strip-types --test src/lib/public-origin.test.mjs 2>&1 | tail -6
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`, and the existing web test passes (this proves the `node --test` + strip-types setup works here). If the iOS baseline fails in files this plan does not touch, stop and report.

- [ ] **Step 3: Project-registration helper**

The helper from the previous increment is reused. If `$SCRATCH/add_files2.rb` (SCRATCH = the session scratchpad directory, outside the repo) does not exist, create it:

```ruby
require 'xcodeproj'
root = '/Users/chainimitsakhorn/Documents/Project/Slippy/ios'
proj = Xcodeproj::Project.open("#{root}/Slippy.xcodeproj")
target = proj.targets.find { |t| t.name == 'Slippy' } or abort 'no Slippy target'
files = ARGV
abort 'usage: ruby add_files2.rb <path relative to ios/> ...' if files.empty?
files.each do |rel|
  abs = "#{root}/#{rel}"
  abort "missing file #{rel}" unless File.exist?(abs)
  if proj.files.any? { |f| f.real_path.to_s == abs }
    puts "already: #{rel}"; next
  end
  group = proj.main_group
  File.dirname(rel).split('/').each do |part|
    child = group.children.find { |c| c.is_a?(Xcodeproj::Project::Object::PBXGroup) && (c.display_name == part || c.path == part) }
    abort "missing group #{part} for #{rel}" unless child
    group = child
  end
  ref = group.new_file(abs)
  target.source_build_phase.add_file_reference(ref)
  puts "added: #{rel}"
end
proj.save
```

- [ ] **Step 4: Append the planning amendments to the spec**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/docs/superpowers/specs
cat >> 2026-11-09-line-invite-open-in-app-design.md <<'EOF'

## 8. Planning amendments (2026-11-09, found while reading the code for the plan)

These refine the approved spec; none adds product scope.

1. **`/friends/join/*` is not public today.** `web/src/middleware.ts` redirects any anonymous request to `/login` (without the token) unless the path is in its public list, and `/login` ignores `next`. So the landing page could not be seen by the typical recipient (not yet logged in). The plan makes exactly one URL shape public: `/friends/join/<12-hex-token>?src=line`, via a pure helper, and the landing branch does **no database or session access**, so the public page cannot be used to test whether a token exists. This is a security-model change and needs explicit approval before deploy.
2. **The existing web fallback for signed-out users is already broken** (token lost at login). The landing's "ดำเนินการต่อบนเว็บ" therefore keeps pointing at the existing plain URL and works for signed-in users only; fixing login `next` handling is separate work (it also needs open-redirect protection).
3. **The landing does not validate the token against the database** (spec §3.1 said it would). It validates the token's *format* only; the app reports expired/unknown tokens when the user confirms.
4. **A second link while a redeem is in flight is ignored** (latest wins otherwise), so the confirmation the user is looking at cannot change under them.
5. **No npm script is added** (`web/package.json` is dirty with other work); the web test is run with an explicit `node --experimental-strip-types --test` command. Web type-check, lint and a rendered page check are not obtainable on this machine (`web/node_modules` has no `tsc`/`next`).
6. **Presentation:** the confirmation sheet is attached at the app root and shown only when a session exists. If another sheet is already presented by `RootView` at that moment, SwiftUI shows the invite sheet after it is dismissed.
EOF
tail -3 2026-11-09-line-invite-open-in-app-design.md | cut -c1-80
```

---

## Task 1: Web helper `friend-invite.ts` + Node tests

**Files:**
- Create: `web/src/lib/friend-invite.ts`
- Create: `web/src/lib/friend-invite.test.mjs`

**Interfaces:**
- Produces (all exported from `friend-invite.ts`, pure, no imports):
  - `isInviteToken(value: unknown): value is string` — exactly `^[0-9a-f]{12}$`
  - `inviteDeepLink(token: string): string | null` — `slippy://friends/join/<token>` or `null`
  - `isLineInviteSource(src: string | string[] | null | undefined): boolean` — true only for the string `"line"`
  - `withLineSource(inviteUrl: string): string` — sets `src=line`, keeps path and other query; unparseable input returned unchanged
  - `isPublicInviteLanding(pathname: string, search: URLSearchParams): boolean` — true only for `/friends/join/<valid token>` (optional trailing slash) with `src=line`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/friend-invite.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
PATH=/usr/local/bin:$PATH node --experimental-strip-types --test src/lib/friend-invite.test.mjs 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|Cannot find|fail |# fail|# pass" | head -3
```

Expected: FAIL (`Cannot find module …/friend-invite.ts`).

- [ ] **Step 3: Implement**

Create `web/src/lib/friend-invite.ts`:

```ts
/**
 * Friend-invite helpers shared by the join page, middleware and the LINE share
 * button. Pure functions, no imports, so `node --test` can load this file.
 *
 * Invite tokens come from `friend_invite_links.token`:
 * `substr(replace(gen_random_uuid()::text,'-',''),1,12)` → 12 lowercase hex.
 */

const TOKEN_PATTERN = /^[0-9a-f]{12}$/

/** True only for a well-formed invite token. Nothing else may reach an href, the database or the app. */
export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value)
}

/** The iOS app's deep link for a token, or `null` when the token is malformed. */
export function inviteDeepLink(token: string): string | null {
  return isInviteToken(token) ? `slippy://friends/join/${token}` : null
}

/** Links shared from LINE carry `?src=line`. Exact match only. */
export function isLineInviteSource(src: string | string[] | null | undefined): boolean {
  return src === "line"
}

/** Adds `src=line` to an invite URL (replacing an existing `src`), keeping path and other query. */
export function withLineSource(inviteUrl: string): string {
  try {
    const url = new URL(inviteUrl)
    url.searchParams.set("src", "line")
    return url.toString()
  } catch {
    return inviteUrl
  }
}

/**
 * The one URL shape that may be opened without a session: the static LINE
 * landing page. Used by middleware. The plain `/friends/join/<token>` stays
 * behind login because it creates a friendship.
 */
export function isPublicInviteLanding(pathname: string, search: URLSearchParams): boolean {
  const match = /^\/friends\/join\/([^/]+)\/?$/.exec(pathname)
  return match !== null && isInviteToken(match[1]) && search.get("src") === "line"
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
PATH=/usr/local/bin:$PATH node --experimental-strip-types --test src/lib/friend-invite.test.mjs 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 6`, `# fail 0`. If a case fails, fix `friend-invite.ts` (not the expectation) unless the expectation contradicts the Global Constraints. A common slip: `searchParams.set` re-encodes the existing query — compare with the exact strings above.

- [ ] **Step 5: Checkpoint (no commit)** — `git status --short web/src/lib/friend-invite.ts web/src/lib/friend-invite.test.mjs` → two `??` lines.

---

## Task 2: Web wiring — middleware, landing page, LINE share link

**Files:**
- Modify: `web/src/middleware.ts` (import + one `isPublic` clause)
- Modify: `web/src/app/friends/join/[token]/page.tsx` (landing branch before any client/auth access)
- Modify: `web/src/app/(app)/social/friends/AddFriendModal.tsx` (`lineShareUrl` only)

**Interfaces:**
- Consumes: `isPublicInviteLanding`, `isLineInviteSource`, `inviteDeepLink`, `isInviteToken`, `withLineSource` (Task 1).
- Produces: `GET /friends/join/<token>?src=line` renders the landing for anyone; every other `/friends/join/…` behaves exactly as before.

No web type-check, lint or render is available on this machine (`web/node_modules` has no `tsc`/`next`): these edits are verified by reading and by Task 1's tests, and must be reported as such.

- [ ] **Step 1: Middleware**

In `web/src/middleware.ts` add to the imports (after the `checkRateLimit` import):

```ts
import { isPublicInviteLanding } from "@/lib/friend-invite"
```

and add a clause to `isPublic` immediately before the final `|| pathname === "/"`:

```ts
    || isPublicInviteLanding(pathname, request.nextUrl.searchParams)  // static LINE landing for /friends/join/<token>?src=line — no DB, no session needed; the plain link stays behind login
```

Read-check: the helper returns `true` only for the exact shape; the clause is an `||` addition, so no existing path becomes private or public otherwise.

- [ ] **Step 2: Landing page**

In `web/src/app/friends/join/[token]/page.tsx`:

1. Add the import:

```tsx
import { inviteDeepLink, isLineInviteSource } from "@/lib/friend-invite"
```

2. Replace the top of the component, i.e. this block

```tsx
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const sb    = await createClient()
  const { data: { user } } = await sb.auth.getUser()
```

with

```tsx
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ src?: string | string[] }>
}) {
  const { token } = await params
  const { src } = await searchParams

  // Links shared from LINE open this static landing first. It must stay free of
  // any database or session access: it is reachable without login (middleware)
  // and must not reveal whether a token exists.
  if (isLineInviteSource(src)) return <InviteLanding token={token} />

  const admin = createAdminClient()
  const sb    = await createClient()
  const { data: { user } } = await sb.auth.getUser()
```

3. Add this component at the end of the file:

```tsx
function InviteLanding({ token }: { token: string }) {
  const deepLink = inviteDeepLink(token)

  if (!deepLink) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-3">
          <p className="text-2xl">😕</p>
          <p className="text-red-500 font-medium">ลิงก์หมดอายุหรือไม่ถูกต้อง</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center space-y-5 shadow-sm">
        <p className="text-3xl">👋</p>
        <h1 className="text-xl font-semibold">เป็นเพื่อนกันใน Slippy</h1>
        <p className="text-sm text-muted-foreground">คุณได้รับลิงก์เชิญเป็นเพื่อนใน Slippy</p>
        {/* A plain link the user taps: LINE's in-app browser blocks custom-scheme redirects that are not a tap. */}
        <a
          href={deepLink}
          className="block w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          เปิดใน Slippy
        </a>
        <a
          href={`/friends/join/${token}`}
          className="block w-full rounded-xl border border-border px-4 py-3 text-sm font-medium hover:bg-muted/40 transition-colors"
        >
          ดำเนินการต่อบนเว็บ
        </a>
        <p className="text-xs text-muted-foreground">
          ถ้ากด “เปิดใน Slippy” แล้วไม่มีอะไรเกิดขึ้น แสดงว่ายังไม่ได้ติดตั้งแอป ใช้ทางเว็บแทนได้เลย
        </p>
      </div>
    </div>
  )
}
```

The token reaches `href` only through `inviteDeepLink` (validated) and the second link only when `deepLink` is non-null (the token is therefore 12 hex).

- [ ] **Step 3: LINE share link**

In `web/src/app/(app)/social/friends/AddFriendModal.tsx` add `import { withLineSource } from "@/lib/friend-invite"` with the other imports and change only these two lines

```tsx
  const shareText = `มาเป็นเพื่อนกันใน Slippy กันเถอะ! ${inviteUrl}`
  const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`
```

to

```tsx
  // Only the LINE share carries ?src=line (it opens the landing page); the QR and the copy-link keep the plain URL.
  const shareText = `มาเป็นเพื่อนกันใน Slippy กันเถอะ! ${withLineSource(inviteUrl)}`
  const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`
```

(`inviteUrl` stays untouched for `MyQrPanel` and the copy button.)

- [ ] **Step 4: Verify what can be verified**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff --stat web/src/middleware.ts "web/src/app/friends/join/[token]/page.tsx" "web/src/app/(app)/social/friends/AddFriendModal.tsx"
git diff -U0 web/src/middleware.ts | grep -c '^+.*isPublicInviteLanding'
cd web && PATH=/usr/local/bin:$PATH node --experimental-strip-types --test src/lib/friend-invite.test.mjs 2>&1 | grep -E "^# (pass|fail)"
ls node_modules/.bin/tsc node_modules/.bin/next 2>&1 | head -2
```

Expected: only the three files changed (small diffs); `2` (import + clause); `# pass 6 / # fail 0`; the `ls` shows the tools missing → write down: **type-check, lint and the rendered page were not obtained.** Then re-read the three diffs once more against this plan (imports present, no leftover reference to a removed variable, `searchParams` typed as a Promise for Next 15.5).

- [ ] **Step 5: Checkpoint (no commit)** — three ` M` lines for the files above, plus the Task 1 files.

---

## Task 3: iOS `InviteLink` parser + host verification

**Files:**
- Create: `ios/Slippy/Utils/InviteLink.swift`
- Create: `ios/scripts/verify-invite-link.mjs`

**Interfaces:**
- Produces (all `static` on `enum InviteLink`, Foundation only):
  - `token(from url: URL) -> String?` — non-nil only for `slippy://friends/join/<12 lowercase hex>` (query/fragment ignored)
  - `lineShareURL(_ invite: URL) -> URL` — adds/replaces `src=line`, keeps path and other query
  - `failureMessage(_ raw: String) -> String` — Thai message for a redeem error text
  - `isRetryable(_ raw: String) -> Bool` — `false` for `invite_not_found`, `invite_expired`, `cannot_add_self`

- [ ] **Step 1: Write the failing host script**

Create `ios/scripts/verify-invite-link.mjs`:

```js
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
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-invite-link.mjs 2>&1 | grep -E "AssertionError|ENOENT" | head -2
```

Expected: FAIL (`InviteLink.swift is missing` / file not found).

- [ ] **Step 3: Implement**

Create `ios/Slippy/Utils/InviteLink.swift`:

```swift
import Foundation

/// Friend-invite deep links: `slippy://friends/join/<token>`.
///
/// Foundation only, so `ios/scripts/verify-invite-link.mjs` can compile this
/// file on its own. A custom URL scheme can be opened by any web page or app,
/// so the parser is deliberately strict: only a well-formed token ever leaves
/// this file, and opening a link never creates a friendship by itself.
enum InviteLink {

    /// `friend_invite_links.token` is `substr(replace(gen_random_uuid()::text,'-',''),1,12)`.
    private static func isToken(_ value: String) -> Bool {
        value.utf8.count == 12 && value.utf8.allSatisfy { ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66) }
    }

    /// The token of a `slippy://friends/join/<token>` URL, else `nil`.
    /// Scheme and host are case-insensitive; the token is not (lowercase hex only).
    /// Query and fragment are ignored; any extra path segment rejects the URL.
    static func token(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "slippy", url.host?.lowercased() == "friends" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2, parts[0] == "join", isToken(parts[1]) else { return nil }
        return parts[1]
    }

    /// Adds (or replaces) `src=line` on an invite URL so the web page shows the
    /// "open in Slippy" landing. Path and other query items are kept.
    static func lineShareURL(_ invite: URL) -> URL {
        guard var components = URLComponents(url: invite, resolvingAgainstBaseURL: false) else { return invite }
        var items = (components.queryItems ?? []).filter { $0.name != "src" }
        items.append(URLQueryItem(name: "src", value: "line"))
        components.queryItems = items
        return components.url ?? invite
    }

    private static let finalFailures = ["invite_not_found", "invite_expired", "cannot_add_self"]

    /// Thai message for the text of an error thrown while redeeming an invite.
    static func failureMessage(_ raw: String) -> String {
        if raw.contains("invite_not_found") || raw.contains("invite_expired") { return "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว" }
        if raw.contains("cannot_add_self") { return "นี่คือลิงก์ของคุณเอง" }
        return "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง"
    }

    /// Whether the user can usefully tap "รับคำเชิญ" again after this failure.
    static func isRetryable(_ raw: String) -> Bool {
        !finalFailures.contains { raw.contains($0) }
    }
}
```

- [ ] **Step 4: Run and confirm it passes**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
PATH=/usr/local/bin:$PATH node scripts/verify-invite-link.mjs 2>&1 | grep -E "FAIL|PASS|failed|error"
```

Expected: `PASS: invite link (…)`. On a `FAIL:` fix the Swift, not the expectation. Likely traps: `URL(string:)` returning `nil` for a case (then `tok` returns `nil`, which is the expected "rejected" result — but check the *accepted* cases really parse), and `pathComponents` percent-decoding (`%2F` becomes `/` inside a component and must fail the hex check).

- [ ] **Step 5: Checkpoint (no commit)** — `git status --short ios/Slippy/Utils/InviteLink.swift ios/scripts/verify-invite-link.mjs` → two `??` lines.

---

## Task 4: iOS store, confirmation sheet, app wiring, share URL, fixture

**Files:**
- Create: `ios/Slippy/ViewModels/PendingInviteStore.swift`
- Create: `ios/Slippy/Views/Social/InviteConfirmSheet.swift`
- Create: `ios/Slippy/Views/Social/InviteFixtures.swift` (entire file `#if DEBUG`)
- Modify: `ios/Slippy/Views/Social/SocialAddFriendSheet.swift` (`shareViaLine` only)
- Modify: `ios/Slippy/App/SlippyApp.swift` — **additive hunks only** (property, a branch in `onOpenURL`, one modifier line, one DEBUG `case`). The file already carries unrelated uncommitted work: do not touch any other line.

**Interfaces:**
- Consumes: `InviteLink` (Task 3), `SocialViewModel.acceptInvite(token:) async throws -> String`.
- Produces:
  - `@MainActor final class PendingInviteStore: ObservableObject` — `@Published private(set) var token: String?`, `@Published private(set) var phase: Phase`, `init(redeem: @escaping (String) async throws -> String = PendingInviteStore.liveRedeem)`, `@discardableResult func receive(_ url: URL) -> Bool`, `func accept() async`, `func dismiss()`, `static func liveRedeem(_:) async throws -> String`; `enum Phase: Equatable { case confirming, working, success(String), failed(String, canRetry: Bool) }`
  - `extension View { func inviteLinkSheet(_ store: PendingInviteStore, isSignedIn: Bool) -> some View }`
  - DEBUG preview screen `invite-link-test`.

- [ ] **Step 1: The store**

Create `ios/Slippy/ViewModels/PendingInviteStore.swift`:

```swift
import SwiftUI

/// Holds a friend-invite token between "the link was opened" and "the user
/// confirmed". The token lives in memory only (if the app is killed the user
/// taps the link again). Opening a link NEVER redeems it: only `accept()`,
/// called from the confirmation sheet's button, does.
@MainActor
final class PendingInviteStore: ObservableObject {
    enum Phase: Equatable {
        case confirming
        case working
        case success(String)
        case failed(String, canRetry: Bool)
    }

    @Published private(set) var token: String?
    @Published private(set) var phase: Phase = .confirming

    /// Redeems a token and returns the inviter's name. Injected so Debug
    /// fixtures never touch the network.
    private let redeem: (String) async throws -> String

    init(redeem: @escaping (String) async throws -> String = PendingInviteStore.liveRedeem) {
        self.redeem = redeem
    }

    static func liveRedeem(_ token: String) async throws -> String {
        try await SocialViewModel().acceptInvite(token: token)
    }

    /// Stores the token of an invite deep link. Returns `false` (and changes
    /// nothing) for any other URL. The latest link replaces an older pending
    /// one, except while a redeem is in flight, so the confirmation the user is
    /// looking at cannot change under them.
    @discardableResult
    func receive(_ url: URL) -> Bool {
        guard let newToken = InviteLink.token(from: url) else { return false }
        if phase == .working { return true }
        token = newToken
        phase = .confirming
        return true
    }

    /// The user tapped "รับคำเชิญ".
    func accept() async {
        guard let current = token else { return }
        switch phase {
        case .confirming, .failed(_, canRetry: true): break
        default: return
        }
        phase = .working
        do {
            let name = try await redeem(current)
            guard token == current else { return }   // dismissed while in flight: stay dismissed
            phase = .success(name)
        } catch {
            guard token == current else { return }
            let raw = "\(error) \(error.localizedDescription)"
            phase = .failed(InviteLink.failureMessage(raw), canRetry: InviteLink.isRetryable(raw))
        }
    }

    /// Cancel, "เสร็จสิ้น", or swipe-down. Always clears the token.
    func dismiss() {
        token = nil
        phase = .confirming
    }
}

private struct InviteLinkSheetModifier: ViewModifier {
    @ObservedObject var store: PendingInviteStore
    let isSignedIn: Bool

    func body(content: Content) -> some View {
        content.sheet(isPresented: Binding(
            get: { store.token != nil && isSignedIn },
            set: { if !$0 { store.dismiss() } }
        )) {
            InviteConfirmSheet(store: store)
        }
    }
}

extension View {
    /// Shows the invite confirmation while a link is pending and the user is signed in.
    func inviteLinkSheet(_ store: PendingInviteStore, isSignedIn: Bool) -> some View {
        modifier(InviteLinkSheetModifier(store: store, isSignedIn: isSignedIn))
    }
}
```

- [ ] **Step 2: The sheet**

Create `ios/Slippy/Views/Social/InviteConfirmSheet.swift`:

```swift
import SwiftUI

/// "เพิ่มเพื่อนจากลิงก์เชิญ" — asks before anything happens. The inviter's name
/// is not known until the invite is redeemed (the RPC returns it afterwards), so
/// the text is deliberately generic.
struct InviteConfirmSheet: View {
    @ObservedObject var store: PendingInviteStore

    var body: some View {
        VStack(spacing: 20) {
            Spacer(minLength: 8)
            switch store.phase {
            case .confirming, .working:
                confirmation
            case .success(let name):
                result(icon: "checkmark.circle.fill", tint: Color.successText,
                       title: "เพิ่ม \(name) เป็นเพื่อนแล้ว 🎉", button: "เสร็จสิ้น")
            case .failed(let message, let canRetry):
                failure(message: message, canRetry: canRetry)
            }
            Spacer(minLength: 8)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Color.background.ignoresSafeArea())
        .presentationDetents([.medium])
        .interactiveDismissDisabled(store.phase == .working)
    }

    private var confirmation: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.system(size: 44, weight: .light))
                .foregroundColor(Color.brand500)
            Text("เพิ่มเพื่อนจากลิงก์เชิญ")
                .font(.system(size: 20, weight: .bold)).foregroundColor(Color.textPrimary)
            Text("คุณได้รับลิงก์เชิญเป็นเพื่อนใน Slippy ต้องการรับคำเชิญนี้ไหม?")
                .font(.system(size: 14)).foregroundColor(Color.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                hapticLight()
                Task { await store.accept() }
            } label: {
                HStack(spacing: 8) {
                    if store.phase == .working { ProgressView().tint(.white) }
                    Text("รับคำเชิญ")
                }
                .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(store.phase == .working)
            Button("ยกเลิก") { store.dismiss() }
                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
                .disabled(store.phase == .working)
        }
    }

    private func result(icon: String, tint: Color, title: String, button: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: icon).font(.system(size: 44)).foregroundColor(tint)
            Text(title).font(.system(size: 18, weight: .bold)).foregroundColor(Color.textPrimary)
                .multilineTextAlignment(.center)
            Button(button) { store.dismiss() }
                .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private func failure(message: String, canRetry: Bool) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40)).foregroundColor(Color.errorText)
            Text(message).font(.system(size: 16, weight: .semibold)).foregroundColor(Color.textPrimary)
                .multilineTextAlignment(.center)
            if canRetry {
                Button {
                    hapticLight()
                    Task { await store.accept() }
                } label: {
                    Text("ลองอีกครั้ง")
                        .font(.system(size: 15, weight: .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.brand500).clipShape(RoundedRectangle(cornerRadius: 14))
                }
            }
            Button(canRetry ? "ยกเลิก" : "ปิด") { store.dismiss() }
                .font(.system(size: 14, weight: .medium)).foregroundColor(Color.textSecondary)
        }
    }
}
```

(If `Color.successText` or `Color.errorText` is missing, use the nearest adaptive color in `SlippyColors.swift`; both exist today.)

- [ ] **Step 3: Fixture screen and preview case**

Create `ios/Slippy/Views/Social/InviteFixtures.swift`:

```swift
#if DEBUG
import SwiftUI

// SLIPPY_APPEARANCE_PREVIEW=invite-link-test
// Receives real `slippy://friends/join/<token>` URLs (xcrun simctl openurl …)
// and shows the real sheet, but the redeem step is a local stub, so no network
// and no credentials are involved. Token endings pick the outcome:
//   …ab → success ("พลอย")   …a0 → invite_expired   …a1 → offline (retryable)
struct InviteLinkFixtureScreen: View {
    @StateObject private var store = PendingInviteStore(redeem: { token in
        try await Task.sleep(nanoseconds: 700_000_000)
        func fail(_ text: String) -> NSError {
            NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
        }
        if token.hasSuffix("a0") { throw fail("invite_expired") }
        if token.hasSuffix("a1") { throw fail("The Internet connection appears to be offline.") }
        return "พลอย"
    })

    var body: some View {
        Color.background.ignoresSafeArea()
            .overlay(Text("รอรับลิงก์เชิญ…").font(.system(size: 14)).foregroundColor(Color.textSecondary))
            .onOpenURL { _ = store.receive($0) }
            .inviteLinkSheet(store, isSignedIn: true)
    }
}
#endif
```

- [ ] **Step 4: `SocialAddFriendSheet.shareViaLine`**

In `ios/Slippy/Views/Social/SocialAddFriendSheet.swift` replace

```swift
        guard let url = vm.inviteURL else { return }
        let text = "มาเป็นเพื่อนกันใน Slippy กันเถอะ! \(url.absoluteString)"
```

with

```swift
        guard let inviteURL = vm.inviteURL else { return }
        // Only the LINE share carries ?src=line (it opens the "open in Slippy" landing); QR and copy-link keep the plain URL.
        let url = InviteLink.lineShareURL(inviteURL)
        let text = "มาเป็นเพื่อนกันใน Slippy กันเถอะ! \(url.absoluteString)"
```

- [ ] **Step 5: `SlippyApp.swift` — four additive hunks**

Use the Edit tool (each old string exists once). Keep every other line of the file unchanged.

1. After `    @State private var showSharedImport = false`, add:

```swift
    @StateObject private var pendingInvite = PendingInviteStore()
```

2. In `.onOpenURL`, immediately before the comment `// LINE SDK — must handle every non-import URL so LINE callbacks work`, add:

```swift
                    // Friend-invite deep link (slippy://friends/join/<token>): only remembered here;
                    // the confirmation sheet decides. Every other URL falls through to the LINE SDK below.
                    if pendingInvite.receive(url) { return }
```

3. Immediately before the comment `// Also pick up pending images when returning to foreground`, add:

```swift
                .inviteLinkSheet(pendingInvite, isSignedIn: authVM.session != nil)
```

4. In the DEBUG switch, after the line `case "balance-detail-test": BalanceDetailFixtureScreen()` (it exists in the working tree from the previous increment), add:

```swift
            case "invite-link-test": InviteLinkFixtureScreen()
```

Then prove the edits are additive:

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git diff -U0 ios/Slippy/App/SlippyApp.swift | grep -c '^+.*\(pendingInvite\|invite-link-test\|Friend-invite deep link\|the confirmation sheet decides\)'
git diff --stat ios/Slippy/App/SlippyApp.swift | tail -1
```

Expected: the `grep -c` prints `4` or more (it only proves your lines are present). The real proof is the delta in `git diff --stat` against the value recorded in Preflight: exactly **+6 insertions and 0 new deletions** (property 1 line, `onOpenURL` branch 3 lines = 2 comment + 1 code, modifier 1 line, DEBUG case 1 line). If the delta differs from the 6 lines you added, something else in the file moved; stop and investigate.

- [ ] **Step 6: Register, build**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/ios
ruby "$SCRATCH/add_files2.rb" Slippy/Utils/InviteLink.swift Slippy/ViewModels/PendingInviteStore.swift Slippy/Views/Social/InviteConfirmSheet.swift Slippy/Views/Social/InviteFixtures.swift
./scripts/build-simulator.sh > /private/tmp/slippy-invite-build.log 2>&1; echo "exit=$?"
grep -E "error:" /private/tmp/slippy-invite-build.log | sort -u | cut -c1-240 | head -20
grep -E "BUILD (SUCCEEDED|FAILED)" /private/tmp/slippy-invite-build.log
grep -E "warning:.*(InviteLink|PendingInviteStore|InviteConfirmSheet|InviteFixtures|SocialAddFriendSheet)" /private/tmp/slippy-invite-build.log | sort -u | cut -c1-200
```

Expected: `exit=0`, `** BUILD SUCCEEDED **`, no new warnings naming these files. If `.sheet(isPresented:)` cannot see `PendingInviteStore.token`'s change (stale view), confirm `InviteLinkSheetModifier` observes the store with `@ObservedObject` (it does).

- [ ] **Step 7: Review by reading (Review Focus 1, 4)**

Confirm in the code: (a) `accept()` is called only from the two buttons in `InviteConfirmSheet`; `receive`, `onOpenURL` and the modifier never call it; (b) the `phase == .working` guard in `receive`; (c) `guard token == current` after the `await` in both branches; (d) `dismiss()` always clears the token; (e) the sheet cannot be swiped away while `.working`.

- [ ] **Step 8: Checkpoint (no commit)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git status --short ios/Slippy/Utils/InviteLink.swift ios/Slippy/ViewModels/PendingInviteStore.swift ios/Slippy/Views/Social ios/Slippy/App/SlippyApp.swift
```

---

## Task 5: Simulator end-to-end, final verification

**Files:** none (verification only).

- [ ] **Step 1: Install and launch the fixture**

```bash
UDID=108E0E3F-7C0C-4B39-89C3-FCFCE0519068
xcrun simctl list devices | grep "$UDID"; xcrun simctl boot "$UDID" 2>&1 | head -1
xcrun simctl install "$UDID" /private/tmp/slippy-simulator-derived/Build/Products/Debug-iphonesimulator/Slippy.app && echo installed
SIMCTL_CHILD_SLIPPY_APPEARANCE_PREVIEW=invite-link-test SIMCTL_CHILD_SLIPPY_MAPS_TEST_STYLE=light \
  xcrun simctl launch --terminate-running-process "$UDID" app.slippy.ios
```

If the UDID is stale pick any iPhone from `xcrun simctl list devices available`.

- [ ] **Step 2: A malformed link must do nothing**

```bash
OUT=/private/tmp/slippy-invite-shots; mkdir -p "$OUT"; UDID=108E0E3F-7C0C-4B39-89C3-FCFCE0519068
for bad in "slippy://friends/join/NOTATOKEN" "slippy://friends/join/0123456789AB" "slippy://friends/join/0123456789ab/extra"; do
  xcrun simctl openurl "$UDID" "$bad"; sleep 2
done
xcrun simctl io "$UDID" screenshot "$OUT/malformed-ignored.png" 2>&1 | tail -1
```

Open the PNG (Read tool): expected the plain "รอรับลิงก์เชิญ…" screen, **no sheet**.

- [ ] **Step 3: A valid link shows the confirmation; cancel clears it**

```bash
UDID=108E0E3F-7C0C-4B39-89C3-FCFCE0519068; OUT=/private/tmp/slippy-invite-shots
xcrun simctl openurl "$UDID" "slippy://friends/join/0123456789ab"; sleep 2
xcrun simctl io "$UDID" screenshot "$OUT/confirm-light.png" 2>&1 | tail -1
```

Expected (Read the PNG): the sheet with `เพิ่มเพื่อนจากลิงก์เชิญ`, the generic body text, `รับคำเชิญ` and `ยกเลิก`. **No friendship has been "created"** (the stub was not called: no spinner, no result). Tap `ยกเลิก` with `mcp__Claude_Code_iOS_Simulator__control` (take a screenshot first and tap in that frame); the sheet closes. Open the same URL again: the sheet returns (a new token was stored), proving cancel cleared the previous one.

- [ ] **Step 4: Confirm → success; expired; retryable failure; second link while working**

With the control tool, on the valid-link sheet tap `รับคำเชิญ`: expected a spinner for about 0.7 s, then `เพิ่ม พลอย เป็นเพื่อนแล้ว 🎉` with `เสร็จสิ้น` (screenshot to `$OUT/success-light.png`); tap `เสร็จสิ้น`. Then:

```bash
xcrun simctl openurl "$UDID" "slippy://friends/join/0123456789a0"   # expired
xcrun simctl openurl "$UDID" "slippy://friends/join/0123456789a1"   # offline (retryable)
```

For `…a0`: tap `รับคำเชิญ` → `ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว` with only `ปิด` (no retry button). For `…a1`: → `ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง` with `ลองอีกครั้ง` and `ยกเลิก`. Finally, open `…ab` and tap `รับคำเชิญ`, then immediately `xcrun simctl openurl "$UDID" "slippy://friends/join/0123456789a0"` while the spinner shows: expected the sheet keeps its own flow and ends in **success for `…ab`** (the second link was ignored while working). Record what you actually saw per case; if the control tool is unavailable, say the interaction checks were not obtained.

- [ ] **Step 5: Dark mode screenshot**

```bash
SIMCTL_CHILD_SLIPPY_APPEARANCE_PREVIEW=invite-link-test SIMCTL_CHILD_SLIPPY_MAPS_TEST_STYLE=dark \
  xcrun simctl launch --terminate-running-process "$UDID" app.slippy.ios >/dev/null; sleep 3
xcrun simctl openurl "$UDID" "slippy://friends/join/0123456789ab"; sleep 2
xcrun simctl io "$UDID" screenshot "$OUT/confirm-dark.png" 2>&1 | tail -1
```

Read it: text and the primary button legible in Dark.

- [ ] **Step 6: Existing handlers still work (what can be checked)**

`InviteLink.token` returning `nil` for `slippy://import-shared` and for a LINE SDK callback is proven by Task 3's tests. In `SlippyApp.swift` re-read the `onOpenURL` closure once: the `import-shared` branch still comes first and `LoginManager.shared.application(…)` is still reached for every URL `receive` rejects. A real LINE login callback and a real share-extension import cannot be exercised here: say so.

- [ ] **Step 7: Run every check and confirm repository state**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
export PATH=/usr/local/bin:$PATH
(cd ios && node scripts/verify-invite-link.mjs && node scripts/verify-balance-presentation.mjs && node scripts/verify-chat-presentation.mjs && node scripts/verify-chat-send-contract.mjs) 2>&1 | grep -E "PASS|FAIL"
(cd web && node --experimental-strip-types --test src/lib/friend-invite.test.mjs src/lib/public-origin.test.mjs 2>&1 | grep -E "^# (pass|fail)")
git diff --check; echo "diffcheck=$?"
git status --short | wc -l
git status --short | grep -E "Invite|invite|friend-invite|middleware|friends/join|AddFriendModal|SlippyApp|SocialAddFriendSheet"
git status --short web/package.json ios/Slippy/ViewModels/TripsViewModel.swift ios/Slippy/Models/TripModels.swift
```

Expected: four `PASS` lines; web `# fail 0`; `diffcheck=0`; the entry count equals the Preflight count plus the new files (`friend-invite.ts`, `friend-invite.test.mjs`, `InviteLink.swift`, `PendingInviteStore.swift`, `InviteConfirmSheet.swift`, `InviteFixtures.swift`, `verify-invite-link.mjs`) and this plan/spec edits that were already counted; the `grep` lists only files this plan names; `web/package.json` and the two Trip files show exactly the ` M` they showed in Preflight. Any other changed file means something unintended moved — investigate before reporting.

- [ ] **Step 8: Final state — no commit**

Do not commit and do not deploy. Report to the user: the checks that passed (actual output lines), the screenshots and what each showed (malformed ignored, confirm, success, expired, retryable, dark), the changed/new files, and:

- **Needs explicit approval before deploy:** the middleware change (one URL shape becomes public) — describe it in one sentence, and that the landing does no database or session access.
- **Deployment order:** iOS first, then the web landing.
- **Not verified:** the web page itself rendered (no `next`/`tsc` here — type-check, lint and render not obtained), tapping a real link inside the LINE app on a physical device (provisioning profile expired), LINE's in-app browser behavior with the button on the user's LINE version, the real accept against hosted data (the redeem was a stub), the web deploy to the NAS.
- **Pre-existing and not fixed:** an anonymous visitor to a plain `/friends/join/<token>` link loses the token at login (middleware redirects without it and `/login` ignores `next`), so "ดำเนินการต่อบนเว็บ" only helps signed-in users.
- **Known limit:** if `RootView` already shows a sheet when the link arrives, the invite sheet appears after it is dismissed.

Ask whether to commit; that is a separate approval.

---

## Self-Review (done while writing)

**Spec coverage:** §3.1 landing + `?src=line` on both LINE shares → Tasks 1–2 (iOS share in Task 4 Step 4); §3.2 strict token parsing → Task 3; never auto-accept, signed-out holding, results, latest-wins, reload friends → Task 4 (reload: the sheet's redeem uses the existing RPC; the Social tab reloads on appear — noted as a limit, no cross-view notification added); §4 non-goals respected (no universal links, no inviter name, no schema); §5 verification → Tasks 1, 3, 5 (host check, simulator `openurl`); §6 acceptance criteria map to Task 1/2 (landing doesn't join; plain link unchanged), Task 4/5 (confirm/cancel/results), Task 3 (malformed/foreign URLs), Task 4 (signed-out). Spec §8 amendments (public path, broken fallback, format-only validation, in-flight second link, no npm script, sheet stacking) are written in Task 0 Step 4.

**Placeholders:** none; every code step has full code. The `SlippyApp.swift` insertion counts in Task 4 Step 5 are stated as a rule ("only these new lines were added, delta equals what you intended") rather than a brittle number because the file is dirty with unrelated work.

**Type consistency:** `InviteLink.{token(from:), lineShareURL(_:), failureMessage(_:), isRetryable(_:)}` match Tasks 3, 4; `PendingInviteStore.Phase` cases match the sheet's `switch` and the fixture; `inviteLinkSheet(_:isSignedIn:)` matches `SlippyApp` and the fixture; the web helper names match Tasks 1–2; token endings `ab` / `a0` / `a1` in the fixture match Task 5 URLs.

**Known risks for the executor:** the Swift and TSX here were written against code as read on 2026-11-09 and have **not** been compiled or run; expect small fixes. The web edits cannot be type-checked here. Sheet behavior with `@ObservedObject` inside a `ViewModifier` should refresh on `store.token` changes — if it does not, move the `@ObservedObject` into a small wrapper `View` that owns the `.sheet`.
