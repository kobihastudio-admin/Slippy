import { create } from "zustand"
import { supabase } from "@/lib/supabase"
import { useAuthStore } from "./auth.store"

interface Friend {
  friendshipId: string
  friend: { id: string; full_name: string | null; avatar_url: string | null }
}

interface Conversation {
  id: string
  name: string
  avatarUrl: string | null
  lastMessage: string
  updatedAt: string
}

interface SocialState {
  friends: Friend[]
  pendingReqs: any[]
  conversations: Conversation[]
  loadFriends: () => Promise<void>
  loadConvs: () => Promise<void>
  sendFriendReq: (addresseeId: string) => Promise<void>
  respondFriend: (id: string, action: "accept" | "decline") => Promise<void>
}

export const useSocialStore = create<SocialState>((set, get) => ({
  friends: [],
  pendingReqs: [],
  conversations: [],

  loadFriends: async () => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return

    const [{ data: accepted }, { data: pending }] = await Promise.all([
      supabase
        .from("friendships")
        .select("id, source, requester:requester_id(id,full_name,avatar_url), addressee:addressee_id(id,full_name,avatar_url)")
        .eq("status", "accepted")
        .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`),
      supabase
        .from("friendships")
        .select("id, requester:requester_id(id,full_name,avatar_url)")
        .eq("status", "pending")
        .eq("addressee_id", uid),
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

    const { data } = await supabase
      .from("conversation_members")
      .select("conversation_id, conversations(id,type,name,updated_at)")
      .eq("user_id", uid)
      .limit(30)

    const convIds = (data ?? []).map((m: any) => m.conversation_id)

    let lastMap: Record<string, string> = {}
    if (convIds.length > 0) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("conversation_id, body")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
      for (const m of msgs ?? []) {
        if (!lastMap[(m as any).conversation_id]) lastMap[(m as any).conversation_id] = (m as any).body ?? ""
      }
    }

    const conversations: Conversation[] = (data ?? []).map((m: any) => ({
      id: m.conversation_id,
      name: (m.conversations as any)?.name ?? "การสนทนา",
      avatarUrl: null,
      lastMessage: lastMap[m.conversation_id] ?? "",
      updatedAt: (m.conversations as any)?.updated_at ?? "",
    }))

    set({ conversations })
  },

  sendFriendReq: async (addresseeId: string) => {
    const uid = useAuthStore.getState().user?.id
    if (!uid) return
    await supabase.from("friendships").insert({
      requester_id: uid,
      addressee_id: addresseeId,
      source: "search",
    })
    await get().loadFriends()
  },

  respondFriend: async (id: string, action: "accept" | "decline") => {
    if (action === "accept") {
      await supabase
        .from("friendships")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", id)
    } else {
      await supabase.from("friendships").delete().eq("id", id)
    }
    await get().loadFriends()
  },
}))
