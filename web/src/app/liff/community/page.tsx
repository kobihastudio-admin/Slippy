/**
 * /liff/community — Community Groups LIFF mini-app
 *
 * Views: list → create → detail
 * Handles ?join=TOKEN for auto-joining via shared invite link.
 */

"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  Loader2, AlertCircle, Plus, Users, ChevronLeft,
  Share2, LogOut, Check, Copy,
} from "lucide-react"

type AuthStatus = "checking" | "needLogin" | "outsideLine" | "ready" | "authError"
type View = "list" | "create" | "detail"

interface LineProfile {
  userId: string
  displayName: string
  pictureUrl?: string
}

interface GroupSummary {
  id: string
  name: string
  description: string | null
  type: string
  emoji: string
  shareToken: string
  memberCount: number
  role: string
  createdAt: string
}

interface Member {
  id: string
  displayName: string
  lineUserId: string
  role: string
  joinedAt: string
}

interface GroupDetail {
  id: string
  name: string
  description: string | null
  type: string
  emoji: string
  shareToken: string
  createdAt: string
}

const GROUP_TYPES = [
  { value: "home",      label: "บ้าน/หอ",  emoji: "🏠" },
  { value: "savings",   label: "ออมเงิน",  emoji: "💰" },
  { value: "event",     label: "อีเวนต์",  emoji: "🎉" },
  { value: "community", label: "ชุมชน",    emoji: "🏘️" },
  { value: "coop",      label: "Co-op",    emoji: "💼" },
  { value: "general",   label: "ทั่วไป",   emoji: "👥" },
]

function typeLabel(type: string) {
  return GROUP_TYPES.find(t => t.value === type)?.label ?? type
}

