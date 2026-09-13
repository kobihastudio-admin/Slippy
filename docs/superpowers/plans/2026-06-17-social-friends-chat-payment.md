# Social — Friends, Chat & Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Build friend graph, in-app chat (Supabase Realtime), and PromptPay payment requests across Web, LIFF, iOS, and Android.

**Architecture:** `users` is the identity core; `friendships` is the graph; `conversations`+`messages` power chat via Supabase Realtime; `payment_requests` handles PromptPay QR + slip verification. LINE is one identity provider, not the backbone. All platforms share the same Supabase project.

**Tech Stack:** Next.js 15 API routes, Supabase JS + Realtime, Expo Router (React Native), @line/liff, lucide-react, react-native-svg, expo-notifications

---

## Phase 0 — DB Foundation

### Task 1: Migration 052 — friendships + users phone

**Files:**
- Create: `supabase/migrations/052_friendships.sql`

- [ ] **Step 1: Write migration**

```sql
-- 052: Friend graph + phone on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio   text;

CREATE TABLE IF NOT EXISTS friendships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','blocked')),
  source        text NOT NULL DEFAULT 'search'
    CHECK (source IN ('line_mutual','qr_scan','search','split_activity','trip_activity')),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX idx_friendship_addr ON friendships(addressee_id, status);
CREATE INDEX idx_friendship_req  ON friendships(requester_id, status);

-- friend_invite_links — QR / short link tokens
CREATE TABLE IF NOT EXISTS friend_invite_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text UNIQUE NOT NULL DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,12),
  expires_at timestamptz DEFAULT now() + interval '7 days',
  used_count int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_invite_token ON friend_invite_links(token);
```

- [ ] **Step 2: Apply migration**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
npx supabase db push --local 2>/dev/null || npx supabase migration up
```

Expected: migration 052 applied.

---

### Task 2: Migration 053 — conversations & messages

**Files:**
- Create: `supabase/migrations/053_chat.sql`

- [ ] **Step 1: Write migration**

```sql
-- 053: Chat — conversations + messages
CREATE TABLE IF NOT EXISTS conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL DEFAULT 'direct'
    CHECK (type IN ('direct','group')),
  name         text,                          -- group name (null for direct)
  avatar_url   text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()      -- bumped on each new message
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  last_read_at    timestamptz DEFAULT now(),
  joined_at       timestamptz DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_cm_user ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            text,
  attachment_url  text,
  msg_type        text NOT NULL DEFAULT 'text'
    CHECK (msg_type IN ('text','image','payment_request','slip','system')),
  meta            jsonb DEFAULT '{}'::jsonb,  -- payment_request_id, slip_doc_id, etc.
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_msg_conv ON messages(conversation_id, created_at DESC);

-- Enable Realtime for messages
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_members;
```

- [ ] **Step 2: Apply**

```bash
npx supabase migration up
```

---

### Task 3: Migration 054 — payment_requests

**Files:**
- Create: `supabase/migrations/054_payment_requests.sql`

- [ ] **Step 1: Write migration**

```sql
-- 054: Payment requests (PromptPay-first)
CREATE TABLE IF NOT EXISTS payment_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,
  requester_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payer_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  amount           numeric(14,2) NOT NULL,
  currency         text NOT NULL DEFAULT 'THB',
  description      text,
  promptpay_id     text,          -- เบอร์/เลขบัตร PromptPay ของผู้รับ
  qr_payload       text,          -- PromptPay EMVCo QR string
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','expired','cancelled')),
  expires_at       timestamptz DEFAULT now() + interval '24 hours',
  paid_at          timestamptz,
  slip_doc_id      uuid REFERENCES documents(id) ON DELETE SET NULL,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  split_bill_id    uuid REFERENCES split_bills(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_pr_payer     ON payment_requests(payer_id, status);
CREATE INDEX idx_pr_requester ON payment_requests(requester_id, status);
CREATE INDEX idx_pr_conv      ON payment_requests(conversation_id);
```

- [ ] **Step 2: Apply**

```bash
npx supabase migration up
```

---

## Phase 1 — Web API Routes

### Task 4: Friends API

**Files:**
- Create: `web/src/app/api/friends/route.ts`
- Create: `web/src/app/api/friends/[id]/route.ts`
- Create: `web/src/app/api/friends/invite/route.ts`
- Create: `web/src/app/api/friends/search/route.ts`

- [ ] **Step 1: Write `web/src/app/api/friends/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/friends — list accepted friends + pending requests
export async function GET(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()
  const uid   = user.id

  const [{ data: accepted }, { data: pending }, { data: sent }] = await Promise.all([
    admin.from("friendships")
      .select("id, source, created_at, requester:requester_id(id,full_name,avatar_url), addressee:addressee_id(id,full_name,avatar_url)")
      .eq("status", "accepted")
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`),
    admin.from("friendships")
      .select("id, source, created_at, requester:requester_id(id,full_name,avatar_url)")
      .eq("status", "pending")
      .eq("addressee_id", uid),
    admin.from("friendships")
      .select("id, status, created_at, addressee:addressee_id(id,full_name,avatar_url)")
      .eq("requester_id", uid)
      .eq("status", "pending"),
  ])

  const friends = (accepted ?? []).map((f: any) => ({
    friendshipId: f.id,
    source: f.source,
    friend: f.requester_id === uid ? f.addressee : f.requester,
  }))

  return NextResponse.json({ friends, pendingReceived: pending ?? [], pendingSent: sent ?? [] })
}

// POST /api/friends — send friend request { addresseeId }
export async function POST(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { addresseeId, source = "search" } = await req.json()
  if (!addresseeId) return NextResponse.json({ error: "addresseeId required" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from("friendships").insert({
    requester_id: user.id,
    addressee_id: addresseeId,
    source,
  }).select("id").single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, id: data.id })
}
```

- [ ] **Step 2: Write `web/src/app/api/friends/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// PATCH /api/friends/[id] — { action: 'accept' | 'decline' | 'block' }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { action } = await req.json()
  const admin = createAdminClient()

  const statusMap: Record<string, string> = { accept: "accepted", decline: "rejected", block: "blocked" }
  const status = statusMap[action]
  if (!status) return NextResponse.json({ error: "invalid action" }, { status: 400 })

  if (action === "decline") {
    await admin.from("friendships").delete().eq("id", id).eq("addressee_id", user.id)
  } else {
    await admin.from("friendships").update({ status, updated_at: new Date().toISOString() })
      .eq("id", id).eq("addressee_id", user.id)
  }
  return NextResponse.json({ ok: true })
}

// DELETE /api/friends/[id] — unfriend
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()
  await admin.from("friendships").delete().eq("id", id)
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Write `web/src/app/api/friends/search/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/friends/search?q=name_or_phone_or_email
export async function GET(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("q")?.trim()
  if (!q || q.length < 2) return NextResponse.json({ users: [] })

  const admin = createAdminClient()
  const { data } = await admin.from("users")
    .select("id, full_name, avatar_url, phone, email")
    .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
    .neq("id", user.id)
    .limit(20)

  // Mask email/phone for privacy
  const masked = (data ?? []).map((u: any) => ({
    id: u.id,
    full_name: u.full_name,
    avatar_url: u.avatar_url,
    hint: u.phone ? `📱 ${u.phone.slice(0, 3)}***${u.phone.slice(-2)}` :
          u.email ? `✉️ ${u.email.split("@")[0].slice(0, 2)}***@${u.email.split("@")[1]}` : "",
  }))

  return NextResponse.json({ users: masked })
}
```

- [ ] **Step 4: Write `web/src/app/api/friends/invite/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/friends/invite — get or create my invite link
export async function GET() {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()
  let { data: link } = await admin.from("friend_invite_links")
    .select("token, expires_at")
    .eq("user_id", user.id)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle()

  if (!link) {
    const { data: newLink } = await admin.from("friend_invite_links")
      .insert({ user_id: user.id }).select("token, expires_at").single()
    link = newLink
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.slippy.ai"
  return NextResponse.json({ token: link?.token, url: `${base}/friends/join/${link?.token}` })
}

// POST /api/friends/invite/[token] — accept invite (handled separately below)
```

---

### Task 5: Chat API

**Files:**
- Create: `web/src/app/api/conversations/route.ts`
- Create: `web/src/app/api/conversations/[id]/route.ts`
- Create: `web/src/app/api/conversations/[id]/messages/route.ts`

- [ ] **Step 1: Write `web/src/app/api/conversations/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/conversations — list my conversations with last message
export async function GET() {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = createAdminClient()
  const { data: memberships } = await admin.from("conversation_members")
    .select("conversation_id, last_read_at, conversations(id,type,name,avatar_url,updated_at)")
    .eq("user_id", user.id)
    .order("conversations(updated_at)", { ascending: false })
    .limit(50)

  const convIds = (memberships ?? []).map((m: any) => m.conversation_id)
  if (convIds.length === 0) return NextResponse.json({ conversations: [] })

  // last message per conversation
  const { data: lastMsgs } = await admin.from("messages")
    .select("conversation_id, body, msg_type, created_at, sender:sender_id(full_name)")
    .in("conversation_id", convIds)
    .order("created_at", { ascending: false })

  const lastMap: Record<string, any> = {}
  for (const m of lastMsgs ?? []) {
    if (!lastMap[m.conversation_id]) lastMap[m.conversation_id] = m
  }

  // members per conversation (for direct chat partner name)
  const { data: allMembers } = await admin.from("conversation_members")
    .select("conversation_id, user_id, users(id,full_name,avatar_url)")
    .in("conversation_id", convIds)
    .neq("user_id", user.id)

  const memberMap: Record<string, any[]> = {}
  for (const m of allMembers ?? []) {
    if (!memberMap[m.conversation_id]) memberMap[m.conversation_id] = []
    memberMap[m.conversation_id].push((m as any).users)
  }

  const conversations = (memberships ?? []).map((m: any) => {
    const conv = m.conversations
    const lastMsg = lastMap[m.conversation_id]
    const others  = memberMap[m.conversation_id] ?? []
    return {
      id:       conv.id,
      type:     conv.type,
      name:     conv.type === "direct" ? others[0]?.full_name ?? "Unknown" : conv.name,
      avatarUrl: conv.type === "direct" ? others[0]?.avatar_url : conv.avatar_url,
      updatedAt: conv.updated_at,
      lastMessage: lastMsg ? { body: lastMsg.body, msgType: lastMsg.msg_type, senderName: lastMsg.sender?.full_name, createdAt: lastMsg.created_at } : null,
      unreadCount: 0,  // TODO: compare last_read_at with lastMsg.created_at
    }
  })

  return NextResponse.json({ conversations })
}

// POST /api/conversations — create direct or group conversation
export async function POST(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { type = "direct", memberIds, name } = await req.json()
  if (!memberIds?.length) return NextResponse.json({ error: "memberIds required" }, { status: 400 })

  const admin = createAdminClient()

  // For direct: check if conversation already exists
  if (type === "direct" && memberIds.length === 1) {
    const otherId = memberIds[0]
    const { data: existing } = await admin.from("conversation_members")
      .select("conversation_id")
      .eq("user_id", user.id)
      .in("conversation_id",
        admin.from("conversation_members").select("conversation_id").eq("user_id", otherId)
      )
      .limit(1).maybeSingle()

    if (existing) {
      const { data: conv } = await admin.from("conversations").select("*").eq("id", existing.conversation_id).single()
      return NextResponse.json({ conversation: conv, existed: true })
    }
  }

  const { data: conv } = await admin.from("conversations").insert({ type, name, created_by: user.id }).select("id").single()
  const allIds = [user.id, ...memberIds.filter((id: string) => id !== user.id)]
  await admin.from("conversation_members").insert(allIds.map((uid: string) => ({
    conversation_id: conv!.id, user_id: uid,
    role: uid === user.id ? "admin" : "member",
  })))

  return NextResponse.json({ conversation: { id: conv!.id, type, name }, existed: false })
}
```

- [ ] **Step 2: Write `web/src/app/api/conversations/[id]/messages/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/conversations/[id]/messages?before=ISO&limit=30
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const before = req.nextUrl.searchParams.get("before")
  const limit  = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 30), 100)

  const admin = createAdminClient()
  let q = admin.from("messages")
    .select("id, body, attachment_url, msg_type, meta, created_at, sender:sender_id(id,full_name,avatar_url)")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (before) q = q.lt("created_at", before)
  const { data } = await q
  return NextResponse.json({ messages: (data ?? []).reverse() })
}

// POST /api/conversations/[id]/messages — send message
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { body, msgType = "text", attachmentUrl, meta } = await req.json()
  if (!body && !attachmentUrl) return NextResponse.json({ error: "body or attachmentUrl required" }, { status: 400 })

  const admin = createAdminClient()
  const [{ data: msg }] = await Promise.all([
    admin.from("messages").insert({
      conversation_id: id,
      sender_id: user.id,
      body,
      msg_type: msgType,
      attachment_url: attachmentUrl,
      meta: meta ?? {},
    }).select("id, created_at").single(),
    admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id),
  ])

  return NextResponse.json({ ok: true, message: msg })
}
```

---

### Task 6: Payment Requests API

**Files:**
- Create: `web/src/app/api/payment-requests/route.ts`
- Create: `web/src/app/api/payment-requests/[id]/route.ts`
- Create: `web/src/lib/promptpay.ts`

- [ ] **Step 1: Write PromptPay QR helper `web/src/lib/promptpay.ts`**

```typescript
// PromptPay EMVCo QR payload generator (Thai standard)
// Spec: BOT PromptPay QR Code Standard v1.0
function crc16(data: string): string {
  let crc = 0xFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
    }
  }
  return ((crc & 0xFFFF) >>> 0).toString(16).toUpperCase().padStart(4, "0")
}

