// Small pure helpers for files sent in the web chat (the iOS app has the same rules in ChatAttachmentRules.swift).

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
