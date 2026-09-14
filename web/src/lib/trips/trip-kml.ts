/**
 * The trip as a KML file — the "no waypoint limit" answer to Google Maps.
 *
 * A Google Maps directions link caps out at 3 stops on a phone (see
 * google-maps-links.ts). A trip has more stops than that. KML has no such
 * limit and is a format Google's own products read natively: import it at
 * mymaps.google.com (works from a phone browser, not desktop-only) and it
 * becomes a saved map — visible afterward in the Google Maps app itself, under
 * Saved → Maps, on any device signed into that account.
 *
 * One folder per day, one placemark per stop, one line per leg — the same
 * three-part shape the web map and the PDF already use, because it is the
 * correct shape of a trip and reinventing it per export format is how exports
 * drift from what the app actually shows.
 */
import type { JourneyDay } from "./journey"
import { itemSpec, fmtTHB, hhmm } from "./journey"
import { geodesic } from "./routing"

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))

/** KML colour is aabbggrr — the reverse byte order of CSS #rrggbb, alpha first. */
function kmlColor(hex: string, alpha = "ff"): string {
  const clean = hex.replace("#", "")
  const r = clean.slice(0, 2), g = clean.slice(2, 4), b = clean.slice(4, 6)
  return `${alpha}${b}${g}${r}`
}

function placemark(item: {
  title: string; type: string; lat: number; lng: number
  subtitle?: string | null; time?: string | null; amount?: number | null
}): string {
  const spec = itemSpec(item.type)
  const desc = [
    spec.label,
    item.time ? `เวลา ${hhmm(item.time)}` : null,
    item.subtitle,
    item.amount && item.amount > 0 ? fmtTHB(item.amount) : null,
  ].filter(Boolean).join(" · ")

  return `<Placemark>
    <name>${esc(item.title)}</name>
    <description>${esc(desc)}</description>
    <styleUrl>#pin-${esc(item.type)}</styleUrl>
    <Point><coordinates>${item.lng},${item.lat},0</coordinates></Point>
  </Placemark>`
}

function lineString(coords: Array<[number, number]>, color: string, name: string): string {
  const path = coords.map(([lat, lng]) => `${lng},${lat},0`).join(" ")
  return `<Placemark>
    <name>${esc(name)}</name>
    <Style><LineStyle><color>${kmlColor(color)}</color><width>4</width></LineStyle></Style>
    <LineString><tessellate>1</tessellate><coordinates>${path}</coordinates></LineString>
  </Placemark>`
}

export interface TripKmlInput {
  title: string
  days: JourneyDay[]
}

export function buildTripKml({ title, days }: TripKmlInput): string {
  // One style per type actually used, not the whole vocabulary — a document
  // with 24 unused style blocks is 24 things that can never be wrong because
  // nothing reads them, which is not the same as being right to include.
  const usedTypes = new Set<string>()
  for (const d of days) for (const it of d.trip_itinerary_items) {
    if (it.lat != null) usedTypes.add(it.type)
  }
  const styles = [...usedTypes].map(t => {
    const spec = itemSpec(t)
    return `<Style id="pin-${esc(t)}">
      <IconStyle>
        <color>${kmlColor(spec.stroke)}</color>
        <Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
    </Style>`
  }).join("\n  ")

  const folders = days.map(d => {
    const placemarks = d.trip_itinerary_items
      .filter(it => it.lat != null && it.lng != null)
      .map(it => placemark({
        title: it.title, type: it.type, lat: it.lat!, lng: it.lng!,
        subtitle: it.subtitle, time: it.time_from,
        amount: it.amount_base_currency,
      }))

    const legs = d.trip_itinerary_items
      .filter(it => it.lat != null && it.end_lat != null)
      .map(it => {
        const spec = itemSpec(it.type)
        // A stored real route if one was computed; otherwise the same geodesic
        // curve the schematic map draws for a flight or ferry — never a naive
        // straight line pretending to be a road.
        const coords = it.route_geometry?.coordinates?.length
          ? it.route_geometry.coordinates
          : geodesic([it.lat!, it.lng!], [it.end_lat!, it.end_lng!])
        return lineString(coords, spec.stroke, it.title)
      })

    const label = [`วันที่ ${d.day_number}`, d.city, d.date].filter(Boolean).join(" · ")
    return `<Folder>
      <name>${esc(label)}</name>
      ${placemarks.join("\n      ")}
      ${legs.join("\n      ")}
    </Folder>`
  }).join("\n  ")

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(title)}</name>
    ${styles}
    ${folders}
  </Document>
</kml>`
}
