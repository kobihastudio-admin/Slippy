"use client"

/**
 * Client-only loader for the trip map.
 *
 * Leaflet touches `window` while its module is evaluating, so it cannot be part
 * of a server-rendered tree at all — not even behind a falsy branch, because the
 * import is hoisted and runs regardless. `ssr: false` keeps the whole subtree
 * out of the server bundle; the skeleton is what renders until it arrives.
 */

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

const TripMap = dynamic(() => import("./trip-map"), {
  ssr: false,
  loading: () => (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid h-[560px] place-items-center rounded-2xl border bg-muted/30">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />กำลังโหลดแผนที่
        </span>
      </div>
      <div className="h-[560px] rounded-2xl border bg-muted/20" />
    </div>
  ),
})

export default TripMap
