import React, { useEffect } from "react"
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { useSocialStore } from "@/store/social.store"
import { Brand, Light } from "@/constants/colors"

export default function MessagesScreen() {
  const { conversations, loadConvs } = useSocialStore()
  const router = useRouter()

  useEffect(() => { loadConvs() }, [loadConvs])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>
      <Text style={ms.title}>ข้อความ</Text>
      <FlatList
        data={conversations}
        keyExtractor={c => c.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={<Text style={ms.empty}>ยังไม่มีการสนทนา</Text>}
        renderItem={({ item: c }) => (
          <TouchableOpacity style={ms.card} onPress={() => router.push(`/(app)/messages/${c.id}` as any)}>
            <View style={ms.avatar}>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>
                {c.name?.[0] ?? "?"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ms.name}>{c.name}</Text>
              <Text style={ms.last} numberOfLines={1}>
                {c.lastMessage || "ยังไม่มีข้อความ"}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  )
}

const ms = StyleSheet.create({
  title:  { fontSize: 22, fontWeight: "800", color: Light.foreground, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  card:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Light.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: Light.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Brand[500], alignItems: "center", justifyContent: "center" },
  name:   { fontSize: 15, fontWeight: "600", color: Light.foreground },
  last:   { fontSize: 13, color: Light.mutedFg, marginTop: 2 },
  empty:  { textAlign: "center", color: Light.mutedFg, marginTop: 40 },
})
