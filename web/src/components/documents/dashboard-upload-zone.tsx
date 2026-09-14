"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useRef, useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import {
  Upload, Camera, Mail, Loader2, CheckCircle2,
  Copy, Check, X, ExternalLink, SwitchCamera, ZoomIn,
} from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { logClientError } from "@/lib/log-error"
import { ImageCropStep } from "./image-crop-step"

// ─── Image compression constants ─────────────────────────────────────────────
const MAX_IMAGE_PX    = 1920           // longest side in pixels (sufficient for Claude vision)
const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB — compress above this threshold
const COMPRESS_QUALITY = 0.85

/**
 * Compress + resize a raster image using Canvas.
 * – Resizes if the longest side exceeds MAX_IMAGE_PX
 * – Recompresses if the file size exceeds MAX_IMAGE_BYTES
 * – Always outputs JPEG (best size/quality trade-off for document scans)
 * – Skips compression if the image is already small enough
 */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file  // PDFs pass through

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file  // Can't decode — let server handle
  }

  const { width, height } = bitmap
  const longestSide  = Math.max(width, height)
  const needsResize  = longestSide > MAX_IMAGE_PX
  const needsCompress = file.size > MAX_IMAGE_BYTES

  if (!needsResize && !needsCompress) {
    bitmap.close()
    return file  // Already within limits — nothing to do
  }

  const scale   = needsResize ? MAX_IMAGE_PX / longestSide : 1
  const canvas  = document.createElement("canvas")
  canvas.width  = Math.round(width  * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error("toBlob returned null")),
      "image/jpeg",
      COMPRESS_QUALITY,
    )
  )

  const newName    = file.name.replace(/\.(jpe?g|png|webp|heic|heif)$/i, ".jpg")
  const compressed = new File([blob], newName, { type: "image/jpeg" })

  const savedPct = Math.round((1 - compressed.size / file.size) * 100)
  if (savedPct >= 5) {
    toast.info(
      `บีบอัดรูปภาพ −${savedPct}%` +
      ` (${(file.size / 1024 / 1024).toFixed(1)} → ${(compressed.size / 1024 / 1024).toFixed(1)} MB)`
    )
  }
  return compressed
}

// ─── HEIC → JPEG conversion + compression ────────────────────────────────────
//  Strategy 1: native createImageBitmap + Canvas  (iOS Safari 15.4+, no WASM)
//  Strategy 2: heic2any dynamic import fallback   (Chromium + WASM)
//  Strategy 3: upload as-is (last resort)
//  After any HEIC conversion, compressImage() runs to enforce size limits.
async function normalizeFile(file: File): Promise<File> {
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name)

  // ── Non-HEIC: just compress/resize ───────────────────────────────────────────
  if (!isHeic) return compressImage(file)

  const newName = file.name.replace(/\.(heic|heif)$/i, ".jpg")
  const fileCtx = {
    file_name: file.name,
    file_size: file.size,
    file_type: file.type || "(empty — browser didn't set MIME)",
    file_ext:  file.name.split(".").pop()?.toLowerCase(),
  }

  // ── Strategy 1: native createImageBitmap + Canvas ────────────────────────────
  try {
    const bitmap = await createImageBitmap(file)
    const canvas  = document.createElement("canvas")
    const scale   = Math.min(1, MAX_IMAGE_PX / Math.max(bitmap.width, bitmap.height))
    canvas.width  = Math.round(bitmap.width  * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob returned null")), "image/jpeg", COMPRESS_QUALITY)
    )
    toast.info("แปลง HEIC → JPEG เสร็จแล้ว")
    return new File([blob], newName, { type: "image/jpeg" })
  } catch (err1) {
    await logClientError("heic_conversion", err1, { ...fileCtx, strategy: "createImageBitmap" })
  }

  // ── Strategy 2: heic2any WASM ─────────────────────────────────────────────────
  try {
    const heic2any = (await import("heic2any")).default
    const blob     = await heic2any({ blob: file, toType: "image/jpeg", quality: COMPRESS_QUALITY }) as Blob
    toast.info("แปลง HEIC → JPEG เสร็จแล้ว (WASM)")
    // Result is already JPEG — still run through compressImage to enforce size limit
    return compressImage(new File([blob], newName, { type: "image/jpeg" }))
  } catch (err2) {
    await logClientError("heic_conversion", err2, { ...fileCtx, strategy: "heic2any" })
  }

  // ── Strategy 3: upload original (last resort) ─────────────────────────────────
  await logClientError("heic_conversion", new Error("all strategies failed — uploading original"), {
    ...fileCtx, strategy: "fallback_original",
  })
  toast.warning("ไม่สามารถแปลง HEIC ได้ — กำลังอัปโหลดต้นฉบับ")
  return file
}

// ─── Feature flags ────────────────────────────────────────────────────────────
// Set to true when the feature is ready for users
const SHOW_CAMERA = false   // camera on notebook is unreliable — hidden until mobile/HTTPS UX is polished
const SHOW_EMAIL  = false   // email ingestion requires DNS/mailbox setup — hidden until configured

// ─── Accepted types ───────────────────────────────────────────────────────────
const ACCEPT_ATTR = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
const MAX_BYTES   = 20 * 1024 * 1024   // 20 MB