function tlv(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, "0")
  return `${tag}${len}${value}`
}

export function generatePromptPayQR(promptpayId: string, amount?: number): string {
  const isPhone = /^\d{10}$/.test(promptpayId.replace(/[-\s]/g, ""))
  const isNatId = /^\d{13}$/.test(promptpayId)
  const isTaxId = /^\d{10}$/.test(promptpayId) && !isPhone

  const normalized = isPhone
    ? "0066" + promptpayId.replace(/^0/, "").replace(/[-\s]/g, "")
    : promptpayId.replace(/[-\s]/g, "")

  const typeTag = isPhone ? "01" : isNatId ? "02" : "02"
  const merchantAccount = tlv("00", "A000000677010111") + tlv(typeTag, normalized)
  const merchantField   = tlv("29", merchantAccount)

  let payload = tlv("00", "01") + tlv("01", "12") + merchantField + tlv("53", "764")

  if (amount && amount > 0) {
    payload += tlv("54", amount.toFixed(2))
  }

  payload += tlv("58", "TH") + tlv("59", "Slippy") + tlv("60", "Bangkok")
  payload += "6304"
  const crc = crc16(payload)
  return payload + crc
}
```

- [ ] **Step 2: Write `web/src/app/api/payment-requests/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { generatePromptPayQR } from "@/lib/promptpay"

// GET /api/payment-requests?role=received|sent
export async function GET(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = req.nextUrl.searchParams.get("role") ?? "received"
  const admin = createAdminClient()

  const col = role === "sent" ? "requester_id" : "payer_id"
  const { data } = await admin.from("payment_requests")
    .select("*, requester:requester_id(id,full_name,avatar_url), payer:payer_id(id,full_name,avatar_url)")
    .eq(col, user.id)
    .order("created_at", { ascending: false })
    .limit(30)

  return NextResponse.json({ requests: data ?? [] })
}

