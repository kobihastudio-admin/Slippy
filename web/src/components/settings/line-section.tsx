"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import QRCode from "qrcode"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import {
  MessageCircle, RefreshCw, Trash2, Copy, Check,
  Loader2, Zap, Plus, Camera, MoreHorizontal, Wifi
} from "lucide-react"
import { toast }      from "sonner"
import { formatDate } from "@/lib/utils"
import { cn }         from "@/lib/utils"

const BOT_ID = process.env.NEXT_PUBLIC_LINE_BOT_ID ?? "@slippy"

interface LineConnection { id: string; line_user_id: string; display_name: string; created_at: string }
interface Props { orgId: string; isAdmin: boolean }

// ── QR code canvas component ─────────────────────────────────────────────────
function QRCanvas({ code }: { code: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !code) return
    // ใช้ https scheme แทน line:// เพื่อให้ auto-add friend ก่อนถ้ายังไม่ได้เพิ่ม
    // หมายเหตุ: oaMessage deep link ต้องมี "@" (encode เป็น %40) และมี "/" ปิดท้าย ID
    // ไม่งั้น LINE จะหาบัญชีไม่เจอ (user not found) — และทุกอย่างหลัง "?"
    // คือข้อความที่จะใส่ในกล่องแชทเลย ห้ามมี "text=" นำหน้า ไม่งั้น LINE
    // จะเอาคำว่า "text=" ไปแสดงในกล่องข้อความด้วย
    const botId = BOT_ID.startsWith("@") ? BOT_ID.slice(1) : BOT_ID
    const text = `https://line.me/R/oaMessage/%40${botId}/?%2Fconnect%20${code}`
    QRCode.toCanvas(canvasRef.current, text, {
      width:  148,
      margin: 2,
      color:  { dark: "#111827", light: "#ffffff" },
    }).catch(err => console.error("[QR]", err))
  }, [code])

  return (
    <canvas
      ref={canvasRef}
      className="rounded-[6px]"
      style={{ width: 148, height: 148 }}
    />
  )
}

// ── Animated LINE chat preview ──────────────────────────────────────────────
const MSGS = [
  { from:"user", text:"/connect 7C8M6V",           delay:0    },
  { from:"bot",  text:"🎉 เชื่อมต่อสำเร็จ!\nส่งรูปสลิปได้เลยครับ", delay:800  },
  { from:"user", text:"📷 [ส่งรูปสลิป]",            delay:2000 },
  { from:"bot",  card:true,                          delay:3200 },
  { from:"bot",  text:"✅ บันทึกแล้ว · รอตรวจสอบ", delay:4400 },
  { from:"user", text:"/summary",                    delay:5400 },
  { from:"bot",  text:"📊 ยอดรวม: ฿142,380\nเอกสาร: 47 ใบ\nVAT ซื้อ: ฿9,307", delay:6200 },
]

