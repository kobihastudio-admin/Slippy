import { createClient } from "../lib/supabase"
import type { ExtractedDocument } from "./extractor"
import { canonicalMerchantKey } from "./merchant-key"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
const USER_AGENT    = "Slippy/1.0 (accounting document management; contact@solutionx.co.th)"

/**
 * Geocode a Thai address via Nominatim (OpenStreetMap).
 * Returns [lat, lng] or null if not found.
 * Rate limit: 1 req/sec — caller must not flood.
 */
async function geocodeAddress(address: string): Promise<[number, number] | null> {
  try {
    const url = new URL(NOMINATIM_URL)
    url.searchParams.set("q",       address + ", Thailand")
    url.searchParams.set("format",  "json")
    url.searchParams.set("limit",   "1")
    url.searchParams.set("countrycodes", "th")

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const data = await res.json() as any[]
    if (!data.length) return null

    return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
  } catch {
    return null
  }
}

/**
 * Upsert vendor record after a document is extracted.
 * Increments doc_count / total_amount stats, then geocodes if address is new.
 *
 * Fire-and-forget: errors are caught silently — vendor sync never blocks pipeline.
 */
export async function upsertVendor(
  organizationId: string,
  extracted:      ExtractedDocument,
): Promise<void> {
  if (!extracted.vendor_name?.trim()) return

  const supabase = createClient()

  // Canonical "same store" key — computed here (TS) so runtime and the backfill
  // script share one normalization and can't drift. See merchant-key.ts.
  const matchKey = canonicalMerchantKey({
    name:  extracted.vendor_name,
    taxId: extracted.vendor_tax_id,
  })

  // Call DB function that handles dedup + stat increment
  const { data: vendorId, error } = await supabase.rpc("upsert_vendor", {
    p_org_id:    organizationId,
    p_name:      extracted.vendor_name.trim(),
    p_tax_id:    extracted.vendor_tax_id  || null,
    p_address:   extracted.vendor_address || null,
    p_phone:     extracted.vendor_phone   || null,
    p_amount:    extracted.total_amount   ?? 0,
    p_vat:       extracted.vat_amount     ?? 0,
    p_doc_date:  extracted.doc_date       || null,
    p_match_key: matchKey || null,
  })

  if (error || !vendorId) {
    console.warn("[vendor] upsert failed:", error?.message)
    return
  }

  // Geocode if vendor has an address but no coordinates yet
  const { data: vendor } = await supabase
    .from("vendors")
    .select("lat, address")
    .eq("id", vendorId)
    .single()

  if (vendor && !vendor.lat && vendor.address) {
    const coords = await geocodeAddress(vendor.address)
    if (coords) {
      await supabase
        .from("vendors")
        .update({ lat: coords[0], lng: coords[1], geocoded_at: new Date().toISOString() })
        .eq("id", vendorId)
    }
  }
}
