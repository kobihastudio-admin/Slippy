import React, { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useAuthStore } from '@/store/auth.store'
import { supabase } from '@/lib/supabase'
import { fmtTHB, relTime } from '@/lib/utils'
import { Brand, Light, Status, StatusBg } from '@/constants/colors'

/* ─── Types ── */
interface DashDoc {
  id: string; vendor_name: string | null; total_amount: number | null
  status: string; created_at: string; category: string | null
}

interface Stats {
  totalDocs: number; pendingReview: number; totalAmount: number; vatTotal: number
  prevAmount: number; change: number
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'รอดำเนินการ', processing: 'กำลังประมวลผล', reviewing: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว', pushed: 'ส่งแล้ว', failed: 'ล้มเหลว', rejected: 'ปฏิเสธ',
}

/* ─── Sub-components ── */
function StatCard({ label, value, sub, trend, testID }: {
  label: string; value: string; sub?: string; trend?: number; testID?: string
}) {
  return (
    <View style={sc.card} testID={testID}>
      <Text style={sc.value}>{value}</Text>
      <Text style={sc.label}>{label}</Text>
      {sub && <Text style={sc.sub}>{sub}</Text>}
      {trend !== undefined && (
        <Text style={[sc.trend, { color: trend >= 0 ? '#10b981' : '#ef4444' }]}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
        </Text>
      )}
    </View>
  )
}
const sc = StyleSheet.create({
  card:  { flex: 1, backgroundColor: Light.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Light.border, marginHorizontal: 4 },
  value: { fontSize: 20, fontWeight: '800', color: Light.foreground },
  label: { fontSize: 11, color: Light.mutedFg, marginTop: 2, fontWeight: '500' },
  sub:   { fontSize: 10, color: Light.mutedFg, marginTop: 1 },
  trend: { fontSize: 11, fontWeight: '600', marginTop: 4 },
})

function DocRow({ doc, onPress }: { doc: DashDoc; onPress: () => void }) {
  const color = Status[doc.status as keyof typeof Status] ?? '#94a3b8'
  const bgCol = StatusBg[doc.status as keyof typeof StatusBg] ?? '#f8fafc'
  return (
    <TouchableOpacity style={dr.row} onPress={onPress} testID={`doc-row-${doc.id}`}>
      <View style={[dr.dot, { backgroundColor: color }]} />
      <View style={dr.info}>
        <Text style={dr.vendor} numberOfLines={1}>{doc.vendor_name ?? '—'}</Text>
        <Text style={dr.time}>{relTime(doc.created_at)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={dr.amount}>{fmtTHB(doc.total_amount ?? 0)}</Text>
        <View style={[dr.badge, { backgroundColor: bgCol }]}>
          <Text style={[dr.badgeText, { color }]}>{STATUS_LABEL[doc.status] ?? doc.status}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}
const dr = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: Light.border },
  dot:       { width: 8, height: 8, borderRadius: 4, marginRight: 12, flexShrink: 0 },
  info:      { flex: 1, gap: 2 },
  vendor:    { fontSize: 14, fontWeight: '600', color: Light.foreground },
  time:      { fontSize: 11, color: Light.mutedFg },
  amount:    { fontSize: 14, fontWeight: '700', color: Light.foreground },
  badge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 },
  badgeText: { fontSize: 10, fontWeight: '600' },
})

