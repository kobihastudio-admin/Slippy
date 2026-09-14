/**
 * Do trip legs get real routes? — npm run verify:routing <journeyId>
 *
 * Exercises the same decision the app makes (lib/trips/routing.ts) against the
 * trip's real legs, and reports which got a road route and which fell back to a
 * direct line. The point is that the difference is visible: a straight line
 * between Hiroshima and Onomichi is 66 km and the road is 80 km, and only one of
 * those numbers is the drive.
 */
import "dotenv/config"
import { supabase } from "../lib/supabase"

const OSRM = process.env.OSRM_URL ?? "https://router.project-osrm.org"
const modeFor = (t: string) => t === "walk" ? "foot"
  : ["car_rental", "taxi", "bus"].includes(t) ? "driving" : "direct"
const hav = (a: [number, number], b: [number, number]) => {
  const r = (d: number) => d * Math.PI / 180, dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1])
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(x))
}

const journeyId = process.argv[2]
if (!journeyId) { console.error("ต้องระบุ journeyId"); process.exit(1) }

const { data: days } = await supabase.from("trip_itinerary_days")
  .select("day_number,trip_itinerary_items(id,type,title,lat,lng,end_lat,end_lng)")
  .eq("journey_id", journeyId).order("day_number")

const legs = (days as any[] ?? []).flatMap(d =>
  d.trip_itinerary_items.filter((i: any) => i.end_lat != null && i.lat != null))

let routed = 0, direct = 0, failed = 0
console.log(`\nช่วงเดินทาง ${legs.length} ช่วง\n`)

for (const l of legs) {
  const mode = modeFor(l.type)
  const from: [number, number] = [l.lat, l.lng], to: [number, number] = [l.end_lat, l.end_lng]
  const straight = hav(from, to) / 1000
  const name = String(l.title).slice(0, 30).padEnd(30)

  if (mode === "direct") {
    direct++
    console.log(`  ○ ${l.type.padEnd(11)} ${name} เส้นตรง ${straight.toFixed(1)} กม.`)
    continue
  }
  try {
    const url = `${OSRM}/route/v1/${mode}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`
    const json: any = await (await fetch(url, { signal: AbortSignal.timeout(9000) })).json()
    const r = json.routes?.[0]
    if (json.code !== "Ok" || !r) { failed++; console.log(`  ✗ ${l.type.padEnd(11)} ${name} ${json.code}`); continue }
    routed++
    const road = r.distance / 1000
    const diff = ((road - straight) / straight) * 100
    console.log(`  ● ${l.type.padEnd(11)} ${name} ${mode} ${road.toFixed(1)} กม. · ${Math.round(r.duration / 60)} นาที · ${r.geometry.coordinates.length} จุด`)
    console.log(`    ${" ".repeat(42)}เส้นตรงบอก ${straight.toFixed(1)} กม. (ต่างกัน ${diff > 0 ? "+" : ""}${diff.toFixed(0)}%)`)
  } catch (e: any) { failed++; console.log(`  ✗ ${l.type.padEnd(11)} ${name} ${e.message}`) }
}

console.log(`\n● เส้นทางจริง ${routed} · ○ เส้นตรง (บิน/เรือ/รถไฟ) ${direct} · ✗ ล้มเหลว ${failed}`)
process.exit(failed === 0 ? 0 : 1)
