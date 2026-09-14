import React, { useEffect, useState } from "react"
import {
  View, Text, Image, ActivityIndicator,
  TouchableOpacity, StyleSheet, ScrollView,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useLocalSearchParams, useRouter } from "expo-router"
import { supabase } from "@/lib/supabase"
import { Brand, Light } from "@/constants/colors"

export default function PayScreen() {
  const { id }  = useLocalSearchParams<{ id: string }>()
  const router  = useRouter()
  const [req, setReq]     = useState<any>(null)
  const [qrUri, setQrUri] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    supabase
      .from("payment_requests")
      .select("*, requester:requester_id(id,full_name,avatar_url)")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        setReq(data)
        if (data?.qr_payload) {
          setQrUri(
            `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data.qr_payload)}&size=240x240&format=png`
          )
        }
        setLoading(false)
      })
  }, [id])

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Light.background }}>
        <ActivityIndicator color={Brand[500]} size="large" />
      </View>
    )
  }

  if (!req) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: Light.background }}>
        <Text style={{ color: Light.mutedFg }}>ไม่พบรายการ</Text>
      </View>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>
      <ScrollView contentContainerStyle={pay.container}>
        <TouchableOpacity onPress={() => router.back()} style={{ alignSelf: "flex-start", marginBottom: 8 }}>
          <Text style={{ fontSize: 24, color: Light.foreground }}>←</Text>
        </TouchableOpacity>

        <View style={pay.requesterCard}>
          <Text style={pay.label}>ขอเงินจาก</Text>
          <Text style={pay.requesterName}>{req.requester?.full_name ?? "—"}</Text>
        </View>

        <View style={pay.amountCard}>
          <Text style={pay.amountLabel}>
            ฿{Number(req.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
          </Text>
          {req.description ? <Text style={pay.desc}>{req.description}</Text> : null}
        </View>

        {qrUri ? (
          <View style={pay.qrBox}>
            <Image source={{ uri: qrUri }} style={{ width: 240, height: 240 }} resizeMode="contain" />
            <Text style={pay.qrHint}>สแกน QR ด้วยแอปธนาคาร</Text>
          </View>
        ) : (
          <Text style={{ color: Light.mutedFg, textAlign: "center" }}>
            ไม่มี QR Code (ผู้รับยังไม่ตั้งค่า PromptPay)
          </Text>
        )}

        {req.status === "paid" && (
          <View style={pay.paidBadge}>
            <Text style={{ color: "#065f46", fontWeight: "700", fontSize: 15 }}>✅ ชำระเงินแล้ว</Text>
          </View>
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
  amountCard:    { backgroundColor: "#d1fae5", borderRadius: 20, paddingVertical: 24, paddingHorizontal: 40, alignItems: "center", width: "100%" },
  amountLabel:   { fontSize: 36, fontWeight: "900", color: "#065f46" },
  desc:          { fontSize: 13, color: "#047857", marginTop: 4 },
  qrBox:         { alignItems: "center", gap: 8 },
  qrHint:        { fontSize: 12, color: Light.mutedFg },
  paidBadge:     { backgroundColor: "#d1fae5", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24 },
})
