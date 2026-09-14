/**
 * Google Maps JS API configuration, in one place.
 *
 * Was MapTiler (vector tiles) before this — swapped on request: seeing real
 * transit/POI detail *inside the app* while travelling mattered more than
 * MapTiler's live language switcher, which this app no longer offers (Google's
 * JS API fixes display language at load time via `language=`, read once from
 * the browser below — there is no runtime `setLanguage()` the way MapTiler
 * had, confirmed against Google's own localization docs).
 */

export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ""

/**
 * Required to use AdvancedMarkerElement (draggable, custom-HTML pins) —
 * confirmed against Google's Advanced Markers docs: a Map ID is required for
 * advanced markers specifically, even though a plain google.maps.Map does not
 * need one. DEMO_MAP_ID is Google's own documented fallback for exactly this
 * case (no Map ID created yet) — it works today, but should be replaced with
 * a real one from Google Cloud Console → Map Management for production, since
 * a demo ID carries a visible "for development purposes only" watermark.
 */
export const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"

export interface MapLayerOption {
  id: string
  label: string
  typeId: "roadmap" | "satellite" | "hybrid" | "terrain"
}

export const MAP_LAYERS: MapLayerOption[] = [
  { id: "standard",  label: "แผนที่",     typeId: "roadmap" },
  { id: "satellite", label: "ดาวเทียม",   typeId: "hybrid" },   // hybrid = imagery + labels, matching the old layer's behaviour
  { id: "terrain",   label: "ภูมิประเทศ", typeId: "terrain" },
]

export const DEFAULT_LAYER = MAP_LAYERS[0]
