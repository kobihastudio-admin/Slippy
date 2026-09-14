/**
 * The Journey model — one description of what a trip is made of, shared by
 * every screen that draws it.
 *
 * The Journey design started life as a prototype full of hard-coded arrays
 * (trip-journey-design.tsx). Turning it into a real screen meant deciding, once,
 * what an itinerary item looks like — because the Itinerary tab, the Map tab and
 * the Budget tab are three readings of the SAME rows, and if each one keeps its
 * own idea of "a flight" they drift apart the first time a type is added.
 *
 * Mirrors supabase/migrations/20260822120000_trip_journey_structure.sql.
 */
import type { RouteGeometry } from "./routing"
import {
  Plane, Train, Ship, Bus, Car, CarTaxiFront, Footprints, TramFront,
  Hotel, Utensils, Coffee, ShoppingBag, Camera, Waves,
  FileText, Clock, MapPin, type LucideIcon,
} from "lucide-react"

// ── Rows as they come out of Supabase ───────────────────────────────────────

export interface JourneyItem {
  id: string
  sort_order: number
  type: string
  title: string
  subtitle: string | null
  location: string | null
  lat: number | null
  lng: number | null
  end_location: string | null
  end_lat: number | null
  end_lng: number | null
  time_from: string | null
  time_to: string | null
  starts_at: string | null
  ends_at: string | null
  status: string
  provider: string | null
  confirmation_code: string | null
  notes: string | null
  /** As charged, in `currency`. NEVER sum this across a trip — see amount_base_currency. */
  amount: number | null
  currency: string
  exchange_rate: number
  /** The trip base-currency figure. The only one safe to total. */
  amount_base_currency: number
  details: Record<string, unknown> | null
  expense_id: string | null
  /**
   * The drawn path for this leg, if one has been computed. See
   * lib/trips/routing.ts — `provider` says whether it is a real road/foot route
   * or the honest straight line for something that does not follow roads.
   */
  route_geometry: RouteGeometry | null
  checked_in_at: string | null
  checked_in_by: string | null
}

export interface JourneyDay {
  id: string
  day_number: number
  date: string | null
  title: string | null
  city: string | null
  summary: string | null
  trip_itinerary_items: JourneyItem[]
}

export interface JourneyParticipant {
  id: string
  display_name: string
  avatar_url?: string | null
  trip_role?: string | null
  profile_shared_with_trip?: boolean
  is_host: boolean
  amount_owed: number
  amount_paid: number
}

export interface ChecklistItem {
  id: string; title: string; category: string | null; is_done: boolean; sort_order: number
}

export interface TripNote {
  id: string; title: string; body: string | null; tag: string | null; is_pinned: boolean
}

export type TripDocumentKind = "itinerary" | "passport" | "visa" | "insurance" | "ticket" | "hotel" | "other"

export interface TripDocument {
  id: string
  kind: TripDocumentKind
  title: string
  file_path: string
  file_type: string
  file_size: number | null
  created_at: string
}

export const DOC_KIND_LABEL: Record<TripDocumentKind, string> = {
  itinerary: "ตั๋ว/ใบจอง", passport: "พาสปอร์ต", visa: "วีซ่า",
  insurance: "ประกันเดินทาง", ticket: "ตั๋ว", hotel: "ที่พัก", other: "อื่นๆ",
}

export interface TripPhoto {
  id: string
  item_id: string | null
  storage_path: string
  url: string
  caption: string | null
  taken_at: string
}

// ── How each kind of thing is drawn ─────────────────────────────────────────

export type ItemKind = "place" | "transport" | "stay" | "food" | "admin"

interface TypeSpec {
  label: string
  icon: LucideIcon
  /** Tailwind classes — written out, never interpolated, so Tailwind can see them. */
  tile: string
  fg: string
  /** Line colour on the map. Only transport draws lines. */
  stroke: string
  kind: ItemKind
}