/* ─── Main screen ── */
export default function DashboardScreen() {
  const router  = useRouter()
  const { org, profile } = useAuthStore()
  const [docs,      setDocs]      = useState<DashDoc[]>([])
  const [stats,     setStats]     = useState<Stats | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [refreshing,setRefreshing]= useState(false)

  const load = async () => {
    if (!org) return
    setLoading(true)
    const now = new Date()
    const ym  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const [{ data: docsData }, { data: monthData }] = await Promise.all([
      supabase.from('documents').select('id,vendor_name,total_amount,status,created_at,category')
        .eq('organization_id', org.id).order('created_at', { ascending: false }).limit(8),
      supabase.from('documents').select('total_amount,vat_amount,status')
        .eq('organization_id', org.id).like('doc_date', `${ym}%`),
    ])
    const d = docsData ?? []
    const m = monthData ?? []
    const active = m.filter(x => !['pending','failed','rejected','processing'].includes(x.status))
    const totalAmount = active.reduce((a, x) => a + (x.total_amount ?? 0), 0)
    const vatTotal    = active.reduce((a, x) => a + (x.vat_amount  ?? 0), 0)
    const pendingReview = d.filter(x => x.status === 'reviewing').length
    setDocs(d)
    setStats({ totalDocs: m.length, pendingReview, totalAmount, vatTotal, prevAmount: totalAmount * 0.92, change: 8.3 })
    setLoading(false)
  }

  useEffect(() => { load() }, [org])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const firstName = (profile?.full_name ?? '').split(' ')[0] || 'คุณ'

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Brand[500]} />}
        contentContainerStyle={{ paddingBottom: 32 }}
        testID="dashboard-scroll"
      >
        {/* Header */}
        <View style={ds.header}>
          <View>
            <Text style={ds.greeting}>สวัสดี, {firstName} 👋</Text>
            <Text style={ds.orgName}>{org?.name ?? '—'}</Text>
          </View>
          <TouchableOpacity
            style={ds.uploadBtn}
            onPress={() => router.push('/(app)/documents/camera')}
            testID="quick-upload-btn"
          >
            <Text style={ds.uploadBtnText}>📷 สแกนสลิป</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ padding: 48, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={Brand[500]} />
          </View>
        ) : (
          <>
            {/* Stats */}
            <View style={ds.statsRow} testID="stats-row">
              <StatCard label="เอกสารเดือนนี้" value={String(stats?.totalDocs ?? 0)} sub="รายการ" testID="stat-docs" />
              <StatCard label="ยอดรวม" value={fmtTHB(stats?.totalAmount ?? 0)} trend={stats?.change} testID="stat-total" />
            </View>
            <View style={[ds.statsRow, { marginTop: 0 }]}>
              <StatCard label="ภาษีซื้อ (VAT)" value={fmtTHB(stats?.vatTotal ?? 0)} sub="Input VAT" testID="stat-vat" />
              <StatCard label="รอตรวจสอบ" value={String(stats?.pendingReview ?? 0)} sub="รายการ" testID="stat-review" />
            </View>

            {/* Quota bar */}
            {org && (
              <View style={ds.quotaBox}>
                <View style={ds.quotaRow}>
                  <Text style={ds.quotaLabel}>โควต้าเดือนนี้</Text>
                  <Text style={ds.quotaCount}>{org.doc_used} / {org.doc_quota} เอกสาร</Text>
                </View>
                <View style={ds.quotaTrack}>
                  <View style={[ds.quotaFill, { width: `${Math.min(100, (org.doc_used / org.doc_quota) * 100)}%` as any }]} />
                </View>
              </View>
            )}

            {/* Additive prototype entry — intentionally separate from production trip data */}
            <TouchableOpacity
              style={ds.journeyCard}
              onPress={() => router.push('/(app)/journey-prototype' as any)}
              accessibilityRole="button"
              accessibilityLabel="เปิด Journey Prototype"
              testID="journey-prototype-entry"
            >
              <View style={ds.journeyIcon}><Text style={{ fontSize: 24 }}>🗺️</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={ds.journeyEyebrow}>NEW PROTOTYPE</Text>
                <Text style={ds.journeyTitle}>Slippy Journey</Text>
                <Text style={ds.journeySub}>สร้างทริป · วางแผนรายวัน · แผนที่ · งบประมาณ</Text>
              </View>
              <Text style={ds.journeyArrow}>›</Text>
            </TouchableOpacity>

            {/* Recent documents */}
            <View style={ds.section}>
              <View style={ds.sectionHeader}>
                <Text style={ds.sectionTitle}>เอกสารล่าสุด</Text>
                <TouchableOpacity onPress={() => router.push('/(app)/documents/index')}>
                  <Text style={ds.seeAll}>ดูทั้งหมด →</Text>
                </TouchableOpacity>
              </View>
              <View style={ds.docList}>
                {docs.length === 0
                  ? <Text style={ds.empty}>ยังไม่มีเอกสาร</Text>
                  : docs.map(d => (
                      <DocRow key={d.id} doc={d} onPress={() => router.push(`/(app)/documents/${d.id}` as any)} />
                    ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const ds = StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  greeting:     { fontSize: 20, fontWeight: '800', color: Light.foreground },
  orgName:      { fontSize: 12, color: Light.mutedFg, marginTop: 2 },
  uploadBtn:    { backgroundColor: Brand[500], paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, shadowColor: Brand[500], shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  uploadBtnText:{ color: '#fff', fontSize: 13, fontWeight: '700' },
  statsRow:     { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8 },
  quotaBox:     { marginHorizontal: 20, marginVertical: 8, backgroundColor: Light.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Light.border },
  quotaRow:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  quotaLabel:   { fontSize: 12, fontWeight: '600', color: Light.mutedFg },
  quotaCount:   { fontSize: 12, fontWeight: '600', color: Light.foreground },
  quotaTrack:   { height: 6, backgroundColor: Light.muted, borderRadius: 3, overflow: 'hidden' },
  quotaFill:    { height: '100%', backgroundColor: Brand[500], borderRadius: 3 },
  section:      { marginTop: 12 },
  sectionHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Light.foreground },
  seeAll:       { fontSize: 13, color: Brand[500], fontWeight: '600' },
  docList:      { backgroundColor: Light.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Light.border },
  empty:        { padding: 24, textAlign: 'center', color: Light.mutedFg, fontSize: 14 },
  journeyCard:  { marginHorizontal: 20, marginTop: 10, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0' },
  journeyIcon:  { width: 48, height: 48, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  journeyEyebrow:{ fontSize: 9, fontWeight: '800', color: '#047857', letterSpacing: 1 },
  journeyTitle: { marginTop: 2, fontSize: 17, fontWeight: '800', color: '#064e3b' },
  journeySub:   { marginTop: 2, fontSize: 11, color: '#047857' },
  journeyArrow: { fontSize: 28, color: '#059669', fontWeight: '300' },
})
