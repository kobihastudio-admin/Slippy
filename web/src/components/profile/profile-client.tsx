"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useState, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { profilePlanLabel, profileTabs, type ProfileTab } from "@/lib/profile/profile-sections"
import {
  User, Mail, Shield, LogOut, Camera, Check, Edit2,
  MessageCircle, Key,
  Clock, FileText, CheckCircle2, AlertCircle, Loader2,
  Trash2, Building2, Upload, X, Sparkles, Cake,
} from "lucide-react"
import { toast } from "sonner"

/* ─── Types ── */
interface ActivityLog {
  id:         string
  action:     string
  detail:     string | null
  created_at: string
}

type LineConnection = {
  id:           string
  display_name: string | null
  created_at:   string
} | null

interface ProfileProps {
  userId:          string
  name:            string
  email:           string
  role:            string
  orgName:         string
  orgPlan:         string
  avatarUrl?:      string
  joinedAt?:       string
  dateOfBirth?:    string | null
  activityLogs:    ActivityLog[]
  lineConnection:  LineConnection
}

/* ─── Helpers ── */
function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
}

const roleLabel: Record<string, string> = {
  owner: "Owner", admin: "Admin", accountant: "Accountant",
  member: "Member", viewer: "Viewer",
}
const roleBg: Record<string, string> = {
  owner: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  admin: "bg-brand-500/10 text-brand-700 dark:text-brand-300",
  accountant: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  member: "bg-slate-500/10 text-slate-600",
  viewer: "bg-slate-500/10 text-slate-500",
}

// Activity label mapping from action keys
const ACTION_LABEL: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  login:                  { label: "ลงชื่อเข้าใช้",          icon: CheckCircle2, color: "text-emerald-500" },
  consent_update:         { label: "อัปเดตความยินยอม PDPA",  icon: FileText,     color: "text-brand-500"   },
  security_update:        { label: "อัปเดตการตั้งค่าความปลอดภัย", icon: Shield,  color: "text-purple-500"  },
  export_request:         { label: "ขอส่งออกข้อมูล",         icon: FileText,     color: "text-amber-500"   },
  session_revoke:         { label: "ออกจากระบบอุปกรณ์",      icon: AlertCircle,  color: "text-rose-500"    },
  session_revoke_all:     { label: "ออกจากระบบทุกอุปกรณ์",   icon: AlertCircle,  color: "text-rose-500"    },
  account_delete_request: { label: "ขอลบบัญชี",              icon: AlertCircle,  color: "text-rose-600"    },
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return "เมื่อกี้"
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชม.ที่แล้ว`
  const d = Math.floor(h / 24)
  return d === 1 ? "เมื่อวาน" : `${d} วันที่แล้ว`
}

/* ─── Cartoon/comic avatar presets (DiceBear) ── */
// Free, license-friendly generated avatars — no assets to host. Mix of
// "adventurer" (cute illustrated people) and "fun-emoji" (comic-style faces)
// across a fixed set of seeds so the gallery stays stable across renders.
const AVATAR_STYLES = ["adventurer", "fun-emoji", "bottts", "avataaars"] as const
const AVATAR_SEEDS  = ["Slippy", "Nova", "Mochi", "Bubble", "Pixel", "Jelly", "Coco", "Maru"]

function dicebearUrl(style: string, seed: string) {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`
}

const AVATAR_PRESETS = AVATAR_STYLES.flatMap(style =>
  AVATAR_SEEDS.map(seed => ({ style, seed, url: dicebearUrl(style, `${style}-${seed}`) }))
)

