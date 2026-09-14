/**
 * /liff/join/[token] — LIFF Join Page
 *
 * Opens INSIDE LINE app.
 * LINE automatically provides userId + displayName.
 * No /connect required for bill participants.
 */

"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import QRCode from "qrcode"
import { getAppUrl } from "@/lib/app-url"
import { cn } from "@/lib/utils"
import { buildPromptPayPayload } from "@/lib/promptpay"
import { Loader2, CheckCircle, AlertCircle, Users, MapPin, QrCode, X } from "lucide-react"

type JoinStatus = "loading" | "identifying" | "joining" | "success" | "error" | "not_found" | "closed" | "guest_form" | "guest_success"

interface BillInfo {
  id:     string
  title:  string
  type:   string
  venue:  string | null
  host:   string
  participants: number
  total:  number
  maxPlayers?: number | null
  registrationClosed?: boolean
  promptpayId?: string | null
  status?: string
}

interface RosterParticipant { id: string; name: string; guests: { id: string; name: string }[] }

// รายชื่อผู้เข้าร่วมทั้งหมดล่าสุด พร้อมปุ่มยกเลิก/ลบ — ใช้ซ้ำทั้งหน้า success และ
// guest_success เพื่อให้ลบเพื่อนที่เพิ่มเข้ามาได้โดยไม่ต้องออกจากหน้านี้
//
// ปุ่ม "ลบ" (X) แสดงแค่ 2 กรณี: (1) แถวของตัวเอง (p.id === meParticipantId) —
// "ยกเลิกการเข้าร่วม", หรือ (2) เพื่อนที่ตัวเองเป็นคนเพิ่มเข้ามา (ลูกของแถวตัวเอง)
// — ลบคนอื่นที่ไม่ใช่ตัวเองหรือเพื่อนที่เพิ่มเองไม่ได้ในหน้านี้ (ต่างจากแดชบอร์ดของ
// ผู้สร้างกลุ่ม ที่มีสิทธิ์ admin ลบใครก็ได้)
function RosterList({ roster, removingId, onRemove }: {
  roster: { totalCount?: number; meParticipantId?: string | null; participants?: RosterParticipant[] } | null
  removingId: string | null
  onRemove: (participantId: string) => void
}) {
  if (!roster?.participants || roster.participants.length === 0) return null
  const meParticipantId = roster.meParticipantId ?? null
  return (
    <div className="w-full rounded-xl border bg-muted/20 p-3 text-left">
      <p className="text-xs font-semibold text-muted-foreground mb-2">
        👥 ผู้เข้าร่วมทั้งหมด ({roster.totalCount ?? roster.participants.length} คน)
      </p>
      <div className="space-y-1.5">
        {roster.participants.map(p => {
          const isMe = !!meParticipantId && p.id === meParticipantId
          return (
            <div key={p.id}>
              <div className="flex items-center gap-1.5">
                <p className="text-sm flex-1">👤 {p.name}</p>
                {isMe && (
                  <button onClick={() => onRemove(p.id)} disabled={removingId === p.id}
                    title="ยกเลิกการเข้าร่วม" className="text-muted-foreground/60 hover:text-rose-600 disabled:opacity-50 shrink-0">
                    {removingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
              {p.guests.map(g => (
                <div key={g.id} className="flex items-center gap-1.5 pl-5">
                  <p className="text-xs text-muted-foreground flex-1">↳ {g.name}</p>
                  {isMe && (
                    <button onClick={() => onRemove(g.id)} disabled={removingId === g.id}
                      title="ยกเลิก" className="text-muted-foreground/60 hover:text-rose-600 disabled:opacity-50 shrink-0">
                      {removingId === g.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function LiffJoinPage() {
  const params       = useParams()
  const searchParams = useSearchParams()
  const token        = params.token as string
  const type         = searchParams.get("type") ?? "trip"   // trip | split
  const guestMode    = searchParams.get("guest") === "1"

  const [status,   setStatus]   = useState<JoinStatus>("loading")
  const [billInfo, setBillInfo] = useState<BillInfo | null>(null)
  const [profile,  setProfile]  = useState<{ userId: string; displayName: string; pictureUrl?: string } | null>(null)
  const [error,    setError]    = useState("")
  const [name,     setName]     = useState("")  // fallback if not in LINE
  const [guestName,   setGuestName]   = useState("")
  const [addedGuestName, setAddedGuestName] = useState("")
  // เพิ่มเพื่อน — พิมพ์ชื่อเอง | เลือกจากเพื่อนในระบบ | เชิญผ่าน LINE (ให้เพื่อนกดเข้าร่วมเอง)
  const [addGuestTab, setAddGuestTab] = useState<"manual" | "friend" | "line">("manual")
  const [friendOptions, setFriendOptions]     = useState<{ friendshipId: string; friend: { id: string; full_name: string } }[] | null>(null)
  const [friendQuery, setFriendQuery]         = useState("")
  const [friendSearching, setFriendSearching] = useState(false)
  const [addingFriendId, setAddingFriendId]   = useState<string | null>(null)
  // ค้นหาผู้ใช้อื่นในระบบ (ไม่จำกัดแค่ "เพื่อน" ที่ accept กันแล้ว) — เผื่อยังไม่มี
  // เพื่อนในระบบเลย ก็ยังเพิ่มคนที่มีบัญชี Slippy อยู่แล้วได้
  const [userSearchResults, setUserSearchResults] = useState<{ id: string; full_name: string }[]>([])
  const [userSearching, setUserSearching]         = useState(false)
  // ผลตรวจสอบหลังเพิ่มเพื่อน — แสดงสาเหตุตรงนี้เลยถ้าไม่ขึ้นในรายชื่อ/ไม่ส่งเข้ากลุ่ม LINE
  // ไม่ต้องเปิด log เซิร์ฟเวอร์
  const [addGuestDiagnostics, setAddGuestDiagnostics] = useState<{
    nestedUnderAdder?: boolean
    lineNotify?: { attempted: boolean; ok?: boolean; status?: number; skipped?: string; error?: string }
  } | null>(null)
  // ทำไม LIFF หาตัวตนผู้กรอกฟอร์มไม่เจอ — แสดงไว้เผื่อต้อง debug ต่อ
  const [idDiagnostic, setIdDiagnostic] = useState<string | null>(null)
  // รายชื่อผู้เข้าร่วมทั้งหมดล่าสุด — แสดงใหม่ทุกครั้งหลังกดเข้าร่วม ถึงจะเข้าร่วมแล้วก็ตาม
  const [roster, setRoster] = useState<{ totalCount?: number; meParticipantId?: string | null; participants?: RosterParticipant[] } | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // PromptPay QR — only shown once the session is finalized (played/closed).
  // Before that, the amount can still change as people join/leave, so we
  // don't show a number that might be wrong yet.
  const [myAmount, setMyAmount] = useState(0)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const isFinalized = billInfo?.status === "finalized"

  useEffect(() => {
    const promptpayId = billInfo?.promptpayId
    if (!isFinalized || !promptpayId || myAmount <= 0) { setQrDataUrl(null); return }
    QRCode.toDataURL(buildPromptPayPayload(promptpayId, myAmount), { margin: 1, width: 240 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [billInfo, myAmount, isFinalized])

  useEffect(() => { init() }, [token])

  async function init() {
    setStatus("loading")

    // Load bill info first (works without LIFF)
    let bill: BillInfo | null = null
    try {
      const res  = await fetch(`/api/liff/bill-info?token=${token}&type=${type}`)
      const data = await res.json()
      if (!res.ok || !data.bill) { setStatus("not_found"); return }
      bill = data.bill as BillInfo
      setBillInfo(bill)
      if (bill.registrationClosed) { setStatus("closed"); return }
    } catch { setStatus("not_found"); return }

    if (guestMode) {
      if (bill.maxPlayers && bill.participants >= bill.maxPlayers) { setStatus("closed"); return }
      // Try to identify the adder via LIFF (not required, used only for context —
      // without it, the guest still gets added, just not nested under anyone).
      try {
        const { initLiff, getLiffProfile, isInLineApp } = await import("@/lib/liff")
        const ok = await initLiff()
        const inClient = ok && isInLineApp()
        if (inClient) {
          const p = await getLiffProfile()
          if (p) { setProfile(p) } else { setIdDiagnostic(`initLiff=${ok} isInLineApp=${inClient} getLiffProfile=null`) }
        } else {
          setIdDiagnostic(`initLiff=${ok} isInLineApp=${inClient}`)
        }
      } catch (err: any) {
        setIdDiagnostic(`exception: ${err?.message ?? String(err)}`)
      }
      setStatus("guest_form")
      return
    }

    // Try LIFF (auto-identify if inside LINE app)
    setStatus("identifying")
    try {
      const { initLiff, getLiffProfile, isInLineApp } = await import("@/lib/liff")
      const ok = await initLiff()

      if (ok && isInLineApp()) {
        const p = await getLiffProfile()
        if (p) {
          setProfile(p)
          setName(p.displayName)
          // Auto-join if we have profile
          await joinBill(p.userId, p.displayName, p.pictureUrl)
          return
        }
      }
    } catch { /* LIFF not available — fall through to manual */ }

    // Fallback: ask for name (web browser or LIFF ID not configured)
    setStatus("joining")
  }

  async function joinBill(lineUserId: string, displayName: string, pictureUrl?: string) {
    setStatus("joining")
    try {
      const endpoint = type === "trip" ? "/api/liff/join-trip" : "/api/liff/join-split"
      const res = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, lineUserId, displayName, pictureUrl }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "ไม่สามารถเข้าร่วมได้"); setStatus("error"); return }
      const d = await res.json()
      setMyAmount(Number(d.amount) || 0)
      setRoster({ totalCount: d.totalCount, meParticipantId: d.meParticipantId, participants: d.participants })
      setStatus("success")
    } catch { setError("เกิดข้อผิดพลาด กรุณาลองใหม่"); setStatus("error") }
  }

  async function handleManualJoin() {
    if (!name.trim()) return
    setStatus("joining")
    try {
      const endpoint = type === "trip" ? "/api/liff/join-trip" : "/api/liff/join-split"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, guestName: name.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "ไม่สามารถเข้าร่วมได้")
        setStatus("error")
        return
      }
      const data = await res.json()
      setMyAmount(Number(data.amount) || 0)
      setRoster({ totalCount: data.totalCount, meParticipantId: data.meParticipantId, participants: data.participants })
      setStatus("success")
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่")
      setStatus("error")
    }
  }

  async function handleAddGuest() {
    if (!guestName.trim()) return
    setStatus("joining")
    try {
      const res = await fetch("/api/liff/join-split", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          token,
          lineUserId:  profile?.userId ?? "",
          displayName: profile?.displayName ?? "",
          guestName:   guestName.trim(),
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? "ไม่สามารถเพิ่มเพื่อนได้"); setStatus("error"); return }
      setAddedGuestName(guestName.trim())
      setAddGuestDiagnostics({ nestedUnderAdder: d.nestedUnderAdder, lineNotify: d.lineNotify })
      setRoster({ totalCount: d.totalCount, meParticipantId: d.meParticipantId, participants: d.participants })
      setStatus("guest_success")
    } catch { setError("เกิดข้อผิดพลาด กรุณาลองใหม่"); setStatus("error") }
  }

  function handleAddAnotherGuest() {
    setGuestName("")
    setBillInfo(prev => prev ? { ...prev, participants: prev.participants + 1 } : prev)
    setStatus("guest_form")
  }

  // โหลดรายชื่อเพื่อนในระบบ (friendships ที่ accepted แล้ว) ของผู้กรอกฟอร์ม —
  // ต้องระบุตัวตนผ่าน LIFF ได้ก่อน (เห็น profile.userId) ไม่งั้นไม่รู้ว่าจะดูเพื่อนของใคร
  async function loadFriendOptions() {
    if (!profile) return
    setFriendSearching(true)
    try {
      const res = await fetch(`/api/liff/friends?lineUserId=${profile.userId}`)
      const data = await res.json()
      setFriendOptions(data.friends ?? [])
    } catch {
      setFriendOptions([])
    } finally { setFriendSearching(false) }
  }

  // ค้นหาผู้ใช้อื่นในระบบด้วยชื่อ/เบอร์/อีเมล (ไม่ต้องเป็น "เพื่อน" กันมาก่อน) —
  // debounce 350ms กันยิง request ถี่เกินไปตอนพิมพ์
  useEffect(() => {
    if (!profile || addGuestTab !== "friend") return
    const q = friendQuery.trim()
    if (q.length < 2) { setUserSearchResults([]); return }
    const t = setTimeout(async () => {
      setUserSearching(true)
      try {
        const res = await fetch(`/api/liff/friends?lineUserId=${profile.userId}&q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setUserSearchResults(data.users ?? [])
      } catch {
        setUserSearchResults([])
      } finally { setUserSearching(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [friendQuery, profile, addGuestTab])

  async function handleAddFriend(friendUserId: string) {
    setAddingFriendId(friendUserId)
    try {
      const res = await fetch("/api/liff/join-split", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          token,
          lineUserId:  profile?.userId ?? "",
          displayName: profile?.displayName ?? "",
          friendUserId,
        }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? "ไม่สามารถเพิ่มเพื่อนได้"); setStatus("error"); return }
      setAddedGuestName(d.addedName ?? "เพื่อน")
      setAddGuestDiagnostics({ nestedUnderAdder: d.nestedUnderAdder, lineNotify: d.lineNotify })
      setRoster({ totalCount: d.totalCount, meParticipantId: d.meParticipantId, participants: d.participants })
      setStatus("guest_success")
    } catch { setError("เกิดข้อผิดพลาด กรุณาลองใหม่"); setStatus("error") }
    finally { setAddingFriendId(null) }
  }

  // เชิญผ่าน LINE — ส่งลิงก์เข้าร่วม "ตัวจริง" (ไม่ใช่โหมดเพิ่มแทน) ให้เพื่อน
  // กดเข้าร่วมด้วยบัญชี LINE ของตัวเอง ผ่าน shareTargetPicker เลือกคนหรือกลุ่มได้
  async function handleInviteViaLine() {
    if (!billInfo) return
    try {
      const { initLiff } = await import("@/lib/liff")
      const ok = await initLiff()
      if (!ok) { setError("เปิดใช้งาน LIFF ไม่สำเร็จ — ลองเปิดหน้านี้จากในแอป LINE"); return }
      const mod = await import("@line/liff")
      const liff = mod.default
      if (!liff.isApiAvailable?.("shareTargetPicker")) {
        setError("อุปกรณ์นี้ไม่รองรับการเลือกแชทผ่าน LINE")
        return
      }
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID
      const realJoinUrl = liffId
        ? `https://liff.line.me/${liffId}/liff/join/${token}?type=${type}`
        : `${getAppUrl()}/split/join/${token}`
      await liff.shareTargetPicker([
        { type: "text", text: `🧾 ชวนเข้าร่วม ${billInfo.title} — กดลิงก์เพื่อเข้าร่วม: ${realJoinUrl}` } as any,
      ])
    } catch (err: any) {
      setError(`ส่งคำเชิญไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    }
  }

  // ยกเลิก/ลบผู้เข้าร่วม — ปุ่ม X ใน RosterList แสดงแค่แถวตัวเอง/เพื่อนที่ตัวเองเพิ่ม
  // เท่านั้น (ดูเงื่อนไขใน RosterList) จึงเรียก handler นี้ได้แค่ 2 กรณีนั้นจริงๆ
  // แม้ backend จะรองรับสิทธิ์ admin (ผู้สร้างบิล) ลบใครก็ได้ — แต่หน้านี้ไม่เปิดให้ใช้
  // สิทธิ์นั้น (เทียบกับแดชบอร์ดของผู้สร้างกลุ่มซึ่งมีปุ่มลบ admin แยกอยู่แล้ว)
  async function handleRemoveParticipant(participantId: string) {
    setRemovingId(participantId)
    try {
      const res = await fetch("/api/liff/join-split", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, lineUserId: profile?.userId ?? "", removeParticipantId: participantId }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? "ลบไม่สำเร็จ"); return }
      setRoster({ totalCount: d.totalCount, meParticipantId: d.meParticipantId, participants: d.participants })
    } catch { setError("เกิดข้อผิดพลาด กรุณาลองใหม่") }
    finally { setRemovingId(null) }
  }

  const EMOJI: Record<string, string> = { travel:"✈️", food_order:"🍽️", sport:"🏸", general:"💰", split:"🧾" }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-5">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-6">
          <img src="/icon-512.png" alt="Slippy" className="w-16 h-16 rounded-2xl mx-auto mb-2 shadow-lg" />
          <p className="text-sm text-muted-foreground font-medium">Slippy · หารค่าใช้จ่าย</p>
        </div>

        {/* Card */}
        <div className="bg-card border rounded-2xl shadow-xl overflow-hidden">

          {/* Bill info header */}
          {billInfo && (
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white">
              <p className="text-xl font-black">{EMOJI[billInfo.type] ?? "💰"} {billInfo.title}</p>
              {billInfo.venue && <p className="text-sm text-white/80 mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3" />{billInfo.venue}</p>}
              <div className="flex items-center gap-3 mt-2 text-sm text-white/70">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{billInfo.participants} คน</span>
                <span>โดย {billInfo.host}</span>
              </div>
            </div>
          )}

          <div className="p-5">

            {/* Loading */}
            {(status === "loading" || status === "identifying") && (
              <div className="flex flex-col items-center py-6 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
                <p className="text-sm text-muted-foreground">
                  {status === "identifying" ? "กำลังระบุตัวตน..." : "กำลังโหลด..."}
                </p>
              </div>
            )}

            {/* Submitting guest registration */}
            {status === "joining" && guestMode && (
              <div className="flex flex-col items-center py-6 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
                <p className="text-sm text-muted-foreground">กำลังเพิ่มเพื่อน...</p>
              </div>
            )}

            {/* Manual name input (fallback) */}
            {status === "joining" && !guestMode && !profile && (
              <div className="space-y-4">
                <p className="text-sm font-medium">ใส่ชื่อเพื่อเข้าร่วม</p>
                <input
                  value={name} onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleManualJoin()}
                  placeholder="ชื่อ-นามสกุล หรือชื่อเล่น"
                  autoFocus
                  className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                />
                <button
                  onClick={handleManualJoin}
                  disabled={!name.trim()}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-sm disabled:opacity-50 transition-opacity"
                >
                  เข้าร่วมเลย →
                </button>
              </div>
            )}

            {/* LINE identified — auto-joining */}
            {status === "joining" && !guestMode && profile && (
              <div className="flex flex-col items-center py-6 gap-3">
                {profile.pictureUrl && (
                  <img src={profile.pictureUrl} alt={profile.displayName}
                    className="w-14 h-14 rounded-full border-2 border-brand-500" />
                )}
                <p className="font-semibold">{profile.displayName}</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> กำลังเข้าร่วม...
                </div>
              </div>
            )}

            {/* Success */}
            {status === "success" && (
              <div className="flex flex-col items-center py-6 gap-3 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
                <div>
                  <p className="font-bold text-lg">เข้าร่วมแล้ว! 🎉</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {profile ? `ยินดีต้อนรับ ${profile.displayName}` : `ยินดีต้อนรับ ${name}`}
                  </p>
                </div>

                {/* รายชื่อผู้เข้าร่วมทั้งหมดล่าสุด — แสดงใหม่ทุกครั้งที่กดเข้าร่วม
                    แม้จะเข้าร่วมอยู่แล้วก่อนหน้านี้ก็ตาม พร้อมลบเพื่อนที่เพิ่มเข้ามาได้ */}
                <RosterList roster={roster} removingId={removingId} onRemove={handleRemoveParticipant} />

                {isFinalized && qrDataUrl && (
                  <div className="w-full rounded-xl border bg-muted/30 p-4 flex flex-col items-center gap-2">
                    <p className="text-sm font-medium flex items-center gap-1.5"><QrCode className="w-4 h-4" /> สแกนเพื่อจ่ายเงิน</p>
                    <img src={qrDataUrl} alt="PromptPay QR" className="w-48 h-48 rounded-lg bg-white p-2 border" />
                    <p className="text-lg font-bold">฿{myAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p>
                    <p className="text-xs text-muted-foreground">พร้อมเพย์ของผู้จัดกลุ่ม — สแกนแล้วโอนได้เลย</p>
                  </div>
                )}
                {!isFinalized && (
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                    ⏳ ยอดและ QR จะแสดงหลังเล่นจบและผู้จัดปิดบิลแล้ว
                  </p>
                )}
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                  💡 เพิ่ม Slippy เป็นเพื่อนใน LINE เพื่อรับการแจ้งเตือนเมื่อมีการอัปเดตบิล
                </p>
                <a
                  href={`https://line.me/R/ti/p/@${process.env.NEXT_PUBLIC_LINE_BOT_ID ?? ""}`}
                  className="w-full h-11 rounded-xl bg-[#06C755] text-white font-semibold text-sm flex items-center justify-center gap-2"
                >
                  <span className="text-base">💬</span> เพิ่ม Slippy เป็นเพื่อน
                </a>
              </div>
            )}

            {/* Guest registration form */}
            {status === "guest_form" && (
              <div className="space-y-4">
                <p className="text-sm font-medium">เพิ่มเพื่อนเข้าบิลนี้</p>

                {/* Tabs: พิมพ์ชื่อเอง | เพื่อนในระบบ | เชิญผ่าน LINE */}
                <div className="flex gap-1 bg-muted p-0.5 rounded-lg">
                  {([
                    { id: "manual", label: "✏️ พิมพ์ชื่อเอง" },
                    { id: "friend", label: "👥 เพื่อนในระบบ" },
                    { id: "line",   label: "💬 เชิญผ่าน LINE" },
                  ] as const).map(t => (
                    <button key={t.id} type="button"
                      onClick={() => {
                        setAddGuestTab(t.id)
                        if (t.id === "friend" && friendOptions === null) loadFriendOptions()
                      }}
                      className={cn("flex-1 h-8 rounded-md text-[11px] font-medium transition-colors",
                        addGuestTab === t.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground")}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {addGuestTab === "manual" && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">ชื่อเพื่อน</label>
                    <input
                      value={guestName} onChange={e => setGuestName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleAddGuest()}
                      placeholder="ชื่อ-นามสกุล หรือชื่อเล่น"
                      autoFocus
                      className="w-full h-11 rounded-xl border px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                    />
                    <p className="text-xs text-muted-foreground">
                      ค่าใช้จ่ายของเพื่อนจะไปรวมกับคุณ — ตกลงกันเองว่าจะให้เพื่อนโอนหรือจ่ายสดยังไง
                    </p>
                    <button
                      onClick={handleAddGuest}
                      disabled={!guestName.trim()}
                      className="w-full h-11 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold text-sm disabled:opacity-50 transition-opacity"
                    >
                      ➕ เพิ่มเพื่อน
                    </button>
                  </div>
                )}

                {addGuestTab === "friend" && (
                  !profile ? (
                    <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                      ต้องเปิดหน้านี้จากในแอป LINE และเชื่อมต่อบัญชี Slippy ก่อน จึงจะเลือกจากเพื่อนในระบบได้
                      {idDiagnostic && <span className="block mt-1 opacity-60">({idDiagnostic})</span>}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <input
                        value={friendQuery} onChange={e => setFriendQuery(e.target.value)}
                        placeholder="ค้นหาเพื่อน หรือชื่อ/เบอร์/อีเมลผู้ใช้อื่น"
                        className="w-full h-10 rounded-xl border px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                      />
                      {friendSearching ? (
                        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto rounded-lg border divide-y">
                          {(friendOptions ?? [])
                            .filter(f => !friendQuery.trim() || f.friend.full_name?.toLowerCase().includes(friendQuery.trim().toLowerCase()))
                            .map(f => (
                              <button key={f.friendshipId} type="button" disabled={addingFriendId === f.friend.id}
                                onClick={() => handleAddFriend(f.friend.id)}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                                  {f.friend.full_name?.[0]?.toUpperCase() ?? "?"}
                                </div>
                                <span className="text-sm truncate flex-1">{f.friend.full_name}</span>
                                {addingFriendId === f.friend.id ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" /> : <span className="text-brand-500 text-xs font-semibold shrink-0">+ เพิ่ม</span>}
                              </button>
                            ))}

                          {friendQuery.trim().length >= 2 && (
                            <>
                              <p className="text-[10px] font-semibold text-muted-foreground px-3 py-1.5 bg-muted/30">
                                ผู้ใช้อื่นในระบบ
                              </p>
                              {userSearching ? (
                                <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                              ) : userSearchResults.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-3">ไม่พบผู้ใช้ที่ตรงกับ &quot;{friendQuery.trim()}&quot;</p>
                              ) : (
                                userSearchResults.map(u => (
                                  <button key={u.id} type="button" disabled={addingFriendId === u.id}
                                    onClick={() => handleAddFriend(u.id)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                                      {u.full_name?.[0]?.toUpperCase() ?? "?"}
                                    </div>
                                    <span className="text-sm truncate flex-1">{u.full_name}</span>
                                    {addingFriendId === u.id ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" /> : <span className="text-brand-500 text-xs font-semibold shrink-0">+ เพิ่ม</span>}
                                  </button>
                                ))
                              )}
                            </>
                          )}

                          {friendOptions !== null && friendOptions.length === 0 && friendQuery.trim().length < 2 && (
                            <p className="text-xs text-muted-foreground text-center py-4">
                              ยังไม่มีเพื่อนในระบบ — ลองพิมพ์ค้นหาชื่อผู้ใช้อื่นได้เลย
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                )}

                {addGuestTab === "line" && (
                  <div className="space-y-3 text-center py-2">
                    <p className="text-xs text-muted-foreground">
                      ส่งลิงก์ให้เพื่อนกดเข้าร่วมด้วยบัญชี LINE ของตัวเอง — เลือกเพื่อนหรือกลุ่ม LINE ปลายทางได้จากหน้าแชร์ของ LINE
                    </p>
                    <button
                      onClick={handleInviteViaLine}
                      className="w-full h-11 rounded-xl bg-[#06C755] text-white font-semibold text-sm flex items-center justify-center gap-2"
                    >
                      💬 เลือกเพื่อน/กลุ่ม LINE
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Guest added successfully */}
            {status === "guest_success" && (
              <div className="flex flex-col items-center py-6 gap-3 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
                <div>
                  <p className="font-bold text-lg">เพิ่ม {addedGuestName} แล้ว! 🎉</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {addGuestDiagnostics?.nestedUnderAdder
                      ? `${addedGuestName} จะแสดงอยู่ใต้ชื่อคุณในรายชื่อผู้เข้าร่วม — ค่าใช้จ่ายรวมกับคุณแล้ว`
                      : `${addedGuestName} เข้าร่วมแล้ว แต่ระบบหาบัญชีของคุณในบิลนี้ไม่เจอ — เลยยังไม่ได้ผูกค่าใช้จ่ายไว้กับคุณ ลองเปิดหน้านี้จากในแอป LINE อีกครั้ง`}
                  </p>
                </div>
                {addGuestDiagnostics?.lineNotify && !addGuestDiagnostics.lineNotify.ok && addGuestDiagnostics.lineNotify.attempted && (
                  <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-500/10 rounded-lg p-3 text-left w-full">
                    ⚠️ ส่งเข้ากลุ่ม LINE ไม่สำเร็จ{addGuestDiagnostics.lineNotify.status ? ` (HTTP ${addGuestDiagnostics.lineNotify.status})` : ""}: {addGuestDiagnostics.lineNotify.error ?? "ไม่ทราบสาเหตุ"}
                  </p>
                )}
                {addGuestDiagnostics?.lineNotify && !addGuestDiagnostics.lineNotify.attempted && (
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 text-left w-full">
                    ℹ️ ไม่ได้ส่งเข้ากลุ่ม LINE: {addGuestDiagnostics.lineNotify.skipped ?? "ไม่ทราบสาเหตุ"}
                  </p>
                )}

                {/* รายชื่อผู้เข้าร่วมทั้งหมดล่าสุด — ลบเพื่อนที่เพิ่งเพิ่มเข้ามาได้ตรงนี้เลย */}
                <RosterList roster={roster} removingId={removingId} onRemove={handleRemoveParticipant} />

                <button
                  onClick={handleAddAnotherGuest}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold text-sm"
                >
                  ➕ เพิ่มเพื่อนอีกคน
                </button>
              </div>
            )}

            {/* Not found */}
            {status === "not_found" && (
              <div className="flex flex-col items-center py-6 gap-2 text-center">
                <AlertCircle className="w-10 h-10 text-amber-500" />
                <p className="font-semibold">ไม่พบบิลนี้</p>
                <p className="text-sm text-muted-foreground">ลิงก์อาจหมดอายุหรือถูกลบแล้ว</p>
              </div>
            )}

            {/* Registration closed */}
            {status === "closed" && (
              <div className="flex flex-col items-center py-6 gap-2 text-center">
                <AlertCircle className="w-10 h-10 text-amber-500" />
                <p className="font-semibold">⏰ เกินกำหนดการลงทะเบียนแล้ว</p>
                <p className="text-sm text-muted-foreground">เซสชันนี้ปิดรับลงทะเบียนแล้ว — ติดต่อผู้จัดกลุ่มถ้าต้องการเข้าร่วมเพิ่ม</p>
              </div>
            )}

            {/* Error */}
            {status === "error" && (
              <div className="flex flex-col items-center py-4 gap-3 text-center">
                <AlertCircle className="w-10 h-10 text-rose-500" />
                <p className="font-semibold">เกิดข้อผิดพลาด</p>
                <p className="text-sm text-muted-foreground">{error}</p>
                <button onClick={init} className="text-sm text-brand-500 hover:underline">ลองใหม่</button>
              </div>
            )}

          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Powered by Slippy · AI Life Assistant
        </p>
      </div>
    </div>
  )
}
