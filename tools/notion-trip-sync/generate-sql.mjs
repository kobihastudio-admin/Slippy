#!/usr/bin/env node
// Turns a normalized trip snapshot (JSON, usually read out of a Notion trip page) into
// idempotent SQL for the trip tables. Every row carries a stable `key` that is stored in
// `source_id`, so running it again updates/skips instead of duplicating.
//
//   node generate-sql.mjs snapshot.json [--mode=insert-only|update] > sync.sql
//
// insert-only (default): rows that already exist are left exactly as they are, so edits
//   made in the app are never overwritten.
// update: rows that exist are overwritten with the snapshot's values (Notion wins).
//
// The script only prints SQL; it holds no credentials and talks to nothing. Review the
// output, then run it against the project (e.g. the Supabase SQL editor or `psql`).
import { readFileSync } from "node:fs"

const DOLLAR = "$s$"

export function lit(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`)
    return String(value)
  }
  if (typeof value === "boolean") return value ? "true" : "false"
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (text.includes(DOLLAR)) throw new Error(`value contains ${DOLLAR}: ${text.slice(0, 40)}`)
  return `${DOLLAR}${text}${DOLLAR}`
}

function requireKey(row, what) {
  if (!row.key || typeof row.key !== "string") throw new Error(`${what} is missing a string "key": ${JSON.stringify(row).slice(0, 80)}`)
  return row.key
}

function conflict(target, setColumns, mode) {
  if (mode !== "update") return `ON CONFLICT ${target} DO NOTHING`
  return `ON CONFLICT ${target} DO UPDATE SET ${setColumns.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`
}

export function generate(snapshot, { mode = "insert-only" } = {}) {
  if (mode !== "insert-only" && mode !== "update") throw new Error(`unknown mode ${mode}`)
  const jid = snapshot.journeyId
  if (!/^[0-9a-f-]{36}$/i.test(jid ?? "")) throw new Error("snapshot.journeyId must be a uuid")
  const out = [`-- generated ${mode} sync for trip ${jid}`, "BEGIN;"]
  const seen = new Set()
  const unique = (key, what) => {
    if (seen.has(`${what}:${key}`)) throw new Error(`duplicate ${what} key: ${key}`)
    seen.add(`${what}:${key}`)
  }

  for (const day of snapshot.days ?? []) {
    const dayKey = requireKey(day, "day"); unique(dayKey, "day")
    out.push(
      `INSERT INTO trip_itinerary_days (journey_id, day_number, date, title, city, summary, source_id)\n` +
      `VALUES (${lit(jid)}, ${lit(day.day_number)}, ${lit(day.date)}, ${lit(day.title)}, ${lit(day.city)}, ${lit(day.summary)}, ${lit(dayKey)})\n` +
      `${conflict("(journey_id, source_id) WHERE source_id IS NOT NULL", ["date", "title", "city", "summary"], mode)};`)
    for (const [index, item] of (day.items ?? []).entries()) {
      const itemKey = requireKey(item, "item"); unique(`${dayKey}/${itemKey}`, "item")
      out.push(
        `INSERT INTO trip_itinerary_items (day_id, sort_order, type, title, location, time_from, time_to, status, provider, confirmation_code, amount, currency, notes, details, source_id)\n` +
        `SELECT d.id, ${lit(item.sort_order ?? index)}, ${lit(item.type ?? "activity")}, ${lit(item.title)}, ${lit(item.location)}, ${lit(item.time_from)}, ${lit(item.time_to)}, ${lit(item.status ?? "planned")}, ${lit(item.provider)}, ${lit(item.confirmation_code)}, ${lit(item.amount ?? 0)}, ${lit(item.currency ?? "JPY")}, ${lit(item.notes)}, ${lit(item.details ?? {})}::jsonb, ${lit(itemKey)}\n` +
        `FROM trip_itinerary_days d WHERE d.journey_id = ${lit(jid)} AND d.source_id = ${lit(dayKey)}\n` +
        `${conflict("(day_id, source_id) WHERE source_id IS NOT NULL", ["sort_order", "type", "title", "location", "time_from", "time_to", "status", "provider", "confirmation_code", "amount", "currency", "notes", "details"], mode)};`)
    }
  }

  for (const [index, entry] of (snapshot.checklist ?? []).entries()) {
    const key = requireKey(entry, "checklist item"); unique(key, "checklist")
    out.push(
      `INSERT INTO trip_checklist_items (journey_id, title, category, is_done, sort_order, source_id)\n` +
      `VALUES (${lit(jid)}, ${lit(entry.title)}, ${lit(entry.category)}, ${lit(entry.is_done ?? false)}, ${lit(entry.sort_order ?? index + 1)}, ${lit(key)})\n` +
      // is_done is state the group changes in the app, so even `update` mode leaves it alone.
      `${conflict("(journey_id, source_id) WHERE source_id IS NOT NULL", ["title", "category", "sort_order"], mode)};`)
  }

  for (const note of snapshot.notes ?? []) {
    const key = requireKey(note, "note"); unique(key, "note")
    out.push(
      `INSERT INTO trip_notes (journey_id, title, body, tag, is_pinned, source_id)\n` +
      `VALUES (${lit(jid)}, ${lit(note.title)}, ${lit(note.body)}, ${lit(note.tag)}, ${lit(note.is_pinned ?? false)}, ${lit(key)})\n` +
      `${conflict("(journey_id, source_id) WHERE source_id IS NOT NULL", ["title", "body", "tag"], mode)};`)
  }

  for (const [index, c] of (snapshot.candidates ?? []).entries()) {
    const key = requireKey(c, "candidate"); unique(key, "candidate")
    out.push(
      `INSERT INTO trip_place_candidates (journey_id, kind, day_number, title, note, maps_url, price_hint, needs_booking, status, sort_order, source_id)\n` +
      `VALUES (${lit(jid)}, ${lit(c.kind ?? "place")}, ${lit(c.day_number)}, ${lit(c.title)}, ${lit(c.note)}, ${lit(c.maps_url)}, ${lit(c.price_hint)}, ${lit(c.needs_booking ?? false)}, ${lit(c.status ?? "open")}, ${lit(c.sort_order ?? index + 1)}, ${lit(key)})\n` +
      // status is decided by the group in the app and is never overwritten.
      `${conflict("(journey_id, source_id) WHERE source_id IS NOT NULL", ["kind", "day_number", "title", "note", "maps_url", "price_hint", "needs_booking"], mode)};`)
  }

  // Mirror new itinerary lines into the Activity Graph, same statements as migration 20260903053736.
  out.push(
    `INSERT INTO activities (owner_id, trip_id, trip_itinerary_item_id, title, summary, category, visibility, status, location_name, starts_at, ends_at, source_type)\n` +
    `SELECT j.user_id, d.journey_id, i.id, i.title, '', i.type, 'private', CASE WHEN i.status = 'cancelled' THEN 'cancelled' ELSE 'published' END, i.location, i.starts_at, i.ends_at, 'manual'\n` +
    `FROM trip_itinerary_items i JOIN trip_itinerary_days d ON d.id = i.day_id JOIN life_journeys j ON j.id = d.journey_id\n` +
    `WHERE i.activity_id IS NULL AND d.journey_id = ${lit(jid)}\n` +
    `ON CONFLICT (trip_itinerary_item_id) WHERE trip_itinerary_item_id IS NOT NULL DO NOTHING;`,
    `UPDATE trip_itinerary_items i SET activity_id = a.id FROM activities a\n` +
    `WHERE i.activity_id IS NULL AND a.trip_itinerary_item_id = i.id AND i.day_id IN (SELECT id FROM trip_itinerary_days WHERE journey_id = ${lit(jid)});`,
    "COMMIT;")
  return out.join("\n\n") + "\n"
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith("--"))
  const mode = (args.find((a) => a.startsWith("--mode=")) ?? "--mode=insert-only").split("=")[1]
  if (!file) { console.error("usage: generate-sql.mjs snapshot.json [--mode=insert-only|update]"); process.exit(2) }
  process.stdout.write(generate(JSON.parse(readFileSync(file, "utf8")), { mode }))
}
