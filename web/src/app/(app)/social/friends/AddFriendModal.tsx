/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

"use client"

import { useEffect, useRef, useState } from "react"
import QRCode  from "qrcode"
import jsQR    from "jsqr"
import { Icons } from "@/components/ui/icons"
import { cn }     from "@/lib/utils"

/**
 * "เพิ่มเพื่อน" entry point covering the 3 recommended channels:
 *   1. QR ของฉัน   — show a QR the other person scans (in-system, in-person)
 *   2. สแกน QR      — scan someone else's QR (in-system, in-person)
 *   3. แชร์ผ่าน LINE — out-of-system, reaches LINE's much larger install base
 * Both QR tabs resolve through the same `friend_invite_links` token as the
 * existing "copy link" button — scanning just skips the manual paste/open
 * step. See supabase/migrations/052_friendships.sql for the underlying table
 * and app/friends/join/[token]/page.tsx for what happens when the link opens.
 */

type Tab = "myqr" | "scan" | "line"

export default function AddFriendModal({
  inviteUrl,
  onClose,
}: {
  inviteUrl: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>("myqr")

  const shareText = `มาเป็นเพื่อนกันใน Slippy กันเถอะ! ${inviteUrl}`
  const lineShareUrl = `https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">เพิ่มเพื่อน</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground" aria-label="ปิด">
            <Icons.X size={20} />
          </button>
        </div>

        <div className="flex gap-1 p-3">
          {([
            { key: "myqr", label: "QR ของฉัน", icon: Icons.QrCode },
            { key: "scan", label: "สแกน QR",   icon: Icons.Camera },
            { key: "line", label: "แชร์ LINE",  icon: Icons.Send },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-colors",
                tab === t.key
                  ? "bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <t.icon size={16} strokeWidth={1.8} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 pt-2">
          {tab === "myqr" && <MyQrPanel inviteUrl={inviteUrl} />}
          {tab === "scan" && <ScanPanel />}
          {tab === "line" && <LineSharePanel lineShareUrl={lineShareUrl} inviteUrl={inviteUrl} />}
        </div>
      </div>
    </div>
  )
}

function MyQrPanel({ inviteUrl }: { inviteUrl: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!inviteUrl) return
    QRCode.toDataURL(inviteUrl, { width: 280, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null))
  }, [inviteUrl])

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="QR เพิ่มเพื่อน" className="w-56 h-56 rounded-xl border border-border" />
      ) : (
        <div className="w-56 h-56 rounded-xl bg-muted animate-pulse" />
      )}
      <p className="text-sm text-muted-foreground text-center">
        ให้เพื่อนสแกน QR นี้เพื่อเพิ่มเป็นเพื่อนทันที
      </p>
    </div>
  )
}

function ScanPanel() {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          tick()
        }
      } catch {
        setError("ไม่สามารถเข้าถึงกล้องได้ — กรุณาอนุญาตการใช้กล้อง")
      }
    }

    function tick() {
      const video  = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)
      if (code?.data) {
        setScanning(false)
        setResolvedUrl(code.data)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    start()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  useEffect(() => {
    if (!resolvedUrl) return
    // QR encodes the full invite URL (see MyQrPanel) — just navigate there,
    // same as pasting a copied link. The /friends/join/[token] page handles
    // auth + friendship upsert server-side.
    const t = setTimeout(() => { window.location.href = resolvedUrl }, 600)
    return () => clearTimeout(t)
  }, [resolvedUrl])

  if (error) {
    return <div className="text-center py-8 text-sm text-destructive">{error}</div>
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-black">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
        {scanning && (
          <div className="absolute inset-8 border-2 border-white/70 rounded-xl pointer-events-none" />
        )}
        {!scanning && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 text-white">
            <Icons.Check size={36} />
            <p className="text-sm">พบ QR แล้ว กำลังเพิ่มเพื่อน...</p>
            <Icons.Loader size={16} />
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center">เล็ง QR ของเพื่อนให้อยู่ในกรอบ</p>
    </div>
  )
}

function LineSharePanel({ lineShareUrl, inviteUrl }: { lineShareUrl: string; inviteUrl: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-3 py-2">
      <a
        href={lineShareUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 py-3.5 bg-[#06C755] text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
      >
        แชร์ลิงก์เชิญผ่าน LINE
      </a>
      <button
        onClick={() => {
          navigator.clipboard.writeText(inviteUrl)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
        className="flex items-center justify-center gap-2 py-3 border border-border rounded-xl text-sm font-medium
          text-muted-foreground hover:bg-muted transition-colors"
      >
        {copied ? <Icons.Check size={16} /> : <Icons.ArrowUpRight size={16} />}
        {copied ? "คัดลอกแล้ว!" : "คัดลอกลิงก์"}
      </button>
      <p className="text-xs text-muted-foreground text-center px-2">
        เหมาะสำหรับส่งให้เพื่อนที่ยังไม่ได้ใช้ Slippy — เข้าถึงคนได้กว้างกว่าเพราะทุกคนมี LINE อยู่แล้ว
      </p>
    </div>
  )
}
