/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

"use client"

import { useEffect, useState, useCallback } from "react"
import { toast }        from "sonner"
import { Icons }        from "@/components/ui/icons"
import { cn }           from "@/lib/utils"
import AddFriendModal   from "./AddFriendModal"
import ChatRoom          from "../../messages/[id]/ChatRoom"

interface Friend {
  friendshipId: string
  source: string
  friend: { id: string; full_name: string; avatar_url: string | null }
}
interface PendingReq {
  id: string
  requester: { id: string; full_name: string; avatar_url: string | null }
}
interface SentReq {
  id: string
  addressee: { id: string; full_name: string; avatar_url: string | null }
}
interface SearchUser {
  id: string
  full_name: string
  avatar_url: string | null
  hint: string
}

const SOURCE_META: Record<string, string> = {
  line_mutual: "📲 เพื่อนจาก LINE",
  qr_scan:     "📷 เพิ่มจาก QR",
}

function initials(name: string) {
  return (name || "?").trim().slice(0, 2).toUpperCase()
}

function Avatar({ url, name, size = 44 }: { url: string | null; name: string; size?: number }) {
  const style = { width: size, height: size }
  const [broken, setBroken] = useState(false)
  return url && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      style={style}
      onError={() => setBroken(true)}
      className="rounded-full object-cover flex-shrink-0 ring-1 ring-border"
    />
  ) : (
    <div
      style={style}
      className="rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300
        flex items-center justify-center flex-shrink-0 font-semibold text-sm ring-1 ring-border overflow-hidden"
    >
      {initials(name)}
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 bg-card border border-border rounded-[14px] animate-pulse">
      <div className="w-11 h-11 rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 rounded bg-muted" />
        <div className="h-2.5 w-20 rounded bg-muted" />
      </div>
    </div>
  )
}

function EmptyState({ icon: Icon, title, hint }: { icon: any; title: string; hint?: string }) {
  return (
    <div className="text-center py-14 text-muted-foreground">
      <Icon size={40} strokeWidth={1.3} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs mt-1 opacity-70">{hint}</p>}
    </div>
  )
}

interface ActiveChat {
  convId:    string
  name:      string
  avatarUrl: string | null
}

