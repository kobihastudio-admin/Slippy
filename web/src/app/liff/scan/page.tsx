/**
 * /liff/scan — Document Scanner LIFF mini-app
 *
 * Flow:
 * 1. ถ่ายรูปด้วยกล้อง หรือเลือกจาก Photo Library (1-5 รูป)
 * 2. Preview + confirm → อัปโหลด
 * 3. แสดงสถานะ processing → poll ผลลัพธ์จาก OCR pipeline
 * 4. แสดงข้อมูลที่อ่านได้ (ร้าน, ยอด, วันที่) พร้อม link ไปหน้ารายละเอียด
 * 5. ประวัติ 20 รายการล่าสุด
 */

"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useAppLoading } from "@/lib/loading"
import { getAppUrl } from "@/lib/app-url"
import {
  Camera, ImagePlus, Upload, X, CheckCircle, Loader2, AlertCircle,
  RotateCcw, Trash2, Clock, FileText, ChevronRight, Zap,
} from "lucide-react"
import Image from "next/image"

type AuthStatus = "checking" | "needLogin" | "outsideLine" | "ready" | "authError"
type UploadStep = "idle" | "camera" | "previewing" | "uploading" | "processing" | "done" | "error"

// ── Document auto-detect — same brightness+edge heuristic used in the
// dashboard's camera modal (dashboard-upload-zone.tsx), tuned for a faster
// hold time since this flow is for quick slip/receipt capture. Holding the
// phone steady while the frame reads as "detected" both (a) waits out the
// camera's autofocus settling time and (b) only fires the shutter once the
// document fills the guide frame well-lit — both of which matter much more
// for OCR accuracy than the shutter button timing ever did.
function useDocumentDetector(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
  onAutoCapture: () => void,
) {
  const [detected,  setDetected]  = useState(false)
  const [holdPct,   setHoldPct]   = useState(0)
  const canvasRef   = useRef<HTMLCanvasElement | null>(null)
  const holdRef     = useRef(0)

  const INTERVAL_MS  = 250
  const SCORE_THRESH = 65
  const HOLD_NEEDED  = 10   // 10 × 250ms = 2.5s of stable, well-framed detection
  const DECAY_RATE   = 3

  useEffect(() => {
    if (!active) { setDetected(false); setHoldPct(0); holdRef.current = 0; return }
    if (!canvasRef.current) canvasRef.current = document.createElement("canvas")

    const interval = setInterval(() => {
      const video = videoRef.current
      const canvas = canvasRef.current!
      if (!video || video.readyState < 2 || video.videoWidth === 0) return

      const W = 120, H = 90
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!
      ctx.drawImage(video, 0, 0, W, H)
      const { data } = ctx.getImageData(0, 0, W, H)

      let bright = 0
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        if (lum > 175) bright++
      }
      const brightPct = bright / (W * H)

      let edges = 0
      for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const i  = (y * W + x) * 4
          const ir = (y * W + x + 1) * 4
          const ib = ((y + 1) * W + x) * 4
          const lumC = 0.299 * data[i]  + 0.587 * data[i + 1]  + 0.114 * data[i + 2]
          const lumR = 0.299 * data[ir] + 0.587 * data[ir + 1] + 0.114 * data[ir + 2]
          const lumB = 0.299 * data[ib] + 0.587 * data[ib + 1] + 0.114 * data[ib + 2]
          if (Math.abs(lumC - lumR) > 30 || Math.abs(lumC - lumB) > 30) edges++
        }
      }
      const edgePct = edges / (W * H)

      const brightScore = (brightPct > 0.20 && brightPct < 0.88) ? 50 : 0
      const edgeScore   = edgePct > 0.05 ? Math.min(50, edgePct * 600) : 0
      const score       = brightScore + edgeScore
      const found = score >= SCORE_THRESH && brightScore > 0 && edgeScore > 10

      setDetected(found)
      holdRef.current = found ? Math.min(holdRef.current + 1, HOLD_NEEDED) : Math.max(0, holdRef.current - DECAY_RATE)
      setHoldPct(Math.round((holdRef.current / HOLD_NEEDED) * 100))

      if (holdRef.current >= HOLD_NEEDED) {
        holdRef.current = 0
        setHoldPct(0)
        onAutoCapture()
      }
    }, INTERVAL_MS)

    return () => clearInterval(interval)
  }, [active, videoRef, onAutoCapture])

  return { detected, holdPct }
}