// ─── Document validator ───────────────────────────────────────────────────────
/**
 * Two-tier validation before uploading:
 *   Tier 1 — client-side Canvas analysis (instant, free)
 *   Tier 2 — Claude Haiku API call (fast, ~$0.0001)
 *
 * Returns { ok: true } if the image looks like a document,
 * or { ok: false, reason } to reject without queuing OCR.
 */
async function validateDocument(
  file: File
): Promise<{ ok: true } | { ok: false; reason: string }> {

  // PDF → skip visual check, PDFs are almost always documents
  if (file.type === "application/pdf") return { ok: true }

  // ── Tier 1: quick Canvas pixel analysis ────────────────────────────────────
  const clientScore = await new Promise<number>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const W = 120, H = 90
      const canvas = document.createElement("canvas")
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0, W, H)
      const { data } = ctx.getImageData(0, 0, W, H)

      let bright = 0, edges = 0
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4
          const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]
          if (lum > 170) bright++
          if (x < W - 1 && y < H - 1) {
            const ir = (y * W + x + 1) * 4
            const ib = ((y + 1) * W + x) * 4
            const lumR = 0.299*data[ir] + 0.587*data[ir+1] + 0.114*data[ir+2]
            const lumB = 0.299*data[ib] + 0.587*data[ib+1] + 0.114*data[ib+2]
            if (Math.abs(lum - lumR) > 25 || Math.abs(lum - lumB) > 25) edges++
          }
        }
      }
      const brightPct = bright / (W * H)
      const edgePct   = edges  / (W * H)
      const score =
        (brightPct > 0.10 && brightPct < 0.95 ? 50 : 0) +
        (edgePct > 0.03 ? Math.min(50, edgePct * 700) : 0)
      resolve(score)
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => resolve(50)  // can't decode → allow through
    img.src = URL.createObjectURL(file)
  })

  // Clearly not a document (solid color, dark photo, etc.)
  if (clientScore < 20) {
    return { ok: false, reason: "รูปนี้ไม่ใช่เอกสาร กรุณาส่งรูปใบเสร็จหรือเอกสารทางการเงิน" }
  }

  // ── Tier 2: Claude Haiku vision validation ──────────────────────────────────
  // Resize to small thumbnail to minimise token cost
  const thumbBase64 = await new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 512
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
      const canvas = document.createElement("canvas")
      canvas.width  = Math.round(img.width  * ratio)
      canvas.height = Math.round(img.height * ratio)
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/jpeg", 0.7).split(",")[1])
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => resolve("")
    img.src = URL.createObjectURL(file)
  })

  if (!thumbBase64) return { ok: true }  // can't resize → allow through

  try {
    const res = await fetch("/api/documents/validate", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ imageBase64: thumbBase64, mediaType: "image/jpeg" }),
    })
    if (!res.ok) return { ok: true }  // API error → don't block upload

    const { isDocument, reason } = await res.json() as { isDocument: boolean; reason: string }
    if (!isDocument) {
      return {
        ok:     false,
        reason: reason || "รูปนี้ไม่ใช่เอกสาร กรุณาถ่ายรูปใบเสร็จหรือเอกสารทางการเงิน",
      }
    }
  } catch {
    return { ok: true }  // network error → allow through
  }

  return { ok: true }
}

// ─── Document auto-detect hook ───────────────────────────────────────────────
function useDocumentDetector(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
  onAutoCapture: () => void,
) {
  const [detected,   setDetected]   = useState(false)
  const [holdPct,    setHoldPct]    = useState(0)   // 0–100 progress toward auto-capture
  const [countdown,  setCountdown]  = useState(0)   // seconds remaining before capture
  const canvasRef    = useRef<HTMLCanvasElement | null>(null)
  const holdRef      = useRef(0)   // consecutive high-confidence frames

  // Tuning constants
  const INTERVAL_MS  = 250         // analysis frequency
  const SCORE_THRESH = 65          // stricter — must be clearly a document
  const HOLD_NEEDED  = 20          // 20 × 250ms = 5 seconds of stable detection
  const DECAY_RATE   = 3           // frames subtracted per non-detected frame (fast reset)

  useEffect(() => {
    if (!active) {
      setDetected(false); setHoldPct(0); setCountdown(0)
      holdRef.current = 0
      return
    }

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas")

    const interval = setInterval(() => {
      const video  = videoRef.current
      const canvas = canvasRef.current!
      if (!video || video.readyState < 2 || video.videoWidth === 0) return

      // Sample at slightly higher resolution for better accuracy
      const W = 120, H = 90
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!
      ctx.drawImage(video, 0, 0, W, H)
      const { data } = ctx.getImageData(0, 0, W, H)

      // Bright pixels — paper
      let bright = 0
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]
        if (lum > 175) bright++
      }
      const brightPct = bright / (W * H)

      // Edge pixels — text / printed lines
      let edges = 0
      for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const i   = (y * W + x) * 4
          const ir  = (y * W + x + 1) * 4
          const ib  = ((y + 1) * W + x) * 4
          const lumC = 0.299*data[i]  + 0.587*data[i+1]  + 0.114*data[i+2]
          const lumR = 0.299*data[ir] + 0.587*data[ir+1] + 0.114*data[ir+2]
          const lumB = 0.299*data[ib] + 0.587*data[ib+1] + 0.114*data[ib+2]
          if (Math.abs(lumC - lumR) > 30 || Math.abs(lumC - lumB) > 30) edges++
        }
      }
      const edgePct = edges / (W * H)

      // Score: needs BOTH a bright region AND visible text/edges
      // brightPct 0.20–0.88: large white area (not all-white/all-dark)
      // edgePct > 0.05: text or lines are visible
      const brightScore = (brightPct > 0.20 && brightPct < 0.88) ? 50 : 0
      const edgeScore   = edgePct > 0.05 ? Math.min(50, edgePct * 600) : 0
      const score       = brightScore + edgeScore

      // Both conditions must contribute for a high-confidence result
      const found = score >= SCORE_THRESH && brightScore > 0 && edgeScore > 10

      setDetected(found)

      if (found) {
        holdRef.current = Math.min(holdRef.current + 1, HOLD_NEEDED)
      } else {
        // Reset quickly if document leaves frame
        holdRef.current = Math.max(0, holdRef.current - DECAY_RATE)
      }

      const pct = Math.round((holdRef.current / HOLD_NEEDED) * 100)
      setHoldPct(pct)

      // Countdown display (seconds remaining)
      const remaining = Math.ceil(((HOLD_NEEDED - holdRef.current) * INTERVAL_MS) / 1000)
      setCountdown(holdRef.current > 0 ? remaining : 0)

      if (holdRef.current >= HOLD_NEEDED) {
        holdRef.current = 0
        setHoldPct(0)
        setCountdown(0)
        onAutoCapture()
      }
    }, INTERVAL_MS)

    return () => clearInterval(interval)
  }, [active, videoRef, onAutoCapture])

  return { detected, holdPct, countdown }
}