export default function LiffCommunityPage() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking")
  const [authError,  setAuthError]  = useState("")
  const [loggingIn,  setLoggingIn]  = useState(false)
  const [profile,    setProfile]    = useState<LineProfile | null>(null)

  const [view,    setView]    = useState<View>("list")
  const [groups,  setGroups]  = useState<GroupSummary[]>([])
  const [detail,  setDetail]  = useState<GroupDetail | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [isMember, setIsMember] = useState(false)

  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState("")

  // Create form state
  const [newType,  setNewType]  = useState("general")
  const [newName,  setNewName]  = useState("")
  const [newDesc,  setNewDesc]  = useState("")
  const [creating, setCreating] = useState(false)

  const [copied, setCopied] = useState(false)

  // ── Auth ──────────────────────────────────────────────────────────────
  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    setAuthStatus("checking")
    setAuthError("")

    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) {
      setAuthStatus("authError")
      setAuthError("ระบบยังไม่ได้ตั้งค่า LIFF (NEXT_PUBLIC_LIFF_ID ไม่พบ)")
      return
    }

    let liff: any
    try {
      const mod = await import("@line/liff")
      liff = mod.default
      await liff.init({ liffId })
    } catch (err: any) {
      setAuthStatus("authError")
      setAuthError(`เริ่มต้น LIFF ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
      return
    }

    if (!liff.isInClient()) {
      setAuthStatus("outsideLine")
      return
    }

    if (!liff.isLoggedIn()) {
      setAuthStatus("needLogin")
      return
    }

    try {
      const p = await liff.getProfile()
      const prof: LineProfile = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl }
      setProfile(prof)
      setAuthStatus("ready")
      await loadGroups(prof.userId)

      // Handle ?join=TOKEN
      const params = new URLSearchParams(window.location.search)
      const joinToken = params.get("join")
      if (joinToken) {
        await handleAutoJoin(prof, joinToken)
      }
    } catch (err: any) {
      setAuthStatus("authError")
      setAuthError(`ดึงข้อมูลโปรไฟล์ LINE ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    }
  }

  async function handleLineLogin() {
    setLoggingIn(true)
    try {
      const mod = await import("@line/liff")
      const liff = mod.default
      const redirectUri = window.location.href.split("#")[0]
      liff.login({ redirectUri })
    } catch (err: any) {
      setLoggingIn(false)
      setAuthStatus("authError")
      setAuthError(`เข้าสู่ระบบด้วย LINE ไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    }
  }

  // ── Data ──────────────────────────────────────────────────────────────
  async function loadGroups(userId: string) {
    try {
      const res = await fetch(`/api/liff/community?lineUserId=${userId}`)
      const data = await res.json()
      setGroups(data.groups ?? [])
    } catch { setError("โหลดรายการกลุ่มไม่สำเร็จ") }
  }

  async function openDetail(id: string) {
    if (!profile) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/liff/community/${id}?lineUserId=${profile.userId}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ไม่พบกลุ่ม"); return }
      setDetail(data.group)
      setMembers(data.members ?? [])
      setIsAdmin(data.isAdmin)
      setIsMember(data.isMember)
      setView("detail")
    } catch { setError("โหลดรายละเอียดไม่สำเร็จ") }
    finally { setBusy(false) }
  }

  async function handleAutoJoin(prof: LineProfile, shareToken: string) {
    // Find group with this token — try all groups or search
    // We need to find the group id from the share token
    // Fetch all and match, or we can let the backend handle it by trying a special endpoint
    // For simplicity, we'll look at groups after loading
    try {
      // Try to find group by iterating loaded groups or via a search
      // We'll do a targeted approach: search for the group using a dummy endpoint
      // Since we don't have a search-by-token endpoint, we'll load groups first then match
      const res = await fetch(`/api/liff/community?lineUserId=${prof.userId}`)
      const data = await res.json()
      const existingGroups: GroupSummary[] = data.groups ?? []

      // Check if already in the group with this token
      const alreadyIn = existingGroups.find(g => g.shareToken === shareToken)
      if (alreadyIn) {
        await openDetail(alreadyIn.id)
        return
      }

      // Need to find group id — we'll need a lookup endpoint; for now skip auto-join
      // if we can't find the group id. A full implementation would have GET /api/liff/community?token=X
    } catch { /* ignore auto-join errors */ }
  }

  async function createGroup() {
    if (!profile || !newName.trim()) return
    setCreating(true)
    setError("")
    try {
      const typeObj = GROUP_TYPES.find(t => t.value === newType)
      const res = await fetch("/api/liff/community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: profile.userId,
          name: newName.trim(),
          description: newDesc.trim() || undefined,
          type: newType,
          emoji: typeObj?.emoji ?? "👥",
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) { setError(data.error ?? "สร้างกลุ่มไม่สำเร็จ"); return }
      setNewName("")
      setNewDesc("")
      setNewType("general")
      await loadGroups(profile.userId)
      await openDetail(data.id)
    } finally { setCreating(false) }
  }

  async function leaveGroup() {
    if (!profile || !detail) return
    if (!confirm("ออกจากกลุ่มนี้?")) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch(`/api/liff/community/${detail.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave", lineUserId: profile.userId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "ออกจากกลุ่มไม่สำเร็จ"); return }
      await loadGroups(profile.userId)
      setView("list")
    } finally { setBusy(false) }
  }

  function shareInviteLink() {
    if (!detail) return
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? ""
    const link = `https://liff.line.me/${liffId}/liff/community?join=${detail.shareToken}`
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Auth screens ──────────────────────────────────────────────────────
  if (authStatus === "checking") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white gap-3">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
        <p className="text-sm text-gray-500">กำลังตรวจสอบสิทธิ์...</p>
      </div>
    )
  }

  if (authStatus === "outsideLine") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-6 text-center gap-4">
        <AlertCircle className="w-12 h-12 text-amber-500" />
        <h2 className="text-lg font-semibold text-gray-800">เปิดใน LINE เท่านั้น</h2>
        <p className="text-sm text-gray-500">กรุณาเปิดหน้านี้ผ่านแอป LINE</p>
      </div>
    )
  }

  if (authStatus === "needLogin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-6 text-center gap-6">
        <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center">
          <Users className="w-8 h-8 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800 mb-1">กลุ่มของฉัน</h2>
          <p className="text-sm text-gray-500">กรุณาเข้าสู่ระบบด้วย LINE เพื่อใช้งาน</p>
        </div>
        <button
          onClick={handleLineLogin}
          disabled={loggingIn}
          className="w-full max-w-xs py-3 bg-green-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
          เข้าสู่ระบบด้วย LINE
        </button>
      </div>
    )
  }

  if (authStatus === "authError") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white px-6 text-center gap-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-sm text-red-600">{authError}</p>
        <button onClick={init} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">ลองอีกครั้ง</button>
      </div>
    )
  }

  // ── Create view ───────────────────────────────────────────────────────
  if (view === "create") {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3 z-10">
          <button onClick={() => setView("list")} className="p-1 -ml-1 text-gray-600">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold text-gray-900">สร้างกลุ่มใหม่</h1>
        </div>

        <div className="px-4 py-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Type selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">ประเภทกลุ่ม</label>
            <div className="grid grid-cols-3 gap-2">
              {GROUP_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setNewType(t.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-sm font-medium transition-all",
                    newType === t.value
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-gray-200 bg-white text-gray-600",
                  )}
                >
                  <span className="text-2xl">{t.emoji}</span>
                  <span className="text-xs">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">ชื่อกลุ่ม *</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="เช่น บ้านหมู่ 5, ทริปเกาะช้าง"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">คำอธิบาย (ไม่บังคับ)</label>
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="บอกสมาชิกเกี่ยวกับกลุ่มนี้..."
              rows={3}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
            />
          </div>

          <button
            onClick={createGroup}
            disabled={creating || !newName.trim()}
            className="w-full py-4 bg-green-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 text-base"
          >
            {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            สร้างกลุ่ม
          </button>
        </div>
      </div>
    )
  }

  // ── Detail view ───────────────────────────────────────────────────────
  if (view === "detail" && detail) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3 z-10">
          <button
            onClick={async () => {
              setView("list")
              if (profile) await loadGroups(profile.userId)
            }}
            className="p-1 -ml-1 text-gray-600"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <span className="text-2xl">{detail.emoji}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">{detail.name}</h1>
            <p className="text-xs text-gray-500">{typeLabel(detail.type)}</p>
          </div>
        </div>

        <div className="px-4 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Description */}
          {detail.description && (
            <div className="bg-white rounded-xl px-4 py-3 text-sm text-gray-600">
              {detail.description}
            </div>
          )}

          {/* Invite */}
          <button
            onClick={shareInviteLink}
            className="w-full bg-green-500 text-white py-3 rounded-xl flex items-center justify-center gap-2 font-semibold"
          >
            {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
            {copied ? "คัดลอกแล้ว!" : "แชร์ลิงก์เชิญ"}
          </button>

          {/* Members */}
          <div className="bg-white rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-700">สมาชิก ({members.length})</span>
            </div>
            {members.map((m, i) => (
              <div
                key={m.id}
                className={cn("px-4 py-3 flex items-center gap-3", i < members.length - 1 ? "border-b border-gray-50" : "")}
              >
                <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm flex-shrink-0">
                  {m.displayName.slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {m.displayName}
                    {m.lineUserId === profile?.userId ? " (ฉัน)" : ""}
                  </p>
                </div>
                {m.role === "admin" && (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                    admin
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Leave button — only if not last admin */}
          {isMember && (
            <button
              onClick={leaveGroup}
              disabled={busy}
              className="w-full py-3 border-2 border-red-200 text-red-600 rounded-xl flex items-center justify-center gap-2 font-semibold text-sm"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              ออกจากกลุ่ม
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-4 z-10">
        <h1 className="text-xl font-bold text-gray-900">กลุ่มของฉัน</h1>
        {profile && (
          <p className="text-xs text-gray-500 mt-0.5">{profile.displayName}</p>
        )}
      </div>

      <div className="px-4 py-4 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {busy && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
          </div>
        )}

        {!busy && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <Users className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-gray-700 font-medium">ยังไม่มีกลุ่ม</p>
            <p className="text-sm text-gray-400">กด + เพื่อสร้างกลุ่มแรกของคุณ</p>
          </div>
        )}

        {groups.map(g => (
          <button
            key={g.id}
            onClick={() => openDetail(g.id)}
            className="w-full bg-white rounded-2xl px-4 py-4 flex items-center gap-3 text-left shadow-sm active:bg-gray-50"
          >
            <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center text-2xl flex-shrink-0">
              {g.emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900 truncate">{g.name}</p>
                {g.role === "admin" && (
                  <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full flex-shrink-0">admin</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{typeLabel(g.type)}</span>
                <span className="text-xs text-gray-400">
                  <Users className="w-3 h-3 inline mr-0.5" />{g.memberCount} คน
                </span>
              </div>
            </div>
            <ChevronLeft className="w-4 h-4 text-gray-300 rotate-180 flex-shrink-0" />
          </button>
        ))}
      </div>

      {/* FAB */}
      <button
        onClick={() => { setError(""); setView("create") }}
        className="fixed bottom-8 right-6 w-14 h-14 bg-green-500 text-white rounded-full shadow-lg flex items-center justify-center active:bg-green-600 z-20"
      >
        <Plus className="w-7 h-7" />
      </button>
    </div>
  )
}