/* ─── Avatar picker modal ── */
function AvatarPickerModal({
  currentUrl, onClose, onSelect, onUpload, uploading,
}: {
  currentUrl?: string
  onClose: () => void
  onSelect: (url: string) => Promise<void>
  onUpload: (file: File) => Promise<void>
  uploading: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [savingUrl, setSavingUrl] = useState<string | null>(null)

  const handlePick = async (url: string) => {
    setSavingUrl(url)
    await onSelect(url)
    setSavingUrl(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border bg-card shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-card z-10">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-500" />
            เปลี่ยนรูปโปรไฟล์
          </p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Upload your own photo */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">อัปโหลดรูปของคุณ</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void onUpload(file)
                e.target.value = ""
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed
                text-sm font-medium text-muted-foreground hover:text-foreground hover:border-brand-500/50
                hover:bg-muted/40 transition-colors disabled:opacity-60"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? "กำลังอัปโหลด..." : "เลือกรูปจากเครื่อง (สูงสุด 2MB)"}
            </button>
          </div>

          {/* Cartoon/comic avatar gallery */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">หรือเลือกอวตาร์การ์ตูน</p>
            <div className="grid grid-cols-4 gap-3">
              {AVATAR_PRESETS.map(({ style, seed, url }) => {
                const active = currentUrl === url
                const isSaving = savingUrl === url
                return (
                  <button
                    key={`${style}-${seed}`}
                    onClick={() => void handlePick(url)}
                    disabled={!!savingUrl}
                    className={cn(
                      "relative aspect-square rounded-xl border-2 overflow-hidden transition-all",
                      "hover:border-brand-500/60 hover:scale-[1.03]",
                      active ? "border-brand-500 ring-2 ring-brand-500/30" : "border-transparent bg-muted/40",
                      !!savingUrl && !isSaving && "opacity-50"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`${style} ${seed}`} className="w-full h-full object-cover" />
                    {isSaving && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                      </span>
                    )}
                    {active && !isSaving && (
                      <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-brand-500 flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Avatar section ── */
function AvatarSection({ userId, name, avatarUrl, onAvatarChange }: {
  userId: string; name: string; avatarUrl?: string; onAvatarChange: (url: string) => void
}) {
  const [hovered, setHovered]   = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading]   = useState(false)
  const supabase = createClient()
  const colors = ["from-brand-400 to-brand-700", "from-purple-400 to-brand-600", "from-rose-400 to-brand-500"]
  const grad = colors[name.length % colors.length]

  const saveAvatar = async (url: string) => {
    const { error } = await supabase.from("users").update({ avatar_url: url }).eq("id", userId)
    if (error) {
      toast.error("ไม่สามารถบันทึกรูปโปรไฟล์ได้")
      return
    }
    onAvatarChange(url)
    toast.success("เปลี่ยนรูปโปรไฟล์แล้ว")
    setPickerOpen(false)
  }

  const handleUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกินไป — สูงสุด 2MB")
      return
    }
    setUploading(true)
    try {
      const ext  = file.name.split(".").pop() ?? "jpg"
      const path = `${userId}/avatar-${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600" })
      if (uploadError) throw uploadError

      const { data } = supabase.storage.from("avatars").getPublicUrl(path)
      await saveAvatar(data.publicUrl)
    } catch (err: any) {
      toast.error(`อัปโหลดไม่สำเร็จ: ${err?.message ?? "unknown error"}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <div className="relative inline-block" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={name}
            className={cn("w-24 h-24 rounded-full object-cover bg-muted transition-all duration-200", hovered && "opacity-80")}
          />
        ) : (
          <div className={cn(
            "w-24 h-24 rounded-full bg-gradient-to-br flex items-center justify-center",
            "text-white text-3xl font-bold select-none transition-all duration-200",
            grad,
            hovered && "opacity-80"
          )}>
            {initials(name)}
          </div>
        )}
        <button
          onClick={() => setPickerOpen(true)}
          className={cn(
            "absolute inset-0 rounded-full flex items-center justify-center",
            "bg-black/40 transition-opacity duration-200",
            hovered ? "opacity-100" : "opacity-0"
          )}
        >
          <Camera className="w-6 h-6 text-white" />
        </button>
        <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-background
          flex items-center justify-center" title="ออนไลน์">
          <span className="w-2 h-2 rounded-full bg-white" />
        </span>
      </div>

      {pickerOpen && (
        <AvatarPickerModal
          currentUrl={avatarUrl}
          onClose={() => setPickerOpen(false)}
          onSelect={saveAvatar}
          onUpload={handleUpload}
          uploading={uploading}
        />
      )}
    </>
  )
}

/* ─── Edit name form ── */
function EditableField({
  label, value, icon: Icon, editable = false, onSave, type = "text"
}: { label: string; value: string; icon: React.FC<{className?:string}>; editable?: boolean; onSave?: (v: string) => Promise<void>; type?: "text" | "date" }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value)
  const [saving, setSaving]   = useState(false)

  const save = async () => {
    if (!onSave) return
    setSaving(true)
    await onSave(val)
    setSaving(false)
    setEditing(false)
  }

  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors group">
      <div className="w-9 h-9 rounded-xl bg-background border flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type={type}
              value={val}
              onChange={e => setVal(e.target.value)}
              autoFocus
              className="flex-1 text-sm font-medium bg-background border rounded-lg px-3 py-1.5 outline-none
                focus:ring-2 ring-brand-500/30"
            />
            <button
              onClick={save}
              disabled={saving}
              className="p-1.5 rounded-lg bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => { setVal(value); setEditing(false) }}
              className="p-1.5 rounded-lg border hover:bg-muted transition-colors text-xs"
            >
              ×
            </button>
          </div>
        ) : (
          <p className="text-sm font-medium">
            {type === "date" && val ? new Date(val).toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" }) : (val || "—")}
          </p>
        )}
      </div>
      {editable && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-muted"
        >
          <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}

/* ─── Change password modal ── */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const supabase = createClient()
  const [pw1, setPw1]       = useState("")
  const [pw2, setPw2]       = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (pw1.length < 8) {
      toast.error("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
      return
    }
    if (pw1 !== pw2) {
      toast.error("รหัสผ่านไม่ตรงกัน")
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pw1 })
    setSaving(false)
    if (error) {
      toast.error(`เปลี่ยนรหัสผ่านไม่สำเร็จ: ${error.message}`)
      return
    }
    toast.success("เปลี่ยนรหัสผ่านแล้ว")
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-brand-500" />
            เปลี่ยนรหัสผ่าน
          </p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">รหัสผ่านใหม่</label>
            <input
              type="password"
              value={pw1}
              onChange={e => setPw1(e.target.value)}
              autoFocus
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:ring-2 ring-brand-500/30"
              placeholder="อย่างน้อย 8 ตัวอักษร"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">ยืนยันรหัสผ่านใหม่</label>
            <input
              type="password"
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void submit()}
              className="w-full text-sm bg-background border rounded-lg px-3 py-2 outline-none focus:ring-2 ring-brand-500/30"
              placeholder="พิมพ์รหัสผ่านอีกครั้ง"
            />
          </div>
          <button
            onClick={() => void submit()}
            disabled={saving || !pw1 || !pw2}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-semibold
              hover:bg-brand-600 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            บันทึกรหัสผ่านใหม่
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Main component ── */
export function ProfileClient({
  userId, name, email, role, orgName, orgPlan, avatarUrl, joinedAt, dateOfBirth, activityLogs, lineConnection,
}: ProfileProps) {
  const [tab, setTab]           = useState<ProfileTab>("info")
  const [avatar, setAvatar]     = useState(avatarUrl)
  const [pwModalOpen, setPwModalOpen] = useState(false)
  const [isPending, startTrans] = useTransition()
  const router                  = useRouter()
  const supabase                = createClient()

  const handleSaveName = async (newName: string) => {
    const { error } = await supabase.from("users").update({ full_name: newName }).eq("id", userId)
    if (error) toast.error("ไม่สามารถบันทึกชื่อได้")
    else { toast.success("บันทึกชื่อแล้ว"); router.refresh() }
  }

  const handleSaveDob = async (newDob: string) => {
    const { error } = await supabase.from("users").update({ date_of_birth: newDob || null }).eq("id", userId)
    if (error) toast.error("ไม่สามารถบันทึกวันเกิดได้")
    else { toast.success("บันทึกวันเกิดแล้ว"); router.refresh() }
  }

  const handleLogout = () => {
    startTrans(async () => {
      await supabase.auth.signOut()
      router.push("/login")
    })
  }

  return (
    <div className="page-narrow animate-fade-in space-y-6">

      {/* ── Hero card ── */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        {/* Gradient banner */}
        <div className="h-28 bg-gradient-to-br from-brand-500 via-brand-600 to-purple-600 relative">
          <div className="absolute inset-0 opacity-20"
            style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)", backgroundSize: "30px 30px" }} />
        </div>

        <div className="px-6 pb-6">
          <div className="-mt-12 flex items-end justify-between gap-4 mb-4">
            <AvatarSection
              userId={userId}
              name={name}
              avatarUrl={avatar}
              onAvatarChange={url => { setAvatar(url); router.refresh() }}
            />
            <a href="#profile-account" className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border
              hover:bg-muted transition-colors mb-1">
              <Edit2 className="w-3.5 h-3.5" />
              แก้ไขโปรไฟล์
            </a>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{name}</h1>
              <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full", roleBg[role] ?? roleBg.member)}>
                {roleLabel[role] ?? role}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{email}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                <span className="truncate">{orgName}</span>
                <span className={cn("shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase",
                  orgPlan === "pro" ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"
                )}>
                  {profilePlanLabel(orgPlan)}
                </span>
              </span>
              {joinedAt && (
                <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                  <Clock className="w-3.5 h-3.5" />
                  เข้าร่วม {new Date(joinedAt).toLocaleDateString("th-TH", { month: "long", year: "numeric" })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 p-1 bg-muted/60 rounded-xl">
        {profileTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 py-2 text-sm font-medium rounded-lg transition-all",
              tab === t.key
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: ข้อมูลส่วนตัว ── */}
      {tab === "info" && (
        <div className="space-y-4">
          <div id="profile-account" className="space-y-2 scroll-mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">บัญชี</p>
            <EditableField label="ชื่อ-นามสกุล" value={name}  icon={User}  editable onSave={handleSaveName} />
            <EditableField label="วันเกิด" value={dateOfBirth ?? ""} type="date" icon={Cake} editable onSave={handleSaveDob} />
            <EditableField label="อีเมล"         value={email} icon={Mail}             />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">องค์กรและบทบาท</p>
            <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/40">
              <div className="w-9 h-9 rounded-xl bg-background border flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-0.5">องค์กรปัจจุบัน</p>
                <p className="text-sm font-medium">{orgName}</p>
              </div>
              <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full", roleBg[role] ?? roleBg.member)}>
                {roleLabel[role] ?? role}
              </span>
            </div>
          </div>

          {/* Linked accounts — real data */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">บัญชีที่เชื่อมต่อ</p>
            {/* LINE connection */}
            <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors">
              <div className="w-9 h-9 rounded-xl bg-[#06C755]/10 flex items-center justify-center shrink-0">
                <MessageCircle className="w-4 h-4 text-[#06C755]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">LINE</p>
                <p className="text-xs text-muted-foreground">
                  {lineConnection
                    ? `${lineConnection.display_name ?? "@LINE"} · เชื่อมเมื่อ ${new Date(lineConnection.created_at).toLocaleDateString("th-TH", { month: "short", year: "2-digit" })}`
                    : "ยังไม่ได้เชื่อมต่อ"}
                </p>
              </div>
              <Link href="/settings/integrations" className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:bg-muted">
                {lineConnection ? "จัดการ" : "เชื่อมต่อ"}
              </Link>
            </div>
          </div>

          {/* Recent activity — real from user_activity_logs */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">กิจกรรมล่าสุด</p>
            <div className="rounded-xl border bg-card overflow-hidden divide-y">
              {activityLogs.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                  ยังไม่มีกิจกรรม
                </div>
              ) : (
                activityLogs.map((a) => {
                  const meta = ACTION_LABEL[a.action]
                  const Icon = meta?.icon ?? FileText
                  const color = meta?.color ?? "text-muted-foreground"
                  return (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                      <Icon className={cn("w-4 h-4 shrink-0", color)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{meta?.label ?? a.action}</p>
                        {a.detail && (
                          <p className="text-xs text-muted-foreground truncate">{a.detail}</p>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">{relTime(a.created_at)}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: ความปลอดภัย ── */}
      {tab === "security" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setPwModalOpen(true)}
            className="w-full text-left flex items-center gap-3 p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors"
          >
            <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <Key className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">เปลี่ยนรหัสผ่าน</p>
              <p className="text-xs text-muted-foreground">อัปเดตรหัสผ่านของบัญชี</p>
            </div>
            <span className="text-xs font-medium text-brand-600">เปลี่ยนรหัสผ่าน</span>
          </button>

          {/* Auth method info */}
          <div className="rounded-xl border bg-emerald-500/5 border-emerald-500/20 px-4 py-3 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              บัญชีนี้ใช้ <span className="font-semibold">อีเมล + รหัสผ่าน</span> สำหรับการลงชื่อเข้าใช้
            </p>
          </div>
          <Link href="/privacy" className="block rounded-xl border bg-card p-4 hover:bg-muted/30 transition-colors">
            <p className="text-sm font-semibold">ความเป็นส่วนตัวและข้อมูลของคุณ</p>
            <p className="mt-1 text-xs text-muted-foreground">จัดการสิทธิ์ข้อมูล การส่งออกข้อมูล และคำขอลบบัญชีจากหน้าความเป็นส่วนตัว</p>
          </Link>
        </div>
      )}

      {pwModalOpen && <ChangePasswordModal onClose={() => setPwModalOpen(false)} />}

      {/* ── Logout ── */}
      <div className="pt-2 border-t">
        <button
          onClick={handleLogout}
          disabled={isPending}
          className="flex items-center gap-2 text-sm font-medium text-rose-500 hover:text-rose-600
            transition-colors disabled:opacity-60"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          ออกจากระบบ
        </button>
      </div>
    </div>
  )
}
