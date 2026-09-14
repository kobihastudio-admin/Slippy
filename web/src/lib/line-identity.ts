/**
 * Shared LINE ↔ Slippy account-resolution logic.
 *
 * Used by all three LINE entry points so they stay consistent:
 *   - /api/auth/line/callback  (LINE Login button on /login)
 *   - /api/auth/liff           (LIFF Rich Menu bridge)
 *   - /api/line/connect-callback (Settings → "เชื่อมต่อ LINE")
 *
 * Resolution order for `resolveOrCreateLineUser`:
 *   1. `line_connections` row for this `line_user_id` (covers accounts that
 *      were connected later via Settings — those don't have
 *      `user_metadata.line_user_id` set)
 *   2. `user_metadata.line_user_id` match (covers accounts created directly
 *      via LINE Login / LIFF)
 *   3. Otherwise create a brand-new account
 *
 * `ensureLineLinkage` guarantees a brand-new LINE-only account always ends
 * up with a personal organization + a `line_connections` row, so LIFF
 * pillar pages (which require an org) work immediately after first login.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { slugify }     from "@/lib/utils"
import { getDocQuota } from "@/lib/plans"

const PLACEHOLDER_EMAIL_DOMAINS = ["@noreply.slippy.app", "@line.slippy.app"]

export interface LineProfile {
  lineUserId:  string
  displayName: string
  avatarUrl?:  string
  email?:      string
}

export interface ResolvedLineUser {
  userId:    string
  email:     string
  isNewUser: boolean
}

export function hasPlaceholderEmail(email?: string | null): boolean {
  return !!email && PLACEHOLDER_EMAIL_DOMAINS.some(domain => email.includes(domain))
}

/** Find a Supabase auth user whose `user_metadata.line_user_id` matches (paginated). */
export async function findUserByLineMetadata(admin: SupabaseClient, lineUserId: string) {
  let page = 1
  for (;;) {
    const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (!list?.users?.length) return null
    const found = list.users.find((u: any) => u.user_metadata?.line_user_id === lineUserId)
    if (found) return found
    if (list.users.length < 1000) return null
    page++
  }
}

/** Find the existing `line_connections` row for this LINE user, if any. */
export async function findLineConnection(admin: SupabaseClient, lineUserId: string) {
  const { data } = await admin
    .from("line_connections")
    .select("user_id, organization_id, display_name")
    .eq("line_user_id", lineUserId)
    .maybeSingle()
  return data as { user_id: string; organization_id: string; display_name: string | null } | null
}

/**
 * Find-or-create the Slippy account for a LINE profile. Shared by the
 * `/login` LINE button and the LIFF bridge so both entry points resolve to
 * the same account for a given LINE user.
 */
export async function resolveOrCreateLineUser(
  admin: SupabaseClient,
  profile: LineProfile,
): Promise<ResolvedLineUser> {
  const { lineUserId, displayName, avatarUrl, email: lineEmail } = profile

  // 1. Already linked via "เชื่อมต่อ LINE" in Settings
  const connection = await findLineConnection(admin, lineUserId)
  if (connection?.user_id) {
    const { data: existing } = await admin.auth.admin.getUserById(connection.user_id)
    if (existing?.user) {
      const user = existing.user
      let targetEmail = user.email!
      const metadataPatch: Record<string, any> = {}

      if (!user.user_metadata?.line_user_id) {
        metadataPatch.line_user_id = lineUserId
      }
      if (avatarUrl && user.user_metadata?.avatar_url !== avatarUrl) {
        metadataPatch.avatar_url = avatarUrl
      }

      const updates: Record<string, any> = {}
      if (Object.keys(metadataPatch).length) {
        updates.user_metadata = { ...user.user_metadata, ...metadataPatch }
      }
      if (lineEmail && hasPlaceholderEmail(user.email)) {
        updates.email = lineEmail
        updates.email_confirm = true
        updates.user_metadata = { ...(updates.user_metadata ?? user.user_metadata), avatar_url: avatarUrl }
        targetEmail = lineEmail
      }
      if (Object.keys(updates).length) {
        await admin.auth.admin.updateUserById(user.id, updates)
      }

      return { userId: user.id, email: targetEmail, isNewUser: false }
    }
  }

  // 2. Account created directly via LINE Login/LIFF (user_metadata.line_user_id)
  const existingUser = await findUserByLineMetadata(admin, lineUserId)
  if (existingUser) {
    let targetEmail = existingUser.email!
    if (lineEmail && hasPlaceholderEmail(existingUser.email)) {
      await admin.auth.admin.updateUserById(existingUser.id, {
        email: lineEmail, email_confirm: true,
        user_metadata: { ...existingUser.user_metadata, avatar_url: avatarUrl },
      })
      targetEmail = lineEmail
    } else if (avatarUrl && existingUser.user_metadata?.avatar_url !== avatarUrl) {
      await admin.auth.admin.updateUserById(existingUser.id, {
        user_metadata: { ...existingUser.user_metadata, avatar_url: avatarUrl },
      })
    }
    return { userId: existingUser.id, email: targetEmail, isNewUser: false }
  }

  // 3. Brand-new account
  const targetEmail = lineEmail ?? `line.${lineUserId.toLowerCase()}@noreply.slippy.app`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: targetEmail, email_confirm: true,
    user_metadata: { full_name: displayName, avatar_url: avatarUrl, line_user_id: lineUserId, provider: "line" },
  })

  if (createErr) {
    if (createErr.message.includes("already been registered") || createErr.message.includes("duplicate")) {
      const { data: byEmail } = await admin.auth.admin.listUsers({ perPage: 1000 })
      const matched = byEmail?.users?.find((u: any) => u.email === targetEmail)
      if (!matched) throw new Error("line_create_failed")
      await admin.auth.admin.updateUserById(matched.id, {
        user_metadata: { ...matched.user_metadata, line_user_id: lineUserId },
      })
      return { userId: matched.id, email: targetEmail, isNewUser: false }
    }
    throw new Error(createErr.message)
  }

  if (created?.user) {
    await admin.from("users").upsert(
      { id: created.user.id, email: targetEmail, full_name: displayName },
      { onConflict: "id" }
    )
  }

  return { userId: created!.user!.id, email: targetEmail, isNewUser: true }
}

