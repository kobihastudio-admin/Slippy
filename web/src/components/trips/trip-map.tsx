"use client"

/**
 * The trip map — real Google Maps, and the itinerary is edited on it.
 *
 * Loaded through a dynamic import with ssr:false (see trip-map-loader.tsx):
 * the Maps JS API bootstrap loader reaches for `window` at module scope,
 * same as Leaflet/MapTiler before it.
 *
 * WHY GOOGLE MAPS JS API (was MapTiler, was Leaflet+OSM raster before that)
 * Chosen on request: seeing real place/transit detail *inside the app*
 * while travelling, without switching to a separate Maps app, mattered more
 * than MapTiler's live language switcher — which this app no longer offers.
 * Confirmed against Google's own docs: the JS API's display language is
 * fixed once, at first load (`setOptions({ language })`, read from the
 * browser below when unset) — there is no `setLanguage()` to change it at
 * runtime the way MapTiler had. That trade was made deliberately, not missed.
 *
 * SETUP THIS APP NEEDS
 *   NEXT_PUBLIC_GOOGLE_MAPS_KEY    — already used for Places search/photos;
 *                                    reused here for the embedded map itself.
 *   NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID — required for AdvancedMarkerElement
 *                                    (draggable, custom-HTML pins) even
 *                                    though a plain map does not need one.
 *                                    Falls back to Google's own DEMO_MAP_ID
 *                                    (documented for exactly this case) so
 *                                    the map works before a real one exists —
 *                                    swap in a real Map ID from Google Cloud
 *                                    Console → Map Management for production.
 *
 * WHAT "EDIT FROM THE MAP" MEANS HERE — unchanged from every version before
 *   • drag a pin        → the stop moves, and its coordinates save on drop
 *   • click empty map   → a stop is added there, named from reverse geocoding
 *   • search a place    → same, but you pick from results
 *   • drag in the list  → reorders the day
 *
 * PIN/ROUTE CLICKS VS. EMPTY-MAP CLICKS
 * Unlike MapLibre (which needed hand-rolled hit-testing — see the git history
 * of this file), Google's AdvancedMarkerElement and Polyline each dispatch
 * their own click event and do not also trigger the map's click listener,
 * so "click a pin", "click a route line" and "click empty space" are simply
 * three separate listeners here with no manual disambiguation needed.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { setOptions, importLibrary } from "@googlemaps/js-api-loader"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Search, X, Loader2, Trash2, GripVertical, MapPin, LocateFixed,
  Maximize2, Minimize2, Plus, ExternalLink, PersonStanding, Pencil, Navigation,
} from "lucide-react"
import { MAP_LAYERS, DEFAULT_LAYER, GOOGLE_MAPS_KEY, GOOGLE_MAP_ID } from "@/lib/trips/map-config"
import { googleMapsPinUrl, googleStreetViewUrl } from "@/lib/trips/google-maps-links"
import { appleMapsPinUrl } from "@/lib/trips/apple-maps-links"
import { MODE_LABEL, isStale, type RouteGeometry } from "@/lib/trips/routing"
import {
  type JourneyDay, type JourneyItem,
  itemSpec, isLeg, hhmm, TYPE_SPEC,
} from "@/lib/trips/journey"

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

let apiOptionsSet = false
/** setOptions() must run exactly once, before the first importLibrary() call. */
function ensureApiOptions() {
  if (apiOptionsSet) return
  setOptions({ key: GOOGLE_MAPS_KEY, v: "weekly" })
  apiOptionsSet = true
}

/** Builds a pin's DOM element — inline SVG, same drawing this app has used since the Leaflet version. */
function pinElement(type: string, label: string, active: boolean): HTMLDivElement {
  const spec = itemSpec(type)
  const size = active ? 44 : 36
  const h = size * 42 / 32
  const el = document.createElement("div")
  el.style.width = `${size}px`
  el.style.height = `${h}px`
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="${size}" height="${h}">
      <ellipse cx="16" cy="40" rx="6" ry="2.5" fill="rgba(0,0,0,.2)"/>
      <path d="M16 1.5C9.1 1.5 3.5 7.1 3.5 14c0 9.3 12.5 26 12.5 26S28.5 23.3 28.5 14C28.5 7.1 22.9 1.5 16 1.5z"
            fill="${spec.stroke}" stroke="#fff" stroke-width="${active ? 2.5 : 1.8}"/>
      <circle cx="16" cy="14" r="8.5" fill="#fff" fill-opacity=".92"/>
      <text x="16" y="18" text-anchor="middle" font-size="10" font-weight="700"
            fill="${spec.stroke}" font-family="-apple-system,system-ui,sans-serif">${escapeHtml(label)}</text>
    </svg>`
  return el
}

/** The provisional pin — a tapped point, before it is anything. */
function pendingElement(): HTMLDivElement {
  const el = document.createElement("div")
  el.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="40" height="52">
      <path d="M16 1.5C9.1 1.5 3.5 7.1 3.5 14c0 9.3 12.5 26 12.5 26S28.5 23.3 28.5 14C28.5 7.1 22.9 1.5 16 1.5z"
            fill="#0f172a" stroke="#fff" stroke-width="2.5"/>
      <circle cx="16" cy="14" r="4.5" fill="#fff"/></svg>`
  return el
}

