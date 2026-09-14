/**
 * APP_URL with a trailing slash (e.g. "https://dev.slippyai.app/") silently
 * produces double-slash URLs everywhere it's concatenated with a path
 * (`${APP_URL}/places?...` -> ".../app//places?..."), and breaks exact-match
 * comparisons like CORS origin checks. Normalize once here instead of
 * trusting every call site to remember to strip it.
 */
export function getAppUrl(fallback = "https://dev.slippyai.app"): string {
  const raw = process.env.APP_URL ?? fallback
  return raw.replace(/\/+$/, "")
}
