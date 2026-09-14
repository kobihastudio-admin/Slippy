import React, { useEffect, useState } from "react"
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, StyleSheet, Image, ActivityIndicator,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useSocialStore } from "@/store/social.store"
import { supabase } from "@/lib/supabase"
import { Brand, Light } from "@/constants/colors"

type Tab = "friends" | "pending" | "search"

export default function FriendsScreen() {
  const { friends, pendingReqs, loadFriends, respondFriend, sendFriendReq } = useSocialStore()
  const [tab, setTab]         = useState<Tab>("friends")
  const [query, setQuery]     = useState("")
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())

  useEffect(() => { loadFriends() }, [loadFriends])

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .ilike("full_name", `%${query}%`)
        .limit(20)
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

      <View style={s.tabBar}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[s.tabBtn, tab === t.key && s.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "friends" && (
        <FlatList
          data={friends}
          keyExtractor={f => f.friendshipId}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={s.empty}>ยังไม่มีเพื่อน</Text>}
          renderItem={({ item: f }) => (
            <View style={s.card}>
              {f.friend?.avatar_url
                ? <Image source={{ uri: f.friend.avatar_url }} style={s.avatar} />
                : <View style={[s.avatar, s.avatarFb]}><Text style={{ fontSize: 20 }}>👤</Text></View>
              }
              <Text style={s.name}>{f.friend?.full_name ?? "—"}</Text>
            </View>
          )}
        />
      )}

      {tab === "pending" && (
        <FlatList
          data={pendingReqs}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={s.empty}>ไม่มีคำขอรอตอบรับ</Text>}
          renderItem={({ item: p }) => (
            <View style={s.card}>
              <View style={[s.avatar, s.avatarFb]}><Text style={{ fontSize: 20 }}>👤</Text></View>
              <Text style={[s.name, { flex: 1 }]}>{p.requester?.full_name ?? "—"}</Text>
              <TouchableOpacity style={s.btnGreen} onPress={() => respondFriend(p.id, "accept")}>
                <Text style={s.btnGreenTxt}>✓ รับ</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnGray} onPress={() => respondFriend(p.id, "decline")}>
                <Text style={{ fontSize: 13 }}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {tab === "search" && (
        <View style={{ flex: 1 }}>
          <View style={s.searchWrap}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="ค้นหาชื่อผู้ใช้..."
              style={s.searchInput}
            />
          </View>
          {searching && <ActivityIndicator style={{ marginTop: 20 }} color={Brand[500]} />}
          <FlatList
            data={results}
            keyExtractor={u => u.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={query.length >= 2 && !searching ? <Text style={s.empty}>ไม่พบผู้ใช้</Text> : null}
            renderItem={({ item: u }) => (
              <View style={s.card}>
                <View style={[s.avatar, s.avatarFb]}><Text style={{ fontSize: 20 }}>👤</Text></View>
                <Text style={[s.name, { flex: 1 }]}>{u.full_name}</Text>
                {sentIds.has(u.id) ? (
                  <Text style={{ fontSize: 12, color: Light.mutedFg }}>ส่งแล้ว</Text>
                ) : (
                  <TouchableOpacity
                    style={s.btnGreen}
                    onPress={async () => {
                      await sendFriendReq(u.id)
                      setSentIds(prev => new Set([...prev, u.id]))
                    }}
                  >
                    <Text style={s.btnGreenTxt}>+ เพิ่ม</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
        </View>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: Light.background },
  title:          { fontSize: 22, fontWeight: "800", color: Light.foreground, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  tabBar:         { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 4 },
  tabBtn:         { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: Light.muted, alignItems: "center" },
  tabActive:      { backgroundColor: Brand[500] },
  tabLabel:       { fontSize: 12, fontWeight: "600", color: Light.mutedFg },
  tabLabelActive: { color: "#fff" },
  card:           { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Light.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: Light.border },
  avatar:         { width: 44, height: 44, borderRadius: 22 },
  avatarFb:       { backgroundColor: "#e5e7eb", alignItems: "center", justifyContent: "center" },
  name:           { fontSize: 15, fontWeight: "600", color: Light.foreground },
  empty:          { textAlign: "center", color: Light.mutedFg, marginTop: 40 },
  btnGreen:       { backgroundColor: Brand[500], paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  btnGreenTxt:    { color: "#fff", fontSize: 12, fontWeight: "700" },
  btnGray:        { backgroundColor: Light.muted, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  searchWrap:     { paddingHorizontal: 16, paddingVertical: 8 },
  searchInput:    { backgroundColor: Light.card, borderWidth: 1, borderColor: Light.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
})