function LineChatPreview() {
  const [shown, setShown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    // Clear old timers
    timerRef.current.forEach(clearTimeout)
    timerRef.current = []
    setShown(0)

    MSGS.forEach((m, i) => {
      const t = setTimeout(() => setShown(i + 1), m.delay)
      timerRef.current.push(t)
    })

    // Loop: reset after last message + 3s
    const loop = setTimeout(() => {
      timerRef.current.forEach(clearTimeout)
      setShown(0)
      // Re-trigger by unmounting/remounting via key trick isn't easy here,
      // just schedule fresh timers recursively
    }, (MSGS[MSGS.length-1].delay ?? 0) + 3000)
    timerRef.current.push(loop)

    return () => timerRef.current.forEach(clearTimeout)
  }, [])

  return (
    <div className="rounded-[12px] border bg-card overflow-hidden shadow-sm h-full flex flex-col">
      {/* Header */}
      <div className="bg-[#06C755] text-white px-3 py-2.5 flex items-center gap-2 shrink-0">
        <div className="h-8 w-8 rounded-full bg-white text-[#06C755] flex items-center justify-center font-black text-[13px] shrink-0">S</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[12.5px] leading-tight">Slippy Bot</div>
          <div className="text-[10px] opacity-85 flex items-center gap-1">
            <span className="h-1 w-1 rounded-full bg-white animate-pulse" /> ออนไลน์
          </div>
        </div>
        <MoreHorizontal className="w-3.5 h-3.5 opacity-70" />
      </div>

      {/* Messages */}
      <div className="bg-[#7EAFC9]/12 dark:bg-slate-900/40 px-2.5 py-3 space-y-2 flex-1 overflow-hidden">
        {MSGS.slice(0, shown).map((m, i) => {
          const isBot = m.from === "bot"
          const wrap = `flex ${isBot ? "justify-start" : "justify-end"}`
          return (
            <div key={i} className={cn(wrap, "animate-in fade-in slide-in-from-bottom-1 duration-300")}>
              {m.card ? (
                <div className="bg-white dark:bg-slate-800 rounded-[10px] overflow-hidden shadow-sm w-[170px]">
                  <div className="bg-gradient-to-r from-brand-500 to-brand-700 px-2.5 py-1.5 flex items-center gap-1.5 text-white">
                    <Zap className="w-3 h-3 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold truncate">7-Eleven ทองหล่อ 24</div>
                      <div className="text-[8px] opacity-80">AI ดึงข้อมูล · 98%</div>
                    </div>
                  </div>
                  <div className="px-2.5 py-1.5 space-y-0.5 text-[10px]">
                    <div className="flex justify-between"><span className="text-slate-500">ยอดรวม</span><span className="font-bold text-slate-900 dark:text-white">฿118.00</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">VAT</span><span className="text-slate-700 dark:text-slate-300">฿7.71</span></div>
                  </div>
                  <div className="grid grid-cols-2 border-t border-slate-100 dark:border-slate-700 text-[9.5px] font-semibold">
                    <button className="py-1.5 text-slate-400 border-r border-slate-100 dark:border-slate-700">แก้ไข</button>
                    <button className="py-1.5 text-brand-500">อนุมัติ</button>
                  </div>
                </div>
              ) : (
                <div className={cn(
                  "max-w-[85%] rounded-[11px] px-2.5 py-1.5 text-[11px] leading-snug whitespace-pre-line",
                  isBot ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
                        : "bg-[#06C755] text-white"
                )}>
                  {m.text}
                </div>
              )}
            </div>
          )
        })}
        {/* Typing indicator */}
        {shown > 0 && shown < MSGS.length && MSGS[shown]?.from === "bot" && (
          <div className="flex justify-start animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-[11px] px-2.5 py-1.5 shadow-sm flex items-center gap-1">
              {[0,150,300].map(d => (
                <span key={d} className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce"
                  style={{ animationDelay:`${d}ms` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-2.5 py-2 border-t border-border bg-card flex items-center gap-1.5 shrink-0">
        <span className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Plus className="w-3 h-3 text-muted-foreground" />
        </span>
        <div className="flex-1 h-6 rounded-full bg-muted px-2.5 text-[10.5px] text-muted-foreground flex items-center">
          พิมพ์ข้อความ...
        </div>
        <span className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Camera className="w-3 h-3 text-muted-foreground" />
        </span>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
export function LineSection({ orgId, isAdmin }: Props) {
  const [connections, setConnections] = useState<LineConnection[]>([])
  const [loading,    setLoading]     = useState(true)
  const [genLoading, setGenLoading]  = useState(false)
  const [code,       setCode]        = useState<string | null>(null)
  const [copied,     setCopied]      = useState(false)
  const [showQR,     setShowQR]      = useState(false)

  const searchParams = useSearchParams()

  // แสดง toast เมื่อ redirect กลับจาก LINE Login
  useEffect(() => {
    const connected = searchParams.get("connected")
    const name      = searchParams.get("name")
    const error     = searchParams.get("error")
    const merged    = searchParams.get("merged")
    if (connected === "true") {
      toast.success(`เชื่อมต่อ LINE สำเร็จ! ${name ? `ยินดีต้อนรับ ${decodeURIComponent(name)}` : ""}`)
      if (merged === "true") {
        toast.info("พบบัญชี LINE เดิมที่เคยใช้แยกต่างหาก ระบบได้รวมข้อมูลเข้ากับบัญชีนี้ให้แล้ว")
      }
      fetchConnections()
    } else if (error) {
      const msg: Record<string, string> = {
        line_cancelled:  "ยกเลิกการเชื่อมต่อ",
        state_mismatch:  "Session หมดอายุ กรุณาลองใหม่",
        token_failed:    "รับ token จาก LINE ไม่ได้",
        profile_failed:  "ดึงข้อมูล profile ไม่ได้",
        upsert_failed:   "บันทึกการเชื่อมต่อไม่สำเร็จ",
        line_already_linked: "บัญชี LINE นี้เชื่อมต่อกับบัญชี Slippy อื่นอยู่แล้ว กรุณาออกจากระบบบัญชีนั้นก่อน หรือใช้บัญชี LINE อื่น",
        not_configured:  "LINE Login ยังไม่ได้ตั้งค่า",
        unexpected:      "เกิดข้อผิดพลาด กรุณาลองใหม่",
      }
      toast.error(msg[error] ?? `เกิดข้อผิดพลาด: ${error}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchConnections = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/line/connect?orgId=${orgId}`)
      const { connections } = await res.json()
      setConnections(connections ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetchConnections() }, [fetchConnections])

  const generateCode = async () => {
    setGenLoading(true)
    try {
      const res  = await fetch("/api/line/connect", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ orgId }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data.error ?? `Error ${res.status}`)
        console.error("[LINE connect]", res.status, data)
        return
      }
      setCode(data.code)
      setShowQR(true)
      toast.success("สร้าง Code สำเร็จ! ใช้ได้ 24 ชั่วโมง")
    } catch (e) {
      console.error("[LINE connect] fetch failed", e)
      toast.error("เชื่อมต่อ server ไม่ได้ กรุณาลองใหม่")
    } finally {
      setGenLoading(false)   // always reset loading
    }
  }

  const copyCode = async () => {
    if (!code) return
    await navigator.clipboard.writeText(`/connect ${code}`)
    setCopied(true); toast.success("คัดลอกแล้ว")
    setTimeout(() => setCopied(false), 2000)
  }

  const disconnect = async (id: string) => {
    await fetch("/api/line/connect", {
      method:"DELETE", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ connectionId: id }),
    })
    setConnections(prev => prev.filter(c => c.id !== id))
    toast.success("ยกเลิกการเชื่อมต่อแล้ว")
  }

  const isConnected = connections.length > 0

  return (
    <div className="rounded-[12px] border bg-card overflow-hidden">

        {/* Connected state */}
        {!loading && isConnected ? (
          <div className="p-5 space-y-4">
            {/* Header: connected badge */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[10px] bg-[#06C755]/10 flex items-center justify-center shrink-0">
                <MessageCircle className="w-5 h-5 text-[#06C755]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-[14px]">LINE Bot</p>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full
                    bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <Wifi className="w-2.5 h-2.5" /> เชื่อมต่อถาวร
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground">เชื่อมต่อ {connections.length} บัญชี · ใช้งานได้จนกว่าจะ Reset</p>
              </div>
            </div>

            {/* Connected accounts */}
            <div className="space-y-2">
              {connections.map(c => (
                <div key={c.id}
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-200/50 dark:border-emerald-500/20">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-[#06C755] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      {c.display_name.slice(0,1).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold">{c.display_name}</p>
                      <p className="text-[11px] text-muted-foreground">เชื่อมเมื่อ {formatDate(c.created_at)}</p>
                    </div>
                  </div>
                  {isAdmin && (
                    <button onClick={() => disconnect(c.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 text-muted-foreground transition-colors"
                      title="ยกเลิกการเชื่อมต่อ">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add more connections — 2 options */}
            <div className="flex flex-col sm:flex-row gap-2">
              {/* Option A: LINE Login (one-tap) */}
              <a href={`/api/line/connect-login?orgId=${orgId}`}
                className="flex-1 flex items-center justify-center gap-2 h-9 px-3 rounded-[8px]
                  bg-[#06C755] hover:bg-[#05b04a] text-white text-[12.5px] font-semibold transition">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
                </svg>
                เชื่อมต่อด้วย LINE
              </a>

              {/* Option B: QR Code / manual code */}
              <button onClick={generateCode} disabled={genLoading}
                className="flex-1 flex items-center justify-center gap-2 h-9 px-3 text-[12.5px]
                  rounded-[8px] border border-dashed hover:bg-muted transition-colors
                  disabled:opacity-60 text-muted-foreground">
                {genLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                ใช้ QR Code / รหัส
              </button>
            </div>

            {/* QR Code / manual code result */}
            {showQR && code && (
              <div className="flex gap-4 items-start pt-1">
                <div className="shrink-0">
                  <div className="rounded-[10px] border-2 border-[#06C755]/30 overflow-hidden bg-white p-1.5 inline-flex">
                    <QRCanvas code={code} />
                  </div>
                  <p className="text-[9.5px] text-muted-foreground text-center mt-1">สแกนด้วยมือถือ</p>
                </div>

                <div className="flex-1 space-y-2 pt-1">
                  <p className="text-[11.5px] text-muted-foreground">หรือพิมพ์คำสั่งใน LINE:</p>
                  <div className="flex items-center gap-2 bg-muted/50 rounded-[8px] border px-2.5 py-2">
                    <code className="flex-1 text-[12.5px] font-mono font-bold text-foreground">
                      /connect {code}
                    </code>
                    <button onClick={copyCode}
                      className="p-1 rounded-md hover:bg-muted transition-colors shrink-0">
                      {copied
                        ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                        : <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      }
                    </button>
                  </div>
                  <p className="text-[10.5px] text-muted-foreground">
                    รหัสนี้ใช้ได้ 24 ชั่วโมง
                  </p>
                  <button onClick={generateCode} disabled={genLoading}
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                    <RefreshCw className="w-3 h-3" /> สร้างรหัสใหม่
                  </button>
                </div>
              </div>
            )}
          </div>

        ) : (
          /* Not connected state */
          <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[10px] bg-[#06C755]/10 flex items-center justify-center shrink-0">
                <MessageCircle className="w-5 h-5 text-[#06C755]" />
              </div>
              <div>
                <p className="font-semibold text-[14px]">LINE Bot</p>
                <p className="text-[12px] text-muted-foreground">ยังไม่มีบัญชีที่เชื่อมต่อ</p>
              </div>
            </div>

            {/* Steps */}
            <ol className="space-y-2.5 text-[13px]">
              {([
                <span key={0}>เพิ่ม <strong className="text-foreground">{BOT_ID}</strong> ใน LINE ของคุณ</span>,
                <span key={1}>กด &ldquo;สร้าง QR Code&rdquo; แล้วสแกนด้วยมือถือ</span>,
                <span key={2}>หรือพิมพ์คำสั่ง /connect ตามด้วยรหัสที่แสดง</span>,
              ] as React.ReactNode[]).map((content, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="h-5 w-5 rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300
                    text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                  <span className="text-foreground pt-0.5">{content}</span>
                </li>
              ))}
            </ol>

            {/* Generate button or QR display */}
            {!code ? (
              <div className="space-y-2">
                {/* Primary: LINE Login one-tap */}
                <a href={`/api/line/connect-login?orgId=${orgId}`}
                  className="w-full h-11 rounded-[10px] bg-[#06C755] hover:bg-[#05a847] text-white
                    text-[14px] font-semibold transition-colors flex items-center justify-center gap-2.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
                  </svg>
                  เชื่อมต่อด้วย LINE (แนะนำ)
                </a>

                {/* Divider */}
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <div className="flex-1 h-px bg-border"/>หรือ<div className="flex-1 h-px bg-border"/>
                </div>

                {/* Secondary: QR Code */}
                <button onClick={generateCode} disabled={genLoading}
                  className="w-full h-9 rounded-[10px] border border-dashed text-muted-foreground text-[13px]
                    font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2
                    hover:bg-muted">
                  {genLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  ใช้ QR Code / รหัส /connect
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-4 items-start">
                  {/* QR Code */}
                  <div className="shrink-0">
                    <div className="rounded-[10px] border-2 border-[#06C755]/30 overflow-hidden bg-white p-1.5 inline-flex">
                      <QRCanvas code={code} />
                    </div>
                    <p className="text-[9.5px] text-muted-foreground text-center mt-1">สแกนด้วยมือถือ</p>
                  </div>

                  {/* Code + copy */}
                  <div className="flex-1 space-y-2 pt-1">
                    <p className="text-[11.5px] text-muted-foreground">หรือพิมพ์คำสั่งใน LINE:</p>
                    <div className="flex items-center gap-2 bg-muted/50 rounded-[8px] border px-2.5 py-2">
                      <code className="flex-1 text-[12.5px] font-mono font-bold text-foreground">
                        /connect {code}
                      </code>
                      <button onClick={copyCode}
                        className="p-1 rounded-md hover:bg-muted transition-colors shrink-0">
                        {copied
                          ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                          : <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                        }
                      </button>
                    </div>
                    <p className="text-[10.5px] text-muted-foreground">
                      รหัสนี้ใช้ได้ 24 ชั่วโมง
                    </p>
                    <button onClick={generateCode} disabled={genLoading}
                      className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                      <RefreshCw className="w-3 h-3" /> สร้างรหัสใหม่
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

  )
}
