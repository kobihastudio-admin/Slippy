import { supabase } from "../lib/supabase"
import type { SyncStore } from "./line-group-sync-logic"

const LINE_API = "https://api.line.me/v2/bot"

/** Best effort: group name from the bot's own token. Rooms and failures give null; never throws. */
export async function fetchGroupName(groupId: string): Promise<string | null> {
  try {
    const t = process.env.LINE_CHANNEL_ACCESS_TOKEN
    if (!t) return null
    const res = await fetch(`${LINE_API}/group/${encodeURIComponent(groupId)}/summary`, {
      headers: { Authorization: `Bearer ${t}` },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { groupName?: string }
    return body.groupName?.trim() || null
  } catch {
    return null
  }
}

const TABLE = "line_synced_groups"

// Every lookup is keyed on the LINE sender (line_user_id), not the Slippy user: see SyncStore.
export const supabaseSyncStore: SyncStore = {
  async isEnabled(lineUserId, groupId) {
    const { data, error } = await supabase
      .from(TABLE).select("id")
      .eq("line_user_id", lineUserId).eq("line_group_id", groupId).eq("enabled", true)
      .limit(1).maybeSingle()
    if (error) throw new Error(`[group-sync] isEnabled: ${error.message}`)
    return !!data
  },

  async enable(who, groupId) {
    const name = await fetchGroupName(groupId)
    const row: Record<string, unknown> = {
      user_id: who.userId, line_user_id: who.lineUserId, line_group_id: groupId,
      enabled: true, updated_at: new Date().toISOString(),
    }
    if (name) row.group_name = name            // never overwrite a known name with null
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "line_user_id,line_group_id" })
    if (error) throw new Error(`[group-sync] enable: ${error.message}`)
  },

  async disable(lineUserId, groupId) {
    const { error } = await supabase
      .from(TABLE).update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("line_user_id", lineUserId).eq("line_group_id", groupId)
    if (error) throw new Error(`[group-sync] disable: ${error.message}`)
  },

  async list(lineUserId) {
    const { data, error } = await supabase
      .from(TABLE).select("group_name")
      .eq("line_user_id", lineUserId).eq("enabled", true).order("created_at", { ascending: true })
    if (error) throw new Error(`[group-sync] list: ${error.message}`)
    return (data ?? []).map((r: { group_name: string | null }) => ({ name: r.group_name }))
  },
}