function LocateButton({ map }: { map: google.maps.Map | null }) {
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" aria-label="ไปยังตำแหน่งปัจจุบัน"
      onClick={() => {
        if (!map) return
        if (!navigator.geolocation) { toast("อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง"); return }
        setBusy(true)
        navigator.geolocation.getCurrentPosition(
          pos => {
            map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude })
            map.setZoom(15)
            setBusy(false)
          },
          err => {
            setBusy(false)
            toast(err.code === err.PERMISSION_DENIED
              ? "ไม่ได้อนุญาตให้เข้าถึงตำแหน่ง"
              : "หาตำแหน่งปัจจุบันไม่ได้")
          },
          { enableHighAccuracy: true, timeout: 8000 },
        )
      }}
      disabled={!map}
      className="grid h-9 w-9 place-items-center rounded-lg bg-white text-slate-700 shadow-lg hover:bg-slate-50 disabled:opacity-50">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
    </button>
  )
}

interface Props {
  tripId: string
  days: JourneyDay[]
  activeDay: number | null
  onDaysChange: (days: JourneyDay[]) => void
  canEdit: boolean
  variant?: "full" | "compact"
  height?: number
  /**
   * Opens the full item-detail editor (title, type, time, notes, provider…) —
   * this component only ever edits an item's *position* (drag a pin) and its
   * *existence* (click empty map to add, trash icon to remove). Everything
   * else about a stop is edited the same way from either the map or the
   * itinerary tab, so the sheet itself lives one level up in
   * trip-journey-client.tsx rather than being duplicated here.
   */
  onEditItem?: (item: JourneyItem) => void
  /** Live-sharing trip members' current positions — rendered as distinct
   * dark dot markers, separate from the itinerary pins above. Optional so
   * every existing call site (e.g. the Overview tab's compact preview,
   * which doesn't call useLocationShares) keeps working unchanged. */
  liveLocations?: import("@/lib/trips/use-location-shares").ActiveLocation[]
}

interface SearchResult { label: string; name: string; lat: number; lng: number; kind: string | null }