// POST /api/payment-requests — create request
export async function POST(req: NextRequest) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { payerId, amount, description, promptpayId, conversationId, splitBillId } = await req.json()
  if (!amount || amount <= 0) return NextResponse.json({ error: "invalid amount" }, { status: 400 })

  const admin = createAdminClient()

  // Get promptpayId from org settings if not provided
  let ppId = promptpayId
  if (!ppId) {
    const { data: { user: authUser } } = await sb.auth.getUser()
    const { data: member } = await admin.from("organization_members")
      .select("organization_id").eq("user_id", user.id).limit(1).maybeSingle()
    if (member) {
      const { data: org } = await admin.from("organizations")
        .select("settings").eq("id", member.organization_id).maybeSingle()
      ppId = (org?.settings as any)?.promptpay_id
    }
  }

  const qrPayload = ppId ? generatePromptPayQR(ppId, amount) : null

  const { data: pr } = await admin.from("payment_requests").insert({
    requester_id:    user.id,
    payer_id:        payerId ?? null,
    amount,
    description,
    promptpay_id:    ppId ?? null,
    qr_payload:      qrPayload,
    conversation_id: conversationId ?? null,
    split_bill_id:   splitBillId ?? null,
  }).select("id, qr_payload").single()

  // If in a conversation, send as message
  if (conversationId && pr) {
    await admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id:       user.id,
      msg_type:        "payment_request",
      body:            `💸 ขอเงิน ฿${Number(amount).toLocaleString("th-TH")} — ${description ?? ""}`,
      meta:            { payment_request_id: pr.id, amount, description },
    })
    await admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId)
  }

  return NextResponse.json({ ok: true, id: pr?.id, qrPayload: pr?.qr_payload })
}
```

- [ ] **Step 3: Write `web/src/app/api/payment-requests/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// GET /api/payment-requests/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()
  const { data } = await admin.from("payment_requests")
    .select("*, requester:requester_id(id,full_name,avatar_url), payer:payer_id(id,full_name,avatar_url)")
    .eq("id", id).maybeSingle()

  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ request: data })
}

// PATCH /api/payment-requests/[id] — { action: 'mark_paid', slipDocId? } or { action: 'cancel' }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sb   = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { action, slipDocId } = await req.json()
  const admin = createAdminClient()

  if (action === "mark_paid") {
    await admin.from("payment_requests").update({
      status: "paid", paid_at: new Date().toISOString(),
      ...(slipDocId ? { slip_doc_id: slipDocId } : {}),
    }).eq("id", id)
  } else if (action === "cancel") {
    await admin.from("payment_requests").update({ status: "cancelled" })
      .eq("id", id).eq("requester_id", user.id)
  }

  return NextResponse.json({ ok: true })
}
```

---

## Phase 2 — Web App UI

### Task 7: Friends page

**Files:**
- Create: `web/src/app/social/friends/page.tsx`
- Modify: `web/src/components/layout/sidebar.tsx` — add friends nav item

- [ ] **Step 1: Add nav item to sidebar**

In `web/src/components/layout/sidebar.tsx`, find `activityItems` array and add before `social`:

```typescript
{ key: "friends", href: "/social/friends", icon: Icons.Users, label: "เพื่อน" },
```

Also add `Icons.Users` if not present — it's from lucide-react, check `web/src/components/ui/icons.tsx`.

- [ ] **Step 2: Create `web/src/app/social/friends/page.tsx`**

```typescript
import { Suspense } from "react"
import FriendsClient from "./FriendsClient"

export const metadata = { title: "เพื่อน — Slippy" }
export default function FriendsPage() {
  return <Suspense><FriendsClient /></Suspense>
}
```

- [ ] **Step 3: Create `web/src/app/social/friends/FriendsClient.tsx`** (300 lines — full friend list + search + pending + QR invite UI)

```typescript
"use client"
import { useEffect, useState, useCallback } from "react"
import { UserPlus, Search, QrCode, Check, X, Users, Clock, Copy } from "lucide-react"

interface Friend { friendshipId: string; source: string; friend: { id: string; full_name: string; avatar_url: string | null } }
interface PendingReq { id: string; requester: { id: string; full_name: string; avatar_url: string | null }; source: string }
interface SearchUser { id: string; full_name: string; avatar_url: string | null; hint: string }

