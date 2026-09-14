"use client"
import { useEffect, useState } from "react"
import { Loader2, AlertCircle, UserPlus, Check, X, Search, Users } from "lucide-react"

type AuthStatus = "checking" | "outsideLine" | "needLogin" | "ready" | "authError"

interface Friend {
  friendshipId: string
  friend: { id: string; full_name: string; avatar_url: string | null }
}
interface Pending {
  id: string
  requester: { id: string; full_name: string; avatar_url: string | null }
}
interface SearchUser {
  id: string
  full_name: string
  avatar_url: string | null
  hint: string
}

export default function LiffFriendsPage() {
  const [status, setStatus]       = useState<AuthStatus>("checking")
  const [lineUserId, setLineUserId] = useState("")
  const [tab, setTab]             = useState<"friends" | "search" | "pending">("friends")
  const [friends, setFriends]     = useState<Friend[]>([])
  const [pending, setPending]     = useState<Pending[]>([])
  const [query, setQuery]         = useState("")
  const [results, setResults]     = useState<SearchUser[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [sentIds, setSentIds]     = useState<Set<string>>(new Set())

  useEffect(() => { initLiff() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function initLiff() {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID
    if (!liffId) { setStatus("authError"); return }
    try {
      const { default: liff } = await import("@line/liff")
      await liff.init({ liffId })
      if (!liff.isInClient()) { setStatus("outsideLine"); return }
      if (!liff.isLoggedIn()) { setStatus("needLogin"); return }
      const p = await liff.getProfile()
      setLineUserId(p.userId)
      setStatus("ready")
      await loadFriends(p.userId)
    } catch { setStatus("authError") }
  }

  async function loadFriends(uid: string) {
    const res = await fetch(`/api/liff/friends?lineUserId=${uid}`)
    const j   = await res.json()
    setFriends(j.friends ?? [])
    setPending(j.pending ?? [])
  }

  async function handleLineLogin() {
    const { default: liff } = await import("@line/liff")
    liff.login({ redirectUri: window.location.href.split("#")[0] })
  }

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.length < 2) { setResults([]); return }
      setSearchLoading(true)
      const res = await fetch(`/api/liff/friends?lineUserId=${lineUserId}&q=${encodeURIComponent(query)}`)
      const j   = await res.json()
      setResults(j.users ?? [])
      setSearchLoading(false)
    }, 400)
    return () => clearTimeout(t)
  }, [query, lineUserId])

  async function addFriend(addresseeId: string) {
    await fetch("/api/liff/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineUserId, addresseeId, action: "add" }),
    })
    setSentIds(prev => new Set([...prev, addresseeId]))
  }

  async function respond(friendshipId: string, action: "accept" | "decline") {
    await fetch("/api/liff/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineUserId, friendshipId, action }),
    })
    await loadFriends(lineUserId)
  }

  if (status === "checking") return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3">
      <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      <p className="text-sm text-gray-500">กำลังโหลด...</p>
    </div>
  )

  if (status === "outsideLine") return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
      <AlertCircle className="w-12 h-12 text-amber-500" />
      <p className="text-gray-700 font-medium">เปิดใน LINE เท่านั้น</p>
    </div>
  )

  if (status === "needLogin") return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
      <AlertCircle className="w-12 h-12 text-blue-500" />
      <p className="text-gray-700">กรุณาเข้าสู่ระบบก่อน</p>
      <button onClick={() => void handleLineLogin()} className="px-5 py-2.5 rounded-xl bg-[#06c755] text-white font-semibold">
        เข้าสู่ระบบด้วย LINE
      </button>
    </div>
  )

  if (status === "authError") return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
      <AlertCircle className="w-12 h-12 text-red-500" />
      <p className="text-gray-700">เชื่อมต่อ LINE ไม่สำเร็จ</p>
      <button onClick={() => void initLiff()} className="px-5 py-2.5 rounded-xl bg-gray-900 text-white font-semibold">
        ลองใหม่
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="bg-white border-b px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900">เพื่อน</h1>
      </div>

      {/* Tabs */}
      <div className="px-4 py-3 flex gap-1 bg-white border-b">
        {(["friends", "pending", "search"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? "bg-green-500 text-white" : "text-gray-500 bg-gray-100"
            }`}
          >
            {t === "friends" ? `เพื่อน (${friends.length})`
              : t === "pending" ? `รอตอบ (${pending.length})`
              : "ค้นหา"}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-3">
        {tab === "friends" && (
          friends.length === 0
            ? <div className="text-center py-8 text-gray-400"><Users className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>ยังไม่มีเพื่อน</p></div>
            : friends.map(f => (
              <div key={f.friendshipId} className="flex items-center gap-3 p-3 bg-white rounded-xl">
                {f.friend?.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={f.friend.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" />
                  : <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">👤</div>
                }
                <p className="flex-1 font-medium text-gray-900">{f.friend?.full_name ?? "—"}</p>
              </div>
            ))
        )}

        {tab === "pending" && (
          pending.length === 0
            ? <div className="text-center py-8 text-gray-400">ไม่มีคำขอรอตอบ</div>
            : pending.map(p => (
              <div key={p.id} className="flex items-center gap-3 p-3 bg-white rounded-xl">
                {p.requester?.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.requester.avatar_url} className="w-10 h-10 rounded-full object-cover" alt="" />
                  : <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">👤</div>
                }
                <p className="flex-1 font-medium text-gray-900">{p.requester?.full_name ?? "—"}</p>
                <button onClick={() => respond(p.id, "accept")} className="w-8 h-8 bg-green-500 text-white rounded-lg flex items-center justify-center">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => respond(p.id, "decline")} className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))
        )}

        {tab === "search" && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="ชื่อ / เบอร์ / อีเมล"
                className="w-full pl-10 pr-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 text-sm bg-white"
              />
            </div>
            {searchLoading && <div className="text-center text-gray-400 text-sm">ค้นหา...</div>}
            {results.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 bg-white rounded-xl">
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">👤</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{u.full_name}</p>
                  <p className="text-xs text-gray-400">{u.hint}</p>
                </div>
                {sentIds.has(u.id) ? (
                  <span className="text-xs text-gray-400">ส่งแล้ว ✓</span>
                ) : (
                  <button
                    onClick={() => addFriend(u.id)}
                    className="px-3 py-1.5 bg-green-50 text-green-600 rounded-lg text-sm font-medium flex items-center gap-1 border border-green-200"
                  >
                    <UserPlus className="w-3 h-3" />เพิ่ม
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
