"use client"

const PATCH_FLAG = "__slippyLiffFetchPatched"

function installAuthenticatedFetch() {
  if (typeof window === "undefined") return

  const globalWindow = window as Window & { [PATCH_FLAG]?: boolean }
  if (globalWindow[PATCH_FLAG]) return
  globalWindow[PATCH_FLAG] = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

    const url = new URL(requestUrl, window.location.origin)
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/liff/")) {
      return originalFetch(input, init)
    }

    try {
      const { default: liff } = await import("@line/liff")
      const accessToken = liff.getAccessToken?.()
      if (!accessToken) return originalFetch(input, init)

      const headers = new Headers(input instanceof Request ? input.headers : undefined)
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
      headers.set("Authorization", `Bearer ${accessToken}`)

      return originalFetch(input, { ...init, headers })
    } catch {
      return originalFetch(input, init)
    }
  }
}

export function LiffApiAuth() {
  installAuthenticatedFetch()
  return null
}
