"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export interface ActiveLocation { sessionId: string; userId: string; lat: number; lng: number; recordedAt: string }
export type ShareDuration = "15m" | "1h" | "4h" | "eod"

/** Browser geolocation, foreground-only (no service worker, no background
 * sync) — matches the spec's locked-in decision exactly. */
export function useLocationShares(tripId: string) {
  const [others, setOthers] = useState<ActiveLocation[]>([])
  const [mySession, setMySession] = useState<{ id: string; expiresAt: string } | null>(null)
  const watchId = useRef<number | null>(null)
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const pollOthers = useCallback(async () => {
    const res = await fetch(`/api/trips/${tripId}/location-sessions`)
    if (!res.ok) return
    const json = await res.json() as { locations: ActiveLocation[] }
    setOthers(json.locations)
  }, [tripId])

  useEffect(() => {
    pollOthers()
    const t = setInterval(pollOthers, 10_000)
    return () => clearInterval(t)
  }, [pollOthers])

  const start = useCallback(async (duration: ShareDuration) => {
    if (mySession) return
    const res = await fetch(`/api/trips/${tripId}/location-sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration }),
    })
    if (!res.ok) throw new Error((await res.json()).error ?? "เริ่มแชร์ตำแหน่งไม่สำเร็จ")
    const { session } = await res.json() as { session: { id: string; expiresAt: string } }
    setMySession(session)

    if (!navigator.geolocation) {
      await fetch(`/api/trips/${tripId}/location-sessions/${session.id}`, { method: "DELETE" })
      throw new Error("Geolocation not available on this device")
    }
    watchId.current = navigator.geolocation.watchPosition(() => { /* position read on each ping tick below */ })
    pingTimer.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(pos => {
        fetch(`/api/trips/${tripId}/location-sessions/${session.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy, heading: pos.coords.heading ?? undefined, speedMps: pos.coords.speed ?? undefined,
          }),
        })
      })
    }, 12_000)
  }, [tripId, mySession])

  const stop = useCallback(async () => {
    if (!mySession) return
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    if (pingTimer.current) clearInterval(pingTimer.current)
    await fetch(`/api/trips/${tripId}/location-sessions/${mySession.id}`, { method: "DELETE" })
    setMySession(null)
  }, [tripId, mySession])

  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    if (pingTimer.current) clearInterval(pingTimer.current)
  }, [])

  return { others, mySession, start, stop }
}
