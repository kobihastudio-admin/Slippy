// Small pure helpers for files sent in the web chat (the iOS app has the same rules in ChatAttachmentRules.swift).
//
// Chat files live in the PRIVATE `chat-attachments` bucket at `chat/<conversationId>/<millis>.<ext>`. A message stores
// that object path in `attachment_url` (older messages store the full public URL the bucket used to have; the path is
// read out of it). Nobody opens a file by a permanent link: a client asks Storage for a short-lived signed URL with its
// own session, and Storage only signs for members of the conversation in the path (see the migration
// 20261114100000_chat_attachments_private.sql).

export const CHAT_BUCKET = "chat-attachments"
/** Lifetime of a signed URL, in seconds. */
export const SIGNED_URL_TTL_SECONDS = 3600
/** A cached signed URL is renewed when less than this many milliseconds are left. */
export const SIGNED_URL_RENEW_MARGIN_MS = 5 * 60 * 1000

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const PATH_RE = new RegExp(`^chat/(${UUID})/[A-Za-z0-9]+\\.[A-Za-z0-9]{1,8}$`, "i")
const STORAGE_URL_RE = new RegExp(`/storage/v1/object/(?:public|sign|authenticated)/${CHAT_BUCKET}/(.+)$`)

/** The object path inside the bucket for a value stored in `messages.attachment_url`, or null if it is not a chat file. */
export function chatAttachmentPath(stored: unknown): string | null {
  if (typeof stored !== "string") return null
  const value = stored.trim()
  if (PATH_RE.test(value)) return value
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    const match = STORAGE_URL_RE.exec(url.pathname)
    if (!match) return null
    const path = decodeURIComponent(match[1])
    return PATH_RE.test(path) ? path : null
  } catch {
    return null
  }
}

/** The conversation id a chat file path belongs to (lower-case), or null. */
export function chatAttachmentConversationId(path: unknown): string | null {
  if (typeof path !== "string") return null
  const match = PATH_RE.exec(path)
  return match ? match[1].toLowerCase() : null
}

/** Lower-case letters and digits, at most 8; anything else (empty, hostile, `../`) becomes `bin`. */
export function safeExtension(raw: string): string {
  const ext = (raw ?? "").toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin"
}

/** `chat/<conversationId>/<millis>.<ext>` for a file picked in the web chat. */
export function buildChatAttachmentPath(conversationId: string, nowMs: number, fileName: string): string {
  const dot = (fileName ?? "").lastIndexOf(".")
  const ext = safeExtension(dot >= 0 ? fileName.slice(dot + 1) : "")
  return `chat/${conversationId.toLowerCase()}/${Math.round(nowMs)}.${ext}`
}

/** Remembers signed URLs until shortly before they expire. */
export class SignedUrlCache {
  private entries = new Map<string, { url: string; expiresAt: number }>()

  /** The cached URL if it will still be valid for at least the renew margin, else null. */
  get(path: string, nowMs: number): string | null {
    const entry = this.entries.get(path)
    if (!entry) return null
    if (entry.expiresAt - nowMs < SIGNED_URL_RENEW_MARGIN_MS) {
      this.entries.delete(path)
      return null
    }
    return entry.url
  }

  set(path: string, url: string, nowMs: number, ttlSeconds: number = SIGNED_URL_TTL_SECONDS): void {
    this.entries.set(path, { url, expiresAt: nowMs + ttlSeconds * 1000 })
  }

  clear(): void {
    this.entries.clear()
  }
}

/** `1.5 MB` / `320 KB` / `12 B`; anything that is not a positive number gives an empty string. */
export function formatFileSize(bytes: unknown): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return ""
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes)} B`
}

/** `msg_type` for a picked file, from its MIME type. */
export function chatMessageType(mime: string): "image" | "video" | "file" {
  const lower = (mime ?? "").toLowerCase()
  if (lower.startsWith("image/")) return "image"
  if (lower.startsWith("video/")) return "video"
  return "file"
}

/** Only http(s) links are ever shared or opened from a message. */
export function isSafeAttachmentUrl(url: unknown): url is string {
  if (typeof url !== "string") return false
  try {
    const u = new URL(url)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}
