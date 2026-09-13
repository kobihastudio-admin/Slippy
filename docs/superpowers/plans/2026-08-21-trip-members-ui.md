# Trip Members & Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-built, already-tested trip conversation/membership backend (`trip-access.ts`, `trip-conversation.ts`, `/api/trips/[id]/members`, `/api/trips/[id]/conversation`) into the production trip detail page, so an owner can see who's on a trip, invite an existing Slippy friend, remove a member with confirmation, and open the trip's group chat — none of which any UI currently calls.

**Architecture:** Two new self-fetching client components (`TripMembersPanel`, `InviteFriendModal`) added as a new "สมาชิก" tab inside the existing `TripDetailClient` tab system, following the exact pattern the "แผนการเดินทาง" (itinerary) tab already uses (`ItineraryPanel`: self-contained, `fetch`s its own data by `tripId`, no new props threaded through the server component). No new API routes, no new DB tables, no new environment variables — every endpoint this plan calls already exists and is already covered by `trip-conversation.test.mjs` (17/17 passing). Chat itself is not rebuilt: an "เปิดแชททริป" button ensures the trip's conversation exists, then navigates to the existing `/messages/[id]` chat room.

**Tech Stack:** Next.js 15 App Router, React client components, `sonner` toasts, `lucide-react` icons, existing Tailwind utility conventions (`cn()` from `@/lib/utils`).

**Spec:** [docs/SLIPPY_TRIP_FULL_LOOP_CLAUDE_HANDOFF.md](../../SLIPPY_TRIP_FULL_LOOP_CLAUDE_HANDOFF.md) — this plan implements remaining-work item 1 ("Finish Phase 1 UI wiring: production Journey detail, Slippy friend picker, LINE invite/share and member-removal confirmation"), scoped to the Slippy-friend and member-removal halves. LINE invite/share for non-Slippy travelers is **already implemented** (the existing "เชิญเพื่อน" copy-link button in `trip-detail-client.tsx:1139-1144` shares `trip.share_token` via the LIFF `liff/trips/[token]` flow) and is out of scope here.

## Global Constraints

- Never expose the Supabase service-role key to a client component — all new components call existing `/api/trips/[id]/...` routes, never `createAdminClient()` directly. (Spec §2)
- Keep existing trip creation, expense, split, and settlement flows exactly as they behave today — do not modify `trip-access.ts`, `trip-conversation.ts`, or any `/api/trips/[id]/expenses|itinerary|preorder|pay|recurring` route. (Spec §1, "without replacing or breaking the current trip, split-bill... flows")
- `TRIP_FEATURE_MAPS`, `TRIP_FEATURE_LIVE_LOCATION`, `TRIP_FEATURE_CALLS` stay at their current disabled default — this plan touches none of the code they gate. (Spec §"Current feature flags")
- Do not edit historical migrations already applied in production; this plan adds no migrations at all. (Spec §12)
- Inspect `git status` before editing; do not reset, delete, restore, or overwrite unrelated work; do not commit or push unless explicitly requested. (Spec §12)
- This repo has no component-testing framework (no jest/vitest/testing-library — confirmed via `web/package.json`). The only automated test tooling is `node --experimental-strip-types --test` against plain `.mjs`/`.ts` files with no `@/` path aliases (see `trip-conversation.test.mjs`). New UI components are therefore verified by `tsc --noEmit` (compiles, types match) plus a live browser walkthrough of the dev server, not new unit tests — inventing a testing framework this repo doesn't use would be its own unreviewed change. Route-level integration tests (remaining-work item 3) are a separate follow-up plan.

---

## Task 1: `TripMembersPanel` — list members, remove with confirmation, open chat

**Files:**
- Create: `web/src/components/trips/trip-members-panel.tsx`

