"use client"

import { useEffect, useState, useCallback } from "react"
import Link                                 from "next/link"
import { MessageSquare, Plus, Search, Users, Image as ImageIcon, Video as VideoIcon, FileText } from "lucide-react"
import ChatRoom from "./[id]/ChatRoom"

interface Conv {
  id: string
  type: string
  name: string
  avatarUrl: string | null
  updatedAt: string
  lastMessage: { body: string | null; msgType: string; senderName: string; createdAt: string } | null
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const [broken, setBroken] = useState(false)
  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        onError={() => setBroken(true)}
        alt={name}
        className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-background shadow-sm"
      />
    )
  }
  return (
    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center
      text-white font-bold text-lg shrink-0 ring-2 ring-background shadow-sm overflow-hidden">
      {name?.[0]?.toUpperCase() ?? "?"}
    </div>
  )
}

function LastMsg({ msg }: { msg: Conv["lastMessage"] }) {
  if (!msg) return <span className="text-muted-foreground text-xs">เริ่มสนทนา...</span>
  if (msg.msgType === "image") return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs"><ImageIcon className="w-3 h-3" />รูปภาพ</span>
  )
  if (msg.msgType === "video") return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs"><VideoIcon className="w-3 h-3" />วิดีโอ</span>
  )
  if (msg.msgType === "file") return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs"><FileText className="w-3 h-3" />ไฟล์แนบ</span>
  )
  if (msg.msgType === "payment_request") return <span className="text-xs text-amber-600">💸 คำขอชำระเงิน</span>
  return <span className="text-xs text-muted-foreground truncate">{msg.senderName ? `${msg.senderName}: ` : ""}{msg.body ?? ""}</span>
}

function timeLabel(iso: string) {
  const d = new Date(iso), now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days === 0) return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
  if (days === 1) return "เมื่อวาน"
  if (days < 7)  return d.toLocaleDateString("th-TH", { weekday: "short" })
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })
}

export default function MessagesPage() {
  const [convs, setConvs]     = useState<Conv[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState("")
  const [activeId, setActiveId]     = useState<string | null>(null)
  const [activeConv, setActiveConv] = useState<Conv | null>(null)
  const [currentUserId, setCurrentUserId] = useState("")

  const load = useCallback(async () => {
    const [convRes, userRes] = await Promise.all([
      fetch("/api/conversations"),
      fetch("/api/auth/me").catch(() => null),
    ])
    const j = await convRes.json()
    setConvs(j.conversations ?? [])
    setLoading(false)
    if (userRes?.ok) {
      const u = await userRes.json().catch(() => ({}))
      setCurrentUserId(u.id ?? "")
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!activeId) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [activeId, load])

  // Deep-link support — clicking "แชท" elsewhere in the app (e.g. the
  // friends list) navigates to /messages#<conversationId>. The hash was
  // previously never read, so the conversation never actually opened —
  // this just showed the empty "เลือกการสนทนา" state even with a valid id
  // in the URL. Runs once conversations have loaded so the match can find
  // the right one.
  useEffect(() => {
    if (loading || activeId) return
    const hashId = window.location.hash.slice(1)
    if (!hashId) return
    const match = convs.find(c => c.id === hashId)
    if (match) openConv(match)
  }, [loading, activeId, convs])

  function openConv(c: Conv) {
    setActiveId(c.id)
    setActiveConv(c)
    window.history.replaceState(null, "", `/messages#${c.id}`)
  }
  const filtered = convs.filter(c => !search || c.name?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background">

      {/* ── Conversation list ── */}
      <aside className={`flex flex-col border-r border-border bg-background shrink-0
        ${activeId ? "hidden md:flex md:w-80 lg:w-96" : "flex w-full md:w-80 lg:w-96"}`}>

        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <h1 className="text-lg font-bold flex items-center gap-2 text-foreground">
            <MessageSquare className="w-5 h-5 text-brand-500" />ข้อความ
          </h1>
          <Link href="/social/friends"
            className="w-8 h-8 rounded-lg bg-brand-500 text-white flex items-center justify-center hover:bg-brand-600 transition-colors" title="แชทใหม่">
            <Plus className="w-4 h-4" />
          </Link>
        </div>

        <div className="px-3 py-2.5 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาการสนทนา..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted rounded-xl outline-none focus:ring-2 focus:ring-brand-500/30 placeholder:text-muted-foreground" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && [...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-3 px-4 py-3 animate-pulse">
              <div className="w-12 h-12 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-3 bg-muted rounded w-3/4" /><div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4 py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                <Users className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="font-semibold text-foreground">ยังไม่มีการสนทนา</p>
              <p className="text-sm text-muted-foreground -mt-2">เริ่มแชทกับเพื่อนของคุณ</p>
              <Link href="/social/friends"
                className="px-4 py-2 bg-brand-500 text-white rounded-xl text-sm font-medium hover:bg-brand-600 transition-colors">
                ค้นหาเพื่อน
              </Link>
            </div>
          )}

          {filtered.map(c => (
            <button key={c.id} onClick={() => openConv(c)}
              className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left
                ${activeId === c.id ? "bg-brand-500/10 border-r-2 border-brand-500" : "hover:bg-muted/60"}`}>
              <Avatar name={c.name} avatarUrl={c.avatarUrl} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-sm text-foreground truncate">{c.name}</span>
                  {c.updatedAt && <span className="text-[10px] text-muted-foreground shrink-0">{timeLabel(c.updatedAt)}</span>}
                </div>
                <div className="mt-0.5"><LastMsg msg={c.lastMessage} /></div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Chat area ── */}
      <main className={`flex-1 flex flex-col min-w-0 ${!activeId ? "hidden md:flex" : "flex"}`}>
        {activeId && activeConv ? (
          <ChatRoom
            convId={activeId}
            convName={activeConv.name}
            convAvatarUrl={activeConv.avatarUrl}
            currentUserId={currentUserId}
            onBack={() => { setActiveId(null); setActiveConv(null); window.history.replaceState(null, "", "/messages") }}
            onNewMessage={load}
            embedded
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
            <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center">
              <MessageSquare className="w-10 h-10 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground text-lg">เลือกการสนทนา</p>
            <p className="text-muted-foreground text-sm -mt-2">หรือเริ่มแชทใหม่กับเพื่อนของคุณ</p>
          </div>
        )}
      </main>
    </div>
  )
}
