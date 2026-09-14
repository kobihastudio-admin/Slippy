/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest }          from "next/server"
import {
  getBearerToken,
  VERIFIED_LINE_USER_HEADER,
  verifyLineAccessToken,
} from "@/lib/liff-auth"
import { checkRateLimit } from "@/lib/rate-limit"

const PUBLIC_LIFF_API_PATHS = new Set([
  "/api/liff/bill-info",
  "/api/liff/join-split",
  "/api/liff/join-trip",
])

// Stripe/LINE webhooks and LIFF traffic come from external systems / LINE's
// in-app browser, not a human clicking around — never throttle them.
const RATE_LIMIT_EXEMPT_PREFIXES = ["/api/webhooks/", "/api/liff/"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith("/api/") && !RATE_LIMIT_EXEMPT_PREFIXES.some(p => pathname.startsWith(p))) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
    const { allowed, retryAfterSeconds } = await checkRateLimit("api", ip, 60, 60)
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
      )
    }
  }

  if (pathname.startsWith("/api/liff/") && !PUBLIC_LIFF_API_PATHS.has(pathname)) {
    const accessToken = getBearerToken(request)
    if (!accessToken) {
      return NextResponse.json({ error: "LIFF authentication required" }, { status: 401 })
    }

    const profile = await verifyLineAccessToken(accessToken).catch(() => null)
    if (!profile?.userId) {
      return NextResponse.json({ error: "Invalid or expired LINE access token" }, { status: 401 })
    }

    const claimedLineUserId = request.nextUrl.searchParams.get("lineUserId")
    if (claimedLineUserId && claimedLineUserId !== profile.userId) {
      return NextResponse.json({ error: "LINE identity mismatch" }, { status: 403 })
    }

    const requestHeaders = new Headers(request.headers)
    requestHeaders.delete(VERIFIED_LINE_USER_HEADER)
    requestHeaders.set(VERIFIED_LINE_USER_HEADER, profile.userId)

    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cs: { name: string; value: string; options: CookieOptions }[]) => {
          cs.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cs.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let { data: { user } } = await supabase.auth.getUser()

  // Native clients (the iOS app) authenticate with a Supabase **Bearer token**
  // in the Authorization header, not a browser cookie session — so the
  // cookie-based getUser() above sees no user and, without this, every iOS
  // call to a web `/api/...` route (e.g. /api/documents/[id]/process, which
  // triggers extraction) was 307-redirected to /login and silently dropped.
  // That broke server-side extraction for all app uploads. Verify the bearer
  // token too: still fully authenticated, nothing is made public.
  if (!user) {
    const bearer = getBearerToken(request)
    if (bearer) {
      const { data: { user: bearerUser } } = await supabase.auth.getUser(bearer)
      if (bearerUser) user = bearerUser
    }
  }

  const isPublic = pathname.startsWith("/login")
    || pathname.startsWith("/register")
    || pathname.startsWith("/auth/")
    || pathname.startsWith("/api/auth/")      // OAuth callbacks (LINE, etc.)
    || pathname.startsWith("/api/webhooks/")
    || pathname.startsWith("/privacy-policy")
    || pathname.startsWith("/cookie-policy")
    || pathname.startsWith("/terms")
    || pathname.startsWith("/about")
    || pathname.startsWith("/careers")
    || pathname.startsWith("/press")
    || pathname.startsWith("/blog")
    || pathname.startsWith("/customers")
    || pathname.startsWith("/api-docs")
    || pathname.startsWith("/help-center")
    || pathname.startsWith("/status")
    || pathname.startsWith("/mobile-app")
    || pathname.startsWith("/changelog")
    || pathname.startsWith("/dpa")
    || pathname.startsWith("/liff/")          // LIFF mini-apps — auth via LINE profile, not Supabase session
    || pathname.startsWith("/api/liff/")      // LIFF backing APIs (join, bill-info, sport-groups, …)
    || pathname.startsWith("/api/places")     // venue/place search used by LIFF mini-apps (no Supabase session)
    || pathname.startsWith("/api/ocr-feedback") // "ส่งให้ Slippy เรียนรู้" from CameraPickerView/OCRFullDetailView —
                                                 // anonymous training-data submission, not a logged-in user action
    || pathname === "/api/trips/recurring/run"  // internal cron endpoint — auth'd via CRON_SECRET, not a session
    || pathname.startsWith("/api/errors")     // client_error_logs — explicitly allows anon insert (route comment:
                                                 // "user might not be logged in yet"), but was missing here, so it
                                                 // was actually hitting this same redirect-instead-of-save bug
    || pathname === "/"

  if (!user && !isPublic) {
    const loginUrl = new URL("/login", request.url)
    return NextResponse.redirect(loginUrl)
  }

  if (user && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return supabaseResponse
}

export const config = {
  // Node.js runtime (not the default Edge runtime) — ioredis needs raw TCP
  // sockets for the rate limiter, which Edge doesn't support. Safe here
  // since this app deploys as a long-running Docker container, not Vercel.
  runtime: "nodejs",
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