/**
 * Ensure `userId` has an organization and a `line_connections` row for
 * `lineUserId`. If the user has no organization yet (brand-new LINE-only
 * account), auto-creates a personal one (mirrors `/api/onboarding/new-org`
 * defaults — no `tax_id`/`address`, i.e. "ส่วนตัว").
 *
 * Returns the organization id the LINE connection now points to, if any.
 */
export async function ensureLineLinkage(
  admin: SupabaseClient,
  userId: string,
  lineUserId: string,
  displayName: string,
): Promise<string | undefined> {
  let orgId: string | undefined

  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (membership?.organization_id) {
    orgId = membership.organization_id
  } else {
    const orgName = displayName.trim() || "บัญชีของฉัน"
    const slug    = slugify(orgName) + "-" + Date.now().toString(36)

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({
        name: orgName, slug, plan: "free",
        doc_quota: getDocQuota("free"), doc_used: 0, fiscal_year_end: 12,
      })
      .select("id")
      .single()

    if (!orgErr && org) {
      const { error: memberErr } = await admin
        .from("organization_members")
        .insert({ organization_id: org.id, user_id: userId, role: "owner" })

      if (memberErr) {
        await admin.from("organizations").delete().eq("id", org.id)
      } else {
        orgId = org.id
      }
    }
  }

  if (orgId) {
    await admin
      .from("line_connections")
      .upsert({
        line_user_id:    lineUserId,
        user_id:         userId,
        organization_id: orgId,
        display_name:    displayName,
      }, { onConflict: "line_user_id" })
  }

  return orgId
}

/**
 * Merge a LINE-only placeholder account (`fromUserId`, e.g.
 * `line.<id>@noreply.slippy.app`) into a real-email account (`toUserId`).
 *
 * Happens when a user logs in with LINE first (no email from LINE →
 * placeholder account + auto-created personal org), then later logs in via
 * Google/Facebook with their real email (a separate Slippy account) and
 * connects the same LINE account from Settings. Without this, the two
 * accounts would stay permanently separate because the LINE user id is
 * already tied to the placeholder account.
 *
 * Moves `organization_members` (respecting the
 * `UNIQUE(organization_id, user_id)` constraint — duplicates are dropped,
 * keeping the higher role) and `line_connections` rows to `toUserId`, copies
 * over a missing avatar, and tags `fromUserId` as merged.
 */
export async function mergeLineOnlyAccount(
  admin: SupabaseClient,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  const { data: fromMemberships } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", fromUserId)

  for (const m of fromMemberships ?? []) {
    const { data: existing } = await admin
      .from("organization_members")
      .select("id, role")
      .eq("organization_id", m.organization_id)
      .eq("user_id", toUserId)
      .maybeSingle()

    if (existing) {
      if (m.role === "owner" && existing.role !== "owner") {
        await admin.from("organization_members").update({ role: "owner" }).eq("id", existing.id)
      }
      await admin.from("organization_members")
        .delete()
        .eq("organization_id", m.organization_id)
        .eq("user_id", fromUserId)
    } else {
      await admin.from("organization_members")
        .update({ user_id: toUserId })
        .eq("organization_id", m.organization_id)
        .eq("user_id", fromUserId)
    }
  }

  await admin.from("line_connections").update({ user_id: toUserId }).eq("user_id", fromUserId)

  const { data: { user: toUser } } = await admin.auth.admin.getUserById(toUserId)
  const { data: { user: fromUser } } = await admin.auth.admin.getUserById(fromUserId)

  if (toUser && fromUser) {
    const metadataPatch: Record<string, any> = {}
    if (!toUser.user_metadata?.avatar_url && fromUser.user_metadata?.avatar_url) {
      metadataPatch.avatar_url = fromUser.user_metadata.avatar_url
    }
    if (Object.keys(metadataPatch).length) {
      await admin.auth.admin.updateUserById(toUserId, {
        user_metadata: { ...toUser.user_metadata, ...metadataPatch },
      })
    }

    // Old placeholder account: drop its line_user_id (now owned by toUserId) and
    // mark it merged so future lookups don't try to resolve through it.
    const { line_user_id, ...restMeta } = fromUser.user_metadata ?? {}
    await admin.auth.admin.updateUserById(fromUserId, {
      user_metadata: { ...restMeta, merged_into: toUserId },
    })
  }
}
