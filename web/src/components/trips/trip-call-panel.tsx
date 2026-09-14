"use client"

import { useEffect, useRef, useState } from "react"
import { Room } from "livekit-client"
import { Phone, PhoneOff } from "lucide-react"

export interface TripCall {
  connected: boolean
  connecting: boolean
  join: () => Promise<void>
  leave: () => Promise<void>
}

/**
 * Voice-only for this plan — no camera track is ever requested or published,
 * per the locked-in decision in the design spec.
 *
 * A single instance of this hook is meant to be called ONCE per trip page
 * (in trip-journey-client.tsx) and its `{ connected, connecting, join, leave }`
 * passed down to every `CallButton` render site. Previously each `CallButton`
 * called this logic itself, so the Itinerary tab's button and the Map tab's
 * button each held their OWN `roomRef` — switching from whichever tab you
 * joined the call from unmounted that instance, ran its unmount-cleanup
 * effect, and silently disconnected the call out from under you even though
 * you never touched the hang-up button. One shared instance means there is
 * only ever one `Room`, so no tab switch can trigger its cleanup effect.
 */
export function useTripCall(tripId: string): TripCall {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const roomRef = useRef<Room | null>(null)
  const callSessionIdRef = useRef<string | null>(null)

  // Now only tears down when the trip page itself unmounts (this hook is
  // called once, at the page level), not on every tab switch.
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect()
    }
  }, [])

  async function join() {
    setConnecting(true)
    try {
      const res = await fetch(`/api/trips/${tripId}/calls/token`, { method: "POST" })
      if (!res.ok) throw new Error((await res.json()).error ?? "เข้าร่วมสายไม่สำเร็จ")
      const { token, url, callSessionId } = await res.json() as { token: string; url: string; callSessionId: string }

      const room = new Room()
      try {
        await room.connect(url, token)
        await room.localParticipant.setMicrophoneEnabled(true)
      } catch (err) {
        // room.connect() may have succeeded even though a later step (e.g.
        // enabling the mic) failed — this room is never stored in roomRef,
        // so it must be disconnected here or it (and any mic track it
        // already captured) leaks as an unreachable, still-connected room.
        await room.disconnect()
        throw err
      }
      roomRef.current = room
      callSessionIdRef.current = callSessionId
      setConnected(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : "เข้าร่วมสายไม่สำเร็จ")
    } finally {
      setConnecting(false)
    }
  }

  async function leave() {
    roomRef.current?.disconnect()
    roomRef.current = null
    setConnected(false)
    // Marks this call session `ended` so trip_call_sessions_one_active_per_trip
    // (a partial unique index on journey_id WHERE status IN ('ringing',
    // 'active')) doesn't stay permanently stuck on a dangling ringing/active
    // row — without this, the very next person to try to join this trip's
    // call would hit that unique index and mintCallToken would start
    // failing for everyone. Not scoped to "the last participant leaves":
    // ending it here is a simplification (a future join briefly finds no
    // row and starts a fresh one, cheaper than tracking room occupancy),
    // not a full call-history feature.
    const callSessionId = callSessionIdRef.current
    callSessionIdRef.current = null
    if (callSessionId) {
      try {
        await fetch(`/api/trips/${tripId}/calls/token`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callSessionId }),
        })
      } catch {
        // Best-effort — a failed hang-up notification must never block the
        // user from actually leaving the call locally (already done above).
      }
    }
  }

  return { connected, connecting, join, leave }
}

/** Presentational only — state comes from `useTripCall`, called once at the
 * trip page level and shared across every render site (see that hook's own
 * doc comment for why). */
export function CallButton({ call }: { call: TripCall }) {
  const { connected, connecting, join, leave } = call

  if (connected) {
    return (
      <button onClick={leave} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700">
        <PhoneOff className="h-3.5 w-3.5" />วางสาย
      </button>
    )
  }
  return (
    <button onClick={join} disabled={connecting} className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-card px-3 text-xs font-semibold hover:bg-muted/50 disabled:opacity-50">
      <Phone className="h-3.5 w-3.5" />{connecting ? "กำลังเชื่อมต่อ…" : "โทร"}
    </button>
  )
}

/** The "in call" indicator — rendered once, outside every tab-conditional
 * block, so it survives switching tabs (see useTripCall's doc comment).
 * Deliberately NOT self-positioning: the caller stacks this alongside the
 * location-sharing banner in one positioned container. */
export function TripCallBanner({ call }: { call: TripCall }) {
  if (!call.connected) return null
  return (
    <button
      onClick={() => call.leave()}
      className="pointer-events-auto flex items-center gap-2 rounded-full bg-rose-600/90 px-4 py-2 text-xs font-semibold text-white shadow-lg"
    >
      <PhoneOff className="h-3.5 w-3.5" />กำลังคุยสาย · แตะเพื่อวางสาย
    </button>
  )
}