export default function TripMap({
  tripId, days, activeDay, onDaysChange, canEdit, onEditItem,
  variant = "full", height = 560, liveLocations,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Placeholder left in the map's normal in-page position — never itself
  // portaled. Its only job is to report, via ResizeObserver below, where
  // the docked map should visually sit; see the render section for why the
  // actual content always lives in one single, unmoving body portal instead.
  const placeholderRef = useRef<HTMLDivElement>(null)
  const contentBoxRef = useRef<HTMLDivElement>(null)
  const [dockRect, setDockRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const [dockedHeight, setDockedHeight] = useState<number | null>(null)
  const [dockReady, setDockReady] = useState(false)
  useEffect(() => { setDockReady(true) }, [])
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map())
  const liveMarkersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map())
  const polylinesRef = useRef<Map<string, google.maps.Polyline>>(new Map())
  const pendingMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null)
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)

  const [selected,  setSelected]  = useState<string | null>(null)
  const [pending,   setPending]   = useState<
    { lat: number; lng: number; name?: string; label?: string; loading: boolean } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  // Tracks where the in-page placeholder currently is, so the portaled
  // content can be pinned there with `position: fixed`. Re-measures on
  // resize/scroll (including nested scroll containers, via capture) since
  // the placeholder can move for reasons that have nothing to do with this
  // component — a collapsed sidebar, a resized window, a scrolled page.
  useEffect(() => {
    if (fullscreen) return
    const el = placeholderRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setDockRect({ top: r.top, left: r.left, width: r.width })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [fullscreen])

  // The portaled content sizes itself naturally (map height + side panel);
  // mirror that measured height back onto the placeholder so the
  // surrounding page still reserves the right amount of space for it —
  // the placeholder has no children of its own to size itself by.
  useEffect(() => {
    if (fullscreen) return
    const el = contentBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setDockedHeight(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fullscreen])

  const [layerId, setLayerId] = useState(DEFAULT_LAYER.id)
  const layer = MAP_LAYERS.find(l => l.id === layerId) ?? DEFAULT_LAYER
  const [busy,      setBusy]      = useState<string | null>(null)
  const [query,     setQuery]     = useState("")
  const [results,   setResults]   = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [viewbox,   setViewbox]   = useState("")
  const dragItem = useRef<string | null>(null)
  const requested = useRef<Set<string>>(new Set())
  const [routes, setRoutes] = useState<Record<string, RouteGeometry>>({})

  const scoped = useMemo(
    () => (activeDay != null ? days.filter(d => d.day_number === activeDay) : days),
    [days, activeDay],
  )
  const targetDay = scoped[0] ?? days[0]

  const pins = useMemo(() => {
    const out: Array<{ item: JourneyItem; dayNumber: number; n: number }> = []
    let n = 0
    for (const d of scoped) {
      for (const it of d.trip_itinerary_items) {
        if (it.lat == null || it.lng == null) continue
        out.push({ item: it, dayNumber: d.day_number, n: ++n })
      }
    }
    return out
  }, [scoped])

  const legs = useMemo(
    () => scoped.flatMap(d => d.trip_itinerary_items.filter(isLeg)),
    [scoped],
  )

  // The tapped/clicked pin, resolved to its item — drives the floating detail
  // card below. Previously a marker click only highlighted the pin and the
  // matching side-list row; on the "Plan" tab that list sits off-screen (or,
  // on the Overview preview, doesn't render at all), so selecting a place from
  // the map itself appeared to do nothing.
  const selectedPin = useMemo(
    () => pins.find(p => p.item.id === selected) ?? null,
    [pins, selected],
  )
  const appleTarget = selectedPin?.item ?? pins[0]?.item ?? null

  const points = useMemo<Array<[number, number]>>(
    () => pins.map(p => [p.item.lat!, p.item.lng!]),
    [pins],
  )

  // ── Server writes ─────────────────────────────────────────────────────────

  const applyItem = useCallback((updated: JourneyItem) => {
    onDaysChange(days.map(d => ({
      ...d,
      trip_itinerary_items: d.trip_itinerary_items
        .map(i => (i.id === updated.id ? { ...i, ...updated } : i))
        .filter(i => i.id !== updated.id || d.id === (updated as JourneyItem & { day_id?: string }).day_id || !("day_id" in updated)),
    })))
  }, [days, onDaysChange])

  const patchItem = useCallback(async (itemId: string, patch: Record<string, unknown>) => {
    setBusy(itemId)
    const before = days
    try {
      const res = await fetch(`/api/trips/${tripId}/itinerary/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, ...patch }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ")
      applyItem(json.item as JourneyItem)
      return true
    } catch (err) {
      onDaysChange(before)
      toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ")
      return false
    } finally {
      setBusy(null)
    }
  }, [tripId, days, applyItem, onDaysChange])

  const inspectPoint = useCallback(async (lat: number, lng: number) => {
    setSelected(null)
    setResults(null)
    setPending({ lat, lng, loading: true })
    try {
      const res = await fetch(`/api/trips/geocode?lat=${lat}&lng=${lng}`)
      const json = await res.json()
      const place = json.places?.[0]
      setPending(p => (p && p.lat === lat && p.lng === lng
        ? { ...p, name: place?.name, label: place?.label, loading: false }
        : p))
    } catch {
      setPending(p => (p && p.lat === lat && p.lng === lng ? { ...p, loading: false } : p))
    }
  }, [])

  const addStop = useCallback(async (lat: number, lng: number, name?: string) => {
    if (!targetDay) { toast.error("ทริปนี้ยังไม่มีวัน — เพิ่มวันก่อน"); return }
    setBusy("new")
    try {
      let title = name
      if (!title) {
        try {
          const g = await fetch(`/api/trips/geocode?lat=${lat}&lng=${lng}`)
          const gj = await g.json()
          title = gj.places?.[0]?.name
        } catch { /* geocoder optional */ }
      }
      const res = await fetch(`/api/trips/${tripId}/itinerary/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayId: targetDay.id,
          title: title?.trim() || "จุดแวะใหม่",
          type: "activity",
          lat, lng,
          location: title ?? null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "เพิ่มไม่สำเร็จ")
      const item = json.item as JourneyItem
      onDaysChange(days.map(d => d.id === targetDay.id
        ? { ...d, trip_itinerary_items: [...d.trip_itinerary_items, item] }
        : d))
      setSelected(item.id)
      setPending(null)
      toast.success(`เพิ่ม "${item.title}" ใน${targetDay.city ?? `วันที่ ${targetDay.day_number}`}แล้ว`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เพิ่มไม่สำเร็จ")
    } finally {
      setBusy(null)
    }
  }, [tripId, targetDay, days, onDaysChange])

  const removeStop = useCallback(async (itemId: string) => {
    setBusy(itemId)
    const before = days
    try {
      const res = await fetch(`/api/trips/${tripId}/itinerary/items?itemId=${itemId}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error ?? "ลบไม่สำเร็จ")
      onDaysChange(days.map(d => ({
        ...d, trip_itinerary_items: d.trip_itinerary_items.filter(i => i.id !== itemId),
      })))
      setSelected(null)
      toast.success("ลบรายการแล้ว")
    } catch (err) {
      onDaysChange(before)
      toast.error(err instanceof Error ? err.message : "ลบไม่สำเร็จ")
    } finally {
      setBusy(null)
    }
  }, [tripId, days, onDaysChange])

  const reorder = useCallback(async (dayId: string, fromId: string, toId: string) => {
    const day = days.find(d => d.id === dayId)
    if (!day || fromId === toId) return
    const list = [...day.trip_itinerary_items]
    const from = list.findIndex(i => i.id === fromId)
    const to   = list.findIndex(i => i.id === toId)
    if (from < 0 || to < 0) return
    list.splice(to, 0, ...list.splice(from, 1))

    const before = days
    onDaysChange(days.map(d => d.id === dayId
      ? { ...d, trip_itinerary_items: list.map((i, k) => ({ ...i, sort_order: k })) }
      : d))
    try {
      for (const [k, i] of list.entries()) {
        if (i.sort_order === k) continue
        const res = await fetch(`/api/trips/${tripId}/itinerary/items`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: i.id, sortOrder: k }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? "จัดลำดับไม่สำเร็จ")
      }
    } catch (err) {
      onDaysChange(before)
      toast.error(err instanceof Error ? err.message : "จัดลำดับไม่สำเร็จ")
    }
  }, [tripId, days, onDaysChange])

  /** Fetch the path for any leg that has none, or whose pins have moved — same OSRM-backed route-legs endpoint as before; only the drawing engine changed. */
  useEffect(() => {
    const needing = legs.filter(l => {
      const from: [number, number] = [l.lat!, l.lng!]
      const to:   [number, number] = [l.end_lat!, l.end_lng!]
      if (!isStale(routes[l.id] ?? l.route_geometry, from, to)) return false
      const key = `${l.id}:${from.join()}:${to.join()}`
      if (requested.current.has(key)) return false
      requested.current.add(key)
      return true
    })
    if (!needing.length) return

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/trips/${tripId}/route-legs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: needing.map(l => l.id) }),
        })
        if (!res.ok) return
        const json = await res.json() as { routes?: Record<string, RouteGeometry> }
        if (!cancelled && json.routes) setRoutes(prev => ({ ...prev, ...json.routes }))
      } catch { /* the dashed direct line remains, still a true statement */ }
    })()
    return () => { cancelled = true }
  }, [legs, routes, tripId])

  // ── Place search ──────────────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults(null); return }
    setSearching(true)
    try {
      const url = `/api/trips/geocode?q=${encodeURIComponent(q)}${viewbox ? `&viewbox=${viewbox}` : ""}`
      const res = await fetch(url)
      const json = await res.json()
      setResults(json.places ?? [])
      if (!json.places?.length) toast("ไม่พบสถานที่นี้ — ลองพิมพ์ชื่ออังกฤษหรือปักหมุดเอง")
    } catch {
      setResults([])
      toast.error("ค้นหาสถานที่ไม่สำเร็จ")
    } finally {
      setSearching(false)
    }
  }, [viewbox])

  const center: [number, number] = points[0] ?? [34.3853, 132.4553] // [lat, lng]
  const compact = variant === "compact"

  // ── Map lifecycle ────────────────────────────────────────────────────────

  const mapClickRef = useRef<(lat: number, lng: number) => void>(() => {})
  useEffect(() => { mapClickRef.current = inspectPoint }, [inspectPoint])

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    if (!GOOGLE_MAPS_KEY) { setMapError("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_GOOGLE_MAPS_KEY"); return }

    let cancelled = false
    ;(async () => {
      try {
        ensureApiOptions()
        const { Map } = await importLibrary("maps") as google.maps.MapsLibrary
        await importLibrary("marker")
        if (cancelled || !containerRef.current) return

        const map = new Map(containerRef.current, {
          center: { lat: center[0], lng: center[1] },
          zoom: 12,
          mapId: GOOGLE_MAP_ID,
          mapTypeId: DEFAULT_LAYER.typeId,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
          gestureHandling: "greedy",
        })
        mapRef.current = map
        infoWindowRef.current = new google.maps.InfoWindow()

        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return
          mapClickRef.current(e.latLng.lat(), e.latLng.lng())
        })

        const reportViewbox = () => {
          const b = map.getBounds()
          if (!b) return
          const ne = b.getNorthEast(), sw = b.getSouthWest()
          setViewbox([sw.lng(), ne.lat(), ne.lng(), sw.lat()].map(n => n.toFixed(5)).join(","))
        }
        map.addListener("bounds_changed", reportViewbox)

        setMapReady(true)
      } catch (err) {
        console.error("[trip-map] Google Maps failed to load", err)
        if (!cancelled) {
          setMapError("โหลดแผนที่ไม่สำเร็จ — ตรวจสอบ NEXT_PUBLIC_GOOGLE_MAPS_KEY และ API ที่เปิดใช้ใน Google Cloud Console")
        }
      }
    })()

    return () => {
      cancelled = true
      mapRef.current = null
      setMapReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- center/layer are read only at construction; dockReady is here only to retry once the portal has actually mounted containerRef.current
  }, [dockReady])

  /**
   * Re-fits the camera to whatever is currently shown.
   *
   * Reused by both the "points changed" effect below AND the resize
   * handlers — `google.maps.event.trigger(map, "resize")` alone tells the
   * map its container is a new size, but re-centering on the *same* point
   * afterward does not reliably make it fetch/draw tiles for the newly
   * exposed area. Verified live: entering fullscreen left the old, small
   * tile set sitting in its old screen position — a narrow strip of map
   * surrounded by blank background, not a resize at all. Re-running the
   * real fit (fitBounds, or panTo+setZoom for one point) after the resize
   * event is what actually makes Google redraw the newly visible area.
   */
  const fitToPoints = useCallback(() => {
    const map = mapRef.current
    if (!map || !points.length) return
    if (points.length === 1) {
      map.panTo({ lat: points[0][0], lng: points[0][1] })
      map.setZoom(14)
      return
    }
    const bounds = new google.maps.LatLngBounds()
    for (const [lat, lng] of points) bounds.extend({ lat, lng })
    map.fitBounds(bounds, 56)
  }, [points])

  // Container resize (hidden tab / unsettled sidebar / fullscreen toggle).
  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container) return
    const observer = new ResizeObserver(() => {
      google.maps.event.trigger(map, "resize")
      fitToPoints()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [mapReady, fitToPoints])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Two passes: one right after the class change starts the CSS
    // transition, one after it has actually finished — a single early
    // trigger sometimes fires before the container has reached its final
    // fullscreen size, so the resize is computed against a mid-transition
    // dimension and tiles come up wrong again.
    const t1 = setTimeout(() => { google.maps.event.trigger(map, "resize"); fitToPoints() }, 60)
    const t2 = setTimeout(() => { google.maps.event.trigger(map, "resize"); fitToPoints() }, 350)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [fullscreen, fitToPoints])

  // Fit to whatever is currently shown.
  useEffect(() => {
    if (!mapReady) return
    fitToPoints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, activeDay, points.length])

  // Layer / map type switch.
  useEffect(() => {
    mapRef.current?.setMapTypeId(layer.typeId)
  }, [layer])

  // Legs — one Polyline per leg, rebuilt when the set or their routes change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    polylinesRef.current.forEach(p => p.setMap(null))
    polylinesRef.current.clear()

    for (const l of legs) {
      const route = routes[l.id] ?? l.route_geometry
      const path: google.maps.LatLngLiteral[] = route?.coordinates?.length
        ? route.coordinates.map(([lat, lng]) => ({ lat, lng }))
        : [{ lat: l.lat!, lng: l.lng! }, { lat: l.end_lat!, lng: l.end_lng! }]
      const isReal = route?.provider === "osrm"
      const spec = itemSpec(l.type)

      // A dashed line has no native strokeDasharray on Polyline — Google's own
      // documented pattern is a solid line with strokeOpacity 0 (invisible)
      // plus a short line-segment icon repeated along the path instead.
      const polyline = new google.maps.Polyline({
        path,
        map,
        strokeColor: spec.stroke,
        strokeWeight: isReal ? 5 : 4,
        strokeOpacity: isReal ? 0.85 : 0,
        icons: isReal ? undefined : [{
          icon: { path: "M 0,-1 0,1", strokeOpacity: 0.7, scale: 3 },
          offset: "0", repeat: "12px",
        }],
      })

      polyline.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng || !infoWindowRef.current) return
        const modeLabel = route ? MODE_LABEL[route.mode] : "กำลังคำนวณเส้นทาง…"
        const distanceLine = route?.distance_m != null
          ? `<p style="color:#64748b;margin:2px 0 0">ระยะทาง ${(route.distance_m / 1000).toFixed(1)} กม.${route.duration_s != null ? ` · ~${Math.round(route.duration_s / 60)} นาที` : ""}</p>`
          : ""
        infoWindowRef.current.setContent(`<div style="font:12px -apple-system,system-ui,sans-serif">
          <p style="font-weight:600;margin:0 0 2px">${escapeHtml(l.title)}</p>
          <p style="color:#64748b;margin:0">${escapeHtml(spec.label)} · ${escapeHtml(modeLabel)}</p>
          ${distanceLine}
        </div>`)
        infoWindowRef.current.setPosition(e.latLng)
        infoWindowRef.current.open(map)
      })

      polylinesRef.current.set(l.id, polyline)
    }
  }, [legs, routes, mapReady])

  // Pins — full rebuild on relevant change. Simple and correct; a trip has
  // dozens of stops at most, not thousands.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    markersRef.current.forEach(m => { m.map = null })
    markersRef.current.clear()

    for (const { item, n } of pins) {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: item.lat!, lng: item.lng! },
        content: pinElement(item.type, String(n), selected === item.id),
        gmpDraggable: canEdit,
        gmpClickable: true,
      })
      marker.addListener("click", () => setSelected(item.id))
      if (canEdit) {
        marker.addListener("dragend", (e: { latLng: google.maps.LatLng }) => {
          patchItem(item.id, { lat: e.latLng.lat(), lng: e.latLng.lng() })
        })
      }
      markersRef.current.set(item.id, marker)
    }
  }, [pins, selected, canEdit, mapReady, patchItem])

  // Live-sharing members' positions — a separate marker set from the
  // itinerary pins above; full rebuild on each change, same as those.
  // Greyed out once a ping is >60s old (matches the polling/ping cadence
  // in use-location-shares.ts: 10s poll, 12s ping — 60s is several missed
  // beats, not a hair-trigger flicker on ordinary network jitter).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    liveMarkersRef.current.forEach(m => { m.map = null })
    liveMarkersRef.current.clear()

    for (const loc of liveLocations ?? []) {
      const stale = Date.now() - new Date(loc.recordedAt).getTime() > 60_000
      const el = document.createElement("div")
      el.innerHTML = `<div style="width:22px;height:22px;border-radius:50%;background:${stale ? "#94a3b8" : "#0f172a"};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);opacity:${stale ? 0.6 : 1}"></div>`
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map, position: { lat: loc.lat, lng: loc.lng }, content: el,
      })
      liveMarkersRef.current.set(loc.sessionId, marker)
    }
  }, [liveLocations, mapReady])

  // The provisional "what's here" pin.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (pendingMarkerRef.current) { pendingMarkerRef.current.map = null; pendingMarkerRef.current = null }
    if (pending) {
      pendingMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: pending.lat, lng: pending.lng },
        content: pendingElement(),
      })
    }
  }, [pending, mapReady])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false) }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [fullscreen])

  // The map renders through ONE portal straight to <body>, whose TARGET
  // never changes — only its inline position does, between "pinned over
  // the fullscreen viewport" and "pinned over the in-page placeholder's
  // measured rect" (see dockRect/dockedHeight above). Two earlier designs
  // both broke this the same way, for two different reasons:
  //
  //  1. Switching the component's *returned element type* between plain
  //     JSX (docked) and createPortal(...) (fullscreen) made React treat
  //     them as different elements at that position and remount the whole
  //     subtree on toggle — containerRef's div (with Google's map already
  //     attached) got thrown away for a fresh, empty one, while mapRef
  //     still pointed at the orphaned old one, so the once-only creation
  //     guard never ran again. A blank screen, not the squished-map bug
  //     that was meant to fix.
  //  2. Always portaling, but swapping the portal's *container argument*
  //     between localDockRef.current and document.body, has the identical
  //     failure: React's reconciler treats a HostPortal fiber whose
  //     containerInfo differs as a different fiber, not an update — same
  //     remount, same orphaned map, confirmed live (the container div
  //     moved to the right DOM location but came up with zero children;
  //     Google's map DOM was never re-created there).
  //
  // The only container that can never change identity is document.body
  // itself. Docked-vs-fullscreen is therefore just inline CSS on a wrapper
  // around this same, never-remounted portal — see the return below. This
  // also keeps the fullscreen stacking-context fix (a `position: sticky`
  // ancestor on the itinerary tab traps a `fixed` overlay's paint order
  // inside its own stacking context per spec, regardless of z-index) since
  // document.body has no such trapping ancestor either way.
  const content = (
    <div className={cn(
      fullscreen
        ? "flex h-dvh w-screen flex-col gap-2 bg-background p-2 lg:flex-row"
        : cn("grid gap-4", !compact && "lg:grid-cols-[1fr_340px]"),
    )}>
      {/* ── Map ── */}
      <div
        className={cn("relative overflow-hidden rounded-2xl border",
                      fullscreen && "min-h-0 flex-1")}
        style={fullscreen ? undefined : { height }}>
        {mapError ? (
          <div className="grid h-full place-items-center bg-muted/30 p-6 text-center">
            <div>
              <MapPin className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">{mapError}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Google Cloud Console → APIs &amp; Services → เปิด &quot;Maps JavaScript API&quot;
              </p>
            </div>
          </div>
        ) : (
          <div ref={containerRef} className="absolute inset-0 z-0" />
        )}

        <div className="absolute left-3 top-3 z-[400] flex flex-col items-start gap-2">
          <button onClick={() => setFullscreen(v => !v)}
            aria-label={fullscreen ? "ออกจากเต็มหน้าจอ" : "ขยายเต็มหน้าจอ"}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-lg hover:bg-slate-50">
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {fullscreen ? "ย่อลง" : "เต็มหน้าจอ"}
          </button>
          {canEdit && !pending && (
            <span className="max-w-[220px] rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-[11px] text-white">
              แตะที่ไหนก็ได้บนแผนที่ เพื่อดูว่าตรงนั้นคืออะไร
            </span>
          )}
        </div>

        <div className="absolute right-3 top-3 z-[400] flex max-w-[calc(100%-6rem)] flex-col items-end gap-2 sm:max-w-none">
          <div className="flex overflow-hidden rounded-xl bg-white shadow-lg">
            <span className="inline-flex items-center gap-1.5 bg-slate-900 px-2.5 py-2 text-[11px] font-semibold text-white">
              <MapPin className="h-3.5 w-3.5" />Google Map
            </span>
            {appleTarget ? (
              <a href={appleMapsPinUrl([appleTarget.lat!, appleTarget.lng!], appleTarget.title)} target="_blank" rel="noopener noreferrer"
                title="เปิดจุดที่เลือกใน Apple Maps"
                className="inline-flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
                <Navigation className="h-3.5 w-3.5" />Apple Maps
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-semibold text-slate-400">
                <Navigation className="h-3.5 w-3.5" />Apple Maps
              </span>
            )}
          </div>
          <div className="flex overflow-hidden rounded-xl bg-white shadow-lg">
          {MAP_LAYERS.map(l => (
            <button key={l.id} onClick={() => setLayerId(l.id)}
              className={cn("px-2.5 py-2 text-[11px] font-semibold transition",
                l.id === layerId ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50")}>
              {l.label}
            </button>
          ))}
          </div>
        </div>

        {busy && (
          <div className="absolute left-1/2 top-3 z-[400] inline-flex -translate-x-1/2 items-center gap-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium shadow">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />กำลังบันทึก
          </div>
        )}

        <div className="absolute bottom-3 left-3 z-[400]">
          <LocateButton map={mapRef.current} />
        </div>

        {pending && (
          <div className="absolute bottom-3 left-3 right-3 z-[401] rounded-xl border bg-white p-3 shadow-xl sm:right-20">
            <div className="flex items-start gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-900" />
              <div className="min-w-0 flex-1">
                {pending.loading ? (
                  <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />กำลังดูว่าตรงนี้คืออะไร…
                  </p>
                ) : (
                  <>
                    <p className="text-[13px] font-semibold leading-tight text-slate-900">
                      {pending.name ?? "ตำแหน่งที่เลือก"}
                    </p>
                    {pending.label && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{pending.label}</p>
                    )}
                  </>
                )}
                <p className="mt-1 font-mono text-[10px] text-slate-400">
                  {pending.lat.toFixed(5)}, {pending.lng.toFixed(5)}
                </p>
              </div>
              <button onClick={() => setPending(null)} aria-label="ปิด"
                className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            {canEdit && targetDay && (
              <button
                onClick={() => addStop(pending.lat, pending.lng, pending.name)}
                disabled={pending.loading || busy === "new"}
                className="mt-2.5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-brand-500 text-[13px] font-semibold text-white disabled:opacity-50">
                {busy === "new"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Plus className="h-4 w-4" />}
                เพิ่มเข้าวันที่ {targetDay.day_number}{targetDay.city ? ` · ${targetDay.city}` : ""}
              </button>
            )}
          </div>
        )}

        {!pending && selectedPin && (() => {
          const { item } = selectedPin
          const spec = itemSpec(item.type)
          const Icon = spec.icon
          return (
            <div className="absolute bottom-3 left-3 right-3 z-[401] rounded-xl border bg-white p-3 shadow-xl sm:right-20">
              <div className="flex items-start gap-2.5">
                <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg", spec.tile, spec.fg)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-tight text-slate-900">{item.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {[spec.label, hhmm(item.time_from)].filter(Boolean).join(" · ")}
                  </p>
                  {item.location && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{item.location}</p>
                  )}
                </div>
                <button onClick={() => setSelected(null)} aria-label="ปิด"
                  className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <a href={googleStreetViewUrl([item.lat!, item.lng!])} target="_blank" rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50">
                  <PersonStanding className="h-3.5 w-3.5" />Street View
                </a>
                <a href={googleMapsPinUrl([item.lat!, item.lng!], item.title)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50">
                  <ExternalLink className="h-3.5 w-3.5" />Google Maps
                </a>
                <a href={appleMapsPinUrl([item.lat!, item.lng!], item.title)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50">
                  <Navigation className="h-3.5 w-3.5" />Apple Maps
                </a>
                {canEdit && onEditItem && (
                  <button onClick={() => onEditItem(item)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50">
                    <Pencil className="h-3.5 w-3.5" />ข้อมูลเพิ่มเติม
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => removeStop(item.id)} disabled={busy === item.id}
                    className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 text-[12px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                    {busy === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    ลบ
                  </button>
                )}
              </div>
            </div>
          )
        })()}
      </div>

      {/* ── Side panel — unchanged; none of this touches the map engine. ── */}
      <div className={cn("space-y-3",
                          compact && !fullscreen && "hidden",
                          fullscreen && "max-h-[38dvh] shrink-0 overflow-y-auto lg:max-h-none lg:w-[340px]")}>
        {canEdit && (
          <div className="rounded-2xl border bg-card p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border px-2.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") runSearch(query) }}
                  placeholder="ค้นหาสถานที่ เช่น Itsukushima Shrine"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
                {query && (
                  <button onClick={() => { setQuery(""); setResults(null) }} aria-label="ล้างคำค้น">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              <button onClick={() => runSearch(query)} disabled={searching}
                className="h-9 rounded-xl bg-brand-500 px-3 text-xs font-semibold text-white disabled:opacity-50">
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "ค้นหา"}
              </button>
            </div>

            {results && (
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {results.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">ไม่พบผลลัพธ์</p>}
                {results.map(r => (
                  <button key={`${r.lat},${r.lng}`}
                    onClick={() => { addStop(r.lat, r.lng, r.name); setResults(null); setQuery("") }}
                    className="flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-muted/60">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-500" />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{r.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{r.label}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border bg-card">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-semibold">
              {activeDay != null ? `ลำดับวันที่ ${activeDay}` : "ทุกจุดในทริป"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {canEdit ? "ลากเพื่อจัดลำดับ · ลากหมุดบนแผนที่เพื่อย้ายตำแหน่ง" : "แตะเพื่อดูบนแผนที่"}
            </p>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {pins.length === 0 && (
              <p className="p-4 text-center text-xs text-muted-foreground">
                ยังไม่มีจุดที่มีพิกัดในช่วงนี้
              </p>
            )}
            {pins.map(({ item, n, dayNumber }) => {
              const spec = itemSpec(item.type)
              const Icon = spec.icon
              const dayId = scoped.find(d => d.trip_itinerary_items.some(i => i.id === item.id))?.id
              return (
                <div key={item.id}
                  draggable={canEdit && activeDay != null}
                  onDragStart={() => { dragItem.current = item.id }}
                  onDragOver={e => { if (dragItem.current) e.preventDefault() }}
                  onDrop={() => {
                    if (dragItem.current && dayId) reorder(dayId, dragItem.current, item.id)
                    dragItem.current = null
                  }}
                  onClick={() => setSelected(item.id)}
                  className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl p-2.5 transition",
                    selected === item.id ? "bg-brand-500/10" : "hover:bg-muted/50")}>
                  {canEdit && activeDay != null && (
                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold", spec.tile, spec.fg)}>
                    {n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <Icon className={cn("h-3 w-3 shrink-0", spec.fg)} />
                      <span className="truncate text-xs font-medium">{item.title}</span>
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {activeDay == null && `วันที่ ${dayNumber} · `}
                      {hhmm(item.time_from) || spec.label}
                    </span>
                  </span>
                  {busy === item.id
                    ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    : (
                      <>
                        <a href={googleStreetViewUrl([item.lat!, item.lng!])}
                          target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          aria-label="ดูมุมมองถนน (Street View)"
                          title="ดูมุมมองถนน"
                          className="shrink-0 text-muted-foreground hover:text-brand-600">
                          <PersonStanding className="h-3.5 w-3.5" />
                        </a>
                        <a href={googleMapsPinUrl([item.lat!, item.lng!], item.title)}
                          target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          aria-label="เปิดใน Google Maps"
                          className="shrink-0 text-muted-foreground hover:text-brand-600">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        {canEdit && onEditItem && (
                          <button onClick={e => { e.stopPropagation(); onEditItem(item) }}
                            aria-label="แก้ไขรายละเอียด"
                            title="แก้ไขรายละเอียด"
                            className="shrink-0 text-muted-foreground hover:text-brand-600">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={e => { e.stopPropagation(); removeStop(item.id) }}
                            aria-label="ลบจุดนี้"
                            className="shrink-0 text-muted-foreground hover:text-rose-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1.5 rounded-2xl border bg-card px-4 py-3 text-[11px]">
          {[...new Set(pins.map(p => p.item.type))].filter(t => t in TYPE_SPEC).map(t => (
            <span key={t} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: itemSpec(t).stroke }} />
              {itemSpec(t).label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )

  // See the long comment above `content` — this portal's target
  // (document.body) never changes; only the wrapper's inline position does.
  const wrapperStyle: CSSProperties = fullscreen
    ? {}
    : dockRect
      ? { top: dockRect.top, left: dockRect.left, width: dockRect.width }
      : { top: 0, left: 0, width: 0, visibility: "hidden" }

  return (
    <>
      <div ref={placeholderRef} style={!fullscreen && dockedHeight ? { height: dockedHeight } : undefined} />
      {dockReady && createPortal(
        <div ref={contentBoxRef}
          className={fullscreen ? "fixed inset-0 z-[1000]" : "fixed z-30"}
          style={wrapperStyle}>
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}
