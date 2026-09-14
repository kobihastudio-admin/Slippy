"use client"

/**
 * The trip screen — the Journey design (trip-journey-design.tsx) running on real
 * rows instead of hard-coded arrays.
 *
 * Everything here reads the same `days` prop. The Itinerary tab draws it as a
 * timeline, the Map tab draws it as geography, the Budget tab draws it as money;
 * they are three renderings of one list, not three features that happen to sit
 * behind three tabs. That is why the shared vocabulary lives in lib/trips/
 * journey.ts rather than in this file.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import TripMap from "./trip-map-loader"
import { TripImportDialog } from "./trip-import-dialog"
import { TripMembersPanel } from "./trip-members-panel"
import { LocationShareControl, LocationSharingBanner } from "./trip-location-share"
import { CallButton, TripCallBanner, useTripCall } from "./trip-call-panel"
import { useLocationShares } from "@/lib/trips/use-location-shares"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  ArrowLeft, CalendarDays, ChevronRight, Compass, Ellipsis, Map as MapIcon,
  Wallet, Users, CheckCircle2, Circle, MapPin, Receipt, FileText,
  ListChecks, Pin, PinOff, Ticket, FileUp, Printer, ExternalLink,
  FolderOpen, Images, Camera, Upload, Plus, Trash2, Pencil, X, Loader2,
  PersonStanding, Sparkles, Tag, UserPlus,
} from "lucide-react"
import {
  type JourneyDay, type JourneyItem, type JourneyParticipant,
  type ChecklistItem, type TripNote, type TripDocument, type TripPhoto,
  itemSpec, isLeg, STATUS_LABEL, TYPE_SPEC, fmtTHB, originalAmount, journeyTotal,
  spendByCategory, fmtDayLabel, fmtWeekday, hhmm, daysUntil, DOC_KIND_LABEL,
} from "@/lib/trips/journey"
import { googleMapsPinUrl, googleMapsDirectionsUrl, googleTravelMode, googleStreetViewUrl } from "@/lib/trips/google-maps-links"

type Tab = "overview" | "plan" | "map" | "budget" | "manage"

const TABS: Array<{ id: Tab; label: string; icon: typeof MapPin }> = [
  { id: "overview", label: "ภาพรวม",   icon: Compass },
  { id: "plan",     label: "แผนเดินทาง", icon: CalendarDays },
  { id: "map",      label: "แผนที่",     icon: MapIcon },
  { id: "budget",   label: "ค่าใช้จ่าย",  icon: Wallet },
  { id: "manage",   label: "จัดการทริป", icon: Ellipsis },
]

const KYUSHU_CREW = [
  { name: "Dr. Tom", role: "Shiba · Mentor", avatar: "/design/kyushu-avatar-tom.png", mascot: "/design/kyushu-mascot-shiba.png", tone: "from-amber-400/25 to-violet-500/20" },
  { name: "Dr. Joey", role: "Owl · Navigator", avatar: "/design/kyushu-avatar-joey.png", mascot: "/design/kyushu-mascot-owl.png", tone: "from-sky-400/25 to-indigo-500/20" },
  { name: "Nancy", role: "Red panda · Planner", avatar: "/design/kyushu-avatar-nancy.png", mascot: "/design/kyushu-mascot-red-panda.png", tone: "from-rose-400/25 to-orange-500/20" },
  { name: "Vivi", role: "Rabbit · Story", avatar: "/design/kyushu-avatar-vivi.png", mascot: "/design/kyushu-mascot-rabbit.png", tone: "from-fuchsia-400/25 to-violet-500/20" },
] as const

export interface JourneyTrip {
  id: string
  title: string
  destination: string | null
  description: string | null
  status: string
  started_at: string | null
  ended_at: string | null
  base_currency: string
  cover_emoji: string | null
  notes: string | null
}

interface Props {
  trip: JourneyTrip
  days: JourneyDay[]
  participants: JourneyParticipant[]
  checklist: ChecklistItem[]
  notes: TripNote[]
  documents: TripDocument[]
  photos: TripPhoto[]
  /** Resolved server-side from trip-features.ts (see that file's header for
   * why) and passed down rather than read here — this component is a client
   * component, and those flags come from server-only env vars. */
  featureLiveLocation: boolean
  featureCalls: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Map
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Itinerary
// ─────────────────────────────────────────────────────────────────────────────

