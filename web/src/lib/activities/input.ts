import type { ActivityStatus, ActivityVisibility, CreateActivityInput } from "./types"

export type ParsedActivityInput = CreateActivityInput & {
  locationName: string | null
  startsAt: string | null
  endsAt: string | null
  sourceType: "manual" | "imported" | "line" | "partner" | "calendar"
  sourceUrl: string | null
  tripId: string | null
  groupId: string | null
}

const VISIBILITIES: readonly ActivityVisibility[] = ["private", "group", "public"]
const STATUSES: readonly ActivityStatus[] = ["draft", "published", "cancelled", "completed"]
const SOURCE_TYPES = ["manual", "imported", "line", "partner", "calendar"] as const

function optionalString(value: unknown, field: string): string | null {
  if (value == null || value === "") return null
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  return value.trim() || null
}

function optionalIsoDate(value: unknown, field: string): string | null {
  const raw = optionalString(value, field)
  if (!raw) return null
  if (Number.isNaN(Date.parse(raw))) throw new Error(`${field} must be a valid ISO date`)
  return new Date(raw).toISOString()
}

export function parseActivityInput(input: unknown): ParsedActivityInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("activity input must be an object")
  const value = input as Record<string, unknown>
  const title = optionalString(value.title, "title")
  if (!title || title.length > 160) throw new Error("title must be between 1 and 160 characters")

  const visibility = value.visibility == null ? "private" : value.visibility
  if (typeof visibility !== "string" || !VISIBILITIES.includes(visibility as ActivityVisibility)) {
    throw new Error("visibility is invalid")
  }
  const status = value.status == null ? "draft" : value.status
  if (typeof status !== "string" || !STATUSES.includes(status as ActivityStatus)) {
    throw new Error("status is invalid")
  }
  const sourceType = value.sourceType == null ? "manual" : value.sourceType
  if (typeof sourceType !== "string" || !SOURCE_TYPES.includes(sourceType as typeof SOURCE_TYPES[number])) {
    throw new Error("sourceType is invalid")
  }

  const sourceUrl = optionalString(value.sourceUrl, "sourceUrl")
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl)
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported protocol")
    } catch {
      throw new Error("sourceUrl must be an absolute HTTP(S) URL")
    }
  }

  const startsAt = optionalIsoDate(value.startsAt, "startsAt")
  const endsAt = optionalIsoDate(value.endsAt, "endsAt")
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
    throw new Error("endsAt cannot be before startsAt")
  }

  return {
    title,
    summary: optionalString(value.summary, "summary") ?? "",
    category: optionalString(value.category, "category") ?? "general",
    visibility: visibility as ActivityVisibility,
    status: status as ActivityStatus,
    locationName: optionalString(value.locationName, "locationName"),
    startsAt,
    endsAt,
    sourceType: sourceType as ParsedActivityInput["sourceType"],
    sourceUrl,
    tripId: optionalString(value.tripId, "tripId"),
    groupId: optionalString(value.groupId, "groupId"),
  }
}