**Interfaces:**
- Consumes: `GET /api/trips/[id]/members` → `{ members: {id, user_id, display_name, line_user_id, is_host, is_non_line, joined_at}[], myRole: "owner"|"participant"|"none" }` (existing route, `web/src/app/api/trips/[id]/members/route.ts:16-33`); `DELETE /api/trips/[id]/members?userId=...` → `{removed: boolean, alreadyRemoved?: boolean}` or `{error}` (existing route, same file `:167-220`); `POST /api/trips/[id]/conversation` → `{conversationId: string, existed: boolean}` or `{error}` (existing route, `web/src/app/api/trips/[id]/conversation/route.ts:43-61`).
- Produces: exports `TripMembersPanel({ tripId }: { tripId: string })` and the `TripMember` type, both consumed by Task 3. Renders an "เชิญเพื่อน" button that opens `InviteFriendModal` (Task 2) — passes it `tripId` and `existingUserIds: string[]`.

- [ ] **Step 1: Create the component**

```tsx
"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { UserPlus, LogOut, MessageCircle, Crown } from "lucide-react"
import { InviteFriendModal } from "./invite-friend-modal"

export type TripMember = {
  id: string
  user_id: string | null
  display_name: string
  line_user_id: string | null
  is_host: boolean
  is_non_line: boolean
  joined_at: string
}

export function TripMembersPanel({ tripId }: { tripId: string }) {
  const router = useRouter()
  const [members, setMembers] = useState<TripMember[] | null>(null)
  const [myRole, setMyRole] = useState<"owner" | "participant" | "none">("none")
  const [showInvite, setShowInvite] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [openingChat, setOpeningChat] = useState(false)

  const load = () => {
    fetch(`/api/trips/${tripId}/members`)
      .then(r => r.json())
      .then(d => { setMembers(d.members ?? []); setMyRole(d.myRole ?? "none") })
      .catch(() => setMembers([]))
  }
  useEffect(load, [tripId])

  const isOwner = myRole === "owner"

  const removeMember = async (member: TripMember) => {
    if (!member.user_id) return
    if (!confirm(`เอา ${member.display_name} ออกจากทริปนี้?\nประวัติค่าใช้จ่ายของเขาจะยังอยู่ แต่จะไม่เห็นทริปนี้อีกต่อไป`)) return
    setRemovingId(member.id)
    try {
      const res = await fetch(`/api/trips/${tripId}/members?userId=${member.user_id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "ลบสมาชิกไม่สำเร็จ"); return }
      toast.success(`เอา ${member.display_name} ออกจากทริปแล้ว`)
      load()
    } finally {
      setRemovingId(null)
    }
  }

  const openChat = async () => {
    setOpeningChat(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/conversation`, { method: "POST" })
      const data = await res.json()
      if (!res.ok || !data.conversationId) { toast.error(data.error ?? "เปิดแชทไม่สำเร็จ"); return }
      router.push(`/messages/${data.conversationId}`)
    } finally {
      setOpeningChat(false)
    }
  }

  if (members === null) return <div className="text-center py-10 text-sm text-muted-foreground">กำลังโหลด...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button onClick={openChat} disabled={openingChat}
          className="h-9 px-3.5 rounded-[8px] border bg-card text-sm font-medium flex items-center gap-1.5 hover:bg-muted/40 disabled:opacity-50">
          <MessageCircle className="w-4 h-4" /> {openingChat ? "กำลังเปิด..." : "เปิดแชททริป"}
        </button>
        {isOwner && (
          <button onClick={() => setShowInvite(true)}
            className="h-9 px-3.5 rounded-[8px] bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium flex items-center gap-1.5">
            <UserPlus className="w-4 h-4" /> เชิญเพื่อน
          </button>
        )}
      </div>

      <div className="rounded-xl border bg-card divide-y">
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">ยังไม่มีสมาชิก</p>
        ) : members.map(m => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 flex items-center justify-center font-semibold text-xs shrink-0">
              {m.display_name.trim().slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium flex items-center gap-1.5">
                {m.display_name}
                {m.is_host && <Crown className="w-3.5 h-3.5 text-amber-500" aria-label="เจ้าของทริป" />}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {m.user_id ? "สมาชิก Slippy" : m.line_user_id ? "เชิญผ่าน LINE" : "ไม่มีบัญชี Slippy"}
              </p>
            </div>
            {isOwner && !m.is_host && m.user_id && (
              <button onClick={() => removeMember(m)} disabled={removingId === m.id}
                className="h-8 px-2.5 rounded-[7px] text-xs font-medium text-destructive hover:bg-destructive/10 flex items-center gap-1 disabled:opacity-50">
                <LogOut className="w-3.5 h-3.5" /> {removingId === m.id ? "กำลังลบ..." : "ลบออก"}
              </button>
            )}
          </div>
        ))}
      </div>

      {showInvite && (
        <InviteFriendModal
          tripId={tripId}
          existingUserIds={members.filter(m => m.user_id).map(m => m.user_id as string)}
          onClose={() => setShowInvite(false)}
          onDone={() => { setShowInvite(false); load() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck (will fail — `./invite-friend-modal` does not exist yet)**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
npm run typecheck
```

Expected: FAIL — `Cannot find module './invite-friend-modal' or its corresponding type declarations.` This confirms the file was created and TypeScript is actually checking it; proceed to Task 2 before re-running.

---

## Task 2: `InviteFriendModal` — Slippy friend picker

**Files:**
- Create: `web/src/components/trips/invite-friend-modal.tsx`

**Interfaces:**
- Consumes: `GET /api/friends` → `{ friends: {friendshipId, source, friend: {id, full_name, avatar_url}}[] }` (existing route, `web/src/app/api/friends/route.ts:6-34`); `POST /api/trips/[id]/members` body `{userIds: string[]}` → `{invited: string[], alreadyMembers: string[], notFriends: string[], conversationId: string|null}` or `{error}` (existing route, `web/src/app/api/trips/[id]/members/route.ts:52-158`).
- Produces: exports `InviteFriendModal({ tripId, existingUserIds, onClose, onDone }: { tripId: string; existingUserIds: string[]; onClose: () => void; onDone: () => void })`, imported by `TripMembersPanel` from Task 1.

- [ ] **Step 1: Create the component**

```tsx
"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { X, Check, Search } from "lucide-react"

type Friend = { id: string; full_name: string; avatar_url: string | null }

export function InviteFriendModal({
  tripId,
  existingUserIds,
  onClose,
  onDone,
}: {
  tripId: string
  existingUserIds: string[]
  onClose: () => void
  onDone: () => void
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/friends")
      .then(r => r.json())
      .then(d => {
        const already = new Set(existingUserIds)
        const list: Friend[] = (d.friends ?? [])
          .map((f: { friend: Friend }) => f.friend)
          .filter((f: Friend) => f && !already.has(f.id))
        setFriends(list)
      })
      .catch(() => setFriends([]))
    // existingUserIds is fixed for the lifetime of one modal open (snapshotted
    // by the parent when it renders this component) — re-running on every
    // parent re-render would refetch mid-selection and drop the user's picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const submit = async () => {
    if (selected.size === 0) return
    setSaving(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/members`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(selected) }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "เชิญเพื่อนไม่สำเร็จ"); return }
      toast.success(
        data.invited.length > 0 ? `เชิญ ${data.invited.length} คนเข้าทริปแล้ว` : "ทุกคนอยู่ในทริปนี้อยู่แล้ว",
      )
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const shown = (friends ?? []).filter(f => f.full_name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto border shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-bold">เชิญเพื่อนเข้าทริป</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground" aria-label="ปิด">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 pb-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาเพื่อน..."
              className="w-full h-10 pl-9 pr-3 rounded-[8px] border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="p-4 space-y-1 min-h-[120px]">
          {friends === null ? (
            <p className="text-sm text-muted-foreground text-center py-8">กำลังโหลด...</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {friends.length === 0 ? "เพื่อนทุกคนอยู่ในทริปนี้แล้ว หรือยังไม่มีเพื่อนใน Slippy" : "ไม่พบเพื่อนที่ค้นหา"}
            </p>
          ) : shown.map(f => {
            const isSelected = selected.has(f.id)
            return (
              <button key={f.id} onClick={() => toggle(f.id)}
                className={cn("w-full flex items-center gap-3 px-2 py-2 rounded-[8px] text-left transition-colors",
                  isSelected ? "bg-brand-50 dark:bg-brand-900/30" : "hover:bg-muted/50")}>
                <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 flex items-center justify-center font-semibold text-xs shrink-0 overflow-hidden">
                  {f.avatar_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={f.avatar_url} alt={f.full_name} className="w-full h-full object-cover" />
                    : f.full_name.trim().slice(0, 2).toUpperCase()}
                </div>
                <span className="flex-1 text-sm font-medium truncate">{f.full_name}</span>
                <div className={cn("w-5 h-5 rounded-full border flex items-center justify-center shrink-0",
                  isSelected ? "bg-brand-500 border-brand-500" : "border-muted-foreground/30")}>
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
              </button>
            )
          })}
        </div>

        <div className="p-4 pt-2 border-t">
          <button onClick={submit} disabled={selected.size === 0 || saving}
            className="w-full h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold">
            {saving ? "กำลังเชิญ..." : selected.size > 0 ? `เชิญ ${selected.size} คน` : "เลือกเพื่อนที่ต้องการเชิญ"}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck both new components**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
npm run typecheck
```

Expected: PASS — no errors from `trip-members-panel.tsx` or `invite-friend-modal.tsx`. (Both files are unused by any page yet, so this only proves they compile in isolation — Task 3 wires them in.)

- [ ] **Step 3: Commit**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git add web/src/components/trips/trip-members-panel.tsx web/src/components/trips/invite-friend-modal.tsx
git commit -m "feat(trips): add members panel and friend-invite modal (not yet wired)"
```

---

## Task 3: Wire the "สมาชิก" tab into production `TripDetailClient`

**Files:**
- Modify: `web/src/components/trips/trip-detail-client.tsx:1087` (tab union type), `:1170-1183` (tab button list), `:1186-1188` (tab content render)

**Interfaces:**
- Consumes: `TripMembersPanel` from Task 1 (`import { TripMembersPanel } from "./trip-members-panel"`).

- [ ] **Step 1: Add the import**

In `web/src/components/trips/trip-detail-client.tsx`, the existing itinerary/preorder/recurring panels are imported implicitly (they're defined in the same file above `TripDetailClient`) — `TripMembersPanel` instead lives in its own file, so it needs an explicit import alongside the other top-of-file imports:

```tsx
import { cn } from "@/lib/utils"
import { COMMON_CURRENCIES } from "@/lib/exchange-rates"
import { TripMembersPanel } from "./trip-members-panel"
```

(Insert the `TripMembersPanel` import line directly after the existing `COMMON_CURRENCIES` import at line 7.)

- [ ] **Step 2: Add `"members"` to the tab union**

Change:
```tsx
  const [tab,        setTab]        = useState<"expenses"|"settlement"|"payments"|"recurring"|"itinerary"|"preorder">("expenses")
```
to:
```tsx
  const [tab,        setTab]        = useState<"expenses"|"settlement"|"payments"|"recurring"|"itinerary"|"preorder"|"members">("expenses")
```

- [ ] **Step 3: Add the tab button**

Change the tabs array (currently 6 entries) to add a 7th, placed right after itinerary since membership is trip-setup, not money:
```tsx
        {[
          { id: "expenses",   label: `รายจ่าย (${expenses.length})` },
          { id: "itinerary",  label: "แผนการเดินทาง" },
          { id: "members",    label: "สมาชิก" },
          { id: "preorder",   label: "สั่งของ" },
          { id: "settlement", label: `สรุปการจ่าย ${isSettled ? "✅" : `(${settlement.length})`}` },
          { id: "payments",   label: `ประวัติโอน (${payments.length})` },
          { id: "recurring",  label: "รายจ่ายประจำ" },
        ].map(t => (
```

- [ ] **Step 4: Render the panel**

Change:
```tsx
      {tab === "itinerary" && <ItineraryPanel tripId={trip.id} />}
      {tab === "preorder"  && <PreorderPanel tripId={trip.id} participants={participants} />}
      {tab === "recurring" && <RecurringPanel tripId={trip.id} />}
```
to:
```tsx
      {tab === "itinerary" && <ItineraryPanel tripId={trip.id} />}
      {tab === "members"   && <TripMembersPanel tripId={trip.id} />}
      {tab === "preorder"  && <PreorderPanel tripId={trip.id} participants={participants} />}
      {tab === "recurring" && <RecurringPanel tripId={trip.id} />}
```

- [ ] **Step 5: Typecheck**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
npm run typecheck
```

Expected: PASS, zero errors.

- [ ] **Step 6: Regression — existing trip backend tests must still be green**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
npm run test:trips
```

Expected: `# tests 17`, `# pass 17`, `# fail 0` — unchanged, since this task touches no file `trip-conversation.test.mjs` exercises.

- [ ] **Step 7: Start the dev server and open a real trip as the owner**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
npm run dev:http
```

Log in, open any existing trip you own (`/trips/[id]`), or create one via the "+ ทริปใหม่" flow first if none exist.

- [ ] **Step 8: Verify the members list**

Click the "สมาชิก" tab. Confirm: it shows a loading state briefly, then a list with at least yourself (crown icon next to your name, "สมาชิก Slippy" caption), and no console errors in the browser devtools network/console tabs for the `GET /api/trips/[id]/members` call (expect 200, not 401/404/500).

- [ ] **Step 9: Verify invite → real-time member add**

Click "เชิญเพื่อน". Confirm the modal opens, lists your accepted Slippy friends (people already on the trip must NOT appear — if you have no friends yet, add one first via `/social/friends`). Search by typing part of a name and confirm the list filters. Select one friend, click "เชิญ 1 คน", confirm a success toast appears, the modal closes, and the new member now appears in the list without a page reload.

- [ ] **Step 10: Verify the chat wiring**

Click "เปิดแชททริป". Confirm the browser navigates to `/messages/<some-uuid>` and the chat room loads (not a 404 or blank page). Confirm a system message reading "<friend name> เข้าร่วมทริปแล้ว" is visible in the chat history from the invite in Step 9.

- [ ] **Step 11: Verify member removal with confirmation**

Go back to the trip's "สมาชิก" tab. Click "ลบออก" next to the friend invited in Step 9. Confirm a native `confirm()` dialog appears with their name; click Cancel and confirm they are NOT removed (list unchanged); click "ลบออก" again and this time accept the dialog — confirm a success toast appears and they disappear from the list. Confirm your own row (the owner, crown icon) never shows a "ลบออก" button.

- [ ] **Step 12: Commit**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
git add web/src/components/trips/trip-detail-client.tsx
git commit -m "feat(trips): wire members/chat panel into production trip detail page"
```

---

## Known follow-ups (deliberately not in this plan)

- **Participant-scoped RLS** (handoff remaining-work item 2): still organization-scoped only (confirmed live in `030_trip_management.sql:99-106` and equivalents in `074`/`072`). Not blocking — every route this plan uses already goes through `getTripAccess()`/`canManageTrip()` server-side with the service-role client, per the handoff's own note that routes "must continue using `getTripAccess()` until direct-client policies are hardened and verified." Hardening RLS touches every historical trip policy at once and deserves its own reviewed plan, not a rider on a UI change.
- **Route-level integration tests** (handoff remaining-work item 3): this repo has no harness for testing Next.js route handlers (no way to mock `NextRequest`/`@/lib/supabase/*` under the existing `node --test` setup). Adding one (likely vitest, given path-alias and Next.js runtime needs) is infrastructure work independent of this UI feature and should be its own plan.
- Maps, live location, and calls (remaining-work items 4-6) remain untouched and behind their disabled feature flags, as instructed.
