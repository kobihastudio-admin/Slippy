"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 *
 * Manual crop step for the web upload flow — the iOS app gets a cleaner
 * frame "for free" via VisionKit's document scanner (auto edge-detect +
 * perspective correction) before a photo ever reaches the server; the web
 * upload flow has no equivalent, it just sends whatever was selected
 * (desk, hands, background clutter and all). Full automatic perspective
 * correction needs real computer-vision (contour + homography), which is
 * out of scope here — this gives web users a quick manual trim instead, so
 * at minimum stray background doesn't dilute the AI's read of the receipt.
 * Server-side rotation/contrast enhancement (preprocessor.ts) already runs
 * identically for both platforms after this.
 */

import { useRef, useState, useCallback, useEffect } from "react"
import { Crop, Check, X } from "lucide-react"

interface Rect { x: number; y: number; w: number; h: number } // 0–1, fraction of image

interface ImageCropStepProps {
  file:      File
  onConfirm: (cropped: File) => void
  onSkip:    () => void   // upload the original, unmodified
  onCancel:  () => void   // back out entirely (e.g. pick a different file)
}

const HANDLES = ["nw", "ne", "sw", "se"] as const
type Handle = typeof HANDLES[number]

export function ImageCropStep({ file, onConfirm, onSkip, onCancel }: ImageCropStepProps) {
  const [imgUrl] = useState(() => URL.createObjectURL(file))
  const containerRef = useRef<HTMLDivElement>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [rect, setRect] = useState<Rect>({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 })
  const dragRef = useRef<{ mode: "move" | Handle; startX: number; startY: number; start: Rect } | null>(null)

  useEffect(() => () => URL.revokeObjectURL(imgUrl), [imgUrl])

  const clamp = (v: number) => Math.min(1, Math.max(0, v))

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current
    const box  = containerRef.current
    if (!drag || !box) return
    const b = box.getBoundingClientRect()
    const dx = (e.clientX - drag.startX) / b.width
    const dy = (e.clientY - drag.startY) / b.height

    setRect(() => {
      const s = drag.start
      if (drag.mode === "move") {
        const x = clamp(Math.min(1 - s.w, Math.max(0, s.x + dx)))
        const y = clamp(Math.min(1 - s.h, Math.max(0, s.y + dy)))
        return { ...s, x, y }
      }
      let { x, y, w, h } = s
      const minSize = 0.08
      if (drag.mode.includes("w")) { const nx = clamp(s.x + dx); w = Math.max(minSize, s.x + s.w - nx); x = s.x + s.w - w }
      if (drag.mode.includes("e")) { w = Math.max(minSize, clamp(s.x + s.w + dx) - s.x) }
      if (drag.mode.includes("n")) { const ny = clamp(s.y + dy); h = Math.max(minSize, s.y + s.h - ny); y = s.y + s.h - h }
      if (drag.mode.includes("s")) { h = Math.max(minSize, clamp(s.y + s.h + dy) - s.y) }
      return { x, y, w, h }
    })
  }, [])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", onPointerUp)
  }, [onPointerMove])

  const startDrag = (mode: "move" | Handle) => (e: React.PointerEvent) => {
    e.preventDefault()
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: rect }
    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
  }

  async function handleConfirm() {
    if (!naturalSize) { onSkip(); return }
    const sx = Math.round(rect.x * naturalSize.w)
    const sy = Math.round(rect.y * naturalSize.h)
    const sw = Math.round(rect.w * naturalSize.w)
    const sh = Math.round(rect.h * naturalSize.h)

    const img = new Image()
    img.src = imgUrl
    await img.decode()

    const canvas = document.createElement("canvas")
    canvas.width  = sw
    canvas.height = sh
    const ctx = canvas.getContext("2d")
    if (!ctx) { onSkip(); return }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

    canvas.toBlob((blob) => {
      if (!blob) { onSkip(); return }
      const cropped = new File([blob], file.name, { type: "image/jpeg" })
      onConfirm(cropped)
    }, "image/jpeg", 0.92)
  }

  const handleCursor: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Crop className="w-4 h-4 text-brand-500" />
        ครอบตัดภาพก่อนอัปโหลด (ไม่บังคับ)
      </div>
      <p className="text-xs text-muted-foreground">
        ลากมุมกรอบเพื่อตัดส่วนพื้นโต๊ะ/พื้นหลังออก — ภาพที่เห็นแค่ใบเสร็จล้วนๆ ช่วยให้ AI อ่านข้อมูลแม่นยำขึ้น
      </p>

      <div
        ref={containerRef}
        className="relative mx-auto max-w-full select-none touch-none"
        style={{ maxHeight: "60vh" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgUrl}
          alt=""
          className="block max-w-full max-h-[60vh] mx-auto rounded-lg"
          onLoad={(e) => {
            const t = e.currentTarget
            setNaturalSize({ w: t.naturalWidth, h: t.naturalHeight })
          }}
          draggable={false}
        />

        {/* Dimmed overlay outside the crop rect */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-black/45" style={{
            clipPath: `polygon(0% 0%, 0% 100%, ${rect.x * 100}% 100%, ${rect.x * 100}% ${rect.y * 100}%, ${(rect.x + rect.w) * 100}% ${rect.y * 100}%, ${(rect.x + rect.w) * 100}% ${(rect.y + rect.h) * 100}%, ${rect.x * 100}% ${(rect.y + rect.h) * 100}%, ${rect.x * 100}% 100%, 100% 100%, 100% 0%)`,
          }} />
        </div>

        {/* Crop rectangle */}
        <div
          className="absolute border-2 border-brand-400 cursor-move"
          style={{
            left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
          }}
          onPointerDown={startDrag("move")}
        >
          {HANDLES.map(h => (
            <div
              key={h}
              onPointerDown={startDrag(h)}
              className="absolute w-4 h-4 bg-brand-500 border-2 border-white rounded-full -m-2"
              style={{
                cursor: handleCursor[h],
                left:  h.includes("w") ? 0 : "100%",
                top:   h.includes("n") ? 0 : "100%",
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5">
          <X className="w-3.5 h-3.5 inline mr-1" /> เปลี่ยนไฟล์
        </button>
        <div className="flex gap-2">
          <button onClick={onSkip} className="text-xs font-medium rounded-lg border px-3 py-1.5 hover:bg-muted/50">
            ใช้ภาพเต็ม (ไม่ครอบตัด)
          </button>
          <button onClick={handleConfirm} className="text-xs font-medium rounded-lg bg-brand-500 text-white px-3 py-1.5 hover:bg-brand-600 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> ครอบตัดและอัปโหลด
          </button>
        </div>
      </div>
    </div>
  )
}
