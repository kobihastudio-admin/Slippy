/**
 * /liff/dashboard — Modern Dashboard (LIFF mini-app)
 *
 * Life Score hero, activity cards, expense charts, quick actions, and activity feed.
 */

"use client"

import { useEffect, useState } from "react"
import { useAppLoading } from "@/lib/loading"
import {
  Loader2, AlertCircle, Camera, Receipt, Heart, Plane, FileText, Bell,
  CheckCircle2, AlertTriangle, FileBadge, Zap, Mail, BarChart3, TrendingUp,
  Wallet, Pill, Map, ChevronRight, RefreshCcw,
} from "lucide-react"
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, PieChart, Pie, Tooltip } from "recharts"

type AuthStatus = "checking" | "needLogin" | "outsideLine" | "ready" | "authError"

interface DashboardData {
  totalDocs: number
  pendingDocs: number
  monthlyCount: number
  monthlyTotal: number
  lifeScore: { wealth_score: number; lifestyle_score: number; journey_score: number; social_score: number; overall_score: number } | null
  unpaidBillsCount: number
  unpaidTotal: number
  upcomingTrips: { id: string; title: string; memberCount: number }[]
  todayMedCount: number
  todayMeds: { id: string; name: string; scheduledAt: string }[]
  recentScans: { id: string; url: string | null; status: string; createdAt: string }[]
  recentDocs: { id: string; vendorName: string | null; totalAmount: number | null; status: string; createdAt: string }[]
  notifications: { id: string; type: string; title: string; body: string | null; read: boolean; relTime: string }[]
  barData: { label: string; total: number }[]
  donutData: { name: string; value: number }[]
}

const DONUT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"]
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID as string

function fmtThb(n: number) {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `฿${(n / 1_000).toFixed(1)}K`
  return "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function LifeScoreRing({ score }: { score: number }) {
  const r = 54
  const circ = 2 * Math.PI * r
  const arc  = circ * 0.75
  const fill = arc * (score / 100)
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#6366f1" : score >= 40 ? "#f59e0b" : "#ef4444"
  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 140 140" className="w-full h-full -rotate-[135deg]">
        <circle cx={70} cy={70} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={10}
          strokeDasharray={`${arc} ${circ - arc}`} strokeLinecap="round" />
        <circle cx={70} cy={70} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${fill} ${circ - fill}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: "stroke-dasharray 1s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black text-white">{score}</span>
        <span className="text-[10px] text-white/60 mt-0.5">Life Score</span>
      </div>
    </div>
  )
}

