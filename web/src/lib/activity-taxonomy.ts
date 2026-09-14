import {
  BadgeCheck, BedDouble, Camera, Cross, FileText, Image, MapPin, Plane,
  ShieldCheck, ShoppingBag, Sparkles, Ticket, Trees, Users, Utensils,
  WalletCards,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

/** Stable presentation keys shared conceptually with iOS ActivityCategoryStyle. */
export type ActivityCategoryKey =
  | "transport" | "place" | "stay" | "food" | "sightseeing" | "nature"
  | "shopping" | "reservation" | "document" | "money" | "people"
  | "safety" | "memory" | "health" | "general"

export type ActivityCategory = {
  key: ActivityCategoryKey
  labelTh: string
  labelEn: string
  icon: LucideIcon
  /** Semantic Tailwind tokens deliberately independent from any one screen. */
  tone: "sky" | "violet" | "amber" | "emerald" | "rose" | "indigo" | "slate"
  /** Native iOS counterpart, kept here as an auditable cross-surface contract. */
  sfSymbol: string
}

const categories: ActivityCategory[] = [
  { key: "transport", labelTh: "การเดินทาง", labelEn: "Transport", icon: Plane, tone: "sky", sfSymbol: "airplane" },
  { key: "place", labelTh: "สถานที่และแผนที่", labelEn: "Places & map", icon: MapPin, tone: "indigo", sfSymbol: "mappin.and.ellipse" },
  { key: "stay", labelTh: "ที่พัก", labelEn: "Stay", icon: BedDouble, tone: "violet", sfSymbol: "bed.double.fill" },
  { key: "food", labelTh: "อาหาร", labelEn: "Food", icon: Utensils, tone: "amber", sfSymbol: "fork.knife" },
  { key: "sightseeing", labelTh: "เที่ยวชม", labelEn: "Sightseeing", icon: Camera, tone: "emerald", sfSymbol: "camera.fill" },
  { key: "nature", labelTh: "ธรรมชาติ", labelEn: "Nature", icon: Trees, tone: "emerald", sfSymbol: "leaf.fill" },
  { key: "shopping", labelTh: "ช้อปปิ้ง", labelEn: "Shopping", icon: ShoppingBag, tone: "rose", sfSymbol: "bag.fill" },
  { key: "reservation", labelTh: "ตั๋วและการจอง", labelEn: "Tickets & bookings", icon: Ticket, tone: "violet", sfSymbol: "ticket.fill" },
  { key: "document", labelTh: "เอกสาร", labelEn: "Documents", icon: FileText, tone: "slate", sfSymbol: "doc.text.fill" },
  { key: "money", labelTh: "ค่าใช้จ่าย", labelEn: "Money", icon: WalletCards, tone: "amber", sfSymbol: "wallet.pass.fill" },
  { key: "people", labelTh: "ทีมและการแชร์", labelEn: "People & sharing", icon: Users, tone: "indigo", sfSymbol: "person.2.fill" },
  { key: "safety", labelTh: "ความปลอดภัย", labelEn: "Safety", icon: ShieldCheck, tone: "rose", sfSymbol: "shield.checkered" },
  { key: "memory", labelTh: "บันทึกการเดินทาง", labelEn: "Memories", icon: Image, tone: "violet", sfSymbol: "photo.on.rectangle.angled" },
  { key: "health", labelTh: "สุขภาพและยา", labelEn: "Health & medication", icon: Cross, tone: "rose", sfSymbol: "cross.case.fill" },
  { key: "general", labelTh: "อื่นๆ", labelEn: "General", icon: Sparkles, tone: "slate", sfSymbol: "sparkles" },
]

const CATEGORY_BY_KEY: Record<ActivityCategoryKey, ActivityCategory> = Object.fromEntries(
  categories.map(category => [category.key, category]),
) as Record<ActivityCategoryKey, ActivityCategory>

const TRIP_TYPE_TO_CATEGORY: Record<string, ActivityCategoryKey> = {
  travel: "transport",
  food_order: "food",
  sport: "sightseeing",
  general: "money",
}

const ITINERARY_TYPE_TO_CATEGORY: Record<string, ActivityCategoryKey> = {
  flight: "transport", shinkansen: "transport", train: "transport", subway: "transport",
  ferry: "transport", bus: "transport", car_rental: "transport", taxi: "transport",
  walk: "transport", transport: "transport",
  hotel: "stay",
  restaurant: "food", meal: "food",
  activity: "sightseeing", onsen: "sightseeing", shopping: "shopping",
  booking: "reservation", note: "memory", free_time: "general", other: "general",
}

/** Returns a safe category even when an older server sends an unknown value. */
export function activityCategory(key?: string | null): ActivityCategory {
  return CATEGORY_BY_KEY[key as ActivityCategoryKey] ?? CATEGORY_BY_KEY.general
}

export function tripTypeCategory(type?: string | null): ActivityCategory {
  return activityCategory(TRIP_TYPE_TO_CATEGORY[type ?? ""])
}

export function itineraryTypeCategory(type?: string | null): ActivityCategory {
  return activityCategory(ITINERARY_TYPE_TO_CATEGORY[type ?? ""])
}

/** Expenses retain their detailed database category; this is their shared visual family. */
export function expenseCategory(_category?: string | null): ActivityCategory {
  return activityCategory("money")
}

/** Medication is private health data, but uses the same visual language as the journey. */
export function medicationCategory(): ActivityCategory {
  return activityCategory("health")
}

export const ACTIVITY_CATEGORIES = categories
