"use client"

/**
 * The printable trip page — toolbar plus the document.
 *
 * The document is built as an HTML string (lib/trips/trip-document-html.ts) and
 * injected, rather than being a React tree. That is not a shortcut: the PDF
 * route cannot render React at all, because a Next route handler is compiled
 * under React's `react-server` export condition and react-dom/server throws
 * there. Making the builder produce a string is what lets the page and the PDF
 * share one definition of the document instead of drifting apart.
 *
 * The markup comes from our own server, from our own database, and every value
 * interpolated into it is escaped in the builder.
 */

import { useEffect, useState } from "react"
import { Printer, ArrowLeft, Download, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PRINT_CSS } from "@/lib/trips/print-css"

interface Props {
  tripId: string
  tripTitle: string
  html: string
  /** Open the browser print dialog on arrival (?print=1). */
  autoPrint?: boolean
}

export function TripPrintClient({ tripId, tripTitle, html, autoPrint }: Props) {
  const router = useRouter()
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!autoPrint) return
    // One frame after paint, so the dialog never captures a half-laid-out page.
    const t = setTimeout(() => window.print(), 350)
    return () => clearTimeout(t)
  }, [autoPrint])

  /**
   * One-click download.
   *
   * Fetched as a blob and saved through an object URL rather than navigating to
   * the route: a plain link would replace this tab with the PDF response, and
   * it leaves nowhere to show progress during the few seconds Chrome takes.
   */
  const download = async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/pdf`)
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}))
        throw new Error(msg.error ?? "สร้าง PDF ไม่สำเร็จ")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${tripTitle.replace(/[/\\?%*:|"<>]/g, "-")}.pdf`
      a.click()
      // Revoking immediately can cancel the save in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success("ดาวน์โหลด PDF แล้ว")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้าง PDF ไม่สำเร็จ")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-5 py-3">
        <button onClick={() => router.push(`/trips/${tripId}`)}
          className="inline-flex items-center gap-2 text-sm font-semibold">
          <ArrowLeft className="h-4 w-4" />กลับไปหน้าทริป
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()}
            className="inline-flex h-9 items-center gap-2 rounded-xl border bg-card px-3.5 text-sm font-semibold hover:bg-muted/50">
            <Printer className="h-4 w-4" />พิมพ์
          </button>
          <button onClick={download} disabled={downloading}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white disabled:opacity-60">
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? "กำลังสร้าง…" : "ดาวน์โหลด PDF"}
          </button>
        </div>
      </div>

      {/* The sheet sits on the app's own surface, which stays themed. The
          document itself is white in both themes — it is paper. */}
      <div className="min-h-screen bg-muted/40 px-4 pb-16 print:bg-white print:px-0 print:pb-0">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </>
  )
}
