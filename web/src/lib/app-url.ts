/**
 * NEXT_PUBLIC_APP_URL with a trailing slash (e.g. "https://dev.slippyai.app/")
 * silently produces double-slash URLs everywhere it's concatenated with a
 * path (`${appUrl}/api/...` -> ".../app//api/..."), which LINE's OAuth
 * redirect_uri validation rejects outright since it compares byte-for-byte
 * against the registered Callback URL. Normalize once here instead of
 * trusting every call site to remember to strip it.
 */
export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "https://dev.slippyai.app"
  return raw.replace(/\/+$/, "")
}