/**
 * Every value allowed by trip_itinerary_items_type_check has a row here.
 * `itemSpec` falls back rather than throwing, so a type added in SQL before it
 * is added here degrades to a neutral pin instead of a blank screen.
 */
export const TYPE_SPEC: Record<string, TypeSpec> = {
  flight:     { label: "เที่ยวบิน",   icon: Plane,         tile: "bg-sky-500/10",     fg: "text-sky-600 dark:text-sky-400",         stroke: "#0ea5e9", kind: "transport" },
  shinkansen: { label: "ชินคันเซ็น",  icon: TramFront,     tile: "bg-rose-500/10",    fg: "text-rose-600 dark:text-rose-400",       stroke: "#f43f5e", kind: "transport" },
  train:      { label: "รถไฟ",        icon: Train,         tile: "bg-indigo-500/10",  fg: "text-indigo-600 dark:text-indigo-400",   stroke: "#6366f1", kind: "transport" },
  subway:     { label: "รถไฟใต้ดิน",  icon: Train,         tile: "bg-indigo-500/10",  fg: "text-indigo-600 dark:text-indigo-400",   stroke: "#818cf8", kind: "transport" },
  ferry:      { label: "เรือเฟอร์รี", icon: Ship,          tile: "bg-cyan-500/10",    fg: "text-cyan-600 dark:text-cyan-400",       stroke: "#06b6d4", kind: "transport" },
  bus:        { label: "รถบัส",       icon: Bus,           tile: "bg-teal-500/10",    fg: "text-teal-600 dark:text-teal-400",       stroke: "#14b8a6", kind: "transport" },
  car_rental: { label: "รถเช่า",      icon: Car,           tile: "bg-slate-500/10",   fg: "text-slate-600 dark:text-slate-300",     stroke: "#64748b", kind: "transport" },
  taxi:       { label: "แท็กซี่",     icon: CarTaxiFront,  tile: "bg-amber-500/10",   fg: "text-amber-600 dark:text-amber-400",     stroke: "#f59e0b", kind: "transport" },
  walk:       { label: "เดิน",        icon: Footprints,    tile: "bg-muted",          fg: "text-muted-foreground",                  stroke: "#94a3b8", kind: "transport" },
  transport:  { label: "การเดินทาง",  icon: Bus,           tile: "bg-teal-500/10",    fg: "text-teal-600 dark:text-teal-400",       stroke: "#14b8a6", kind: "transport" },

  hotel:      { label: "ที่พัก",      icon: Hotel,         tile: "bg-violet-500/10",  fg: "text-violet-600 dark:text-violet-400",   stroke: "#8b5cf6", kind: "stay" },

  restaurant: { label: "ร้านอาหาร",   icon: Utensils,      tile: "bg-orange-500/10",  fg: "text-orange-600 dark:text-orange-400",   stroke: "#f97316", kind: "food" },
  meal:       { label: "มื้ออาหาร",   icon: Coffee,        tile: "bg-orange-500/10",  fg: "text-orange-600 dark:text-orange-400",   stroke: "#fb923c", kind: "food" },

  activity:   { label: "กิจกรรม",     icon: Camera,        tile: "bg-emerald-500/10", fg: "text-emerald-600 dark:text-emerald-400", stroke: "#10b981", kind: "place" },
  onsen:      { label: "ออนเซ็น",     icon: Waves,         tile: "bg-cyan-500/10",    fg: "text-cyan-600 dark:text-cyan-400",       stroke: "#22d3ee", kind: "place" },
  shopping:   { label: "ช้อปปิ้ง",    icon: ShoppingBag,   tile: "bg-fuchsia-500/10", fg: "text-fuchsia-600 dark:text-fuchsia-400", stroke: "#d946ef", kind: "place" },

  booking:    { label: "การจอง",      icon: FileText,      tile: "bg-muted",          fg: "text-muted-foreground",                  stroke: "#94a3b8", kind: "admin" },
  note:       { label: "โน้ต",        icon: FileText,      tile: "bg-muted",          fg: "text-muted-foreground",                  stroke: "#94a3b8", kind: "admin" },
  free_time:  { label: "เวลาว่าง",    icon: Clock,         tile: "bg-muted",          fg: "text-muted-foreground",                  stroke: "#94a3b8", kind: "admin" },
  other:      { label: "อื่นๆ",       icon: MapPin,        tile: "bg-muted",          fg: "text-muted-foreground",                  stroke: "#94a3b8", kind: "admin" },
}