export default function FriendsClient() {
  const [tab, setTab]               = useState<"friends"|"search"|"pending">("friends")
  const [friends, setFriends]       = useState<Friend[]>([])
  const [pending, setPending]       = useState<PendingReq[]>([])
  const [sentList, setSentList]     = useState<any[]>([])
  const [query, setQuery]           = useState("")
  const [results, setResults]       = useState<SearchUser[]>([])
  const [inviteUrl, setInviteUrl]   = useState("")
  const [copied, setCopied]         = useState(false)
  const [loading, setLoading]       = useState(false)

  async function load() {
    const res = await fetch("/api/friends")
    const json = await res.json()
    setFriends(json.friends ?? [])
    setPending(json.pendingReceived ?? [])
    setSentList(json.pendingSent ?? [])
  }

  async function loadInvite() {
    const res = await fetch("/api/friends/invite")
    const json = await res.json()
    setInviteUrl(json.url ?? "")
  }

  useEffect(() => { load(); loadInvite() }, [])

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`)
    const json = await res.json()
    setResults(json.users ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(query), 400)
    return () => clearTimeout(t)
  }, [query, search])

  async function sendRequest(addresseeId: string) {
    await fetch("/api/friends", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresseeId }) })
    setResults(r => r.filter(u => u.id !== addresseeId))
    load()
  }

  async function respond(id: string, action: "accept"|"decline") {
    await fetch(`/api/friends/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }) })
    load()
  }

  function copyInvite() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const TABS = [
    { key: "friends", label: `เพื่อน (${friends.length})` },
    { key: "pending", label: `รอตอบรับ (${pending.length})` },
    { key: "search",  label: "ค้นหา" },
  ] as const

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">เพื่อน</h1>
        <button onClick={copyInvite}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-medium">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? "คัดลอกแล้ว!" : "Invite Link"}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key as any)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Friends list */}
      {tab === "friends" && (
        <div className="space-y-2">
          {friends.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Users className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>ยังไม่มีเพื่อน — ค้นหาหรือส่ง Invite Link</p>
            </div>
          )}
          {friends.map(f => (
            <div key={f.friendshipId} className="flex items-center gap-3 p-3 bg-white rounded-xl border">
              {f.friend.avatar_url
                ? <img src={f.friend.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" />
                : <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-lg">👤</div>
              }
              <div className="flex-1">
                <p className="font-medium">{f.friend.full_name}</p>
                <p className="text-xs text-gray-400">{f.source === "line_mutual" ? "📲 LINE" : f.source === "qr_scan" ? "📷 QR" : "🔍 ค้นหา"}</p>
              </div>
              <a href={`/messages?userId=${f.friend.id}`}
                className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium">แชท</a>
            </div>
          ))}
        </div>
      )}

      {/* Pending */}
      {tab === "pending" && (
        <div className="space-y-2">
          {pending.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>ไม่มีคำขอเพื่อนที่รอตอบรับ</p>
            </div>
          )}
          {pending.map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border">
              {p.requester.avatar_url
                ? <img src={p.requester.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" />
                : <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-lg">👤</div>
              }
              <div className="flex-1">
                <p className="font-medium">{p.requester.full_name}</p>
                <p className="text-xs text-gray-400">ส่งคำขอเพื่อน</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => respond(p.id, "accept")}
                  className="w-8 h-8 bg-green-500 text-white rounded-lg flex items-center justify-center">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => respond(p.id, "decline")}
                  className="w-8 h-8 bg-gray-100 text-gray-500 rounded-lg flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {/* Sent requests */}
          {sentList.length > 0 && (
            <>
              <p className="text-sm font-medium text-gray-500 pt-2">คำขอที่ส่งออก</p>
              {sentList.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border opacity-70">
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-lg">👤</div>
                  <div className="flex-1">
                    <p className="font-medium">{s.addressee?.full_name ?? "—"}</p>
                    <p className="text-xs text-gray-400">รอการตอบรับ</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Search */}
      {tab === "search" && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาด้วยชื่อ, เบอร์โทร, อีเมล"
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          {loading && <div className="text-center text-gray-400 text-sm py-4">กำลังค้นหา...</div>}
          {results.map(u => (
            <div key={u.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border">
              {u.avatar_url
                ? <img src={u.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" />
                : <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-lg">👤</div>
              }
              <div className="flex-1">
                <p className="font-medium">{u.full_name}</p>
                <p className="text-xs text-gray-400">{u.hint}</p>
              </div>
              <button onClick={() => sendRequest(u.id)}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-600 border border-green-200 rounded-lg text-sm font-medium">
                <UserPlus className="w-4 h-4" />เพิ่มเพื่อน
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

### Task 8: Chat (Messages) page

**Files:**
- Create: `web/src/app/messages/page.tsx`
- Create: `web/src/app/messages/[id]/page.tsx`
- Create: `web/src/app/messages/[id]/ChatRoom.tsx`
- Modify: sidebar — add Messages nav item

- [ ] **Step 1: Add Messages nav to sidebar**

In `activityItems` in `web/src/components/layout/sidebar.tsx`, add:
```typescript
{ key: "messages", href: "/messages", icon: Icons.MessageSquare, label: "ข้อความ" },
```

- [ ] **Step 2: Create `web/src/app/messages/page.tsx`**

```typescript
"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { MessageSquare } from "lucide-react"

interface Conv {
  id: string; type: string; name: string; avatarUrl: string | null
  updatedAt: string; lastMessage: { body: string; senderName: string; createdAt: string } | null
}

export default function MessagesPage() {
  const [convs, setConvs] = useState<Conv[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/conversations").then(r => r.json()).then(j => {
      setConvs(j.conversations ?? [])
      setLoading(false)
    })
  }, [])

  return (
    <div className="max-w-2xl mx-auto py-6 px-4">
      <h1 className="text-2xl font-bold mb-4">ข้อความ</h1>
      {loading && <div className="text-gray-400 text-sm text-center py-8">กำลังโหลด...</div>}
      {!loading && convs.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p>ยังไม่มีการสนทนา</p>
          <Link href="/social/friends" className="mt-4 inline-block text-green-600 text-sm">ค้นหาเพื่อนเพื่อเริ่มแชท →</Link>
        </div>
      )}
      <div className="space-y-2">
        {convs.map(c => (
          <Link key={c.id} href={`/messages/${c.id}`}
            className="flex items-center gap-3 p-4 bg-white rounded-xl border hover:border-gray-300 transition-colors">
            {c.avatarUrl
              ? <img src={c.avatarUrl} className="w-12 h-12 rounded-full object-cover" alt="" />
              : <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-bold text-lg">
                  {c.name?.[0] ?? "?"}
                </div>
            }
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{c.name}</p>
              {c.lastMessage && (
                <p className="text-sm text-gray-400 truncate">
                  {c.lastMessage.senderName ? `${c.lastMessage.senderName}: ` : ""}{c.lastMessage.body}
                </p>
              )}
            </div>
            {c.updatedAt && (
              <span className="text-xs text-gray-400 whitespace-nowrap">
                {new Date(c.updatedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `web/src/app/messages/[id]/ChatRoom.tsx`** — Realtime chat room

```typescript
"use client"
import { useEffect, useRef, useState, useCallback } from "react"
import { createClient } from "@supabase/supabase-js"
import { Send, Image as ImageIcon, ArrowLeft, DollarSign } from "lucide-react"
import Link from "next/link"

const sbClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

interface Message {
  id: string; body: string | null; msg_type: string
  created_at: string; attachment_url: string | null; meta: any
  sender: { id: string; full_name: string; avatar_url: string | null }
}

export default function ChatRoom({ convId, currentUserId }: { convId: string; currentUserId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState("")
  const [sending, setSending]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function loadMessages() {
    const res = await fetch(`/api/conversations/${convId}/messages?limit=50`)
    const json = await res.json()
    setMessages(json.messages ?? [])
  }

  useEffect(() => {
    loadMessages()
    const channel = sbClient.channel(`conv:${convId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages",
        filter: `conversation_id=eq.${convId}` }, payload => {
        setMessages(prev => [...prev, payload.new as any])
      })
      .subscribe()
    return () => { sbClient.removeChannel(channel) }
  }, [convId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send() {
    if (!input.trim() || sending) return
    setSending(true)
    const body = input.trim()
    setInput("")
    await fetch(`/api/conversations/${convId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    })
    setSending(false)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-white">
        <Link href="/messages" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <p className="font-semibold">การสนทนา</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
        {messages.map(m => {
          const isMe = m.sender?.id === currentUserId
          return (
            <div key={m.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
              {!isMe && (
                m.sender?.avatar_url
                  ? <img src={m.sender.avatar_url} className="w-8 h-8 rounded-full object-cover flex-shrink-0" alt="" />
                  : <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
              )}
              <div className={`max-w-[70%] ${isMe ? "items-end" : "items-start"} flex flex-col gap-1`}>
                {!isMe && <p className="text-xs text-gray-400">{m.sender?.full_name}</p>}
                {m.msg_type === "payment_request" ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2 text-amber-700">
                      <DollarSign className="w-4 h-4" />
                      <span className="font-semibold text-sm">{m.body}</span>
                    </div>
                    {!isMe && (
                      <a href={`/pay/${m.meta?.payment_request_id}`}
                        className="mt-2 block text-center text-xs bg-amber-500 text-white rounded-lg py-1.5 font-medium">
                        ดู QR Code ชำระเงิน
                      </a>
                    )}
                  </div>
                ) : (
                  <div className={`px-4 py-2 rounded-2xl text-sm ${
                    isMe ? "bg-green-600 text-white rounded-tr-sm" : "bg-white border text-gray-800 rounded-tl-sm"}`}>
                    {m.body}
                  </div>
                )}
                <p className="text-[10px] text-gray-400">
                  {new Date(m.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-3 border-t bg-white">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="พิมพ์ข้อความ..."
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
        />
        <button onClick={send} disabled={sending || !input.trim()}
          className="w-10 h-10 bg-green-600 text-white rounded-xl flex items-center justify-center disabled:opacity-50">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `web/src/app/messages/[id]/page.tsx`**

```typescript
import { createClient } from "@/lib/supabase/server"
import { redirect }     from "next/navigation"
import ChatRoom         from "./ChatRoom"

export default async function ConvPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const sb      = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect("/login")
  return <ChatRoom convId={id} currentUserId={user.id} />
}
```

---

### Task 9: Pay page (PromptPay QR display)

**Files:**
- Create: `web/src/app/pay/[id]/page.tsx`

- [ ] **Step 1: Create pay page**

```typescript
"use client"
import { useEffect, useState } from "react"
import { useParams }           from "next/navigation"
import QRCode                  from "qrcode"  // add: npm i qrcode @types/qrcode in web/

interface PayRequest {
  id: string; amount: number; description: string
  qr_payload: string | null; status: string
  requester: { full_name: string; avatar_url: string | null }
}

export default function PayPage() {
  const { id }    = useParams<{ id: string }>()
  const [req, setReq]     = useState<PayRequest | null>(null)
  const [qrUrl, setQrUrl] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/payment-requests/${id}`).then(r => r.json()).then(async j => {
      setReq(j.request)
      if (j.request?.qr_payload) {
        const url = await QRCode.toDataURL(j.request.qr_payload, { width: 240 })
        setQrUrl(url)
      }
      setLoading(false)
    })
  }, [id])

  if (loading) return <div className="flex items-center justify-center min-h-screen">กำลังโหลด...</div>
  if (!req)    return <div className="flex items-center justify-center min-h-screen text-red-500">ไม่พบรายการ</div>

  return (
    <div className="max-w-sm mx-auto py-10 px-4 text-center space-y-6">
      <div>
        <p className="text-gray-500 text-sm">ขอเงินจาก</p>
        <p className="font-semibold text-lg">{req.requester.full_name}</p>
      </div>
      <div className="bg-green-50 rounded-2xl py-6">
        <p className="text-4xl font-bold text-green-700">฿{Number(req.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p>
        {req.description && <p className="text-sm text-gray-500 mt-1">{req.description}</p>}
      </div>
      {qrUrl && (
        <div className="flex flex-col items-center gap-2">
          <img src={qrUrl} alt="PromptPay QR" className="rounded-xl shadow" />
          <p className="text-xs text-gray-400">สแกน QR ด้วยแอปธนาคาร</p>
        </div>
      )}
      {req.status === "paid" && (
        <div className="bg-green-100 text-green-700 rounded-xl py-3 font-semibold">✅ ชำระเงินแล้ว</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Install qrcode in web/**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
npm install qrcode @types/qrcode
```

---

## Phase 3 — LIFF Social Pages

### Task 10: LIFF Friends page

**Files:**
- Create: `web/src/app/liff/friends/page.tsx`
- Create: `web/src/app/api/liff/friends/route.ts`

- [ ] **Step 1: Write `web/src/app/api/liff/friends/route.ts`**

Same as web friends API but uses `resolveConn` pattern (lineUserId → user_id):

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

async function resolveUser(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections")
    .select("user_id").eq("line_user_id", lineUserId).maybeSingle()
  return data?.user_id ?? null
}

// GET /api/liff/friends?lineUserId=X
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin  = createAdminClient()
  const userId = await resolveUser(admin, lineUserId)
  if (!userId)  return NextResponse.json({ needsConnect: true, friends: [] })

  const [{ data: accepted }, { data: pending }] = await Promise.all([
    admin.from("friendships")
      .select("id, source, requester:requester_id(id,full_name,avatar_url), addressee:addressee_id(id,full_name,avatar_url)")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    admin.from("friendships")
      .select("id, requester:requester_id(id,full_name,avatar_url)")
      .eq("status", "pending").eq("addressee_id", userId),
  ])

  const friends = (accepted ?? []).map((f: any) => ({
    friendshipId: f.id,
    friend: f.requester_id === userId ? f.addressee : f.requester,
  }))

  return NextResponse.json({ friends, pending: pending ?? [] })
}

// POST /api/liff/friends — { lineUserId, addresseeId, action: 'add'|'accept'|'decline' }
export async function POST(req: NextRequest) {
  const { lineUserId, addresseeId, action, friendshipId } = await req.json()
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })

  const admin  = createAdminClient()
  const userId = await resolveUser(admin, lineUserId)
  if (!userId)  return NextResponse.json({ needsConnect: true }, { status: 403 })

  if (action === "add") {
    const { error } = await admin.from("friendships").insert({
      requester_id: userId, addressee_id: addresseeId, source: "search"
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  } else if (action === "accept" && friendshipId) {
    await admin.from("friendships").update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", friendshipId).eq("addressee_id", userId)
  } else if (action === "decline" && friendshipId) {
    await admin.from("friendships").delete().eq("id", friendshipId).eq("addressee_id", userId)
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Write `web/src/app/liff/friends/page.tsx`** (compact LIFF version matching other LIFF pages pattern)

```typescript
"use client"
import { useEffect, useState } from "react"
import { Loader2, AlertCircle, UserPlus, Check, X, Search, Users } from "lucide-react"

type AuthStatus = "checking"|"outsideLine"|"needLogin"|"ready"|"authError"
interface Friend { friendshipId: string; friend: { id: string; full_name: string; avatar_url: string | null } }
interface Pending { id: string; requester: { id: string; full_name: string; avatar_url: string | null } }

export default function LiffFriendsPage() {
  const [status, setStatus] = useState<AuthStatus>("checking")
  const [lineUserId, setLineUserId] = useState("")
  const [tab, setTab]   = useState<"friends"|"search"|"pending">("friends")
  const [friends, setFriends]   = useState<Friend[]>([])
  const [pending, setPending]   = useState<Pending[]>([])
  const [query, setQuery]       = useState("")
  const [results, setResults]   = useState<any[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  useEffect(() => { initLiff() }, [])

  async function initLiff() {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) { setStatus("authError"); return }
    try {
      const { default: liff } = await import("@line/liff")
      await liff.init({ liffId })
      if (!liff.isInClient()) { setStatus("outsideLine"); return }
      if (!liff.isLoggedIn()) { setStatus("needLogin"); return }
      const p = await liff.getProfile()
      setLineUserId(p.userId)
      setStatus("ready")
      await loadFriends(p.userId)
    } catch { setStatus("authError") }
  }

  async function loadFriends(uid: string) {
    const res = await fetch(`/api/liff/friends?lineUserId=${uid}`)
    const j   = await res.json()
    setFriends(j.friends ?? [])
    setPending(j.pending ?? [])
  }

  async function doSearch(q: string) {
    if (q.length < 2) { setResults([]); return }
    setSearchLoading(true)
    const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`)
    const j   = await res.json()
    setResults(j.users ?? [])
    setSearchLoading(false)
  }

  useEffect(() => {
    const t = setTimeout(() => doSearch(query), 400)
    return () => clearTimeout(t)
  }, [query])

  async function addFriend(addresseeId: string) {
    await fetch("/api/liff/friends", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ lineUserId, addresseeId, action: "add" }) })
    setResults(r => r.filter(u => u.id !== addresseeId))
  }

  async function respond(friendshipId: string, action: "accept"|"decline") {
    await fetch("/api/liff/friends", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ lineUserId, friendshipId, action }) })
    await loadFriends(lineUserId)
  }

  if (status === "checking") return <div className="flex flex-col items-center justify-center min-h-screen gap-3"><Loader2 className="w-8 h-8 text-green-500 animate-spin" /><p className="text-sm text-gray-500">กำลังโหลด...</p></div>
  if (status === "outsideLine") return <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center"><AlertCircle className="w-12 h-12 text-amber-500" /><p>เปิดใน LINE เท่านั้น</p></div>

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="bg-white border-b px-4 py-4">
        <h1 className="text-xl font-bold">เพื่อน</h1>
      </div>

      <div className="px-4 py-3 flex gap-1 bg-white border-b">
        {(["friends","pending","search"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium ${tab===t?"bg-green-500 text-white":"text-gray-500"}`}>
            {t==="friends"?`เพื่อน(${friends.length})`:t==="pending"?`รอตอบ(${pending.length})`:"ค้นหา"}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-3">
        {tab === "friends" && (friends.length === 0
          ? <div className="text-center py-8 text-gray-400"><Users className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>ยังไม่มีเพื่อน</p></div>
          : friends.map(f => (
            <div key={f.friendshipId} className="flex items-center gap-3 p-3 bg-white rounded-xl">
              {f.friend.avatar_url ? <img src={f.friend.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" /> : <div className="w-10 h-10 rounded-full bg-gray-200" />}
              <p className="flex-1 font-medium">{f.friend.full_name}</p>
            </div>
          ))
        )}
        {tab === "pending" && (pending.length === 0
          ? <div className="text-center py-8 text-gray-400">ไม่มีคำขอรอตอบ</div>
          : pending.map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3 bg-white rounded-xl">
              {p.requester.avatar_url ? <img src={p.requester.avatar_url} className="w-10 h-10 rounded-full" alt="" /> : <div className="w-10 h-10 rounded-full bg-gray-200" />}
              <p className="flex-1 font-medium">{p.requester.full_name}</p>
              <button onClick={() => respond(p.id,"accept")} className="w-8 h-8 bg-green-500 text-white rounded-lg flex items-center justify-center"><Check className="w-4 h-4" /></button>
              <button onClick={() => respond(p.id,"decline")} className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
          ))
        )}
        {tab === "search" && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="ชื่อ / เบอร์ / อีเมล"
                className="w-full pl-10 pr-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 text-sm" />
            </div>
            {searchLoading && <div className="text-center text-gray-400 text-sm">ค้นหา...</div>}
            {results.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 bg-white rounded-xl">
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">👤</div>
                <div className="flex-1"><p className="font-medium">{u.full_name}</p><p className="text-xs text-gray-400">{u.hint}</p></div>
                <button onClick={() => addFriend(u.id)} className="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-sm font-medium flex items-center gap-1"><UserPlus className="w-3 h-3" />เพิ่ม</button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
```

---

### Task 11: LIFF Chat page

**Files:**
- Create: `web/src/app/liff/chat/page.tsx`
- Create: `web/src/app/api/liff/chat/route.ts`

- [ ] **Step 1: Write `web/src/app/api/liff/chat/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

async function resolveUser(admin: ReturnType<typeof createAdminClient>, lineUserId: string) {
  const { data } = await admin.from("line_connections").select("user_id").eq("line_user_id", lineUserId).maybeSingle()
  return data?.user_id ?? null
}

// GET /api/liff/chat?lineUserId=X — list conversations
export async function GET(req: NextRequest) {
  const lineUserId = req.nextUrl.searchParams.get("lineUserId")
  if (!lineUserId) return NextResponse.json({ error: "lineUserId required" }, { status: 400 })
  const admin  = createAdminClient()
  const userId = await resolveUser(admin, lineUserId)
  if (!userId)  return NextResponse.json({ needsConnect: true, conversations: [] })

  const { data: memberships } = await admin.from("conversation_members")
    .select("conversation_id, conversations(id,type,name,updated_at)")
    .eq("user_id", userId).limit(30)

  const convIds = (memberships ?? []).map((m: any) => m.conversation_id)
  if (!convIds.length) return NextResponse.json({ conversations: [] })

  const { data: lastMsgs } = await admin.from("messages")
    .select("conversation_id, body, created_at").in("conversation_id", convIds)
    .order("created_at", { ascending: false })

  const lastMap: Record<string, string> = {}
  for (const m of lastMsgs ?? []) {
    if (!lastMap[m.conversation_id]) lastMap[m.conversation_id] = m.body ?? ""
  }

  const conversations = (memberships ?? []).map((m: any) => ({
    id: m.conversation_id,
    name: m.conversations?.name ?? "การสนทนา",
    lastMessage: lastMap[m.conversation_id] ?? "",
    updatedAt: m.conversations?.updated_at,
  }))

  return NextResponse.json({ conversations, userId })
}

// POST /api/liff/chat — send message { lineUserId, conversationId, body }
export async function POST(req: NextRequest) {
  const { lineUserId, conversationId, body } = await req.json()
  if (!lineUserId || !conversationId || !body)
    return NextResponse.json({ error: "lineUserId, conversationId, body required" }, { status: 400 })

  const admin  = createAdminClient()
  const userId = await resolveUser(admin, lineUserId)
  if (!userId)  return NextResponse.json({ needsConnect: true }, { status: 403 })

  await Promise.all([
    admin.from("messages").insert({ conversation_id: conversationId, sender_id: userId, body, msg_type: "text" }),
    admin.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId),
  ])
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Write `web/src/app/liff/chat/page.tsx`** — LIFF chat list + simple room

```typescript
"use client"
import { useEffect, useState, useRef } from "react"
import { Loader2, AlertCircle, Send, ArrowLeft, MessageSquare } from "lucide-react"
import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

type AuthStatus = "checking"|"outsideLine"|"ready"|"authError"
interface Conv { id: string; name: string; lastMessage: string; updatedAt: string }
interface Msg  { id: string; body: string; sender_id: string; created_at: string }

export default function LiffChatPage() {
  const [status, setStatus]   = useState<AuthStatus>("checking")
  const [lineUserId, setLUID] = useState("")
  const [userId, setUserId]   = useState("")
  const [convs, setConvs]     = useState<Conv[]>([])
  const [activeConv, setActiveConv] = useState<Conv | null>(null)
  const [msgs, setMsgs]       = useState<Msg[]>([])
  const [input, setInput]     = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { initLiff() }, [])

  async function initLiff() {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) { setStatus("authError"); return }
    try {
      const { default: liff } = await import("@line/liff")
      await liff.init({ liffId })
      if (!liff.isInClient()) { setStatus("outsideLine"); return }
      const p = await liff.getProfile()
      setLUID(p.userId)
      setStatus("ready")
      await loadConvs(p.userId)
    } catch { setStatus("authError") }
  }

  async function loadConvs(uid: string) {
    const res = await fetch(`/api/liff/chat?lineUserId=${uid}`)
    const j   = await res.json()
    setConvs(j.conversations ?? [])
    setUserId(j.userId ?? "")
  }

  async function openConv(conv: Conv) {
    setActiveConv(conv)
    const res = await fetch(`/api/conversations/${conv.id}/messages?limit=40`)
    const j   = await res.json()
    setMsgs(j.messages ?? [])

    const ch = sb.channel(`liff-conv:${conv.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages",
        filter: `conversation_id=eq.${conv.id}` }, p => {
        setMsgs(prev => [...prev, p.new as Msg])
      }).subscribe()
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs])

  async function send() {
    if (!input.trim() || !activeConv) return
    const body = input.trim(); setInput("")
    await fetch("/api/liff/chat", { method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ lineUserId, conversationId: activeConv.id, body }) })
  }

  if (status === "checking") return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 text-green-500 animate-spin" /></div>
  if (status === "outsideLine") return <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center"><AlertCircle className="w-12 h-12 text-amber-500" /><p>เปิดใน LINE เท่านั้น</p></div>

  if (activeConv) return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => setActiveConv(null)}><ArrowLeft className="w-5 h-5 text-gray-500" /></button>
        <p className="font-semibold">{activeConv.name}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {msgs.map(m => {
          const isMe = m.sender_id === userId
          return (
            <div key={m.id} className={`flex ${isMe?"justify-end":"justify-start"}`}>
              <div className={`max-w-[75%] px-4 py-2 rounded-2xl text-sm ${isMe?"bg-green-600 text-white":"bg-white border"}`}>
                {m.body}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-center gap-2 px-4 py-3 border-t bg-white">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="พิมพ์ข้อความ..."
          className="flex-1 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        <button onClick={send} className="w-10 h-10 bg-green-600 text-white rounded-xl flex items-center justify-center">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4"><h1 className="text-xl font-bold">ข้อความ</h1></div>
      <div className="px-4 py-4 space-y-2">
        {convs.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>ยังไม่มีการสนทนา</p>
          </div>
        )}
        {convs.map(c => (
          <button key={c.id} onClick={() => openConv(c)}
            className="w-full flex items-center gap-3 p-3 bg-white rounded-xl text-left">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-bold">
              {c.name?.[0] ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{c.name}</p>
              <p className="text-xs text-gray-400 truncate">{c.lastMessage}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

---

## Phase 4 — Mobile (Expo React Native)

### Task 12: Mobile social store + screens

**Files:**
- Create: `mobile/src/store/social.store.ts`
- Create: `mobile/src/app/(app)/friends/index.tsx`
- Create: `mobile/src/app/(app)/messages/index.tsx`
- Create: `mobile/src/app/(app)/messages/[id].tsx`
- Modify: `mobile/src/app/(app)/_layout.tsx` — add Friends + Messages tabs

- [ ] **Step 1: Write social store `mobile/src/store/social.store.ts`**

```typescript
import { create } from "zustand"
import { supabase } from "@/lib/supabase"
import { useAuthStore } from "./auth.store"

interface Friend {
  friendshipId: string
  friend: { id: string; full_name: string | null; avatar_url: string | null }
}
interface Conversation {
  id: string; name: string; avatarUrl: string | null
  lastMessage: string; updatedAt: string
}

interface SocialState {
  friends:       Friend[]
  pendingReqs:   any[]
  conversations: Conversation[]
  loadFriends:   () => Promise<void>
  loadConvs:     () => Promise<void>
  sendFriendReq: (addresseeId: string) => Promise<void>
  respondFriend: (id: string, action: "accept"|"decline") => Promise<void>
}

export const useSocialStore = create<SocialState>((set, get) => ({
  friends: [], pendingReqs: [], conversations: [],

  loadFriends: async () => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    const [{ data: accepted }, { data: pending }] = await Promise.all([
      supabase.from("friendships")
        .select("id, source, requester:requester_id(id,full_name,avatar_url), addressee:addressee_id(id,full_name,avatar_url)")
        .eq("status", "accepted")
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`),
      supabase.from("friendships")
        .select("id, requester:requester_id(id,full_name,avatar_url)")
        .eq("status", "pending").eq("addressee_id", uid),
    ])
    const friends = (accepted ?? []).map((f: any) => ({
      friendshipId: f.id,
      friend: f.requester_id === uid ? f.addressee : f.requester,
    }))
    set({ friends, pendingReqs: pending ?? [] })
  },

  loadConvs: async () => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    const { data } = await supabase.from("conversation_members")
      .select("conversation_id, conversations(id,type,name,updated_at)")
      .eq("user_id", uid).order("conversations(updated_at)", { ascending: false }).limit(30)
    const conversations = (data ?? []).map((m: any) => ({
      id: m.conversation_id,
      name: m.conversations?.name ?? "การสนทนา",
      avatarUrl: null,
      lastMessage: "",
      updatedAt: m.conversations?.updated_at ?? "",
    }))
    set({ conversations })
  },

  sendFriendReq: async (addresseeId) => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    await supabase.from("friendships").insert({ requester_id: uid, addressee_id: addresseeId, source: "search" })
    await get().loadFriends()
  },

  respondFriend: async (id, action) => {
    if (action === "accept") {
      await supabase.from("friendships").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", id)
    } else {
      await supabase.from("friendships").delete().eq("id", id)
    }
    await get().loadFriends()
  },
}))
```

- [ ] **Step 2: Write `mobile/src/app/(app)/friends/index.tsx`**

```typescript
import React, { useEffect, useState } from "react"
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, Image, ActivityIndicator } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useSocialStore } from "@/store/social.store"
import { supabase } from "@/lib/supabase"
import { Brand, Light } from "@/constants/colors"

type Tab = "friends"|"pending"|"search"

export default function FriendsScreen() {
  const { friends, pendingReqs, loadFriends, respondFriend, sendFriendReq } = useSocialStore()
  const [tab, setTab]     = useState<Tab>("friends")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => { loadFriends() }, [loadFriends])

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.from("users")
        .select("id, full_name, avatar_url").ilike("full_name", `%${query}%`).limit(20)
      setResults(data ?? [])
      setSearching(false)
    }, 400)
    return () => clearTimeout(t)
  }, [query])

  const TABS: { key: Tab; label: string }[] = [
    { key: "friends", label: `เพื่อน (${friends.length})` },
    { key: "pending", label: `รอตอบ (${pendingReqs.length})` },
    { key: "search",  label: "ค้นหา" },
  ]

  return (
    <SafeAreaView style={s.container}>
      <Text style={s.title}>เพื่อน</Text>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[s.tabBtn, tab===t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabLabel, tab===t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Friends */}
      {tab === "friends" && (
        <FlatList data={friends} keyExtractor={f => f.friendshipId} contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={s.empty}>ยังไม่มีเพื่อน</Text>}
          renderItem={({ item: f }) => (
            <View style={s.card}>
              {f.friend.avatar_url ? <Image source={{ uri: f.friend.avatar_url }} style={s.avatar} /> : <View style={[s.avatar, s.avatarFb]}><Text>👤</Text></View>}
              <Text style={s.name}>{f.friend.full_name ?? "—"}</Text>
            </View>
          )}
        />
      )}

      {/* Pending */}
      {tab === "pending" && (
        <FlatList data={pendingReqs} keyExtractor={p => p.id} contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={s.empty}>ไม่มีคำขอรอตอบรับ</Text>}
          renderItem={({ item: p }) => (
            <View style={s.card}>
              <View style={[s.avatar, s.avatarFb]}><Text>👤</Text></View>
              <Text style={[s.name, { flex: 1 }]}>{p.requester?.full_name ?? "—"}</Text>
              <TouchableOpacity style={s.btnGreen} onPress={() => respondFriend(p.id,"accept")}><Text style={s.btnGreenTxt}>✓</Text></TouchableOpacity>
              <TouchableOpacity style={s.btnGray}  onPress={() => respondFriend(p.id,"decline")}><Text>✕</Text></TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Search */}
      {tab === "search" && (
        <View style={{ flex: 1 }}>
          <View style={s.searchBar}>
            <TextInput value={query} onChangeText={setQuery} placeholder="ค้นหาชื่อผู้ใช้..." style={s.searchInput} />
          </View>
          {searching && <ActivityIndicator style={{ marginTop: 20 }} color={Brand[500]} />}
          <FlatList data={results} keyExtractor={u => u.id} contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item: u }) => (
              <View style={s.card}>
                <View style={[s.avatar, s.avatarFb]}><Text>👤</Text></View>
                <Text style={[s.name, { flex: 1 }]}>{u.full_name}</Text>
                <TouchableOpacity style={s.btnGreen} onPress={() => sendFriendReq(u.id)}><Text style={s.btnGreenTxt}>+เพื่อน</Text></TouchableOpacity>
              </View>
            )}
          />
        </View>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Light.background },
  title:     { fontSize: 22, fontWeight: "800", color: Light.foreground, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  tabBar:    { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 4 },
  tabBtn:    { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: Light.muted, alignItems: "center" },
  tabActive: { backgroundColor: Brand[500] },
  tabLabel:  { fontSize: 12, fontWeight: "600", color: Light.mutedFg },
  tabLabelActive: { color: "#fff" },
  card:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Light.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: Light.border },
  avatar:    { width: 44, height: 44, borderRadius: 22 },
  avatarFb:  { backgroundColor: "#e5e7eb", alignItems: "center", justifyContent: "center" },
  name:      { fontSize: 15, fontWeight: "600", color: Light.foreground },
  empty:     { textAlign: "center", color: Light.mutedFg, marginTop: 40 },
  btnGreen:  { backgroundColor: Brand[500], paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  btnGreenTxt: { color: "#fff", fontSize: 12, fontWeight: "700" },
  btnGray:   { backgroundColor: Light.muted, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  searchBar: { paddingHorizontal: 16, paddingVertical: 8 },
  searchInput: { backgroundColor: Light.card, borderWidth: 1, borderColor: Light.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
})
```

- [ ] **Step 3: Write `mobile/src/app/(app)/messages/index.tsx`**

```typescript
import React, { useEffect } from "react"
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter }    from "expo-router"
import { useSocialStore } from "@/store/social.store"
import { Light, Brand } from "@/constants/colors"

export default function MessagesScreen() {
  const { conversations, loadConvs } = useSocialStore()
  const router = useRouter()

  useEffect(() => { loadConvs() }, [loadConvs])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>
      <Text style={ms.title}>ข้อความ</Text>
      <FlatList data={conversations} keyExtractor={c => c.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={<Text style={ms.empty}>ยังไม่มีการสนทนา</Text>}
        renderItem={({ item: c }) => (
          <TouchableOpacity style={ms.card} onPress={() => router.push(`/messages/${c.id}`)}>
            <View style={ms.avatar}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>{c.name?.[0] ?? "?"}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={ms.name}>{c.name}</Text>
              <Text style={ms.last} numberOfLines={1}>{c.lastMessage || "ยังไม่มีข้อความ"}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  )
}

const ms = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: Light.foreground, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  card:  { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Light.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: Light.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Brand[500], alignItems: "center", justifyContent: "center" },
  name:  { fontSize: 15, fontWeight: "600", color: Light.foreground },
  last:  { fontSize: 13, color: Light.mutedFg, marginTop: 2 },
  empty: { textAlign: "center", color: Light.mutedFg, marginTop: 40 },
})
```

- [ ] **Step 4: Write `mobile/src/app/(app)/messages/[id].tsx`** — Realtime chat room

```typescript
import React, { useEffect, useRef, useState } from "react"
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useLocalSearchParams, useRouter } from "expo-router"
import { supabase } from "@/lib/supabase"
import { useAuthStore } from "@/store/auth.store"
import { Brand, Light } from "@/constants/colors"

interface Msg { id: string; body: string | null; sender_id: string; created_at: string; msg_type: string }

export default function ChatRoomScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>()
  const router   = useRouter()
  const user     = useAuthStore(s => s.user)
  const [msgs, setMsgs]   = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const listRef = useRef<FlatList>(null)

  useEffect(() => {
    supabase.from("messages").select("id,body,sender_id,created_at,msg_type")
      .eq("conversation_id", id).order("created_at", { ascending: true }).limit(50)
      .then(({ data }) => { setMsgs(data ?? []); scrollBottom() })

    const ch = supabase.channel(`mobile-conv:${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages",
        filter: `conversation_id=eq.${id}` }, p => {
        setMsgs(prev => [...prev, p.new as Msg])
        scrollBottom()
      }).subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [id])

  function scrollBottom() { setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100) }

  async function send() {
    if (!input.trim() || !user) return
    const body = input.trim(); setInput("")
    await supabase.from("messages").insert({ conversation_id: id, sender_id: user.id, body, msg_type: "text" })
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>
      {/* Header */}
      <View style={cr.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Text style={{ fontSize: 20 }}>←</Text>
        </TouchableOpacity>
        <Text style={cr.headerTitle}>การสนทนา</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList ref={listRef} data={msgs} keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item: m }) => {
            const isMe = m.sender_id === user?.id
            return (
              <View style={{ alignItems: isMe ? "flex-end" : "flex-start" }}>
                <View style={[cr.bubble, isMe ? cr.bubbleMe : cr.bubbleThem]}>
                  <Text style={[cr.bubbleTxt, isMe && { color: "#fff" }]}>{m.body}</Text>
                </View>
                <Text style={cr.time}>{new Date(m.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</Text>
              </View>
            )
          }}
        />
        <View style={cr.inputRow}>
          <TextInput value={input} onChangeText={setInput} onSubmitEditing={send}
            placeholder="พิมพ์ข้อความ..." style={cr.input} returnKeyType="send" />
          <TouchableOpacity style={cr.sendBtn} onPress={send}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>ส่ง</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const cr = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: Light.border, backgroundColor: Light.card },
  headerTitle: { fontSize: 16, fontWeight: "700", color: Light.foreground },
  bubble:      { maxWidth: "75%", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  bubbleMe:    { backgroundColor: Brand[500], borderBottomRightRadius: 4 },
  bubbleThem:  { backgroundColor: Light.card, borderWidth: 1, borderColor: Light.border, borderBottomLeftRadius: 4 },
  bubbleTxt:   { fontSize: 14, color: Light.foreground },
  time:        { fontSize: 10, color: Light.mutedFg, marginTop: 2 },
  inputRow:    { flexDirection: "row", gap: 8, padding: 12, borderTopWidth: 1, borderColor: Light.border, backgroundColor: Light.card },
  input:       { flex: 1, backgroundColor: Light.background, borderWidth: 1, borderColor: Light.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  sendBtn:     { backgroundColor: Brand[500], paddingHorizontal: 16, borderRadius: 12, justifyContent: "center" },
})
```

- [ ] **Step 5: Update mobile tab layout** — add Friends + Messages tabs

In `mobile/src/app/(app)/_layout.tsx`, add after Analytics tab:

```typescript
<Tabs.Screen
  name="friends/index"
  options={{ title: 'เพื่อน', tabBarIcon: ({ focused }) => <TabIcon name="friends" focused={focused} emoji="👥" /> }}
/>
<Tabs.Screen
  name="messages/index"
  options={{ title: 'ข้อความ', tabBarIcon: ({ focused }) => <TabIcon name="messages" focused={focused} emoji="💬" /> }}
/>
```

Also add nested stack screen config for messages/[id] — add in root `_layout.tsx`:
```typescript
<Stack.Screen name="(app)/messages/[id]" options={{ headerShown: false, animation: "slide_from_right" }} />
```

---

### Task 13: Mobile payment screen

**Files:**
- Create: `mobile/src/app/(app)/pay/[id].tsx`

- [ ] **Step 1: Write `mobile/src/app/(app)/pay/[id].tsx`**

```typescript
import React, { useEffect, useState } from "react"
import { View, Text, Image, ActivityIndicator, TouchableOpacity, StyleSheet, Share, ScrollView } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useLocalSearchParams, useRouter } from "expo-router"
import { supabase } from "@/lib/supabase"
import { Brand, Light } from "@/constants/colors"

// PromptPay QR via external service — in prod use local generatePromptPayQR port to RN
async function fetchQrDataUrl(qrPayload: string): Promise<string> {
  // Use qrserver.com as fallback for RN (no canvas API)
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrPayload)}&size=240x240&format=png`
}

export default function PayScreen() {
  const { id }     = useLocalSearchParams<{ id: string }>()
  const router     = useRouter()
  const [req, setReq]   = useState<any>(null)
  const [qrUri, setQrUri] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from("payment_requests")
      .select("*, requester:requester_id(id,full_name,avatar_url)")
      .eq("id", id).maybeSingle()
      .then(async ({ data }) => {
        setReq(data)
        if (data?.qr_payload) setQrUri(await fetchQrDataUrl(data.qr_payload))
        setLoading(false)
      })
  }, [id])

  if (loading) return <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}><ActivityIndicator color={Brand[500]} size="large" /></View>
  if (!req)   return <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}><Text>ไม่พบรายการ</Text></View>

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>
      <ScrollView contentContainerStyle={pay.container}>
        <TouchableOpacity onPress={() => router.back()} style={{ alignSelf: "flex-start" }}>
          <Text style={{ fontSize: 24 }}>←</Text>
        </TouchableOpacity>

        <View style={pay.requesterCard}>
          <Text style={pay.label}>ขอเงินจาก</Text>
          <Text style={pay.requesterName}>{req.requester?.full_name ?? "—"}</Text>
        </View>

        <View style={pay.amountCard}>
          <Text style={pay.amountLabel}>฿{Number(req.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</Text>
          {req.description && <Text style={pay.desc}>{req.description}</Text>}
        </View>

        {qrUri ? (
          <View style={pay.qrBox}>
            <Image source={{ uri: qrUri }} style={{ width: 240, height: 240 }} />
            <Text style={pay.qrHint}>สแกน QR ด้วยแอปธนาคาร</Text>
          </View>
        ) : (
          <Text style={{ color: Light.mutedFg, textAlign: "center" }}>ไม่มี QR Code (ผู้รับยังไม่ตั้งค่า PromptPay)</Text>
        )}

        {req.status === "paid" && (
          <View style={pay.paidBadge}><Text style={{ color: "#065f46", fontWeight: "700" }}>✅ ชำระเงินแล้ว</Text></View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const pay = StyleSheet.create({
  container:     { padding: 24, gap: 20, alignItems: "center" },
  requesterCard: { alignItems: "center" },
  label:         { fontSize: 13, color: Light.mutedFg },
  requesterName: { fontSize: 18, fontWeight: "700", color: Light.foreground, marginTop: 4 },
  amountCard:    { backgroundColor: "#d1fae5", borderRadius: 20, paddingVertical: 24, paddingHorizontal: 40, alignItems: "center" },
  amountLabel:   { fontSize: 36, fontWeight: "900", color: "#065f46" },
  desc:          { fontSize: 13, color: "#047857", marginTop: 4 },
  qrBox:         { alignItems: "center", gap: 8 },
  qrHint:        { fontSize: 12, color: Light.mutedFg },
  paidBadge:     { backgroundColor: "#d1fae5", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24 },
})
```

---

## Phase 5 — Join invite link page

### Task 14: Web join page

**Files:**
- Create: `web/src/app/friends/join/[token]/page.tsx`

- [ ] **Step 1: Create**

```typescript
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient }      from "@/lib/supabase/server"
import { redirect }          from "next/navigation"

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const sb    = await createClient()
  const { data: { user } } = await sb.auth.getUser()

  const { data: link } = await admin.from("friend_invite_links")
    .select("user_id, expires_at, used_count").eq("token", token).maybeSingle()

  if (!link || new Date(link.expires_at) < new Date()) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-red-500">ลิงก์หมดอายุหรือไม่ถูกต้อง</p></div>
  }

  if (!user) redirect(`/login?next=/friends/join/${token}`)

  if (user.id !== link.user_id) {
    // Insert friendship request
    await admin.from("friendships").upsert({
      requester_id: user.id, addressee_id: link.user_id, status: "accepted", source: "qr_scan",
    }, { onConflict: "requester_id,addressee_id" })
    await admin.from("friend_invite_links").update({ used_count: link.used_count + 1 }).eq("token", token)
  }

  redirect("/social/friends?joined=1")
}
```

---

## Phase 6 — Type check & verify

### Task 15: TypeScript check all platforms

- [ ] **Step 1: Check web**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/web
npx tsc --noEmit 2>&1 | head -40
```

Expected: 0 errors.

- [ ] **Step 2: Check mobile**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy/mobile
npx tsc --noEmit 2>&1 | head -40
```

Expected: 0 errors.

- [ ] **Step 3: Verify all migrations applied**

```bash
cd /Users/chainimitsakhorn/Documents/Project/Slippy
npx supabase migration list 2>/dev/null | tail -5
```

Expected: 052, 053, 054 present.

---

## UAT Checklist

### Friend System
- [ ] ค้นหาผู้ใช้ด้วยชื่อ → พบผลลัพธ์ (masked)
- [ ] ส่งคำขอเพื่อน → เห็นใน pending ของอีกฝ่าย
- [ ] ตอบรับ → เห็นในรายการเพื่อน ทั้ง Web และ Mobile
- [ ] ปฏิเสธ → หายออกจาก pending
- [ ] Invite link → คลิกแล้ว auto-accept

### Chat
- [ ] สร้าง conversation กับเพื่อน
- [ ] พิมพ์ข้อความ → เห็น Realtime บนอีกหน้าต่าง
- [ ] LIFF chat แสดงรายการ conversation
- [ ] Mobile: กด conversation → เข้า room → ส่งข้อความ → Realtime

### Payment
- [ ] สร้าง payment_request → ได้รับ QR payload
- [ ] หน้า /pay/[id] แสดง QR Code ถูกต้อง
- [ ] ส่ง payment_request ใน conversation → เห็นเป็น message ประเภท payment_request
- [ ] กด mark_paid → status เปลี่ยนเป็น paid