function ItemRow({ item, baseCurrency, photos, onCheckIn, checkingIn, onEdit, onDelete }: {
  item: JourneyItem
  baseCurrency: string
  photos: TripPhoto[]
  onCheckIn: (item: JourneyItem, files: FileList | null) => void
  checkingIn: boolean
  onEdit: (item: JourneyItem) => void
  onDelete: (item: JourneyItem) => void
}) {
  const spec = itemSpec(item.type)
  const Icon = spec.icon
  const original = originalAmount(item, baseCurrency)
  const cancelled = item.status === "cancelled"
  const fileInput = useRef<HTMLInputElement>(null)

  // Only the fields that were actually filled in — `details` is free-form, so
  // anything read out of it is checked rather than assumed.
  const detailBits = Object.entries(item.details ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object")
    .slice(0, 4)

  return (
    <div className="relative flex gap-3 sm:gap-4">
      <div className="w-11 shrink-0 pt-3 text-right text-xs font-semibold tabular-nums text-muted-foreground">
        {hhmm(item.time_from) || "—"}
      </div>
      <div className="relative flex w-6 justify-center">
        <div className="absolute bottom-0 top-0 w-px bg-border" />
        <div className={cn("relative z-10 mt-3 grid h-6 w-6 place-items-center rounded-full ring-4 ring-card", spec.tile)}>
          <Icon className={cn("h-3.5 w-3.5", spec.fg)} />
        </div>
      </div>

      <div className={cn("mb-3 flex-1 rounded-xl border bg-card p-4", cancelled && "opacity-50")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={cn("font-semibold leading-snug", cancelled && "line-through")}>{item.title}</h3>
              {item.status === "optional" && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  {STATUS_LABEL.optional}
                </span>
              )}
              {item.status === "planned" && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {STATUS_LABEL.planned}
                </span>
              )}
            </div>
            {item.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{item.subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {Number(item.amount_base_currency) > 0 && (
              <div className="text-right">
                <p className="text-sm font-bold tabular-nums">{fmtTHB(Number(item.amount_base_currency))}</p>
                {original && <p className="text-[10px] text-muted-foreground tabular-nums">{original}</p>}
              </div>
            )}
            <div className="flex items-center gap-1">
              <button onClick={() => onEdit(item)} aria-label="แก้ไข"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onDelete(item)} aria-label="ลบ"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {(item.location || item.end_location) && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {item.location}
              {item.end_location && <> <span className="text-foreground/50">→</span> {item.end_location}</>}
            </span>
          </p>
        )}

        {item.notes && (
          <p className="mt-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">{item.notes}</p>
        )}

        {item.lat != null && item.lng != null && (() => {
          // A leg (has both ends) gets directions when the type has a road/rail
          // equivalent Google can route (see googleTravelMode); everything else
          // — including a leg with no such equivalent, like a flight — gets a
          // plain pin on its departure point. Never a directions link with no
          // travel mode, which Google Maps accepts but then guesses at.
          const mode = googleTravelMode(item.type)
          const isRoutable = isLeg(item) && mode
          const href = isRoutable
            ? googleMapsDirectionsUrl({
                origin: [item.lat!, item.lng!],
                destination: [item.end_lat!, item.end_lng!],
                mode,
              }).url
            : googleMapsPinUrl([item.lat!, item.lng!], item.title)
          return (
            <span className="mt-2 flex items-center gap-3">
              <a href={href} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400">
                <ExternalLink className="h-3 w-3" />
                เปิดใน Google Maps{isRoutable ? " · นำทาง" : ""}
              </a>
              <a href={googleStreetViewUrl([item.lat!, item.lng!])} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400">
                <PersonStanding className="h-3 w-3" />
                มุมมองถนน
              </a>
            </span>
          )
        })()}

        {(detailBits.length > 0 || item.confirmation_code) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-2.5 text-[11px] text-muted-foreground">
            {item.provider && <span className="font-medium text-foreground/70">{item.provider}</span>}
            {item.confirmation_code && (
              <span className="inline-flex items-center gap-1 font-mono">
                <Ticket className="h-3 w-3" />{item.confirmation_code}
              </span>
            )}
            {detailBits.map(([k, v]) => (
              <span key={k}>{k.replace(/_/g, " ")}: <span className="text-foreground/70">{String(v)}</span></span>
            ))}
          </div>
        )}

        {/* Check-in + photos — a stop remembered, not just planned. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
          {item.checked_in_at ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />เช็คอินแล้ว
            </span>
          ) : (
            <button onClick={() => fileInput.current?.click()} disabled={checkingIn}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold hover:bg-muted/50 disabled:opacity-50">
              {checkingIn ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
              เช็คอิน
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { onCheckIn(item, e.target.files); e.target.value = "" }} />
          {item.checked_in_at && (
            <button onClick={() => fileInput.current?.click()} disabled={checkingIn}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
              <Plus className="h-3 w-3" />เพิ่มรูป
            </button>
          )}
          {photos.map(p => (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
              className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element -- user photos from a dynamic Storage host, not a build-time asset */}
              <img src={p.url} alt={p.caption ?? item.title} className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The one place an itinerary item's non-geographic details get edited —
 * title, type, day, time, status, provider, confirmation code, notes.
 * Reachable from both the itinerary tab (ItemRow's pencil icon) and the map
 * tab (TripMap's side-list pencil icon), so it lives here rather than being
 * built twice. Position (lat/lng) stays a map-only edit — drag the pin — this
 * sheet only ever touches the PATCH/POST fields that have nothing to do with
 * where the pin sits.
 */
function ItemEditSheet({ tripId, days, item, createDayId, onClose, onSaved, onCreated }: {
  tripId: string
  days: JourneyDay[]
  /** Edit mode when set. */
  item: JourneyItem | null
  /** Create mode when set (item must be null) — the day the new stop belongs to. */
  createDayId: string | null
  onClose: () => void
  onSaved: (item: JourneyItem & { day_id: string }) => void
  onCreated: (item: JourneyItem & { day_id: string }) => void
}) {
  const isCreate = !item
  const currentDayId = item
    ? days.find(d => d.trip_itinerary_items.some(i => i.id === item.id))?.id ?? days[0]?.id ?? ""
    : createDayId ?? days[0]?.id ?? ""

  const [title, setTitle] = useState(item?.title ?? "")
  const [type, setType] = useState(item?.type ?? "activity")
  const [dayId, setDayId] = useState(currentDayId)
  const [timeFrom, setTimeFrom] = useState(item?.time_from?.slice(0, 5) ?? "")
  const [timeTo, setTimeTo] = useState(item?.time_to?.slice(0, 5) ?? "")
  const [location, setLocation] = useState(item?.location ?? "")
  const [status, setStatus] = useState(item?.status ?? "planned")
  const [provider, setProvider] = useState(item?.provider ?? "")
  const [confirmationCode, setConfirmationCode] = useState(item?.confirmation_code ?? "")
  const [notes, setNotes] = useState(item?.notes ?? "")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim() || !dayId) return
    setSaving(true)
    try {
      if (isCreate) {
        const res = await fetch(`/api/trips/${tripId}/itinerary/items`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dayId, title: title.trim(), type, location: location.trim() || null,
            timeFrom: timeFrom || null, timeTo: timeTo || null, status,
            notes: notes.trim() || null,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "เพิ่มรายการไม่สำเร็จ")
        onCreated(json.item as JourneyItem & { day_id: string })
        toast.success("เพิ่มรายการแล้ว")
      } else {
        const res = await fetch(`/api/trips/${tripId}/itinerary/items`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: item.id, title: title.trim(), type, dayId,
            location: location.trim() || null, time_from: timeFrom || null, time_to: timeTo || null,
            status, provider: provider.trim() || null,
            confirmation_code: confirmationCode.trim() || null, notes: notes.trim() || null,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ")
        onSaved(json.item as JourneyItem & { day_id: string })
        toast.success("บันทึกแล้ว")
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  const inputClass = "w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500"
  const labelClass = "mb-1 block text-xs font-semibold text-muted-foreground"

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
         role="dialog" aria-modal="true" aria-label={isCreate ? "เพิ่มรายการ" : "แก้ไขรายการ"}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-3xl border bg-card shadow-2xl sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 p-5 backdrop-blur">
          <h2 className="text-lg font-bold">{isCreate ? "เพิ่มรายการ" : "แก้ไขรายการ"}</h2>
          <button onClick={onClose} aria-label="ปิด" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3.5 p-5">
          <div>
            <label className={labelClass}>ชื่อรายการ</label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
              placeholder="เช่น เที่ยวบิน BKK → NRT" className={inputClass} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>ประเภท</label>
              <select value={type} onChange={e => setType(e.target.value)} className={inputClass}>
                {Object.entries(TYPE_SPEC).map(([k, spec]) => <option key={k} value={k}>{spec.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>วันที่</label>
              <select value={dayId} onChange={e => setDayId(e.target.value)} className={inputClass}>
                {days.map(d => (
                  <option key={d.id} value={d.id}>Day {d.day_number}{d.city ? ` · ${d.city}` : ""}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>เวลาเริ่ม</label>
              <input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>เวลาสิ้นสุด</label>
              <input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>สถานที่ (ข้อความ)</label>
            <input value={location} onChange={e => setLocation(e.target.value)}
              placeholder="ชื่อสถานที่ที่แสดงในรายการ" className={inputClass} />
            {!isCreate && item.lat != null && (
              <p className="mt-1 text-[11px] text-muted-foreground">ตำแหน่งหมุดแก้ไขได้โดยลากบนแผนที่ ในแท็บแผนที่</p>
            )}
          </div>

          <div>
            <label className={labelClass}>สถานะ</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={inputClass}>
              {Object.entries(STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>ผู้ให้บริการ</label>
              <input value={provider} onChange={e => setProvider(e.target.value)}
                placeholder="เช่น Thai Airways" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>รหัสยืนยัน / เลขที่จอง</label>
              <input value={confirmationCode} onChange={e => setConfirmationCode(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>โน้ต</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={inputClass} />
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-card/95 p-4 backdrop-blur">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50">
            ยกเลิก
          </button>
          <button onClick={submit} disabled={!title.trim() || !dayId || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}

function DayStrip({ days, active, onPick }: {
  days: JourneyDay[]; active: number | null; onPick: (n: number) => void
}) {
  return (
    <div className="mb-5 flex gap-2 overflow-x-auto pb-2">
      {days.map(d => (
        <button key={d.id} onClick={() => onPick(d.day_number)}
          className={cn("min-w-[104px] shrink-0 rounded-2xl border p-3 text-left transition",
            active === d.day_number
              ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
              : "bg-card hover:bg-muted/50")}>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Day {d.day_number} · {fmtWeekday(d.date)}
          </span>
          <p className="mt-1 text-sm font-bold">{fmtDayLabel(d.date)}</p>
          <p className="truncate text-[11px] text-muted-foreground">{d.city ?? "—"}</p>
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export function TripJourneyClient({
  trip, days: initialDays, participants, checklist,
  notes: initialNotes, documents: initialDocuments, photos: initialPhotos,
  featureLiveLocation, featureCalls,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("overview")
  // null = "whole trip", which the Map tab offers explicitly. Typed as such
  // rather than cast, so every read below has to handle it.
  const [activeDay, setActiveDay] = useState<number | null>(initialDays[0]?.day_number ?? 1)
  const [moreScreen, setMoreScreen] = useState<"menu" | "checklist" | "notes" | "documents" | "gallery" | "members" | "profile">("menu")
  const [selectedCrew, setSelectedCrew] = useState<{ name: string; role: string; avatar: string; participant?: JourneyParticipant } | null>(null)
  // Lifted to the page level (was previously called separately inside
  // LocationShareControl too) — one shared session/geolocation-watch
  // instance means the "currently sharing" banner and the underlying ping
  // loop both survive switching tabs, instead of being torn down the moment
  // the Map tab (the only place this used to be mounted) is left. See
  // LocationShareControl's and LocationSharingBanner's doc comments.
  const { others: liveLocations, mySession: myLocationSession, start: startLocationShare, stop: stopLocationShare } = useLocationShares(trip.id)
  const locationShare = { mySession: myLocationSession, start: startLocationShare, stop: stopLocationShare }
  // Same reasoning, for voice calls — see useTripCall's doc comment.
  const call = useTripCall(trip.id)

  const [notes, setNotes] = useState(initialNotes)
  const [documents, setDocuments] = useState(initialDocuments)
  const [photos, setPhotos] = useState(initialPhotos)
  const [checkingInId, setCheckingInId] = useState<string | null>(null)

  const checkIn = async (item: JourneyItem, files: FileList | null) => {
    setCheckingInId(item.id)
    try {
      if (files?.length) {
        for (const file of Array.from(files)) {
          const form = new FormData()
          form.append("file", file)
          form.append("itemId", item.id)
          const res = await fetch(`/api/trips/${trip.id}/photos`, { method: "POST", body: form })
          const json = await res.json()
          if (!res.ok) throw new Error(json.error ?? "อัปโหลดรูปไม่สำเร็จ")
          setPhotos(prev => [json.photo as TripPhoto, ...prev])
        }
      }
      if (!item.checked_in_at) {
        const res = await fetch(`/api/trips/${trip.id}/itinerary/items`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: item.id, checkedIn: true }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "เช็คอินไม่สำเร็จ")
        setDays(prev => prev.map(d => ({
          ...d,
          trip_itinerary_items: d.trip_itinerary_items.map(i => i.id === item.id ? (json.item as JourneyItem) : i),
        })))
      }
      toast.success(files?.length ? "เช็คอินและอัปโหลดรูปแล้ว" : "เช็คอินแล้ว")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ")
    } finally {
      setCheckingInId(null)
    }
  }

  // ── Itinerary item edit/create/delete — shared by the itinerary tab's
  // ItemRow and the map tab's side-list, via ItemEditSheet below. ──────────
  const [editingItem, setEditingItem] = useState<JourneyItem | null>(null)
  const [creatingDayId, setCreatingDayId] = useState<string | null>(null)

  /**
   * Places an item in whatever day the server says it now belongs to,
   * removing it from every other day first. A plain "update in place" (as
   * TripMap's own internal patch does, for drag-only moves that never cross
   * a day) silently drops the item when the day itself changes: the item id
   * only exists in the OLD day's array, so mapping-by-id in the new day
   * finds nothing to update and the row just vanishes. This sheet is the one
   * place a day change is offered, so it has to get this right.
   */
  const placeItemInDays = (updated: JourneyItem & { day_id: string }) => {
    setDays(prev => prev.map(d => {
      const without = d.trip_itinerary_items.filter(i => i.id !== updated.id)
      if (d.id !== updated.day_id) return { ...d, trip_itinerary_items: without }
      const already = d.trip_itinerary_items.some(i => i.id === updated.id)
      return {
        ...d,
        trip_itinerary_items: already
          ? d.trip_itinerary_items.map(i => (i.id === updated.id ? { ...i, ...updated } : i))
          : [...without, updated],
      }
    }))
  }

  const deleteItem = async (item: JourneyItem) => {
    const before = days
    setDays(prev => prev.map(d => ({
      ...d, trip_itinerary_items: d.trip_itinerary_items.filter(i => i.id !== item.id),
    })))
    const res = await fetch(`/api/trips/${trip.id}/itinerary/items?itemId=${item.id}`, { method: "DELETE" })
    if (!res.ok) { setDays(before); toast.error("ลบรายการไม่สำเร็จ") }
    else toast.success("ลบรายการแล้ว")
  }

  const deletePhoto = async (photoId: string) => {
    const before = photos
    setPhotos(prev => prev.filter(p => p.id !== photoId))
    const res = await fetch(`/api/trips/${trip.id}/photos/${photoId}`, { method: "DELETE" })
    if (!res.ok) { setPhotos(before); toast.error("ลบรูปไม่สำเร็จ") }
  }

  const uploadDocument = async (file: File, kind: string, title: string) => {
    try {
      const form = new FormData()
      form.append("file", file); form.append("kind", kind); form.append("title", title)
      const res = await fetch(`/api/trips/${trip.id}/documents`, { method: "POST", body: form })
      // A response that isn't valid JSON (a proxy's own error page, a body
      // truncated before it reached this route at all) must not propagate as
      // an uncaught throw — DocumentsScreen's submit() awaits this call with
      // no try/catch of its own, so an uncaught error here left "uploading"
      // stuck true forever: the button spun with no way out and no message,
      // which is exactly what silently read as "the upload button hangs."
      const json = await res.json().catch(() => ({ error: "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ไฟล์อาจใหญ่เกินไป" }))
      if (!res.ok) { toast.error(json.error ?? "อัปโหลดไม่สำเร็จ"); return }
      setDocuments(prev => [json.document as TripDocument, ...prev])
      toast.success("อัปโหลดเอกสารแล้ว")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ")
    }
  }

  const openDocument = async (docId: string) => {
    const res = await fetch(`/api/trips/${trip.id}/documents/${docId}`)
    const json = await res.json()
    if (!res.ok) { toast.error(json.error ?? "เปิดไฟล์ไม่สำเร็จ"); return }
    window.open(json.url as string, "_blank", "noopener,noreferrer")
  }

  const deleteDocument = async (docId: string) => {
    const before = documents
    setDocuments(prev => prev.filter(d => d.id !== docId))
    const res = await fetch(`/api/trips/${trip.id}/documents/${docId}`, { method: "DELETE" })
    if (!res.ok) { setDocuments(before); toast.error("ลบเอกสารไม่สำเร็จ") }
  }

  const addNote = async (title: string, body: string) => {
    const res = await fetch(`/api/trips/${trip.id}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error ?? "เพิ่มโน้ตไม่สำเร็จ"); return }
    setNotes(prev => [json.note as TripNote, ...prev])
  }

  const updateNote = async (id: string, patch: { title?: string; body?: string; isPinned?: boolean }) => {
    const before = notes
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch, body: patch.body ?? n.body, is_pinned: patch.isPinned ?? n.is_pinned } : n))
    const res = await fetch(`/api/trips/${trip.id}/notes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    })
    if (!res.ok) { setNotes(before); toast.error("บันทึกโน้ตไม่สำเร็จ") }
  }

  const deleteNote = async (id: string) => {
    const before = notes
    setNotes(prev => prev.filter(n => n.id !== id))
    const res = await fetch(`/api/trips/${trip.id}/notes/${id}`, { method: "DELETE" })
    if (!res.ok) { setNotes(before); toast.error("ลบโน้ตไม่สำเร็จ") }
  }

  /**
   * The itinerary is editable from the map, so it lives in state rather than
   * being read straight from props. Every tab reads this one array — move a pin
   * and the timeline, the totals and the category breakdown all follow, because
   * there is nothing else for them to read.
   */
  const [days, setDays] = useState(initialDays)
  const [importing, setImporting] = useState(false)

  /**
   * Adopt server data whenever it arrives.
   *
   * `days` is state so the map can edit it optimistically, but that means a
   * router.refresh() — which is how an import publishes its new rows — would
   * otherwise re-render this component with fresh props that the initial
   * useState ignores, and the imported stops would simply not appear. The
   * server is authoritative; local edits are a preview of it.
   */
  useEffect(() => { setDays(initialDays) }, [initialDays])

  const total     = useMemo(() => journeyTotal(days), [days])
  const byCat     = useMemo(() => spendByCategory(days), [days])
  const itemCount = useMemo(() => days.reduce((s, d) => s + d.trip_itinerary_items.length, 0), [days])
  const confirmed = useMemo(() => days.reduce((s, d) =>
    s + d.trip_itinerary_items.filter(i => i.status === "confirmed").length, 0), [days])
  const doneChecks = checklist.filter(c => c.is_done).length
  const countdown  = daysUntil(trip.started_at)
  const perHead    = participants.length ? total / participants.length : total
  const day        = days.find(d => d.day_number === activeDay) ?? days[0]

  /** Readiness = how much of the trip is actually booked, not how much is typed in. */
  const readiness = itemCount + checklist.length > 0
    ? Math.round(((confirmed + doneChecks) / (itemCount + checklist.length)) * 100)
    : 0

  const countdownLabel =
    countdown == null ? trip.status
    : countdown > 0   ? `อีก ${countdown} วัน`
    : countdown === 0 ? "วันนี้"
    : `ผ่านมาแล้ว ${Math.abs(countdown)} วัน`

  return (
    <div className="page">
      {/* ── Header ── */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/trips")} aria-label="กลับไปหน้าทริป"
            className="grid h-10 w-10 place-items-center rounded-xl border bg-card hover:bg-muted/50">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{trip.title}</h1>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                {countdownLabel}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {trip.destination ?? "—"} · {days.length} วัน · {participants.length} คน
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setImporting(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-xs font-semibold hover:bg-muted/50">
            <FileUp className="h-4 w-4" />นำเข้าเอกสาร
          </button>
          <Link href={`/trips/${trip.id}/print?print=1`} target="_blank"
            className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-xs font-semibold hover:bg-muted/50">
            <Printer className="h-4 w-4" />Export PDF
          </Link>
          <a href={`/api/trips/${trip.id}/kml`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-xs font-semibold hover:bg-muted/50"
            title="ดาวน์โหลดแล้วนำเข้าที่ mymaps.google.com — เปิดดูซ้ำได้ในแอป Google Maps ภายใต้ Saved → Maps">
            <MapIcon className="h-4 w-4" />ส่งไป Google Maps
          </a>
          <Link href={`/trips/${trip.id}/expenses`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-xs font-semibold hover:bg-muted/50">
            <Receipt className="h-4 w-4" />จัดการค่าใช้จ่าย
          </Link>
        </div>
      </header>

      {/* ── Tabs ── */}
      <nav className="mb-6 flex overflow-x-auto rounded-2xl border bg-card p-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn("flex min-w-[104px] flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
              tab === id ? "bg-brand-500 text-white shadow-sm" : "text-muted-foreground hover:bg-muted/60")}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </nav>

      {/* ── Persistent sharing/call indicators — deliberately OUTSIDE the tab
          switch below, so they stay visible no matter which tab is active.
          See LocationSharingBanner/TripCallBanner doc comments. ── */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2">
        <TripCallBanner call={call} />
        <LocationSharingBanner mySession={myLocationSession} stop={stopLocationShare} />
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[1.5fr_.85fr]">
          <div className="space-y-5">
            <section className="relative min-h-[290px] overflow-hidden rounded-3xl bg-indigo-950 p-6 text-white sm:p-8">
              <img src="/design/kyushu-anime-trip-cover.png" alt="กลุ่มนักเดินทาง Kyushu Anime Journey" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/75 to-indigo-950/15" />
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-slate-950/85 to-transparent" />
              <span className="absolute left-0 top-0 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">{countdownLabel}</span>
              <div className="relative flex min-h-[242px] flex-col justify-end pt-16">
                <p className="text-xs font-bold tracking-[0.18em] text-violet-200">KYUSHU ANIME JOURNEY · 2026</p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight drop-shadow-md sm:text-4xl">{trip.title}</h2>
                <p className="mt-2 max-w-xl text-sm text-slate-100 drop-shadow">
                  {trip.description ?? "จัดการแผน รูปภาพ เอกสาร และช่วงเวลาของทีมไว้ใน Journey เดียว"}
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-4">
                  <div className="flex -space-x-2">
                    {participants.slice(0, 5).map((p, i) => (
                      <div key={p.id} title={p.display_name} className="h-8 w-8 overflow-hidden rounded-full border-2 border-slate-950 bg-indigo-500">
                        {p.profile_shared_with_trip && p.avatar_url
                          ? <img src={p.avatar_url} alt="" className="h-full w-full object-cover" />
                          : <span className="grid h-full w-full place-items-center text-[11px] font-bold text-white">{p.display_name.trim().charAt(0)}</span>}
                      </div>
                    ))}
                  </div>
                  <span className="text-sm text-indigo-100">{participants.length} คนเดินทาง</span>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold"><Users className="h-4 w-4 text-violet-500" />Kyushu travel crew</h3>
                  <p className="mt-1 text-xs text-muted-foreground">แตะการ์ดเพื่อจัดการโปรไฟล์ เอกสาร และข้อมูลส่วนตัวของสมาชิก</p>
                </div>
                <button onClick={() => { setMoreScreen("members"); setTab("manage") }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold text-violet-600 hover:bg-violet-500/10 dark:text-violet-300">
                  <UserPlus className="h-3.5 w-3.5" />เพิ่มสมาชิก
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {KYUSHU_CREW.map((member, index) => {
                  const profile = participants[index]
                  const sharedImage = profile?.profile_shared_with_trip ? profile.avatar_url : null
                  const sharedRole = profile?.profile_shared_with_trip ? profile.trip_role : null
                  return (
                    <button key={member.name} onClick={() => {
                      setSelectedCrew({ name: profile?.profile_shared_with_trip ? profile.display_name : member.name, role: sharedRole || member.role, avatar: sharedImage || member.avatar, participant: profile })
                      setMoreScreen("profile")
                      setTab("manage")
                    }} className={cn("relative overflow-hidden rounded-2xl border bg-gradient-to-br p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-500", member.tone)}>
                      <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-full border-2 border-white/60 bg-slate-950/35">
                        <img src={sharedImage || member.avatar} alt={`${member.name} avatar`} className="h-full w-full object-cover object-top" />
                      </div>
                      <p className="mt-3 truncate text-center text-sm font-semibold">{profile?.profile_shared_with_trip ? profile.display_name : member.name}</p>
                      <p className="mt-0.5 truncate text-center text-[11px] text-muted-foreground">{sharedRole || member.role}</p>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="rounded-3xl border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold"><Tag className="h-4 w-4 text-violet-500" />Travel identity</h3>
                  <p className="mt-1 text-xs text-muted-foreground">สัตว์นำโชค Anime สำหรับป้ายกระเป๋าและพื้นที่ส่วนตัวของทีม</p>
                </div>
                <Sparkles className="h-5 w-5 text-violet-500" />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {KYUSHU_CREW.map(member => (
                  <div key={member.name} className="flex min-h-28 flex-col items-center justify-center rounded-2xl border bg-muted/30 p-3 text-center">
                    <img src={member.mascot} alt={`${member.name} lucky mascot`} className="h-16 w-16 object-contain" />
                    <p className="mt-1 text-xs font-semibold">{member.name}</p>
                    <p className="text-[10px] text-muted-foreground">{member.role.split(" · ")[0]}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">เส้นทางทั้งทริป</p>
                  <h3 className="text-lg font-semibold">{days.length} วัน · {itemCount} รายการ</h3>
                </div>
                <button onClick={() => setTab("map")} className="text-sm font-semibold text-brand-600">ดูแผนที่</button>
              </div>
              <TripMap tripId={trip.id} days={days} activeDay={null}
                       onDaysChange={setDays} canEdit={false}
                       variant="compact" height={380} />
            </section>
          </div>

          <div className="space-y-4">
            <section className="rounded-2xl border bg-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">ความพร้อมของทริป</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{readiness}%</p>
                </div>
                <CheckCircle2 className={cn("h-8 w-8", readiness >= 80 ? "text-emerald-500" : "text-muted-foreground")} />
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${readiness}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">จองแล้ว</p>
                  <p className="mt-1 font-semibold tabular-nums">{confirmed} / {itemCount}</p>
                </div>
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">Checklist</p>
                  <p className="mt-1 font-semibold tabular-nums">{doneChecks} / {checklist.length}</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">ค่าใช้จ่ายที่วางแผนไว้</h3>
                <Wallet className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-3xl font-bold tabular-nums">{fmtTHB(total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">คนละ {fmtTHB(perHead)} · {participants.length} คน</p>
              <button onClick={() => setTab("budget")} className="mt-4 text-sm font-semibold text-brand-600">ดูรายละเอียด</button>
            </section>

            {notes.filter(n => n.is_pinned).map(n => (
              <section key={n.id} className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
                <div className="flex gap-3">
                  <Pin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{n.title}</p>
                    {n.body && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{n.body}</p>}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      )}

      {/* ── Itinerary ── */}
      {tab === "plan" && (
        <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
          <div className="min-w-0">
            <DayStrip days={days} active={activeDay} onPick={setActiveDay} />
            {day && (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">{day.title ?? `Day ${day.day_number}`}</h2>
                    <p className="text-sm text-muted-foreground">
                      {day.city} · {day.trip_itinerary_items.length} รายการ
                      {day.trip_itinerary_items[0]?.time_from && ` · เริ่ม ${hhmm(day.trip_itinerary_items[0].time_from)}`}
                    </p>
                    {day.summary && <p className="mt-2 text-sm text-muted-foreground">{day.summary}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {featureCalls && <CallButton call={call} />}
                    <button onClick={() => setCreatingDayId(day.id)}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border bg-card px-3 text-xs font-semibold hover:bg-muted/50">
                      <Plus className="h-3.5 w-3.5" />เพิ่มรายการ
                    </button>
                  </div>
                </div>
                <div className="rounded-2xl border bg-card p-2 sm:p-4">
                  {day.trip_itinerary_items.length === 0
                    ? <p className="p-8 text-center text-sm text-muted-foreground">ยังไม่มีรายการในวันนี้</p>
                    : day.trip_itinerary_items.map(it => (
                        <ItemRow key={it.id} item={it} baseCurrency={trip.base_currency}
                          photos={photos.filter(p => p.item_id === it.id)}
                          onCheckIn={checkIn} checkingIn={checkingInId === it.id}
                          onEdit={setEditingItem} onDelete={deleteItem} />
                      ))}
                </div>
              </>
            )}
          </div>
          <div>
            <div className="xl:sticky xl:top-5">
              <TripMap tripId={trip.id} days={days} activeDay={activeDay}
                       onDaysChange={setDays} canEdit variant="compact" height={560}
                       onEditItem={setEditingItem} />
            </div>
          </div>
        </div>
      )}

      {/* ── Map ── */}
      {tab === "map" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DayStrip days={days} active={activeDay} onPick={setActiveDay} />
            <div className="flex shrink-0 items-center gap-2">
              {featureLiveLocation && <LocationShareControl share={locationShare} />}
              {featureCalls && <CallButton call={call} />}
              <button onClick={() => setActiveDay(v => (v === null ? days[0]?.day_number ?? 1 : null))}
                className={cn("h-9 shrink-0 rounded-xl border px-3.5 text-xs font-semibold transition",
                  activeDay === null ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "bg-card hover:bg-muted/50")}>
                {activeDay === null ? "กำลังดูทั้งทริป" : "ดูทั้งทริป"}
              </button>
            </div>
          </div>
          <TripMap tripId={trip.id} days={days} activeDay={activeDay}
                   onDaysChange={setDays} canEdit onEditItem={setEditingItem}
                   liveLocations={liveLocations} />
        </div>
      )}

      {/* ── Budget ── */}
      {tab === "budget" && (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
          <div className="space-y-5">
            <section className="rounded-3xl bg-slate-950 p-6 text-white">
              <p className="text-sm text-slate-400">ค่าใช้จ่ายที่วางแผนไว้ทั้งทริป</p>
              <p className="mt-2 text-4xl font-bold tabular-nums">{fmtTHB(total)}</p>
              <div className="mt-6 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">ต่อคน</p>
                  <p className="mt-1 text-base font-semibold tabular-nums">{fmtTHB(perHead)}</p>
                </div>
                <div>
                  <p className="text-slate-400">รายการที่มีค่าใช้จ่าย</p>
                  <p className="mt-1 text-base font-semibold tabular-nums">
                    {days.reduce((s, d) => s + d.trip_itinerary_items.filter(i => Number(i.amount_base_currency) > 0).length, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">สกุลเงินหลัก</p>
                  <p className="mt-1 text-base font-semibold">{trip.base_currency}</p>
                </div>
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border bg-card">
              <div className="flex items-center justify-between border-b p-5">
                <div>
                  <h3 className="font-semibold">รายการค่าใช้จ่าย</h3>
                  <p className="text-xs text-muted-foreground">แสดงยอดเดิมที่จ่ายจริงกำกับไว้ด้วย</p>
                </div>
                <Link href={`/trips/${trip.id}/expenses`} className="text-xs font-semibold text-brand-600">
                  ตัวจัดการเต็ม
                </Link>
              </div>
              {days.flatMap(d => d.trip_itinerary_items
                .filter(i => Number(i.amount_base_currency) > 0)
                .map(i => ({ item: i, day: d })))
                .sort((a, b) => Number(b.item.amount_base_currency) - Number(a.item.amount_base_currency))
                .slice(0, 12)
                .map(({ item, day: d }) => {
                  const spec = itemSpec(item.type)
                  const Icon = spec.icon
                  const original = originalAmount(item, trip.base_currency)
                  return (
                    <div key={item.id} className="flex items-center gap-3 border-b p-4 last:border-0">
                      <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", spec.tile)}>
                        <Icon className={cn("h-4 w-4", spec.fg)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {spec.label} · {fmtDayLabel(d.date)}
                          {item.expense_id && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">· ลงบัญชีแล้ว</span>}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums">{fmtTHB(Number(item.amount_base_currency))}</p>
                        {original && <p className="text-[10px] text-muted-foreground tabular-nums">{original}</p>}
                      </div>
                    </div>
                  )
                })}
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-2xl border bg-card p-5">
              <h3 className="font-semibold">แยกตามหมวด</h3>
              <div className="mt-5 space-y-4">
                {byCat.map(([name, amount], i) => (
                  <div key={name}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{name}</span>
                      <span className="font-semibold tabular-nums">{fmtTHB(amount)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full",
                        ["bg-violet-500", "bg-sky-500", "bg-orange-500", "bg-emerald-500", "bg-slate-400"][i % 5])}
                        style={{ width: `${total > 0 ? (amount / total) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">คนร่วมทริป</h3>
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="mt-4 space-y-2.5">
                {participants.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{p.display_name}</span>
                      {p.is_host && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">เจ้าภาพ</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmtTHB(Number(p.amount_owed))}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ── Trip management ── */}
      {importing && (
        <TripImportDialog tripId={trip.id} onClose={() => setImporting(false)}
          onImported={() => router.refresh()} />
      )}

      {(editingItem || creatingDayId) && (
        <ItemEditSheet
          tripId={trip.id}
          days={days}
          item={editingItem}
          createDayId={creatingDayId}
          onClose={() => { setEditingItem(null); setCreatingDayId(null) }}
          onSaved={placeItemInDays}
          onCreated={placeItemInDays}
        />
      )}

      {tab === "manage" && (
        <div>
          {moreScreen !== "menu" && (
            <button onClick={() => setMoreScreen("menu")} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold">
              <ArrowLeft className="h-4 w-4" />จัดการทริป
            </button>
          )}

          {moreScreen === "menu" && (
            <div className="space-y-7">
              <div>
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">เตรียมเดินทาง</p>
                  <h2 className="mt-1 text-xl font-bold">สิ่งที่ต้องพร้อมก่อนออกเดินทาง</h2>
                  <p className="mt-1 text-sm text-muted-foreground">รวมงานที่ต้องเตรียม จอง และตรวจสอบไว้ในหมวดเดียว</p>
                </div>
                <ManagementCards cards={[
                  { icon: ListChecks, title: "Checklist", sub: `${doneChecks}/${checklist.length} เสร็จแล้ว`, go: () => setMoreScreen("checklist") },
                  { icon: FolderOpen, title: "เอกสารและการจอง", sub: `${documents.length} ไฟล์ · ตั๋ว พาสปอร์ต ประกัน`, go: () => setMoreScreen("documents") },
                  { icon: Receipt, title: "ค่าใช้จ่ายและการหารบิล", sub: "งบประมาณ ชำระเงิน และสลิป", href: `/trips/${trip.id}/expenses` },
                ]} />
              </div>

              <div>
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600 dark:text-rose-300">Journey archive</p>
                  <h2 className="mt-1 text-xl font-bold">บันทึกความทรงจำของทริป</h2>
                  <p className="mt-1 text-sm text-muted-foreground">เก็บภาพและโน้ตไว้ค้นหาและกลับมาใช้งานได้ง่าย</p>
                </div>
                <ManagementCards cards={[
                  { icon: Images, title: "แกลเลอรี", sub: `${photos.length} รูปจากการเดินทาง`, go: () => setMoreScreen("gallery") },
                  { icon: FileText, title: "โน้ตของทริป", sub: `${notes.length} โน้ต · ข้อมูลสำคัญและไอเดีย`, go: () => setMoreScreen("notes") },
                ]} />
              </div>

              <div>
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-600 dark:text-sky-300">ทีมและความเป็นส่วนตัว</p>
                  <h2 className="mt-1 text-xl font-bold">ข้อมูลที่แชร์กับทีม</h2>
                  <p className="mt-1 text-sm text-muted-foreground">จัดการโปรไฟล์ รูป Avatar และเลือกข้อมูลที่ต้องการแชร์กับเพื่อนร่วมทริป</p>
                </div>
                <ManagementCards cards={[
                  { icon: Users, title: "โปรไฟล์และ Avatar", sub: `${participants.length} คน · แก้ไขรูปและข้อมูลส่วนตัว`, href: "/profile" },
                  { icon: MapPin, title: "ตำแหน่งและการติดต่อ", sub: "เปิดแชร์ตำแหน่งหรือคุยกับทีมจากหน้าแผนที่", go: () => setTab("map") },
                ]} />
              </div>
            </div>
          )}

          {moreScreen === "checklist" && (
            <div className="rounded-2xl border bg-card p-2 sm:p-3">
              {checklist.map(c => (
                <div key={c.id} className="flex items-center gap-3 border-b p-3 last:border-0">
                  {c.is_done
                    ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                    : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />}
                  <span className={cn("flex-1 text-sm", c.is_done && "text-muted-foreground line-through")}>{c.title}</span>
                  {c.category && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{c.category}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {moreScreen === "notes" && <NotesScreen notes={notes} onAdd={addNote} onUpdate={updateNote} onDelete={deleteNote} />}
          {moreScreen === "documents" && (
            <DocumentsScreen documents={documents} onUpload={uploadDocument} onOpen={openDocument} onDelete={deleteDocument} />
          )}
          {moreScreen === "gallery" && <GalleryScreen photos={photos} onDelete={deletePhoto} />}
          {moreScreen === "members" && <TripMembersPanel tripId={trip.id} />}
          {moreScreen === "profile" && selectedCrew && (
            <CrewProfileScreen
              crew={selectedCrew}
              documents={documents}
              onOpenDocuments={() => setMoreScreen("documents")}
              onOpenNotes={() => setMoreScreen("notes")}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ManagementCards({ cards }: { cards: Array<{
  icon: typeof MapPin
  title: string
  sub: string
  go?: () => void
  href?: string
}> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ icon: Icon, title, sub, go, href }) => {
        const body = (
          <>
            <div className="flex items-start justify-between">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500/10">
                <Icon className="h-5 w-5 text-brand-600 dark:text-brand-300" />
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </>
        )
        const cls = "rounded-2xl border bg-card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md"
        return href
          ? <Link key={title} href={href} className={cls}>{body}</Link>
          : <button key={title} onClick={go} className={cls}>{body}</button>
      })}
    </div>
  )
}

function CrewProfileScreen({ crew, documents, onOpenDocuments, onOpenNotes }: {
  crew: { name: string; role: string; avatar: string; participant?: JourneyParticipant }
  documents: TripDocument[]
  onOpenDocuments: () => void
  onOpenNotes: () => void
}) {
  const sharing = crew.participant?.profile_shared_with_trip
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)]">
      <section className="relative overflow-hidden rounded-3xl border bg-card p-6">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-violet-500/25 via-indigo-500/20 to-sky-500/20" />
        <div className="relative pt-9 text-center">
          <img src={crew.avatar} alt={`${crew.name} avatar`} className="mx-auto h-32 w-32 rounded-full border-4 border-card object-cover object-top shadow-lg" />
          <h2 className="mt-4 text-xl font-bold">{crew.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{crew.role}</p>
          <span className={cn("mt-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold", sharing ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
            {sharing ? "แชร์โปรไฟล์กับทริปแล้ว" : "ใช้ Avatar เฉพาะทริป"}
          </span>
        </div>
      </section>
      <section className="rounded-3xl border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600 dark:text-violet-300">Personal trip space</p>
        <h2 className="mt-2 text-xl font-bold">จัดการข้อมูลของ {crew.name}</h2>
        <p className="mt-2 text-sm text-muted-foreground">เอกสารและโน้ตในทริปถูกจัดการโดยสิทธิ์การแชร์ของสมาชิก เพื่อไม่ให้ข้อมูลส่วนตัวปรากฏต่อทุกคนโดยอัตโนมัติ</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button onClick={onOpenDocuments} className="rounded-2xl border p-4 text-left hover:bg-muted/50">
            <FolderOpen className="h-5 w-5 text-violet-500" />
            <p className="mt-3 font-semibold">เอกสารทริป</p>
            <p className="mt-1 text-xs text-muted-foreground">{documents.length} ไฟล์ · อัปโหลด ตรวจสอบ และกำหนดสิทธิ์แชร์</p>
          </button>
          <button onClick={onOpenNotes} className="rounded-2xl border p-4 text-left hover:bg-muted/50">
            <FileText className="h-5 w-5 text-violet-500" />
            <p className="mt-3 font-semibold">โน้ตและลิงก์</p>
            <p className="mt-1 text-xs text-muted-foreground">เก็บข้อมูลส่วนตัวหรือข้อมูลที่แชร์กับทีม</p>
          </button>
        </div>
        <Link href="/profile" className="mt-5 inline-flex h-10 items-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
          แก้ไขโปรไฟล์หลักและ Avatar
        </Link>
      </section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes — full CRUD. trip_notes and its RLS already existed; only a write UI
// was missing.
// ─────────────────────────────────────────────────────────────────────────────

function NotesScreen({ notes, onAdd, onUpdate, onDelete }: {
  notes: TripNote[]
  onAdd: (title: string, body: string) => Promise<void>
  onUpdate: (id: string, patch: { title?: string; body?: string; isPinned?: boolean }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editBody, setEditBody] = useState("")

  const submitNew = async () => {
    if (!title.trim()) return
    setSaving(true)
    await onAdd(title.trim(), body.trim())
    setSaving(false)
    setTitle(""); setBody(""); setAdding(false)
  }

  const startEdit = (n: TripNote) => { setEditingId(n.id); setEditTitle(n.title); setEditBody(n.body ?? "") }
  const submitEdit = async () => {
    if (!editingId || !editTitle.trim()) return
    await onUpdate(editingId, { title: editTitle.trim(), body: editBody.trim() })
    setEditingId(null)
  }

  return (
    <div className="space-y-4">
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-xs font-semibold hover:bg-muted/50">
          <Plus className="h-4 w-4" />เพิ่มโน้ต
        </button>
      ) : (
        <div className="rounded-2xl border bg-card p-4 space-y-2.5">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="หัวข้อโน้ต" autoFocus
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500" />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="รายละเอียด (ไม่บังคับ)" rows={3}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setTitle(""); setBody("") }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50">ยกเลิก</button>
            <button onClick={submitNew} disabled={!title.trim() || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}บันทึก
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {notes.map(n => (
          <div key={n.id} className="rounded-2xl border bg-card p-5">
            {editingId === n.id ? (
              <div className="space-y-2.5">
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} autoFocus
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500" />
                <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={3}
                  className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingId(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50">ยกเลิก</button>
                  <button onClick={submitEdit} className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white">บันทึก</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <button onClick={() => onUpdate(n.id, { isPinned: !n.is_pinned })}
                    aria-label={n.is_pinned ? "เลิกปักหมุด" : "ปักหมุด"}
                    className={n.is_pinned ? "text-amber-500" : "text-muted-foreground hover:text-foreground"}>
                    {n.is_pinned ? <Pin className="h-5 w-5" /> : <PinOff className="h-5 w-5" />}
                  </button>
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(n)} aria-label="แก้ไข" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => onDelete(n.id)} aria-label="ลบ" className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <h3 className="mt-4 font-semibold">{n.title}</h3>
                {n.body && <p className="mt-1.5 whitespace-pre-line text-xs text-muted-foreground">{n.body}</p>}
              </>
            )}
          </div>
        ))}
        {notes.length === 0 && !adding && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">ยังไม่มีโน้ต</p>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents — a browsable library, not a folder of forgotten uploads.
// ─────────────────────────────────────────────────────────────────────────────

const DOC_KINDS = Object.keys(DOC_KIND_LABEL) as Array<keyof typeof DOC_KIND_LABEL>

function DocumentsScreen({ documents, onUpload, onOpen, onDelete }: {
  documents: TripDocument[]
  onUpload: (file: File, kind: string, title: string) => Promise<void>
  onOpen: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [kind, setKind] = useState<string>("itinerary")
  const [title, setTitle] = useState("")
  const [uploading, setUploading] = useState(false)

  const grouped = DOC_KINDS
    .map(k => [k, documents.filter(d => d.kind === k)] as const)
    .filter(([, list]) => list.length > 0)

  const submit = async () => {
    if (!pendingFile) return
    setUploading(true)
    try {
      await onUpload(pendingFile, kind, title.trim() || pendingFile.name)
      setPendingFile(null); setTitle("")
    } finally {
      // Always, even if onUpload threw — otherwise a failed upload leaves the
      // button stuck showing its spinner forever with no way to retry.
      setUploading(false)
    }
  }

  return (
    <div className="space-y-5">
      <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { setPendingFile(f); setTitle(f.name) } e.target.value = "" }} />

      {!pendingFile ? (
        <button onClick={() => fileInput.current?.click()}
          className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-xs font-semibold hover:bg-muted/50">
          <Upload className="h-4 w-4" />อัปโหลดเอกสาร
        </button>
      ) : (
        <div className="rounded-2xl border bg-card p-4 space-y-2.5">
          <p className="truncate text-xs text-muted-foreground">{pendingFile.name} · {(pendingFile.size / 1024).toFixed(0)} KB</p>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="ชื่อเอกสาร"
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500" />
          <select value={kind} onChange={e => setKind(e.target.value)}
            className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500">
            {DOC_KINDS.map(k => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}
          </select>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setPendingFile(null); setTitle("") }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/50">ยกเลิก</button>
            <button onClick={submit} disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}อัปโหลด
            </button>
          </div>
        </div>
      )}

      {documents.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีเอกสาร</p>
      ) : grouped.map(([k, list]) => (
        <div key={k}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{DOC_KIND_LABEL[k]}</p>
          <div className="divide-y rounded-2xl border bg-card">
            {list.map(d => (
              <div key={d.id} className="flex items-center gap-3 p-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10">
                  <FileText className="h-4 w-4 text-brand-600 dark:text-brand-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <button onClick={() => onOpen(d.id)} className="truncate text-left text-sm font-medium hover:underline">{d.title}</button>
                  <p className="text-xs text-muted-foreground">
                    {d.file_type.toUpperCase()}{d.file_size ? ` · ${(d.file_size / 1024).toFixed(0)} KB` : ""}
                  </p>
                </div>
                <button onClick={() => onDelete(d.id)} aria-label="ลบ" className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Gallery — the check-in photos, seen all together.
// ─────────────────────────────────────────────────────────────────────────────

function GalleryScreen({ photos, onDelete }: { photos: TripPhoto[]; onDelete: (id: string) => Promise<void> }) {
  const [lightbox, setLightbox] = useState<TripPhoto | null>(null)
  if (photos.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีรูปในทริปนี้ — เช็คอินที่จุดใดจุดหนึ่งแล้วแนบรูปได้เลย</p>
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
        {photos.map(p => (
          <button key={p.id} onClick={() => setLightbox(p)} className="aspect-square overflow-hidden rounded-xl border">
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic Storage host */}
            <img src={p.url} alt={p.caption ?? ""} className="h-full w-full object-cover transition hover:scale-105" />
          </button>
        ))}
      </div>
      {lightbox && (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-h-[85vh] max-w-3xl" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic Storage host */}
            <img src={lightbox.url} alt={lightbox.caption ?? ""} className="max-h-[85vh] rounded-xl object-contain" />
            {lightbox.caption && <p className="mt-2 text-center text-sm text-white/90">{lightbox.caption}</p>}
            <div className="absolute right-2 top-2 flex gap-2">
              <button onClick={() => { onDelete(lightbox.id); setLightbox(null) }}
                className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white hover:bg-rose-600">
                <Trash2 className="h-4 w-4" />
              </button>
              <button onClick={() => setLightbox(null)} className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