export default function FriendsClient() {
  const [tab, setTab]                     = useState<"friends" | "search" | "pending">("friends")
  const [friends, setFriends]             = useState<Friend[]>([])
  const [pending, setPending]             = useState<PendingReq[]>([])
  const [sentList, setSentList]           = useState<SentReq[]>([])
  const [query, setQuery]                 = useState("")
  const [results, setResults]             = useState<SearchUser[]>([])
  const [inviteUrl, setInviteUrl]         = useState("")
  const [showAddModal, setShowAddModal]   = useState(false)
  const [loadingList, setLoadingList]     = useState(true)
  const [searching, setSearching]         = useState(false)
  const [sentIds, setSentIds]             = useState<Set<string>>(new Set())
  const [startingChat, setStartingChat]   = useState<string | null>(null)
  const [respondingId, setRespondingId]   = useState<string | null>(null)
  const [activeChat, setActiveChat]       = useState<ActiveChat | null>(null)
  const [currentUserId, setCurrentUserId] = useState("")

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/friends")
      if (!res.ok) throw new Error()
      const json = await res.json()
      setFriends(json.friends ?? [])
      setPending(json.pendingReceived ?? [])
      setSentList(json.pendingSent ?? [])
    } catch {
      toast.error("โหลดรายชื่อเพื่อนไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setLoadingList(false)
    }
  }, [])

  const loadInvite = useCallback(async () => {
    try {
      const res  = await fetch("/api/friends/invite")
      const json = await res.json()
      setInviteUrl(json.url ?? "")
    } catch { /* invite link is optional UI — silent fail */ }
  }, [])

  useEffect(() => {
    load()
    loadInvite()
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(u => setCurrentUserId(u?.id ?? "")).catch(() => {})
  }, [load, loadInvite])

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const res  = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`)
      const json = await res.json()
      setResults(json.users ?? [])
    } catch {
      toast.error("ค้นหาไม่สำเร็จ")
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(query), 400)
    return () => clearTimeout(t)
  }, [query, search])

  async function sendRequest(addresseeId: string) {
    setSentIds(prev => new Set(prev).add(addresseeId))
    try {
      const res = await fetch("/api/friends", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ addresseeId }),
      })
      if (!res.ok) throw new Error()
      toast.success("ส่งคำขอเพื่อนแล้ว")
      load()
    } catch {
      toast.error("ส่งคำขอไม่สำเร็จ")
      setSentIds(prev => { const next = new Set(prev); next.delete(addresseeId); return next })
    }
  }

  async function respond(id: string, action: "accept" | "decline") {
    setRespondingId(id)
    try {
      const res = await fetch(`/api/friends/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error()
      if (action === "accept") toast.success("เพิ่มเพื่อนเรียบร้อย 🎉")
      load()
    } catch {
      toast.error("ทำรายการไม่สำเร็จ")
    } finally {
      setRespondingId(null)
    }
  }

  async function startChat(userId: string, name: string, avatarUrl: string | null) {
    setStartingChat(userId)
    try {
      const res = await fetch("/api/conversations", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type: "direct", memberIds: [userId] }),
      })
      const j = await res.json()
      if (j.conversation?.id) {
        // Opens inline in a modal on this same page — no navigation, so you
        // never lose your place in the friends list mid-chat.
        setActiveChat({ convId: j.conversation.id, name, avatarUrl })
      } else {
        throw new Error()
      }
    } catch {
      toast.error("เปิดแชทไม่สำเร็จ")
    } finally {
      setStartingChat(null)
    }
  }

  const TABS = [
    { key: "friends" as const, label: "เพื่อน",     count: friends.length },
    { key: "pending" as const, label: "รอตอบรับ",   count: pending.length },
    { key: "search"  as const, label: "ค้นหา",       count: null },
  ]

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">เพื่อน</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {friends.length > 0 ? `${friends.length} คนในรายชื่อเพื่อนของคุณ` : "เชื่อมต่อกับเพื่อนของคุณใน Slippy"}
          </p>
        </div>
        {inviteUrl && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium
              hover:bg-brand-700 active:scale-[0.98] transition-all shadow-sm shrink-0"
          >
            <Icons.UserPlus size={16} strokeWidth={2} />
            <span className="hidden sm:inline">เพิ่มเพื่อน</span>
          </button>
        )}
      </div>

      {showAddModal && (
        <AddFriendModal inviteUrl={inviteUrl} onClose={() => setShowAddModal(false)} />
      )}

      {/* Tab bar */}
      <div className="flex gap-1 bg-muted p-1 rounded-xl">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span
                className={cn(
                  "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold",
                  tab === t.key ? "bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300" : "bg-background text-muted-foreground"
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Friends list */}
      {tab === "friends" && (
        <div className="space-y-2">
          {loadingList && <><RowSkeleton /><RowSkeleton /><RowSkeleton /></>}
          {!loadingList && friends.length === 0 && (
            <EmptyState
              icon={Icons.Users2}
              title="ยังไม่มีเพื่อน"
              hint="กดปุ่ม “เพิ่มเพื่อน” เพื่อค้นหา, สแกน QR หรือแชร์ลิงก์ชวนเพื่อน"
            />
          )}
          {!loadingList && friends.map(f => (
            <div
              key={f.friendshipId}
              role="button"
              tabIndex={0}
              onClick={() => startChat(f.friend?.id, f.friend?.full_name ?? "", f.friend?.avatar_url ?? null)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") startChat(f.friend?.id, f.friend?.full_name ?? "", f.friend?.avatar_url ?? null) }}
              className="flex items-center gap-3 p-3 bg-card border border-border rounded-[14px]
                hover:shadow-sm hover:border-brand-500/40 transition-all cursor-pointer"
            >
              <Avatar url={f.friend?.avatar_url ?? null} name={f.friend?.full_name ?? ""} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{f.friend?.full_name ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {SOURCE_META[f.source] ?? "🔍 เพิ่มจากการค้นหา"}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); startChat(f.friend?.id, f.friend?.full_name ?? "", f.friend?.avatar_url ?? null) }}
                disabled={startingChat === f.friend?.id}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300
                  rounded-lg text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors disabled:opacity-60 shrink-0"
              >
                {startingChat === f.friend?.id
                  ? <Icons.Loader size={16} />
                  : <Icons.MessageSquare size={16} strokeWidth={1.8} />}
                <span className="hidden xs:inline">แชท</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pending */}
      {tab === "pending" && (
        <div className="space-y-5">
          <div className="space-y-2">
            {!loadingList && pending.length === 0 && sentList.length === 0 && (
              <EmptyState icon={Icons.Clock} title="ไม่มีคำขอเพื่อนที่รอตอบรับ" />
            )}
            {pending.map(p => (
              <div
                key={p.id}
                className="flex items-center gap-3 p-3 bg-card border border-border rounded-[14px]"
              >
                <Avatar url={p.requester?.avatar_url ?? null} name={p.requester?.full_name ?? ""} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{p.requester?.full_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">ส่งคำขอเพื่อน</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => respond(p.id, "decline")}
                    disabled={respondingId === p.id}
                    className="w-9 h-9 bg-muted text-muted-foreground rounded-lg flex items-center justify-center
                      hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                    aria-label="ปฏิเสธ"
                  >
                    <Icons.X size={16} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => respond(p.id, "accept")}
                    disabled={respondingId === p.id}
                    className="w-9 h-9 bg-brand-600 text-white rounded-lg flex items-center justify-center
                      hover:bg-brand-700 transition-colors disabled:opacity-50"
                    aria-label="ยอมรับ"
                  >
                    {respondingId === p.id ? <Icons.Loader size={16} /> : <Icons.Check size={16} strokeWidth={2} />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {sentList.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                คำขอที่ส่งออก
              </p>
              {sentList.map(s => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 p-3 bg-card border border-border rounded-[14px] opacity-70"
                >
                  <Avatar url={s.addressee?.avatar_url ?? null} name={s.addressee?.full_name ?? ""} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{s.addressee?.full_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Icons.Clock size={12} /> รอการตอบรับ
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      {tab === "search" && (
        <div className="space-y-3">
          <div className="relative">
            <Icons.Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาด้วยชื่อ, เบอร์โทร, อีเมล"
              className="w-full pl-10 pr-9 py-3 bg-card border border-border rounded-xl text-sm text-foreground
                placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="ล้างคำค้นหา"
              >
                <Icons.X size={14} />
              </button>
            )}
          </div>

          {searching && <><RowSkeleton /><RowSkeleton /></>}
          {!searching && query.trim().length < 2 && (
            <EmptyState icon={Icons.Search} title="พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา" />
          )}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <EmptyState icon={Icons.Users2} title="ไม่พบผู้ใช้ที่ตรงกับคำค้นหา" />
          )}
          {!searching && results.map(u => (
            <div
              key={u.id}
              className="flex items-center gap-3 p-3 bg-card border border-border rounded-[14px]"
            >
              <Avatar url={u.avatar_url} name={u.full_name} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{u.full_name}</p>
                <p className="text-xs text-muted-foreground truncate">{u.hint}</p>
              </div>
              {sentIds.has(u.id) ? (
                <span className="text-xs text-muted-foreground px-3 shrink-0 flex items-center gap-1">
                  <Icons.Check size={13} /> ส่งแล้ว
                </span>
              ) : (
                <button
                  onClick={() => sendRequest(u.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300
                    border border-brand-200 dark:border-brand-800 rounded-lg text-sm font-medium
                    hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors shrink-0"
                >
                  <Icons.UserPlus size={15} strokeWidth={1.8} />
                  เพิ่มเพื่อน
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {activeChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setActiveChat(null)} />
          <div className="relative bg-card border border-border rounded-none sm:rounded-2xl shadow-2xl
            w-full h-full sm:h-[85vh] sm:max-w-lg overflow-hidden flex flex-col">
            <ChatRoom
              convId={activeChat.convId}
              convName={activeChat.name}
              convAvatarUrl={activeChat.avatarUrl}
              currentUserId={currentUserId}
              embedded
              onBack={() => setActiveChat(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