const FALLBACK: TypeSpec = TYPE_SPEC.other

export const itemSpec = (type: string): TypeSpec => TYPE_SPEC[type] ?? FALLBACK

/** A leg drawn as a line on the map, rather than a single pin. */
export const isLeg = (it: JourneyItem): boolean =>
  itemSpec(it.type).kind === "transport" && it.end_lat != null && it.end_lng != null

export const STATUS_LABEL: Record<string, string> = {
  planned:   "ยังไม่จอง",
  confirmed: "จองแล้ว",
  optional:  "ถ้ามีเวลา",
  cancelled: "ยกเลิก",
}

// ── Money ───────────────────────────────────────────────────────────────────

export const fmtTHB = (n: number) =>
  "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })

/**
 * The amount as printed on the receipt, when that is not the trip's currency.
 * Returns null when there is nothing extra to say, so callers can skip the line
 * rather than render "(฿8,544)" next to "฿8,544".
 */
export function originalAmount(it: JourneyItem, baseCurrency: string): string | null {
  if (!it.amount || it.currency === baseCurrency) return null
  const n = it.amount.toLocaleString("th-TH", { maximumFractionDigits: 0 })
  return it.currency === "JPY" ? `¥${n}` : `${n} ${it.currency}`
}

/**
 * Trip total. Sums `amount_base_currency` and nothing else — the one column
 * guaranteed to be in a single currency. Summing `amount` would add yen to baht
 * and produce a confident, meaningless number.
 */
export const journeyTotal = (days: JourneyDay[]): number =>
  days.reduce((s, d) => s + d.trip_itinerary_items.reduce(
    (t, i) => t + Number(i.amount_base_currency ?? 0), 0), 0)

export function spendByCategory(days: JourneyDay[]): Array<[string, number]> {
  const totals = new Map<ItemKind, number>()
  for (const d of days) {
    for (const i of d.trip_itinerary_items) {
      const amt = Number(i.amount_base_currency ?? 0)
      if (amt <= 0) continue
      const k = itemSpec(i.type).kind
      totals.set(k, (totals.get(k) ?? 0) + amt)
    }
  }
  const LABEL: Record<ItemKind, string> = {
    stay: "ที่พัก", transport: "เดินทาง", food: "อาหาร", place: "กิจกรรม", admin: "อื่นๆ",
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [LABEL[k], v] as [string, number])
}

// ── Dates ───────────────────────────────────────────────────────────────────

export const fmtDayLabel = (iso: string | null): string => {
  if (!iso) return "—"
  return new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" })
}

export const fmtWeekday = (iso: string | null): string => {
  if (!iso) return ""
  return new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short" })
}

/** "08:30" from a `time` column that Postgres returns as "08:30:00". */
export const hhmm = (t: string | null): string => (t ? t.slice(0, 5) : "")

/**
 * Days until the trip starts. Negative once it has begun, null without a date.
 * Compared at day granularity so a trip starting later today reads "วันนี้"
 * rather than "อีก 0 วัน".
 */
export function daysUntil(startISO: string | null): number | null {
  if (!startISO) return null
  // Read the calendar date off the STRING rather than converting the instant.
  //
  // life_journeys.started_at is midnight in the destination's timezone —
  // 2026-11-20T00:00:00+09:00 for Japan. `new Date(...)` then .getDate() reads
  // that instant in the VIEWER's timezone, and in Bangkok (+07) it lands at
  // 22:00 on the 19th, so the countdown was a day out for every trip east of
  // here. The first ten characters are already the intended date.
  const m = startISO.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const a = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const now = new Date()
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a - b) / 86_400_000)
}