interface DocResult {
  id: string
  status: string
  vendor_name: string | null
  total_amount: number | null
  doc_date: string | null
  overall_confidence: number | null
  thumbUrl?: string | null
  created_at: string
}

interface Preview {
  file: File
  dataUrl: string
}

const LIFF_ID  = process.env.NEXT_PUBLIC_LIFF_ID as string
const APP_URL  = getAppUrl()

const STATUS_LABEL: Record<string, string> = {
  pending:    "รอประมวลผล",
  processing: "กำลังอ่าน OCR…",
  reviewing:  "รอตรวจสอบ",
  approved:   "อนุมัติแล้ว",
  pushed:     "บันทึกแล้ว",
  failed:     "ล้มเหลว",
  rejected:   "ปฏิเสธ",
}

const STATUS_COLOR: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-700",
  processing: "bg-blue-100 text-blue-700",
  reviewing:  "bg-purple-100 text-purple-700",
  approved:   "bg-emerald-100 text-emerald-700",
  pushed:     "bg-emerald-100 text-emerald-700",
  failed:     "bg-red-100 text-red-700",
  rejected:   "bg-red-100 text-red-700",
}

const DONE_STATUSES = new Set(["reviewing", "approved", "pushed", "failed", "rejected"])

function fmtThb(n: number) {
  return "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export default function LiffScanPage() {
  const [authStatus,   setAuthStatus]  = useState<AuthStatus>("checking")
  const [authError,    setAuthError]   = useState("")
  const [loggingIn,    setLoggingIn]   = useState(false)
  const [lineUserId,   setLineUserId]  = useState("")

  const [step,       setStep]       = useState<UploadStep>("idle")
  const [previews,   setPreviews]   = useState<Preview[]>([])
  const [history,    setHistory]    = useState<DocResult[]>([])
  const [processing, setProcessing] = useState<DocResult[]>([]) // docs in-flight
  const [error,      setError]      = useState("")
  const [torchOn,        setTorchOn]        = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)

  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef   = useRef<HTMLInputElement>(null)
  const pollRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { setLoading } = useAppLoading()

  // ── Auth ───────────────────────────────────────────────────────────────────
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
        setLineUserId(p.userId)
        setAuthStatus("ready")
        loadHistory(p.userId)
      } catch (e: any) {
        if (!cancelled) { setAuthError(e?.message ?? String(e)); setAuthStatus("authError") }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => { cancelled = true; stopCamera() }
  }, [setLoading])

  // ── History load ───────────────────────────────────────────────────────────
  async function loadHistory(uid: string) {
    try {
      const r = await fetch(`/api/liff/scan?lineUserId=${encodeURIComponent(uid)}`)
      const d = await r.json()
      if (d.documents) setHistory(d.documents)
    } catch {}
  }

  // ── Poll processing docs ───────────────────────────────────────────────────
  const pollProcessing = useCallback(async (uid: string, docs: DocResult[]) => {
    if (!docs.length) return
    const pendingIds = docs.filter(d => !DONE_STATUSES.has(d.status)).map(d => d.id)
    if (!pendingIds.length) {
      // All done — move to history
      setHistory(prev => {
        const existingIds = new Set(prev.map(d => d.id))
        const newDone = docs.filter(d => !existingIds.has(d.id))
        return [...newDone, ...prev]
      })
      setProcessing([])
      setStep("done")
      return
    }

    try {
      const r = await fetch(`/api/liff/scan?lineUserId=${encodeURIComponent(uid)}&ids=${pendingIds.join(",")}`)
      const d = await r.json()
      if (!d.documents) return

      const updated: DocResult[] = docs.map(existing => {
        const fresh = d.documents.find((f: DocResult) => f.id === existing.id)
        return fresh ? { ...existing, ...fresh } : existing
      })
      setProcessing(updated)

      const stillPending = updated.filter(d => !DONE_STATUSES.has(d.status))
      if (stillPending.length > 0) {
        // Continue polling
        pollRef.current = setTimeout(() => pollProcessing(uid, updated), 2500)
      } else {
        setHistory(prev => {
          const existingIds = new Set(prev.map(d => d.id))
          const newDone = updated.filter(d => !existingIds.has(d.id))
          return [...newDone, ...prev]
        })
        setProcessing([])
        setStep("done")
      }
    } catch {}
  }, [])

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current) }, [])

  // ── Camera ─────────────────────────────────────────────────────────────────
  async function startCamera() {
    setError("")
    setStep("camera")
    setTorchOn(false)
    setTorchSupported(false)
    try {
      // 1920×2560 ideal (portrait-biased, documents are usually taller than
      // wide) — the old 1280×960 cap was well below what's needed for sharp
      // small print (receipt line items, tax IDs) once the AI pipeline
      // reads it; devices below this just fall back to their max anyway.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width:  { ideal: 1920 },
          height: { ideal: 2560 },
        },
      })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
      applyBestEffortCameraCapabilities(stream)
    } catch {
      setError("ไม่สามารถเปิดกล้องได้ — กรุณาอนุญาตการใช้กล้อง")
      setStep(previews.length ? "previewing" : "idle")
    }
  }

  // Best-effort hardware tuning — neither focus control nor torch is
  // supported everywhere (notably iOS Safari/LINE in-app browser exposes
  // almost none of this), so every step here must fail silently rather than
  // block capture. Where it IS supported (mostly Android Chrome/LINE
  // webview), continuous autofocus measurably sharpens small print before
  // the shutter fires, which is the main lever this page has over plain
  // <input capture> for OCR accuracy.
  function applyBestEffortCameraCapabilities(stream: MediaStream) {
    const track = stream.getVideoTracks()[0]
    if (!track || typeof track.getCapabilities !== "function") return
    try {
      const caps = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean }
      const advanced: MediaTrackConstraintSet[] = []
      if (caps.focusMode?.includes("continuous")) {
        advanced.push({ focusMode: "continuous" } as MediaTrackConstraintSet)
      }
      if (advanced.length) {
        track.applyConstraints({ advanced }).catch(() => {})
      }
      setTorchSupported(!!caps.torch)
    } catch { /* getCapabilities not implemented on this engine — ignore */ }
  }

  function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorchOn(next))
      .catch(() => {})
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function capturePhoto() {
    const video = videoRef.current; const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    canvas.getContext("2d")?.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" })
      const reader = new FileReader()
      reader.onload = e => setPreviews(prev => [...prev, { file, dataUrl: e.target!.result as string }])
      reader.readAsDataURL(file)
    }, "image/jpeg", 0.92) // bumped from 0.88 — higher capture resolution makes JPEG artifacting on fine print more visible at the old quality
    stopCamera()
    setStep("previewing")
  }

  function cancelCamera() { stopCamera(); setStep(previews.length ? "previewing" : "idle") }

  const { detected, holdPct } = useDocumentDetector(
    videoRef,
    step === "camera",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useCallback(() => capturePhoto(), []),
  )

  // ── File picker ────────────────────────────────────────────────────────────
  function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 5 - previews.length)
    if (!files.length) return
    let loaded = 0
    const newPreviews: Preview[] = []
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        newPreviews.push({ file, dataUrl: ev.target!.result as string })
        if (++loaded === files.length) {
          setPreviews(prev => [...prev, ...newPreviews])
          setStep("previewing")
        }
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ""
  }

  // ── Upload → trigger pipeline ──────────────────────────────────────────────
  async function uploadAll() {
    if (!previews.length || !lineUserId) return
    setStep("uploading"); setError("")
    try {
      const form = new FormData()
      form.append("lineUserId", lineUserId)
      previews.forEach(p => form.append("files", p.file))

      const r = await fetch("/api/liff/scan", { method: "POST", body: form })
      const d = await r.json()

      if (d.quotaExceeded) throw new Error(d.error)
      if (!r.ok || !d.ok)  throw new Error(d.error ?? "อัปโหลดไม่สำเร็จ")

      const inFlight: DocResult[] = (d.documents as { id: string; status: string }[]).map(doc => ({
        id: doc.id, status: "pending",
        vendor_name: null, total_amount: null, doc_date: null,
        overall_confidence: null, thumbUrl: null, created_at: new Date().toISOString(),
      }))
      setProcessing(inFlight)
      setPreviews([])
      setStep("processing")
      pollProcessing(lineUserId, inFlight)
    } catch (e: any) {
      setError(e?.message ?? "เกิดข้อผิดพลาด — กรุณาลองใหม่")
      setStep("previewing")
    }
  }

  // ── Auth screens ───────────────────────────────────────────────────────────
  if (authStatus === "checking") return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  )
  if (authStatus === "outsideLine") return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center bg-background">
      <AlertCircle className="w-12 h-12 text-yellow-500" />
      <p className="text-lg font-semibold">เปิดใน LINE เท่านั้น</p>
      <p className="text-sm text-muted-foreground">กรุณาเปิดหน้านี้ผ่าน LINE App</p>
    </div>
  )
  if (authStatus === "needLogin") return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 p-6 bg-background">
      <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center">
        <Camera className="w-10 h-10 text-primary" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold">ส่งสลิป</h1>
        <p className="text-muted-foreground mt-2 text-sm">ถ่ายรูปหรือเลือกสลิปเพื่ออัปโหลด — Slippy อ่านข้อมูลให้อัตโนมัติ</p>
      </div>
      <button disabled={loggingIn} onClick={async () => {
        setLoggingIn(true); const liff = (await import("@line/liff")).default; liff.login()
      }} className="flex items-center gap-2 bg-[#00B900] text-white font-bold px-8 py-3 rounded-2xl disabled:opacity-50">
        {loggingIn && <Loader2 className="w-5 h-5 animate-spin" />} เข้าสู่ระบบด้วย LINE
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

  // ── Camera view ────────────────────────────────────────────────────────────
  if (step === "camera") return (
    <div className="fixed inset-0 bg-black flex flex-col">
      <video ref={videoRef} autoPlay playsInline className="flex-1 object-cover w-full" />
      <canvas ref={canvasRef} className="hidden" />

      {/* Torch toggle — only shown when the device/browser actually exposes it */}
      {torchSupported && (
        <button onClick={toggleTorch}
          className={`absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${torchOn ? "bg-yellow-400 text-black" : "bg-white/20 text-white"}`}>
          <Zap className="w-5 h-5" />
        </button>
      )}

      {/* Document outline guide — turns green and fills as the frame holds
          steady on a well-lit, in-focus document, then auto-captures.
          Manual shutter below still works any time, detection or not. */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div className="relative w-[80%] h-[60%]">
          <div className="absolute -inset-[200%]" style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }} />
          <div className={`w-full h-full border-2 rounded-2xl transition-colors duration-200 ${detected ? "border-emerald-400" : "border-white/70"}`} />
          {holdPct > 0 && (
            <div className="absolute -bottom-3 left-0 right-0 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full transition-all duration-150" style={{ width: `${holdPct}%` }} />
            </div>
          )}
        </div>
        <p className={`absolute top-16 text-sm text-center px-8 transition-colors ${detected ? "text-emerald-300 font-semibold" : "text-white/80"}`}>
          {detected ? "ชัดเจน — ถือนิ่งไว้สักครู่ กำลังถ่ายอัตโนมัติ" : "จัดสลิปให้อยู่ในกรอบ ให้แสงเพียงพอ · Slippy อ่านข้อมูลอัตโนมัติ"}
        </p>
      </div>

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-around px-8 py-10 pb-safe">
        <button onClick={cancelCamera} className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
          <X className="w-6 h-6 text-white" />
        </button>
        <button onClick={capturePhoto}
          className={`w-20 h-20 rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-lg ${detected ? "bg-emerald-400" : "bg-white"}`}>
          <div className="w-14 h-14 rounded-full bg-white border-4 border-gray-200" />
        </button>
        <button onClick={() => { stopCamera(); fileRef.current?.click() }}
          className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
          <ImagePlus className="w-6 h-6 text-white" />
        </button>
      </div>
    </div>
  )

  // ── Main UI ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <canvas ref={canvasRef} className="hidden" />
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFilesChosen} />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <Camera className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="font-bold leading-tight">ส่งสลิป</h1>
          <p className="text-[10px] text-muted-foreground leading-none">Slippy อ่านข้อมูลอัตโนมัติ</p>
        </div>
      </div>

      <div className="flex-1 p-4 pb-8 space-y-5">

        {/* Error banner */}
        {error && (
          <div className="rounded-2xl bg-destructive/10 border border-destructive/20 p-3 flex gap-2 items-start">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Done banner */}
        {step === "done" && !processing.length && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-emerald-500 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">อัปโหลดสำเร็จ!</p>
              <p className="text-sm text-muted-foreground">ดูผลลัพธ์ด้านล่าง</p>
            </div>
          </div>
        )}

        {/* ── Processing section — in-flight docs ── */}
        {processing.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <h2 className="font-semibold text-sm">กำลังประมวลผล…</h2>
            </div>
            {processing.map(doc => (
              <ProcessingCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}

        {/* ── Preview grid ── */}
        {previews.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-foreground">
              รูปที่เลือก ({previews.length}/5)
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {previews.map((p, i) => (
                <div key={i} className="relative rounded-2xl overflow-hidden aspect-[3/4] bg-muted">
                  <Image src={p.dataUrl} alt={`preview-${i}`} fill className="object-cover" />
                  <button onClick={() => {
                    setPreviews(prev => {
                      const next = prev.filter((_, j) => j !== i)
                      if (!next.length) setStep("idle")
                      return next
                    })
                  }} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center">
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Action buttons ── */}
        {step !== "uploading" && step !== "processing" && (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={startCamera} disabled={previews.length >= 5}
              className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors disabled:opacity-40">
              <Camera className="w-7 h-7 text-primary" />
              <span className="text-sm font-medium">ถ่ายรูป</span>
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={previews.length >= 5}
              className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors disabled:opacity-40">
              <ImagePlus className="w-7 h-7 text-primary" />
              <span className="text-sm font-medium">เลือกจากคลัง</span>
            </button>
          </div>
        )}

        {/* Upload controls */}
        {previews.length > 0 && step !== "uploading" && step !== "processing" && (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setPreviews([]); setStep("idle") }}
              className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-muted-foreground/30 text-muted-foreground">
              <RotateCcw className="w-4 h-4" /> ล้าง
            </button>
            <button onClick={uploadAll}
              className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-primary text-primary-foreground font-bold">
              <Upload className="w-4 h-4" /> อัปโหลด {previews.length} รูป
            </button>
          </div>
        )}

        {step === "uploading" && (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">กำลังอัปโหลด…</span>
          </div>
        )}

        {/* ── History ── */}
        {history.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              ประวัติการส่งสลิป
            </h2>
            <div className="space-y-2">
              {history.map(doc => (
                <HistoryCard key={doc.id} doc={doc} appUrl={APP_URL} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!processing.length && !previews.length && !history.length && step !== "done" && (
          <div className="py-16 text-center text-muted-foreground">
            <div className="w-16 h-16 rounded-3xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Camera className="w-8 h-8 opacity-40" />
            </div>
            <p className="text-sm font-medium">ยังไม่มีสลิป</p>
            <p className="text-xs mt-1 opacity-60">กดถ่ายรูปหรือเลือกจากคลังรูปภาพ</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ProcessingCard({ doc }: { doc: DocResult }) {
  const isDone  = DONE_STATUSES.has(doc.status)
  const isError = doc.status === "failed" || doc.status === "rejected"
  return (
    <div className={`rounded-2xl border p-4 ${isError ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          isError ? "bg-destructive/10" : isDone ? "bg-emerald-500/10" : "bg-primary/10"
        }`}>
          {isDone
            ? (isError
                ? <AlertCircle className="w-5 h-5 text-destructive" />
                : <CheckCircle className="w-5 h-5 text-emerald-500" />)
            : <Loader2 className="w-5 h-5 text-primary animate-spin" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[doc.status] ?? "bg-gray-100 text-gray-600"}`}>
              {STATUS_LABEL[doc.status] ?? doc.status}
            </span>
          </div>
          {isDone && !isError && doc.vendor_name && (
            <p className="text-sm font-semibold mt-1 truncate">{doc.vendor_name}</p>
          )}
          {isDone && !isError && doc.total_amount != null && (
            <p className="text-sm text-primary font-bold">{fmtThb(doc.total_amount)}</p>
          )}
          {isDone && !isError && doc.doc_date && (
            <p className="text-xs text-muted-foreground">{doc.doc_date}</p>
          )}
          {isError && <p className="text-xs text-destructive mt-1">ประมวลผลไม่สำเร็จ</p>}
        </div>
        {isDone && !isError && (
          <Zap className="w-4 h-4 text-emerald-500 shrink-0" />
        )}
      </div>
    </div>
  )
}

function HistoryCard({ doc, appUrl }: { doc: DocResult; appUrl: string }) {
  const isError  = doc.status === "failed" || doc.status === "rejected"
  const isPending = doc.status === "pending" || doc.status === "processing"
  return (
    <a href={`${appUrl}/documents/${doc.id}`} className="flex items-center gap-3 p-3 bg-card rounded-2xl border active:bg-muted/50 transition-colors">
      {/* Thumbnail or icon */}
      <div className="w-12 h-14 rounded-xl overflow-hidden shrink-0 bg-muted flex items-center justify-center">
        {doc.thumbUrl
          // Plain <img>, not next/image — this is already a small,
          // pre-compressed Supabase Storage thumbnail. Running it through
          // Next's image-optimization proxy would fetch the original AND
          // re-serve a re-encoded copy through the same dev tunnel (ngrok)
          // this LIFF page is served over, doubling bandwidth for no
          // visual benefit at this size.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={doc.thumbUrl} alt="slip" width={48} height={56} className="object-cover w-full h-full" />
          : <FileText className="w-5 h-5 text-muted-foreground" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {doc.vendor_name ?? (isPending ? "กำลังประมวลผล…" : "ไม่ระบุร้าน")}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(doc.created_at).toLocaleDateString("th-TH", {
            day: "numeric", month: "short", year: "2-digit",
            hour: "2-digit", minute: "2-digit"
          })}
        </p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLOR[doc.status] ?? "bg-gray-100 text-gray-600"}`}>
          {STATUS_LABEL[doc.status] ?? doc.status}
        </span>
      </div>
      <div className="text-right shrink-0">
        {doc.total_amount != null && (
          <p className="text-sm font-bold">{fmtThb(doc.total_amount)}</p>
        )}
        {doc.doc_date && (
          <p className="text-[10px] text-muted-foreground">{doc.doc_date}</p>
        )}
        <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 ml-auto" />
      </div>
    </a>
  )
}
