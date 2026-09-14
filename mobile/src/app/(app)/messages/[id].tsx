import React, { useEffect, useRef, useState } from "react"
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useLocalSearchParams, useRouter } from "expo-router"
import { supabase } from "@/lib/supabase"
import { useAuthStore } from "@/store/auth.store"
import { Brand, Light } from "@/constants/colors"

interface Msg {
  id: string
  body: string | null
  sender_id: string
  created_at: string
  msg_type: string
}

export default function ChatRoomScreen() {
  const { id }    = useLocalSearchParams<{ id: string }>()
  const router    = useRouter()
  const user      = useAuthStore(s => s.user)
  const [msgs, setMsgs]   = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const listRef   = useRef<FlatList>(null)

  function scrollBottom() {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150)
  }

  useEffect(() => {
    if (!id) return

    supabase
      .from("messages")
      .select("id,body,sender_id,created_at,msg_type")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(50)
      .then(({ data }) => { setMsgs(data ?? []); scrollBottom() })

    const ch = supabase
      .channel(`mobile-conv:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` },
        payload => { setMsgs(prev => [...prev, payload.new as Msg]); scrollBottom() }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [id])

  async function send() {
    if (!input.trim() || !user || !id) return
    const body = input.trim()
    setInput("")
    await supabase.from("messages").insert({
      conversation_id: id,
      sender_id: user.id,
      body,
      msg_type: "text",
    })
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>
      <View style={cr.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Text style={{ fontSize: 22, color: Light.foreground }}>←</Text>
        </TouchableOpacity>
        <Text style={cr.headerTitle}>การสนทนา</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item: m }) => {
            const isMe = m.sender_id === user?.id
            return (
              <View style={{ alignItems: isMe ? "flex-end" : "flex-start" }}>
                <View style={[cr.bubble, isMe ? cr.bubbleMe : cr.bubbleThem]}>
                  <Text style={[cr.bubbleTxt, isMe && { color: "#fff" }]}>{m.body}</Text>
                </View>
                <Text style={cr.time}>
                  {new Date(m.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
            )
          }}
        />

        <View style={cr.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            placeholder="พิมพ์ข้อความ..."
            style={cr.input}
            returnKeyType="send"
          />
          <TouchableOpacity style={cr.sendBtn} onPress={send}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>ส่ง</Text>
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
  sendBtn:     { backgroundColor: Brand[500], paddingHorizontal: 16, borderRadius: 12, justifyContent: "center", alignItems: "center" },
})
