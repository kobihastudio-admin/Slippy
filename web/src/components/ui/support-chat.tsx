"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface Msg { role: "user" | "assistant"; content: string; id: string }

const QUICK_PROMPTS = [
  "เดือนนี้ใช้จ่ายไปเท่าไร",
  "ร้านที่ไปบ่อยที่สุดคือร้านไหน",
  "VAT ที่ขอคืนได้เดือนนี้มีเท่าไร",
  "วิธีเชื่อมต่อ LINE Bot",
  "ทำไมเอกสารถึงอ่านไม่ออก",
]

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0,160,320].map(d => (
        <div key={d} className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
          style={{ animationDelay:`${d}ms` }} />
      ))}
    </div>
  )
}

function MsgBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user"
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-white text-[11px] font-black">S</span>
        </div>
      )}
      <div className={cn(
        "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
        isUser
          ? "bg-brand-500 text-white rounded-br-sm"
          : "bg-muted text-foreground rounded-bl-sm"
      )}>
        {/* Simple markdown: bold */}
        {msg.content.split("\n").map((line, i) => (
          <p key={i} className={i > 0 ? "mt-1.5" : ""}>
            {line.split(/\*\*(.*?)\*\*/g).map((part, j) =>
              j % 2 === 1 ? <strong key={j}>{part}</strong> : part
            )}
          </p>
        ))}
      </div>
    </div>
  )
}

export function SupportChat({ orgId }: { orgId?: string }) {
  const [open,     setOpen]     = useState(false)
  const [msgs,     setMsgs]     = useState<Msg[]>([{
    role: "assistant",
    content: "สวัสดีครับ! ผม Slippy AI Assistant 👋\nถามเรื่องค่าใช้จ่าย, ร้านค้า, เอกสาร หรือการใช้งาน Slippy ได้เลยครับ",
    id: "welcome",
  }])
  const [input,    setInput]    = useState("")
  const [loading,  setLoading]  = useState(false)
  const [unread,   setUnread]   = useState(0)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [msgs, loading])

  useEffect(() => {
    if (open) { setUnread(0); setTimeout(() => inputRef.current?.focus(), 150) }
  }, [open])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setInput("")

    const userMsg: Msg = { role: "user", content: trimmed, id: Date.now().toString() }
    setMsgs(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const history = [...msgs, userMsg].slice(-10).map(m => ({ role: m.role, content: m.content }))
      const res  = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, orgId }),  // pass orgId for Life Graph context
      })
      const data = await res.json()
      const content = res.ok
        ? data.message
        : data.upgradeRequired
        ? `${data.error} — ไปที่หน้า Billing เพื่ออัปเกรดได้เลยครับ`
        : (data.error ?? "ขอโทษครับ เกิดข้อผิดพลาด กรุณาลองใหม่")
      const reply: Msg = { role: "assistant", content, id: Date.now().toString() }
      setMsgs(prev => [...prev, reply])
      if (!open) setUnread(n => n + 1)
    } catch {
      setMsgs(prev => [...prev, {
        role: "assistant", content: "ขอโทษครับ เกิดข้อผิดพลาด กรุณาลองใหม่", id: Date.now().toString()
      }])
    } finally {
      setLoading(false)
    }
  }, [loading, msgs, open])

  return (
    <>
      {/* Chat window */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-[340px] sm:w-[380px] flex flex-col
          bg-card border border-border rounded-2xl shadow-2xl shadow-black/15 overflow-hidden
          animate-in slide-in-from-bottom-4 duration-200">

          {/* Header */}
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3.5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
              <Image src="/images/slippy-assistant.png" alt="Slippy Assistant" width={32} height={32} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1">
              <p className="text-white font-semibold text-[13.5px]">Slippy Assistant</p>
              <p className="text-white/70 text-[11px] flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                ออนไลน์ · ตอบทันที
              </p>
            </div>
            <button onClick={() => setOpen(false)}
              className="text-white/70 hover:text-white text-lg leading-none transition-colors">
              ✕
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[380px] min-h-[200px]">
            {msgs.map(m => <MsgBubble key={m.id} msg={m} />)}
            {loading && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full overflow-hidden shrink-0">
                  <Image src="/images/slippy-assistant.png" alt="Slippy Assistant" width={28} height={28} className="w-full h-full object-cover" />
                </div>
                <div className="bg-muted rounded-2xl rounded-bl-sm">
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts */}
          {msgs.length <= 2 && (
            <div className="px-4 pb-2 flex gap-1.5 flex-wrap">
              {QUICK_PROMPTS.map(q => (
                <button key={q} onClick={() => send(q)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-muted
                    hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors">
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-3 border-t border-border flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
              placeholder="พิมพ์คำถาม..."
              className="flex-1 h-9 rounded-xl border border-border bg-muted px-3 text-[13px]
                outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/15 transition"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className="h-9 w-9 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40
                text-white flex items-center justify-center transition-colors shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "fixed bottom-4 right-4 z-50 w-14 h-14 rounded-full shadow-lg shadow-brand-500/30 overflow-hidden",
          "bg-gradient-to-br from-violet-600 to-indigo-600",
          "flex items-center justify-center transition-all duration-200",
          "hover:scale-105 active:scale-95"
        )}
      >
        {open ? (
          <span className="text-white text-xl">✕</span>
        ) : (
          <>
            <Image src="/images/slippy-assistant.png" alt="เปิดแชท Slippy Assistant" width={56} height={56} className="w-full h-full object-cover" />
            {unread > 0 && (
              <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unread}
              </div>
            )}
          </>
        )}
      </button>
    </>
  )
}
