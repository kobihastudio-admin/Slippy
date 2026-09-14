"use client"
import { useEffect, useRef, useState } from "react"
import { Loader2, AlertCircle, Send, ArrowLeft, MessageSquare } from "lucide-react"

type AuthStatus = "checking" | "outsideLine" | "needLogin" | "ready" | "authError"

interface Conv { id: string; name: string; lastMessage: string; updatedAt: string }
interface Msg  { id: string; body: string | null; sender_id: string; created_at: string }

export default function LiffChatPage() {
  const [status, setStatus]     = useState<AuthStatus>("checking")
  const [lineUserId, setLUID]   = useState("")
  const [userId, setUserId]     = useState("")
  const [convs, setConvs]       = useState<Conv[]>([])
  const [activeConv, setActiveConv] = useState<Conv | null>(null)
  const [msgs, setMsgs]         = useState<Msg[]>([])
  const [input, setInput]       = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

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
      setLUID(p.userId)
      setStatus("ready")
      await loadConvs(p.userId)
    } catch { setStatus("authError") }
  }

  async function handleLineLogin() {
    const { default: liff } = await import("@line/liff")
    liff.login({ redirectUri: window.location.href.split("#")[0] })
  }

  async function loadConvs(uid: string) {
    const res = await fetch(`/api/liff/chat?lineUserId=${uid}`)
    const j   = await res.json()
    setConvs(j.conversations ?? [])
    setUserId(j.userId ?? "")
  }

  async function openConv(conv: Conv) {
    setActiveConv(conv)
    setMsgs([])
    const res = await fetch(`/api/liff/chat?lineUserId=${lineUserId}&conversationId=${conv.id}&limit=40`)
    const j   = await res.json()
    setMsgs(j.messages ?? [])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
  }

  useEffect(() => {
    if (!activeConv || !lineUserId) return

    const poll = async () => {
      const res = await fetch(`/api/liff/chat?lineUserId=${lineUserId}&conversationId=${activeConv.id}&limit=40`)
      if (!res.ok) return
      const data = await res.json()
      setMsgs(data.messages ?? [])
    }

    const timer = window.setInterval(() => void poll(), 3000)
    return () => window.clearInterval(timer)
  }, [activeConv, lineUserId])

  async function send() {
    if (!input.trim() || !activeConv) return
    const body = input.trim()
    setInput("")
    const res = await fetch("/api/liff/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineUserId, conversationId: activeConv.id, body }),
    })
    if (res.ok) await openConv(activeConv)
  }

  if (status === "checking") return (
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
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
      <AlertCircle className="w-12 h-12 text-green-500" />
      <p className="text-gray-700 font-medium">กรุณาเข้าสู่ระบบด้วย LINE</p>
      <button onClick={() => void handleLineLogin()} className="px-5 py-2.5 rounded-xl bg-[#06c755] text-white font-semibold">
        เข้าสู่ระบบด้วย LINE
      </button>
    </div>
  )

  if (status === "authError") return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-6 text-center">
      <AlertCircle className="w-12 h-12 text-red-500" />
      <p className="text-gray-700 font-medium">เชื่อมต่อ LINE ไม่สำเร็จ</p>
      <button onClick={() => void initLiff()} className="px-5 py-2.5 rounded-xl bg-gray-900 text-white font-semibold">
        ลองใหม่
      </button>
    </div>
  )

  // Chat room view
  if (activeConv) return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => setActiveConv(null)} className="text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <p className="font-semibold text-gray-900">{activeConv.name}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {msgs.map(m => {
          const isMe = m.sender_id === userId
          return (
            <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] px-4 py-2 rounded-2xl text-sm ${
                isMe ? "bg-green-600 text-white rounded-tr-sm" : "bg-white border text-gray-800 rounded-tl-sm"
              }`}>
                {m.body}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-t bg-white">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send() }}
          placeholder="พิมพ์ข้อความ..."
          className="flex-1 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
        />
        <button onClick={send} className="w-10 h-10 bg-green-600 text-white rounded-xl flex items-center justify-center">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )

  // Conversation list
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900">ข้อความ</h1>
      </div>

      <div className="px-4 py-4 space-y-2">
        {convs.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>ยังไม่มีการสนทนา</p>
          </div>
        )}
        {convs.map(c => (
          <button
            key={c.id}
            onClick={() => openConv(c)}
            className="w-full flex items-center gap-3 p-3 bg-white rounded-xl text-left hover:bg-gray-50 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-bold">
              {c.name?.[0] ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{c.name}</p>
              <p className="text-xs text-gray-400 truncate">{c.lastMessage || "ยังไม่มีข้อความ"}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