function ActivityCard({ icon: Icon, label, value, sub, color, accent }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string; accent: string
}) {
  return (
    <div className={`shrink-0 w-36 rounded-2xl p-4 ${color} flex flex-col gap-2`}>
      <div className={`w-9 h-9 rounded-xl ${accent} flex items-center justify-center`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div>
        <p className="text-xs text-white/70 leading-none">{label}</p>
        <p className="text-lg font-bold text-white leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-[10px] text-white/60 leading-none mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function LiffDashboard() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking")
  const [authError,  setAuthError]  = useState("")
  const [loggingIn,  setLoggingIn]  = useState(false)
  const [profile, setProfile] = useState<{ userId: string; displayName: string; pictureUrl?: string } | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoadingState] = useState(false)
  const [needsConnect, setNeedsConnect] = useState(false)
  const { setLoading } = useAppLoading()

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoading(true)
      try {
        const liff = (await import("@line/liff")).default
        await liff.init({ liffId: LIFF_ID })
        if (cancelled) return
        if (!liff.isInClient()) { setAuthStatus("outsideLine"); setLoading(false); return }
        if (!liff.isLoggedIn()) { setAuthStatus("needLogin"); setLoading(false); return }
        const p = await liff.getProfile()
        if (cancelled) return
        setProfile(p)
        setAuthStatus("ready")
        fetchDashboard(p.userId)
      } catch (e: any) {
        if (!cancelled) { setAuthError(e?.message ?? String(e)); setAuthStatus("authError") }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [setLoading])

  async function fetchDashboard(uid: string) {
    setLoadingState(true)
    try {
      const r = await fetch(`/api/liff/dashboard?lineUserId=${encodeURIComponent(uid)}`)
      const d = await r.json()
      if (d.needsConnect) { setNeedsConnect(true); return }
      setData(d)
    } catch {}
    finally { setLoadingState(false) }
  }

  // ── Auth gates ─────────────────────────────────────────────────────────────
  if (authStatus === "checking") return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  )
  if (authStatus === "outsideLine") return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center bg-background">
      <AlertCircle className="w-12 h-12 text-yellow-500" />
      <p className="text-lg font-semibold">เปิดใน LINE เท่านั้น</p>
    </div>
  )
  if (authStatus === "needLogin") return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 p-6 bg-background">
      <BarChart3 className="w-16 h-16 text-primary" />
      <div className="text-center">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-2 text-sm">เข้าสู่ระบบเพื่อดูภาพรวม</p>
      </div>
      <button disabled={loggingIn} onClick={async () => {
        setLoggingIn(true)
        const liff = (await import("@line/liff")).default
        liff.login()
      }} className="flex items-center gap-2 bg-[#00B900] text-white font-bold px-8 py-3 rounded-2xl disabled:opacity-50">
        {loggingIn && <Loader2 className="w-5 h-5 animate-spin" />}
        เข้าสู่ระบบด้วย LINE
      </button>
    </div>
  )
  if (authStatus === "authError") return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center bg-background">
      <AlertCircle className="w-12 h-12 text-destructive" />
      <p className="font-semibold">เกิดข้อผิดพลาด</p>
      <p className="text-sm text-muted-foreground">{authError}</p>
    </div>
  )
  if (needsConnect) return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center bg-background">
      <AlertCircle className="w-12 h-12 text-yellow-500" />
      <p className="font-semibold">ยังไม่ได้เชื่อมบัญชี</p>
      <p className="text-sm text-muted-foreground">พิมพ์ /connect ในแชท Slippy เพื่อเริ่มต้น</p>
    </div>
  )

  const score = data?.lifeScore?.overall_score ?? 0
  const todoCount = (data?.pendingDocs ?? 0) + (data?.unpaidBillsCount ?? 0) + (data?.todayMedCount ?? 0)

  // ── Main UI ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* Hero gradient banner */}
      <div className="relative bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 px-5 pt-12 pb-8 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/5 -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full bg-white/5 translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-white/70 text-sm mb-1">สวัสดี,</p>
            <h1 className="text-2xl font-black text-white leading-tight">{profile?.displayName?.split(" ")[0] ?? "คุณ"}</h1>
            {todoCount > 0 && (
              <p className="text-white/80 text-sm mt-1">มี {todoCount} รายการรอดำเนินการ</p>
            )}
          </div>
          <LifeScoreRing score={score} />
        </div>

        {/* Life score sub-scores */}
        {data?.lifeScore && (
          <div className="relative z-10 mt-4 grid grid-cols-4 gap-1.5">
            {[
              { label: "Wealth",    v: data.lifeScore.wealth_score    },
              { label: "Lifestyle", v: data.lifeScore.lifestyle_score },
              { label: "Journey",   v: data.lifeScore.journey_score   },
              { label: "Social",    v: data.lifeScore.social_score    },
            ].map(({ label, v }) => (
              <div key={label} className="bg-white/10 rounded-xl p-2 text-center">
                <p className="text-white font-bold text-sm">{v}</p>
                <p className="text-white/60 text-[9px] leading-none mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 px-4 pt-5 pb-8 space-y-6">

        {/* Quick actions 2×2 */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: Camera,  label: "สแกนสลิป",    href: "/liff/scan",      color: "bg-violet-500/10 text-violet-600" },
            { icon: Receipt, label: "สร้างบิล",     href: "/liff/split",     color: "bg-blue-500/10 text-blue-600" },
            { icon: Pill,    label: "บันทึกยา",     href: "/liff/health",    color: "bg-emerald-500/10 text-emerald-600" },
            { icon: Map,     label: "ดูทริป",       href: "/liff/trip",      color: "bg-orange-500/10 text-orange-600" },
          ].map(({ icon: Icon, label, href, color }) => (
            <button key={label} onClick={() => window.location.href = href}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl ${color} border border-current/10`}>
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold leading-tight text-center">{label}</span>
            </button>
          ))}
        </div>

        {/* Activity cards — horizontal scroll */}
        <div>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">กิจกรรม</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none">
            {loading ? (
              <div className="w-36 h-24 rounded-2xl bg-muted animate-pulse shrink-0" />
            ) : (
              <>
                <ActivityCard icon={FileText}   label="สลิปรอตรวจสอบ"   value={String(data?.pendingDocs ?? 0)}        sub={`/ ${data?.totalDocs ?? 0} ทั้งหมด`}    color="bg-gradient-to-br from-blue-500 to-blue-700"    accent="bg-blue-400" />
                <ActivityCard icon={Wallet}     label="บิลที่ค้างชำระ"   value={String(data?.unpaidBillsCount ?? 0)}   sub={data?.unpaidTotal ? fmtThb(data.unpaidTotal) : ""}  color="bg-gradient-to-br from-rose-500 to-rose-700"    accent="bg-rose-400" />
                <ActivityCard icon={Pill}       label="ยาวันนี้"          value={String(data?.todayMedCount ?? 0)}      sub="มื้อที่รอ"     color="bg-gradient-to-br from-emerald-500 to-emerald-700"  accent="bg-emerald-400" />
                <ActivityCard icon={Plane}      label="ทริปที่เปิดอยู่"   value={String(data?.upcomingTrips?.length ?? 0)}  sub="กลุ่ม"      color="bg-gradient-to-br from-amber-500 to-amber-700"  accent="bg-amber-400" />
              </>
            )}
          </div>
        </div>

        {/* Expense bar chart */}
        {data?.barData && data.barData.some(b => b.total > 0) && (
          <div className="bg-card rounded-2xl p-4 border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-sm">ค่าใช้จ่าย 6 เดือน</h2>
              <span className="text-xs text-muted-foreground">{fmtThb(data.monthlyTotal)} เดือนนี้</span>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={data.barData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                  {data.barData.map((_, i) => (
                    <Cell key={i} fill={i === data.barData.length - 1 ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.3)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Donut chart */}
        {data?.donutData && data.donutData.length > 0 && (
          <div className="bg-card rounded-2xl p-4 border">
            <h2 className="font-bold text-sm mb-4">หมวดหมู่เดือนนี้</h2>
            <div className="flex gap-4 items-center">
              <PieChart width={100} height={100}>
                <Pie data={data.donutData} cx={46} cy={46} innerRadius={28} outerRadius={46}
                  dataKey="value" paddingAngle={2}>
                  {data.donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtThb(v)} />
              </PieChart>
              <div className="flex-1 space-y-1.5">
                {data.donutData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="text-xs text-muted-foreground flex-1 truncate">{d.name}</span>
                    <span className="text-xs font-medium">{fmtThb(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Today's meds */}
        {data?.todayMeds && data.todayMeds.length > 0 && (
          <div className="bg-card rounded-2xl p-4 border">
            <h2 className="font-bold text-sm mb-3 flex items-center gap-2">
              <Pill className="w-4 h-4 text-emerald-500" /> ยาวันนี้
            </h2>
            <div className="space-y-2">
              {data.todayMeds.map(m => (
                <div key={m.id} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Pill className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(m.scheduledAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <button
                    onClick={() => window.location.href = "/liff/health"}
                    className="text-xs text-emerald-600 font-medium"
                  >
                    บันทึก
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Insight */}
        {data && data.monthlyTotal > 0 && (
          <div className="bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border border-violet-500/20 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="font-semibold text-sm">AI Insight</p>
                <p className="text-sm text-muted-foreground mt-1">
                  เดือนนี้ใช้จ่าย {fmtThb(data.monthlyTotal)} จาก {data.monthlyCount} รายการ
                  {data.unpaidBillsCount > 0 && ` · มีบิลค้างชำระ ${data.unpaidBillsCount} รายการ`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Recent documents */}
        {data?.recentDocs && data.recentDocs.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">เอกสารล่าสุด</h2>
            <div className="space-y-2">
              {data.recentDocs.slice(0, 4).map(doc => {
                const statusColor = doc.status === "approved" || doc.status === "pushed" ? "text-emerald-600" :
                  doc.status === "reviewing" ? "text-amber-600" : "text-rose-600"
                const statusLabel = doc.status === "approved" ? "อนุมัติ" : doc.status === "pushed" ? "บันทึกแล้ว" :
                  doc.status === "reviewing" ? "รอตรวจสอบ" : "ล้มเหลว"
                return (
                  <div key={doc.id} className="flex items-center gap-3 p-3 bg-card rounded-2xl border">
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.vendorName ?? "ไม่ระบุร้าน"}</p>
                      <p className="text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {doc.totalAmount != null && <p className="text-sm font-bold">{fmtThb(doc.totalAmount)}</p>}
                      <p className={`text-[10px] font-medium ${statusColor}`}>{statusLabel}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Refresh button */}
        <button
          onClick={() => profile && fetchDashboard(profile.userId)}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border text-muted-foreground text-sm disabled:opacity-40"
        >
          <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "กำลังโหลด..." : "รีเฟรช"}
        </button>
      </div>
    </div>
  )
}
