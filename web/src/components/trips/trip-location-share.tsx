"use client"

import { useState } from "react"
import { Locate, LocateOff, X } from "lucide-react"
import { toast } from "sonner"
import type { ShareDuration } from "@/lib/trips/use-location-shares"
import { cn } from "@/lib/utils"

const OPTIONS: { value: ShareDuration; label: string }[] = [
  { value: "15m", label: "15 นาที" },
  { value: "1h",  label: "1 ชั่วโมง" },
  { value: "4h",  label: "4 ชั่วโมง" },
  { value: "eod", label: "จนถึงสิ้นวัน" },
]

export interface LocationShareState {
  mySession: { id: string; expiresAt: string } | null
  start: (duration: ShareDuration) => Promise<void>
  stop: () => Promise<void>
}

/** Start button + duration-picker sheet only — the "currently sharing"
 * banner itself is rendered once, tab-independently, by the caller
 * (trip-journey-client.tsx) so it stays visible no matter which tab is
 * active. `share` comes from a single `useLocationShares(tripId)` call
 * lifted to the trip page: this component used to call that hook itself,
 * which meant its browser-geolocation watch/ping timers (and the session
 * this button believes is active) were torn down and lost the instant the
 * Map tab — the only place this control was rendered — was left, even
 * though the location_sessions row was still live server-side. */
export function LocationShareControl({ share }: { share: LocationShareState }) {
  const { mySession, start, stop } = share
  const [showPicker, setShowPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      <button
        onClick={() => (mySession ? stop() : setShowPicker(true))}
        className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold",
          mySession ? "border-brand-500 bg-brand-50 text-brand-700" : "bg-card hover:bg-muted/50")}>
        {mySession ? <LocateOff className="h-3.5 w-3.5" /> : <Locate className="h-3.5 w-3.5" />}
        {mySession ? "หยุดแชร์ตำแหน่ง" : "แชร์ตำแหน่ง"}
      </button>

      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setShowPicker(false)}>
          <div className="w-full max-w-sm rounded-t-2xl bg-card p-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">แชร์ตำแหน่งนานแค่ไหน</p>
              <button onClick={() => setShowPicker(false)}><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">เพื่อนร่วมทริปจะเห็นตำแหน่งของคุณแบบสด ๆ จนกว่าจะหมดเวลาหรือคุณกดหยุด</p>
            {OPTIONS.map(o => (
              <button key={o.value} disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await start(o.value)
                    setShowPicker(false)
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to start location sharing")
                  } finally {
                    setBusy(false)
                  }
                }}
                className="block w-full rounded-xl p-3 text-left text-sm hover:bg-muted/50 disabled:opacity-50">
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/** The "you are currently sharing" indicator — rendered once, outside every
 * tab-conditional block, so it survives switching tabs. Deliberately NOT
 * self-positioning (no `fixed` here): the caller stacks this alongside the
 * call-in-progress banner in one positioned container, since both can be
 * visible at once. */
export function LocationSharingBanner({ mySession, stop }: { mySession: { id: string; expiresAt: string } | null; stop: () => Promise<void> }) {
  if (!mySession) return null
  return (
    <button
      onClick={() => stop()}
      className="pointer-events-auto rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white shadow-lg"
    >
      กำลังแชร์ตำแหน่ง · แตะเพื่อหยุด
    </button>
  )
}
