"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useEffect, useId, useRef } from "react"
import Script from "next/script"

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string
        callback: (token: string) => void
        "expired-callback"?: () => void
        "error-callback"?: () => void
      }) => string
      reset: (widgetId: string) => void
    }
  }
}

/**
 * TurnstileWidget — renders Cloudflare Turnstile on login/register.
 * Renders nothing (and the parent should treat verification as skipped) if
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY isn't configured — mirrors the server-side
 * verifyTurnstileToken() fail-open behavior so dev/local environments
 * without a Turnstile site set up don't get stuck unable to log in.
 */
export function TurnstileWidget({ onVerify }: { onVerify: (token: string) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const containerId = useId()
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!siteKey) return
    const el = document.getElementById(containerId)
    if (!el || widgetIdRef.current) return

    const tryRender = () => {
      if (!window.turnstile) return false
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: siteKey,
        callback: onVerify,
        "expired-callback": () => onVerify(""),
        "error-callback": () => onVerify(""),
      })
      return true
    }

    if (!tryRender()) {
      const interval = setInterval(() => { if (tryRender()) clearInterval(interval) }, 200)
      return () => clearInterval(interval)
    }
  }, [siteKey, containerId, onVerify])

  if (!siteKey) return null

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      <div id={containerId} />
    </>
  )
}
