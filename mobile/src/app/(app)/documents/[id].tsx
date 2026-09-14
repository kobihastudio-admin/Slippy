/**
 * Document Detail Screen  —  /(app)/documents/[id]
 * Shows extracted data, line items, audit trail, and approval actions.
 */
import React, { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { fmtTHB, relTime } from '@/lib/utils'
import { Brand, Light, Status, StatusBg } from '@/constants/colors'

/* ─── Types ─────────────────────────────────────────────────────── */
interface Document {
  id: string
  vendor_name: string | null
  invoice_number: string | null
  total_amount: number | null
  vat_amount: number | null
  wht_amount: number | null
  subtotal_amount: number | null
  status: string
  doc_date: string | null
  created_at: string
  category: string | null
  overall_confidence: number | null
  machine_verification_status?: 'unverified' | 'needs_review' | 'verified'
  reconciliation_status?: 'not_checked' | 'balanced' | 'mismatch'
  file_path: string | null
  file_type: string | null
  notes: string | null
}

interface LineItem {
  id: string
  description: string | null
  quantity: number | null
  unit_price: number | null
  amount: number | null
  account_code: string | null
}

interface AuditLog {
  action: string
  actor_name: string | null
  created_at: string
}

/* ─── Status helpers ─────────────────────────────────────────────── */
const STATUS_LABEL: Record<string, string> = {
  pending: 'รอดำเนินการ', processing: 'กำลังประมวลผล', reviewing: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว', pushed: 'ส่งแล้ว', failed: 'ล้มเหลว', rejected: 'ปฏิเสธ',
}

const ACTION_LABEL: Record<string, string> = {
  created: 'สร้างเอกสาร', uploaded: 'อัปโหลด', ocr_completed: 'OCR เสร็จ',
  approved: 'อนุมัติ', rejected: 'ปฏิเสธ', pushed: 'ส่งเข้าระบบ',
  reviewed: 'ตรวจสอบแล้ว', failed: 'ล้มเหลว',
}

/* ─── Sub-components ─────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const color = Status[status as keyof typeof Status] ?? '#94a3b8'
  const bg    = StatusBg[status as keyof typeof StatusBg] ?? '#f8fafc'
  return (
    <View style={[det.badge, { backgroundColor: bg }]}>
      <Text style={[det.badgeText, { color }]}>{STATUS_LABEL[status] ?? status}</Text>
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={det.infoRow}>
      <Text style={det.infoLabel}>{label}</Text>
      <Text style={det.infoValue} numberOfLines={2}>{value || '—'}</Text>
    </View>
  )
}

/* ─── Main screen ────────────────────────────────────────────────── */
export default function DocumentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router  = useRouter()

  const [doc,       setDoc]       = useState<Document | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [loading,   setLoading]   = useState(true)
  const [acting,    setActing]    = useState(false)

  /* ── Fetch ── */
  useEffect(() => {
    if (!id) return
    ;(async () => {
      const [{ data: docData }, { data: liData }, { data: auditData }] = await Promise.all([
        supabase.from('documents').select('*').eq('id', id).single(),
        supabase.from('document_line_items').select('*').eq('document_id', id),
        supabase
          .from('audit_logs')
          .select('action, actor_name, created_at')
          .eq('document_id', id)
          .order('created_at', { ascending: false })
          .limit(3),
      ])
      setDoc(docData as Document | null)
      setLineItems((liData ?? []) as LineItem[])
      setAuditLogs((auditData ?? []) as AuditLog[])
      setLoading(false)
    })()
  }, [id])

  /* ── Approve ── */
  const handleApprove = async () => {
    if (!id) return
    Alert.alert('อนุมัติเอกสาร', 'ต้องการอนุมัติเอกสารนี้ใช่หรือไม่?', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'อนุมัติ ✓',
        onPress: async () => {
          setActing(true)
          const { error } = await supabase
            .from('documents')
            .update({ status: 'approved' })
            .eq('id', id)
          setActing(false)
          if (error) {
            Alert.alert('เกิดข้อผิดพลาด', error.message)
            return
          }
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          Alert.alert('อนุมัติสำเร็จ', 'เอกสารได้รับการอนุมัติแล้ว', [
            { text: 'ตกลง', onPress: () => router.back() },
          ])
        },
      },
    ])
  }

  /* ── Reject ── */
  const handleReject = async () => {
    if (!id) return
    Alert.alert('ปฏิเสธเอกสาร', 'ต้องการปฏิเสธเอกสารนี้ใช่หรือไม่?', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ปฏิเสธ',
        style: 'destructive',
        onPress: async () => {
          setActing(true)
          const { error } = await supabase
            .from('documents')
            .update({ status: 'rejected' })
            .eq('id', id)
          setActing(false)
          if (error) { Alert.alert('เกิดข้อผิดพลาด', error.message); return }
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          router.back()
        },
      },
    ])
  }

  /* ── Push to accounting ── */
  const handlePush = async () => {
    if (!id) return
    Alert.alert('ส่งเข้าระบบ', 'ส่งเอกสารนี้เข้าระบบบัญชีใช่หรือไม่?', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ส่งเข้าระบบ',
        onPress: async () => {
          setActing(true)
          const { error } = await supabase
            .from('documents')
            .update({ status: 'pushed' })
            .eq('id', id)
          setActing(false)
          if (error) { Alert.alert('เกิดข้อผิดพลาด', error.message); return }
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          router.back()
        },
      },
    ])
  }

  /* ── Loading ── */
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Light.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={Brand[500]} />
      </SafeAreaView>
    )
  }

  if (!doc) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>
        <View style={det.appBar}>
          <TouchableOpacity onPress={() => router.back()} style={det.backBtn}>
            <Text style={det.backIcon}>‹</Text>
          </TouchableOpacity>
          <Text style={det.appBarTitle}>ไม่พบเอกสาร</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, color: Light.mutedFg }}>ไม่พบข้อมูลเอกสาร</Text>
        </View>
      </SafeAreaView>
    )
  }

  const confidence = doc.overall_confidence != null
    ? Math.round(doc.overall_confidence * 100)
    : null

  const confColor = confidence == null ? '#94a3b8'
    : confidence >= 85 ? '#10b981'
    : confidence >= 60 ? '#f59e0b'
    : '#ef4444'

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Light.background }}>

      {/* ── App Bar ── */}
      <View style={det.appBar}>
        <TouchableOpacity onPress={() => router.back()} style={det.backBtn} testID="back-btn">
          <Text style={det.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={det.appBarTitle} numberOfLines={1}>
          {doc.vendor_name ?? 'เอกสาร'}
        </Text>
        <StatusBadge status={doc.status} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120, padding: 20, gap: 12 }}>

        {/* ── Amount Hero ── */}
        <View style={det.heroCard}>
          <Text style={det.heroLabel}>ยอดรวมทั้งสิ้น</Text>
          <Text style={det.heroAmount}>{fmtTHB(doc.total_amount ?? 0)}</Text>
          {doc.vat_amount != null && (
            <Text style={det.heroSub}>ภาษีมูลค่าเพิ่ม (VAT 7%): {fmtTHB(doc.vat_amount)}</Text>
          )}
          {confidence != null && (
            <View style={[det.confChip, { backgroundColor: confColor + '22' }]}>
              <Text style={[det.confText, { color: confColor }]}>
                ความแม่นยำ {confidence}%
              </Text>
            </View>
          )}
        </View>

        {doc.machine_verification_status && (
          <View style={[det.card, { borderWidth: 1,
            borderColor: doc.machine_verification_status === 'verified' ? '#a7f3d0' : '#fde68a' }]}>
            <Text style={[det.cardTitle, {
              color: doc.machine_verification_status === 'verified' ? '#047857' : '#b45309',
            }]}>
              {doc.machine_verification_status === 'verified' ? '✓ ระบบตรวจยอดแล้ว'
                : doc.machine_verification_status === 'needs_review' ? '! ควรตรวจสอบก่อนอนุมัติ'
                : 'ยังยืนยันข้อมูลไม่ได้'}
            </Text>
            <Text style={{ fontSize: 12, color: Light.mutedFg }}>
              {doc.reconciliation_status === 'balanced' ? 'ยอดรวมและรายการที่ตรวจได้สมดุลกัน'
                : doc.reconciliation_status === 'mismatch' ? 'พบยอดรวม หรือผลรวมรายการไม่ตรงกัน'
                : 'ข้อมูลยังไม่เพียงพอสำหรับตรวจสมดุลยอด'}
            </Text>
          </View>
        )}

        {/* ── Extracted Data Card ── */}
        <View style={det.card}>
          <Text style={det.cardTitle}>ข้อมูลที่สกัดได้</Text>
          <InfoRow label="เลขที่ใบแจ้งหนี้" value={doc.invoice_number} />
          <InfoRow label="วันที่เอกสาร"     value={doc.doc_date} />
          <InfoRow label="ผู้ขาย / ร้านค้า" value={doc.vendor_name} />
          <InfoRow label="หมวดหมู่"         value={doc.category} />
          {doc.subtotal_amount != null && (
            <InfoRow label="ยอดก่อน VAT"    value={fmtTHB(doc.subtotal_amount)} />
          )}
          {doc.wht_amount != null && (
            <InfoRow label="ภาษีหัก ณ ที่จ่าย" value={fmtTHB(doc.wht_amount)} />
          )}
        </View>

        {/* ── Line Items ── */}
        {lineItems.length > 0 && (
          <View style={det.card}>
            <Text style={det.cardTitle}>รายการสินค้า / บริการ</Text>
            {lineItems.map((li, i) => (
              <View key={li.id} style={[det.lineRow, i === lineItems.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={det.lineDesc} numberOfLines={2}>{li.description ?? '—'}</Text>
                  {li.account_code && (
                    <Text style={det.lineCode}>{li.account_code}</Text>
                  )}
                  {(li.quantity != null || li.unit_price != null) && (
                    <Text style={det.lineQty}>
                      {li.quantity != null ? `${li.quantity} × ` : ''}
                      {li.unit_price != null ? fmtTHB(li.unit_price, 2) : ''}
                    </Text>
                  )}
                </View>
                <Text style={det.lineAmt}>{fmtTHB(li.amount ?? 0)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Notes ── */}
        {!!doc.notes && (
          <View style={det.card}>
            <Text style={det.cardTitle}>หมายเหตุ</Text>
            <Text style={det.notesText}>{doc.notes}</Text>
          </View>
        )}

        {/* ── Audit Log ── */}
        {auditLogs.length > 0 && (
          <View style={det.card}>
            <Text style={det.cardTitle}>ประวัติการดำเนินการ</Text>
            {auditLogs.map((log, i) => (
              <View key={i} style={[det.auditRow, i === auditLogs.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={det.auditDot} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={det.auditAction}>{ACTION_LABEL[log.action] ?? log.action}</Text>
                  {log.actor_name && (
                    <Text style={det.auditActor}>{log.actor_name}</Text>
                  )}
                </View>
                <Text style={det.auditTime}>{relTime(log.created_at)}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Sticky Bottom Bar ── */}
      {(doc.status === 'reviewing' || doc.status === 'approved') && (
        <View style={det.bottomBar}>
          {doc.status === 'reviewing' && (
            <>
              <TouchableOpacity
                style={det.rejectBtn}
                onPress={handleReject}
                disabled={acting}
                testID="reject-btn"
              >
                {acting
                  ? <ActivityIndicator color="#ef4444" />
                  : <Text style={det.rejectTxt}>ปฏิเสธ</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={det.approveBtn}
                onPress={handleApprove}
                disabled={acting}
                testID="approve-btn"
              >
                {acting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={det.approveTxt}>อนุมัติ ✓</Text>}
              </TouchableOpacity>
            </>
          )}
          {doc.status === 'approved' && (
            <TouchableOpacity
              style={[det.approveBtn, { flex: 1 }]}
              onPress={handlePush}
              disabled={acting}
              testID="push-btn"
            >
              {acting
                ? <ActivityIndicator color="#fff" />
                : <Text style={det.approveTxt}>ส่งเข้าระบบ →</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  )
}

/* ─── Styles ─────────────────────────────────────────────────────── */
const det = StyleSheet.create({
  /* App bar */
  appBar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Light.border },
  backBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: Light.muted, alignItems: 'center', justifyContent: 'center' },
  backIcon:    { fontSize: 26, color: Light.foreground, lineHeight: 30, marginTop: -2 },
  appBarTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: Light.foreground, textAlign: 'center', marginHorizontal: 8 },
  badge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  badgeText:   { fontSize: 11, fontWeight: '700' },

  /* Hero */
  heroCard:    { backgroundColor: Brand[500], borderRadius: 20, padding: 24, alignItems: 'center', shadowColor: Brand[500], shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  heroLabel:   { fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
  heroAmount:  { fontSize: 36, fontWeight: '800', color: '#fff', marginTop: 4, marginBottom: 6 },
  heroSub:     { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  confChip:    { marginTop: 12, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100 },
  confText:    { fontSize: 12, fontWeight: '700' },

  /* Card */
  card:        { backgroundColor: Light.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Light.border },
  cardTitle:   { fontSize: 13, fontWeight: '700', color: Light.mutedFg, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },

  /* Info rows */
  infoRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Light.border },
  infoLabel:   { fontSize: 13, color: Light.mutedFg, flex: 1 },
  infoValue:   { fontSize: 13, fontWeight: '600', color: Light.foreground, flex: 1.5, textAlign: 'right' },

  /* Line items */
  lineRow:     { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Light.border, gap: 8 },
  lineDesc:    { fontSize: 13, fontWeight: '500', color: Light.foreground },
  lineCode:    { fontSize: 11, color: Brand[500], fontWeight: '600' },
  lineQty:     { fontSize: 11, color: Light.mutedFg },
  lineAmt:     { fontSize: 13, fontWeight: '700', color: Light.foreground, minWidth: 70, textAlign: 'right' },

  /* Notes */
  notesText:   { fontSize: 13, color: Light.foreground, lineHeight: 20 },

  /* Audit */
  auditRow:    { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Light.border, gap: 10 },
  auditDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: Brand[400], marginTop: 4, flexShrink: 0 },
  auditAction: { fontSize: 13, fontWeight: '600', color: Light.foreground },
  auditActor:  { fontSize: 11, color: Light.mutedFg },
  auditTime:   { fontSize: 11, color: Light.mutedFg, marginTop: 2 },

  /* Bottom bar */
  bottomBar:   { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 12, padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20, backgroundColor: Light.card, borderTopWidth: 1, borderTopColor: Light.border },
  rejectBtn:   { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#fecaca', alignItems: 'center', backgroundColor: '#fef2f2' },
  rejectTxt:   { fontSize: 15, fontWeight: '700', color: '#ef4444' },
  approveBtn:  { flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: Brand[500], alignItems: 'center', shadowColor: Brand[500], shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  approveTxt:  { fontSize: 15, fontWeight: '700', color: '#fff' },
})
