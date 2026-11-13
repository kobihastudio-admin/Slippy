"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"
import {
  DEFAULT_FAB, FAB_SIZE, FAB_MARGIN, FAB_STORAGE_KEY,
  clickFollowsDrag, isDrag, parseFabState, serializeFabState, stateAfterDrop, type FabState,
} from "@/lib/assistant-fab"

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

  // Where the round button sits: dragged to a side edge and a height, or hidden behind a small edge tab. It used to be
  // fixed in the bottom-right corner, which covered the chat's send button on a phone.
  const [fab,  setFab]  = useState<FabState>(DEFAULT_FAB)
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null)
  const press       = useRef<{ startX: number; startY: number; offX: number; offY: number; moved: boolean } | null>(null)
  const droppedAt   = useRef<number | null>(null)

  useEffect(() => {
    try { setFab(parseFabState(window.localStorage.getItem(FAB_STORAGE_KEY), window.innerHeight)) } catch { /* private mode: keep the default */ }
  }, [])

  const saveFab = useCallback((next: FabState) => {
    setFab(next)
    try { window.localStorage.setItem(FAB_STORAGE_KEY, serializeFabState(next)) } catch { /* not saved, still works */ }
  }, [])

  function onFabPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (open) return   // while the window is open the button is just "close"
    const rect = e.currentTarget.getBoundingClientRect()
    press.current = { startX: e.clientX, startY: e.clientY, offX: e.clientX - rect.left, offY: e.clientY - rect.top, moved: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not supported: dragging still works while over the button */ }
  }

  function onFabPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const p = press.current
    if (!p) return
    if (!p.moved && !isDrag({ x: p.startX, y: p.startY }, { x: e.clientX, y: e.clientY })) return
    p.moved = true
    setDrag({
      left: Math.min(Math.max(e.clientX - p.offX, 0), window.innerWidth - FAB_SIZE),
      top:  Math.min(Math.max(e.clientY - p.offY, 0), window.innerHeight - FAB_SIZE),
    })
  }

  function onFabPointerUp() {
    const p = press.current
    press.current = null
    if (p?.moved && drag) {
      droppedAt.current = performance.now()   // the click that may follow a drag must not open the window
      saveFab(stateAfterDrop(drag, { width: window.innerWidth, height: window.innerHeight }, false))
    }
    setDrag(null)
  }

  function onFabClick() {
    if (clickFollowsDrag(performance.now(), droppedAt.current)) return
    setOpen(o => !o)
  }

  function hideFab() {
    setOpen(false)
    saveFab({ ...fab, hidden: true })
  }

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
        <div style={{ [fab.side]: FAB_MARGIN, bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
          className="fixed z-50 w-[340px] sm:w-[380px] max-w-[calc(100vw-2rem)] flex flex-col
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
            <button onClick={hideFab} aria-label="ซ่อนไอคอนผู้ช่วย AI"
              className="text-white/70 hover:text-white text-[11px] leading-none transition-colors border border-white/30 rounded-full px-2 py-1">
              ซ่อนไอคอน
            </button>
            <button onClick={() => setOpen(false)} aria-label="ปิด"
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

      {/* Hidden: only a small tab on the screen edge is left, to bring the button back. */}
      {fab.hidden && (
        <button
          onClick={() => saveFab({ ...fab, hidden: false })}
          aria-label="แสดงไอคอนผู้ช่วย AI"
          style={{ [fab.side]: 0, bottom: `calc(${fab.bottom + 8}px + env(safe-area-inset-bottom, 0px))` }}
          className={cn(
            "fixed z-50 w-5 h-12 bg-gradient-to-br from-violet-600 to-indigo-600 text-white text-[11px] opacity-80",
            "flex items-center justify-center shadow-md hover:opacity-100 transition-opacity",
            fab.side === "right" ? "rounded-l-xl" : "rounded-r-xl"
          )}
        >
          {fab.side === "right" ? "‹" : "›"}
        </button>
      )}

      {/* FAB button: tap to open, drag to move */}
      {!fab.hidden && (
        <button
          onClick={onFabClick}
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          onPointerCancel={() => { press.current = null; setDrag(null) }}
          aria-label={open ? "ปิดผู้ช่วย AI" : "เปิดแชท Slippy Assistant (ลากเพื่อย้าย)"}
          style={
            drag
              ? { left: drag.left, top: drag.top, touchAction: "none" }
              : {
                  [fab.side]: FAB_MARGIN,
                  // While the window is open the button returns to the bottom corner it opens from.
                  bottom: `calc(${open ? FAB_MARGIN : fab.bottom}px + env(safe-area-inset-bottom, 0px))`,
                  touchAction: "none",
                }
          }
          className={cn(
            "fixed z-50 w-14 h-14 rounded-full shadow-lg shadow-brand-500/30 overflow-hidden select-none",
            "bg-gradient-to-br from-violet-600 to-indigo-600",
            "flex items-center justify-center",
            drag ? "scale-105" : "transition-all duration-200 hover:scale-105 active:scale-95"
          )}
        >
          {open ? (
            <span className="text-white text-xl">✕</span>
          ) : (
            <>
              <Image src="/images/slippy-assistant.png" alt="" width={56} height={56} draggable={false} className="w-full h-full object-cover pointer-events-none" />
              {unread > 0 && (
                <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unread}
                </div>
              )}
            </>
          )}
        </button>
      )}
    </>
  )
}