// ─── Camera modal (shared between compact and full) ───────────────────────────
interface CameraModalProps {
  videoRef:        React.RefObject<HTMLVideoElement | null>
  cameraError:     string | null
  facingMode:      "environment" | "user"
  hasMultipleCams: boolean
  onClose:         () => void
  onCapture:       () => void
  onFlip:          () => void
  onFallback:      () => void
  onRetry:         () => void
}
function CompactCameraModal({
  videoRef, cameraError, facingMode, hasMultipleCams,
  onClose, onCapture, onFlip, onFallback, onRetry,
}: CameraModalProps) {
  const { detected, holdPct, countdown } = useDocumentDetector(
    videoRef,
    !cameraError,   // only run when camera is working
    onCapture,      // auto-capture callback
  )
  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex-1 relative overflow-hidden">
        {cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 overflow-y-auto py-8">
            <Camera className="w-10 h-10 text-white/30 shrink-0" />

            <p className="text-white font-semibold text-sm text-center">กล้องถูกบล็อก</p>

            {/* Mac-specific step-by-step */}
            <div className="w-full max-w-[300px] space-y-2">

              {/* Step 1 — macOS System (most common culprit) */}
              <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
                <p className="text-white/90 text-xs font-bold mb-2 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-violet-500 text-white text-[9px] flex items-center justify-center shrink-0 font-black">1</span>
                  เปิดสิทธิ์ macOS (สำคัญที่สุด)
                </p>
                <div className="text-[11px] text-white/65 space-y-0.5 leading-relaxed">
                  <p>Apple Menu → <span className="text-white/85 font-medium">System Settings</span></p>
                  <p>→ Privacy &amp; Security → <span className="text-white/85 font-medium">Camera</span></p>
                  <p>→ เปิด toggle ข้าง <span className="text-white/85 font-medium">Google Chrome</span> ✓</p>
                </div>
              </div>

              {/* Step 2 — Browser permission */}
              <div className="bg-white/8 rounded-xl p-3.5 border border-white/8">
                <p className="text-white/90 text-xs font-bold mb-2 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] flex items-center justify-center shrink-0 font-black">2</span>
                  เปิดสิทธิ์ Chrome
                </p>
                <div className="text-[11px] text-white/65 space-y-0.5 leading-relaxed">
                  <p>คลิก <span className="text-white/85 font-medium">🔒</span> ในแถบ URL</p>
                  <p>→ Camera → <span className="text-white/85 font-medium">Allow</span></p>
                </div>
              </div>

              {/* Step 3 — Reload */}
              <div className="bg-white/8 rounded-xl p-3 border border-white/8">
                <p className="text-white/70 text-[11px] flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-white/20 text-white text-[9px] flex items-center justify-center shrink-0 font-black">3</span>
                  กด <span className="text-white/85 font-medium">รีโหลดหน้า</span> แล้วลองใหม่
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 w-full max-w-[300px]">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors"
              >
                🔄 รีโหลดหน้า
              </button>
              <button
                onClick={onRetry}
                className="w-full py-2 rounded-xl bg-white/12 hover:bg-white/20 text-white text-sm font-medium transition-colors"
              >
                ลองอีกครั้ง (ไม่ reload)
              </button>
              <button
                onClick={onFallback}
                className="w-full py-2 rounded-xl bg-white/6 hover:bg-white/12 text-white/60 text-sm transition-colors"
              >
                เลือกไฟล์แทน
              </button>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay playsInline muted
            className={cn("w-full h-full object-cover", facingMode === "user" && "scale-x-[-1]")}
          />
        )}
        {!cameraError && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Frame: 90% wide, A4-like ratio (√2 ≈ 1.414), capped so it doesn't overflow */}
            <div className="w-[90%] max-w-2xl relative" style={{ aspectRatio: "1 / 1.2" }}>
              {/* Dim overlay outside the frame */}
              <div className="absolute -inset-[200%] bg-black/40" />

              {/* Corner brackets — larger to match bigger frame */}
              {[
                "top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-xl",
                "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-xl",
                "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-xl",
                "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-xl",
              ].map((cls, i) => (
                <span
                  key={i}
                  className={cn(
                    "absolute w-10 h-10 transition-colors duration-200",
                    cls,
                    detected ? "border-emerald-400" : "border-white/80"
                  )}
                />
              ))}

              {/* Auto-capture progress bar at bottom of frame */}
              {holdPct > 0 && (
                <div className="absolute -bottom-3 left-0 right-0 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all duration-200"
                    style={{ width: `${holdPct}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Top bar: close + status label */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center transition-colors z-10"
        >
          <X className="w-5 h-5 text-white" />
        </button>
        {!cameraError && (
          <div
            className={cn(
              "absolute top-4 left-1/2 -translate-x-1/2 text-xs backdrop-blur-sm px-3 py-1.5 rounded-full whitespace-nowrap transition-all duration-200 flex items-center gap-1.5",
              detected
                ? "bg-emerald-500/80 text-white font-semibold"
                : "bg-black/30 text-white/60"
            )}
          >
            {detected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {holdPct > 0
                  ? `ถ่ายใน ${countdown} วินาที… (${holdPct}%)`
                  : "พบเอกสาร! นิ่งไว้สักครู่"
                }
              </>
            ) : "ส่องกล้องที่เอกสาร"}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="shrink-0 bg-black/90 backdrop-blur-sm px-8 py-5 flex items-center justify-between">
        {/* Auto-detect badge */}
        <div className="flex flex-col items-center gap-1 w-12">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
            detected ? "bg-emerald-500/20" : "bg-white/5"
          )}>
            <span className="text-base">{detected ? "🟢" : "⚪"}</span>
          </div>
          <span className="text-[9px] text-white/40 text-center leading-tight">
            {detected ? "พบแล้ว" : "Auto"}
          </span>
        </div>

        {/* Shutter button */}
        <button
          onClick={onCapture}
          disabled={!!cameraError}
          className={cn(
            "w-16 h-16 rounded-full border-4 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-150 flex items-center justify-center shadow-lg shadow-black/50",
            detected
              ? "border-emerald-400 bg-emerald-400/20 hover:bg-emerald-400/30"
              : "border-white bg-white/10 hover:bg-white/25"
          )}
        >
          <div className={cn(
            "w-12 h-12 rounded-full transition-colors",
            detected ? "bg-emerald-400" : "bg-white"
          )} />
        </button>

        {/* Flip / spacer */}
        {hasMultipleCams ? (
          <button
            onClick={onFlip}
            className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <SwitchCamera className="w-5 h-5 text-white" />
          </button>
        ) : (
          <div className="w-12 h-12" />
        )}
      </div>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  orgId:    string
  orgSlug?: string   // optional — email button is hidden when not provided
  compact?: boolean  // slim single-row strip for pages where upload is secondary
}

type Status = "idle" | "validating" | "converting" | "uploading" | "processing" | "done"

// ─── Component ────────────────────────────────────────────────────────────────
export function DashboardUploadZone({ orgId, orgSlug, compact = false }: Props) {
  const router = useRouter()

  const [status,   setStatus]   = useState<Status>("idle")
  const [progress, setProgress] = useState(0)
  const [fileName, setFileName] = useState("")
  const [isDrag,   setIsDrag]   = useState(false)
  // Image (not PDF) that's passed validation/normalization and is waiting on
  // the optional manual-crop step before upload — see image-crop-step.tsx.
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null)

  // Email popover
  const [emailOpen, setEmailOpen] = useState(false)
  const [copied,    setCopied]    = useState(false)

  // Camera modal
  const [cameraOpen,       setCameraOpen]       = useState(false)
  const [facingMode,       setFacingMode]       = useState<"environment" | "user">("environment")
  const [cameraError,      setCameraError]      = useState<string | null>(null)
  const [hasMultipleCams,  setHasMultipleCams]  = useState(false)
  const videoRef  = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Hidden file inputs
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const uploadEmail = orgSlug ? `${orgSlug}@docs.slippy.app` : ""

  // ── Validate + normalize (size check, document-likeness, HEIC/compression) ──
  // Split out from the actual upload so the manual crop step (image-crop-step.tsx)
  // can sit between the two — only for raster images, PDFs skip straight through.
  const prepareFile = useCallback(async (raw: File): Promise<File | null> => {
    if (raw.size > MAX_BYTES) {
      toast.error(`ไฟล์ใหญ่เกิน 20MB (${(raw.size / 1024 / 1024).toFixed(1)} MB)`)
      return null
    }

    // ── Validate before uploading ───────────────────────────────────────────
    setStatus("validating")
    setFileName(raw.name)
    const validation = await validateDocument(raw)
    if (!validation.ok) {
      toast.error(validation.reason, {
        duration:    6000,
        description: "ระบบรับเฉพาะใบเสร็จ, ใบกำกับภาษี, บิล, สลิปโอนเงิน และเอกสารทางการเงินเท่านั้น",
      })
      setStatus("idle")
      return null
    }

    setStatus("converting")
    setFileName(raw.name)
    let file: File
    try {
      file = await normalizeFile(raw)
    } catch (err) {
      await logClientError("heic_conversion", err, {
        file_name: raw.name, file_size: raw.size, file_type: raw.type,
      })
      toast.error("แปลงไฟล์ไม่สำเร็จ กรุณาลองใหม่")
      setStatus("idle")
      return null
    }
    return file
  }, [])

  // ── Core upload logic — runs after prepareFile (and, for images, after the
  //    optional crop step) has produced the final file to send. ──────────────
  const uploadFile = useCallback(async (file: File) => {
    setFileName(file.name)
    setStatus("uploading")
    setProgress(10)

    // createClient is called lazily here (not at render level) to avoid
    // SSR issues — createBrowserClient must only run in the browser.
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error("กรุณาเข้าสู่ระบบก่อน"); setStatus("idle"); return }

    const ext  = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
    const path = `${orgId}/${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type })

    if (uploadError) {
      toast.error(uploadError.message)
      setStatus("idle")
      return
    }
    setProgress(30)

    // file_type must match DB CHECK constraint: ('pdf','jpg','png')
    const fileType =
      ext === "pdf" ? "pdf" :
      ext === "png" ? "png" :
      "jpg"

    const { data: doc, error: insertError } = await supabase
      .from("documents")
      .insert({
        organization_id: orgId,
        uploaded_by:     user.id,
        file_path:       path,
        file_type:       fileType,
        status:          "pending",
        source:          "web",
      })
      .select("id")
      .single()

    if (insertError || !doc) {
      toast.error(insertError?.message ?? "สร้าง record ไม่สำเร็จ")
      setStatus("idle")
      return
    }
    setProgress(40)

    setStatus("processing")
    await fetch(`/api/documents/${doc.id}/process`, { method: "POST" })

    const es = new EventSource(`/api/documents/${doc.id}/progress`)
    es.onmessage = (e) => {
      const payload = JSON.parse(e.data)
      if (payload.progress) setProgress(40 + payload.progress * 0.6)
      if (payload.status && ["reviewing", "approved", "failed"].includes(payload.status)) {
        es.close()
        setStatus("done")
        setProgress(100)
        setTimeout(() => router.push(`/documents/${doc.id}/review`), 800)
      }
    }
    es.onerror = () => {
      es.close()
      setStatus("done")
      router.push(`/documents/${doc.id}/review`)
    }
  }, [orgId, router])

  // ── Entry point for every file source (drop, picker, paste, camera) ────────
  // Validates/normalizes first; raster images then pause on the manual crop
  // step (image-crop-step.tsx) before uploading — PDFs go straight through.
  const handleIncomingFile = useCallback(async (raw: File) => {
    const file = await prepareFile(raw)
    if (!file) return
    if (file.type.startsWith("image/")) {
      setStatus("idle")
      setPendingCropFile(file)
    } else {
      await uploadFile(file)
    }
  }, [prepareFile, uploadFile])

  // ── Camera: stop stream helper ─────────────────────────────────────────────
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  // ── Camera: close modal ────────────────────────────────────────────────────
  const closeCamera = useCallback(() => {
    stopStream()
    setCameraOpen(false)
    setCameraError(null)
  }, [stopStream])

  // ── Camera: open modal (getUserMedia) or fallback to file input ────────────
  const openCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click()
      return
    }
    setCameraError(null)
    setCameraOpen(true)
  }, [])

  // ── Camera: start stream when modal opens or facingMode changes ────────────
  useEffect(() => {
    if (!cameraOpen) return
    let active = true

    const start = async () => {
      // Stop any existing stream first
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null

      // ── Call getUserMedia directly — no permissions API pre-check ───────────
      // The Permissions API is unreliable across browsers/OS and can return stale
      // "denied" state even after the user has allowed camera. We rely solely on
      // the getUserMedia error for accurate permission feedback.
      let stream: MediaStream | null = null

      // Try simple first (works on all devices including laptops with only 1 camera)
      const attempts = [
        { video: true, audio: false },
        { video: { facingMode: { ideal: facingMode } }, audio: false },
      ] as const

      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          break   // success
        } catch (err: unknown) {
          const name = (err as { name?: string })?.name ?? ""
          console.warn("[camera] attempt failed:", name, constraints)

          if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            if (!active) return
            // macOS: may also need system-level permission
            const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)
            setCameraError(
              isMac
                ? "กล้องถูกบล็อก\n\nบน Mac: System Settings → Privacy → Camera → เปิด Chrome\nบน Browser: คลิก 🔒 → Camera → Allow\nแล้วโหลดหน้าใหม่"
                : "กล้องถูกบล็อก\n\nคลิก 🔒 ในแถบ URL → Camera → Allow\nแล้วโหลดหน้าใหม่"
            )
            return
          }
          if (name === "NotFoundError" || name === "DevicesNotFoundError") {
            if (!active) return
            stopStream(); setCameraOpen(false); cameraInputRef.current?.click()
            return
          }
          // Other errors: try next constraint
        }
      }

      if (!active || !stream) {
        if (!active) return
        setCameraError("เปิดกล้องไม่ได้ กรุณาลองใหม่หรือเลือกไฟล์แทน")
        return
      }

      streamRef.current = stream
      const attachStream = () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream!
          videoRef.current.play().catch(e => console.warn("[camera] play error:", e))
        } else {
          requestAnimationFrame(attachStream)
        }
      }
      attachStream()

      // Detect multiple cameras
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (active) setHasMultipleCams(devices.filter(d => d.kind === "videoinput").length > 1)
      } catch { /* non-critical */ }
    }

    start()
    return () => { active = false; stopStream() }
  }, [cameraOpen, facingMode, stopStream])

  // ── Camera: retry — close and reopen to get fresh getUserMedia ───────────────
  const retryCamera = useCallback(() => {
    stopStream()
    setCameraError(null)
    setCameraOpen(false)
    setTimeout(() => setCameraOpen(true), 100)
  }, [stopStream])

  // ── Camera: capture snapshot from video frame ──────────────────────────────
  const capturePhoto = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return

    const canvas = document.createElement("canvas")
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext("2d")!.drawImage(video, 0, 0)

    canvas.toBlob(async blob => {
      if (!blob) { toast.error("ถ่ายรูปไม่สำเร็จ"); return }
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: "image/jpeg" })
      // Close camera first so user sees feedback immediately
      closeCamera()
      // handleIncomingFile re-validates + offers the crop step
      await handleIncomingFile(file)
    }, "image/jpeg", 0.92)
  }, [closeCamera, handleIncomingFile])

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────
  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDrag(true)  }
  const onDragLeave = ()                    => setIsDrag(false)
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setIsDrag(false)
    const file = e.dataTransfer.files[0]
    if (file) handleIncomingFile(file)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleIncomingFile(file)
    e.target.value = ""
  }

  // ── Paste handler (Cmd+V / Ctrl+V) ─────────────────────────────────────────
  const handlePaste = useCallback((e: ClipboardEvent) => {
    // Don't intercept when user is typing in an input/textarea
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === "INPUT" || tag === "TEXTAREA") return
    if (status !== "idle") return

    const items = Array.from(e.clipboardData?.items ?? [])

    // 1. Image in clipboard (e.g. screenshot, copy from browser)
    const imageItem = items.find(i => i.type.startsWith("image/"))
    if (imageItem) {
      const blob = imageItem.getAsFile()
      if (blob) {
        const ext  = imageItem.type === "image/png" ? "png" : "jpg"
        const file = new File([blob], `paste_${Date.now()}.${ext}`, { type: imageItem.type })
        handleIncomingFile(file)
        return
      }
    }

    // 2. File(s) in clipboard (copy file from Finder/Explorer)
    const fileItem = items.find(i => i.kind === "file" && !i.type.startsWith("text/"))
    if (fileItem) {
      const file = fileItem.getAsFile()
      if (file) { handleIncomingFile(file); return }
    }
  }, [status, handleIncomingFile])

  // Listen for global paste event
  useEffect(() => {
    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  }, [handlePaste])

  const copyEmail = async () => {
    await navigator.clipboard.writeText(uploadEmail)
    setCopied(true)
    toast.success("คัดลอกอีเมลแล้ว")
    setTimeout(() => setCopied(false), 2000)
  }

  // Close email popover on outside click
  useEffect(() => {
    if (!emailOpen) return
    const handler = (e: MouseEvent) => {
      const el = document.getElementById("email-popover")
      if (el && !el.contains(e.target as Node)) setEmailOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [emailOpen])

  // Close camera modal on Escape
  useEffect(() => {
    if (!cameraOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeCamera() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [cameraOpen, closeCamera])

  // ── Manual crop step (images only) — see image-crop-step.tsx ───────────────
  if (pendingCropFile) {
    return (
      <ImageCropStep
        file={pendingCropFile}
        onConfirm={(cropped) => { setPendingCropFile(null); uploadFile(cropped) }}
        onSkip={() => { const f = pendingCropFile; setPendingCropFile(null); uploadFile(f) }}
        onCancel={() => setPendingCropFile(null)}
      />
    )
  }

  // ── Uploading / processing state ───────────────────────────────────────────
  if (status !== "idle") {
    const label =
      status === "validating"  ? "กำลังตรวจสอบเอกสาร..." :
      status === "converting"  ? "กำลังแปลงไฟล์..." :
      status === "uploading"   ? "กำลังอัปโหลด..." :
      status === "processing"  ? "AI กำลังอ่านเอกสาร..." :
      "เสร็จสิ้น กำลังเปิดหน้า Review..."

    // ── Compact progress strip ────────────────────────────────────────────────
    if (compact) {
      return (
        <div className="h-14 rounded-[10px] border border-border bg-card px-4
          flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 rounded-[8px] bg-brand-50 dark:bg-brand-900/20
            flex items-center justify-center shrink-0">
            {status === "done"
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              : <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate leading-none">{fileName}</p>
            <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-1 rounded-full bg-brand-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <span className="text-[11.5px] text-muted-foreground shrink-0 hidden sm:block">
            {label}
          </span>
        </div>
      )
    }

    // ── Full progress card ────────────────────────────────────────────────────
    return (
      <div className="rounded-[12px] border-2 border-border bg-card overflow-hidden">
        <div className="px-6 py-8">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-[12px] bg-brand-50 dark:bg-brand-900/20
              flex items-center justify-center shrink-0">
              {status === "done"
                ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                : <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{fileName}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              <div className="mt-2.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-1.5 rounded-full bg-brand-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Idle / upload zone ─────────────────────────────────────────────────────
  // ── Compact strip ──────────────────────────────────────────────────────────
  if (compact) {
    return (
      <>
        <input ref={fileInputRef} type="file" accept={ACCEPT_ATTR}
          className="hidden" onChange={onFileChange} />
        <input ref={cameraInputRef} type="file" accept="image/*"
          capture="environment" className="hidden" onChange={onFileChange} />

        {cameraOpen && (
          // Camera modal — identical to full version, shared below
          <CompactCameraModal
            videoRef={videoRef}
            cameraError={cameraError}
            facingMode={facingMode}
            hasMultipleCams={hasMultipleCams}
            onClose={closeCamera}
            onCapture={capturePhoto}
            onFlip={() => setFacingMode(m => m === "environment" ? "user" : "environment")}
            onFallback={() => { setCameraError(null); cameraInputRef.current?.click(); setCameraOpen(false) }}
            onRetry={retryCamera}
          />
        )}

        <div className="relative">
          {/* Compact drag strip */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "h-14 rounded-[10px] border border-dashed bg-card px-4",
              "flex items-center gap-3 cursor-pointer transition-colors duration-150 group",
              isDrag
                ? "border-brand-400 bg-brand-50/60 dark:bg-brand-900/20"
                : "border-border hover:border-brand-300 hover:bg-muted/30"
            )}
          >
            {/* Icon */}
            <div className={cn(
              "w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 transition-colors",
              isDrag
                ? "bg-brand-100 dark:bg-brand-500/20"
                : "bg-brand-50 dark:bg-brand-900/20 group-hover:bg-brand-100 dark:group-hover:bg-brand-500/20"
            )}>
              <Upload className="w-4 h-4 text-brand-500" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground leading-none">
                {isDrag ? "วางไฟล์ที่นี่" : "ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                PDF · JPG · PNG · HEIC · วาง Ctrl+V / ⌘V (สูงสุด 20MB)
              </p>
            </div>

            {/* Action buttons */}
            <div
              className="flex items-center gap-1.5 shrink-0"
              onClick={e => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 px-3 rounded-[8px] bg-brand-500 hover:bg-brand-600
                  active:scale-95 text-white text-xs font-medium transition-all
                  inline-flex items-center gap-1.5 shadow-sm shadow-brand-500/20"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">เลือกไฟล์</span>
              </button>

              {SHOW_CAMERA && (
                <button
                  type="button"
                  onClick={openCamera}
                  title="ถ่ายรูป"
                  className="h-8 w-8 rounded-[8px] border border-border bg-card
                    hover:bg-muted hover:border-brand-300 active:scale-95
                    text-muted-foreground hover:text-foreground transition-all
                    inline-flex items-center justify-center"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
              )}

              {SHOW_EMAIL && orgSlug && (
                <button
                  type="button"
                  title="ส่งทางอีเมล"
                  onClick={() => setEmailOpen(v => !v)}
                  className="h-8 w-8 rounded-[8px] border border-border bg-card
                    hover:bg-muted hover:border-brand-300 active:scale-95
                    text-muted-foreground hover:text-foreground transition-all
                    inline-flex items-center justify-center"
                >
                  <Mail className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Email popover (same as full version) */}
          {emailOpen && orgSlug && (
            <div
              id="email-popover"
              className="absolute z-20 right-0 mt-2
                w-[320px] bg-card border border-border rounded-[14px]
                shadow-xl shadow-black/10 p-5 space-y-3 animate-in fade-in zoom-in-95
                duration-150"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">อีเมลรับเอกสาร</p>
                <button onClick={() => setEmailOpen(false)}
                  className="p-1 rounded-md hover:bg-muted transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                ส่งไฟล์แนบ (PDF, JPG, PNG, HEIC) มาที่อีเมลนี้
                ระบบจะรับและประมวลผลอัตโนมัติ
              </p>
              <div className="flex items-center gap-2 bg-muted rounded-[10px] px-3 py-2.5">
                <code className="flex-1 text-xs font-mono text-foreground truncate">
                  {uploadEmail}
                </code>
                <button
                  onClick={copyEmail}
                  className="shrink-0 p-1.5 rounded-md hover:bg-background
                    transition-colors text-muted-foreground hover:text-foreground"
                  title="คัดลอก"
                >
                  {copied
                    ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                    : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="pt-1 border-t border-border flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">ใช้ชื่อ Subject เป็นชื่อเอกสาร</p>
                <Link href="/settings/integrations" onClick={() => setEmailOpen(false)}
                  className="text-[11px] text-brand-600 hover:underline inline-flex items-center gap-1">
                  ตั้งค่า <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      {/* ── Hidden file inputs ── */}
      <input ref={fileInputRef} type="file" accept={ACCEPT_ATTR}
        className="hidden" onChange={onFileChange} />

      {/* Fallback: native camera for browsers without getUserMedia */}
      <input ref={cameraInputRef} type="file" accept="image/*"
        capture="environment" className="hidden" onChange={onFileChange} />

      {/* ── Camera modal ── */}
      {cameraOpen && (
        <CompactCameraModal
          videoRef={videoRef}
          cameraError={cameraError}
          facingMode={facingMode}
          hasMultipleCams={hasMultipleCams}
          onClose={closeCamera}
          onCapture={capturePhoto}
          onFlip={() => setFacingMode(m => m === "environment" ? "user" : "environment")}
          onFallback={() => { setCameraError(null); cameraInputRef.current?.click(); setCameraOpen(false) }}
          onRetry={retryCamera}
        />
      )}

      {/* ── Drop zone ── */}
      <div className="relative">
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "rounded-[12px] border-2 border-dashed bg-card overflow-hidden relative",
            "transition-colors duration-200 cursor-pointer group",
            isDrag
              ? "border-brand-400 bg-brand-50/60 dark:bg-brand-900/20"
              : "border-border hover:border-brand-400 hover:bg-brand-50/30 dark:hover:bg-brand-500/5"
          )}
        >
          <div className="absolute inset-0 glow-dotgrid opacity-30 pointer-events-none
            [mask-image:radial-gradient(circle_at_center,black,transparent_75%)]" />

          <div className="relative px-6 py-10 text-center">
            <div className="relative inline-flex">
              <div className="absolute inset-0 rounded-full bg-brand-500/30 blur-2xl" />
              <div className="relative h-14 w-14 rounded-[14px]
                bg-gradient-to-br from-brand-400 to-brand-700 text-white
                flex items-center justify-center shadow-lg shadow-brand-500/30
                group-hover:scale-105 transition-transform duration-200">
                <Upload className="w-6 h-6" />
              </div>
            </div>

            <h3 className="mt-4 text-[17px] font-semibold text-foreground">
              {isDrag ? "วางไฟล์ที่นี่" : "ลากไฟล์มาวางที่นี่"}
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              หรือใช้ปุ่มด้านล่าง · รองรับ PDF, JPG, PNG, <strong>HEIC</strong> (สูงสุด 20MB)
            </p>
            {/* Paste hint */}
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
              bg-muted border border-border text-[11px] text-muted-foreground">
              <kbd className="font-mono text-[10px] bg-card border border-border rounded px-1 py-0.5">
                {typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl"}
              </kbd>
              <span>+</span>
              <kbd className="font-mono text-[10px] bg-card border border-border rounded px-1 py-0.5">V</kbd>
              <span>วางรูปหรือ PDF จาก Clipboard ได้เลย</span>
            </div>

            <div
              className="mt-5 flex items-center justify-center gap-2 flex-wrap"
              onClick={e => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-10 px-4 rounded-[10px] bg-brand-500 hover:bg-brand-600
                  active:scale-95 text-white text-sm font-medium transition-all
                  inline-flex items-center gap-2 shadow-sm shadow-brand-500/30"
              >
                <Upload className="w-4 h-4" />
                เลือกไฟล์
              </button>

              {SHOW_CAMERA && (
                <button
                  type="button"
                  onClick={openCamera}
                  className="h-10 px-4 rounded-[10px] border border-border bg-card
                    hover:bg-muted hover:border-brand-300 active:scale-95
                    text-foreground text-sm font-medium transition-all
                    inline-flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  ถ่ายรูป
                </button>
              )}

              {SHOW_EMAIL && orgSlug && (
                <button
                  type="button"
                  onClick={() => setEmailOpen(v => !v)}
                  className="h-10 px-4 rounded-[10px] border border-border bg-card
                    hover:bg-muted hover:border-brand-300 active:scale-95
                    text-foreground text-sm font-medium transition-all
                    inline-flex items-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  ส่งทางอีเมล
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Email popover ── */}
        {emailOpen && (
          <div
            id="email-popover"
            className="absolute z-20 left-1/2 -translate-x-1/2 mt-2
              w-[340px] bg-card border border-border rounded-[14px]
              shadow-xl shadow-black/10 p-5 space-y-3 animate-in fade-in zoom-in-95
              duration-150"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">อีเมลรับเอกสาร</p>
              <button onClick={() => setEmailOpen(false)}
                className="p-1 rounded-md hover:bg-muted transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              ส่งไฟล์แนบ (PDF, JPG, PNG, HEIC) มาที่อีเมลนี้
              ระบบจะรับและประมวลผลอัตโนมัติ
            </p>

            <div className="flex items-center gap-2 bg-muted rounded-[10px] px-3 py-2.5">
              <code className="flex-1 text-xs font-mono text-foreground truncate">
                {uploadEmail}
              </code>
              <button
                onClick={copyEmail}
                className="shrink-0 p-1.5 rounded-md hover:bg-background
                  transition-colors text-muted-foreground hover:text-foreground"
                title="คัดลอก"
              >
                {copied
                  ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                  : <Copy className="w-3.5 h-3.5" />
                }
              </button>
            </div>

            <div className="pt-1 border-t border-border flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                ใช้ชื่อ Subject เป็นชื่อเอกสาร
              </p>
              <Link
                href="/settings/integrations"
                onClick={() => setEmailOpen(false)}
                className="text-[11px] text-brand-600 hover:underline
                  inline-flex items-center gap-1"
              >
                ตั้งค่า <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
