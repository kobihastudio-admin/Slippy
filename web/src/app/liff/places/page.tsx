"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Loader2, MapPin, Star, Navigation, Phone, Globe, AlertCircle, RefreshCw, Check, Users,
  Plus, Link2, Pencil, Search, X,
} from "lucide-react"
import { cn } from "@/lib/utils"

const TYPES = [
  { id: "all",                label: "ทั้งหมด",       emoji: "📍" },
  { id: "restaurant",         label: "ร้านอาหาร",     emoji: "🍽️" },
  { id: "pharmacy",           label: "ร้านยา",         emoji: "💊" },
  { id: "lodging",            label: "โรงแรม",         emoji: "🏨" },
  { id: "tourist_attraction", label: "ท่องเที่ยว",     emoji: "🏛️" },
  { id: "cafe",               label: "คาเฟ่",          emoji: "☕" },
  { id: "hospital",           label: "โรงพยาบาล",     emoji: "🏥" },
]

// category → label/emoji shown in the saved-places picker (mirrors api/liff/places/_lib.ts)
const PLACE_CATEGORIES: Record<string, { label: string; emoji: string }> = {
  gym:                { label: "สนามกีฬา/ฟิตเนส", emoji: "🏸" },
  restaurant:         { label: "ร้านอาหาร",        emoji: "🍽️" },
  cafe:               { label: "คาเฟ่",            emoji: "☕" },
  tourist_attraction: { label: "ท่องเที่ยว",       emoji: "🏛️" },
  lodging:            { label: "โรงแรม",           emoji: "🏨" },
  other:              { label: "อื่นๆ",            emoji: "📍" },
}

function fmtDist(m: number) { return m < 1000 ? `${m} ม.` : `${(m/1000).toFixed(1)} กม.` }

function PlaceCard({ place, lowMeds, onCreateGroup }: { place: any; lowMeds: string[]; onCreateGroup?: (place: any) => void }) {
  const isPharmacy = place.type === "pharmacy" || place.type === "drugstore"
  const hasLowMed  = isPharmacy && lowMeds.length > 0

  return (
    <div className={cn("rounded-2xl border bg-white shadow-sm overflow-hidden",
      place.source === "internal" ? "border-violet-200" : "border-gray-100")}>
      {/* Photo */}
      {place.photo_url && (
        <div className="h-36 bg-gray-100 overflow-hidden">
          <img src={place.photo_url} alt={place.name} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
              {place.source === "internal" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">⭐ เคยไป</span>
              )}
              <span className="text-xs text-gray-400">{place.emoji} {place.label}</span>
            </div>
            <p className="font-bold text-gray-900 leading-tight">{place.name}</p>
            {place.address && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{place.address}</p>}
          </div>
          <span className="text-xs font-semibold text-brand-600 shrink-0 bg-brand-50 px-2 py-1 rounded-full">
            {fmtDist(place.distance_m)}
          </span>
        </div>

        {/* Pharmacy low-med alert */}
        {hasLowMed && (
          <div className="mt-2.5 p-2.5 bg-rose-50 rounded-xl border border-rose-100">
            <p className="text-xs text-rose-700 font-medium flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              ยา "{lowMeds[0]}" ของคุณเหลือน้อย — ร้านนี้อยู่ใกล้แค่ {fmtDist(place.distance_m)}!
            </p>
          </div>
        )}

        {/* Rating + status */}
        <div className="flex items-center gap-3 mt-2.5 text-xs text-gray-500 flex-wrap">
          {place.rating && (
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
              {place.rating}{place.user_ratings ? ` (${place.user_ratings.toLocaleString()})` : ""}
            </span>
          )}
          {place.price_level != null && (
            <span>{"฿".repeat(place.price_level + 1)}</span>
          )}
          {place.is_open === true  && <span className="text-emerald-600 font-medium">● เปิดอยู่</span>}
          {place.is_open === false && <span className="text-rose-500 font-medium">● ปิดแล้ว</span>}
          {place.visit_count && <span>{place.visit_count} ครั้งที่ไป</span>}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-3">
          {onCreateGroup && (
            <button onClick={() => onCreateGroup(place)}
              className="flex-1 h-9 rounded-xl bg-violet-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> สร้างกลุ่ม
            </button>
          )}
          <a href={place.maps_url} target="_blank" rel="noreferrer"
            className={cn("h-9 rounded-xl bg-brand-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5",
              onCreateGroup ? "w-9" : "flex-1")}>
            <Navigation className="w-3.5 h-3.5" />{!onCreateGroup && " นำทาง"}
          </a>
          {place.phone && (
            <a href={`tel:${place.phone}`}
              className="h-9 w-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50">
              <Phone className="w-3.5 h-3.5" />
            </a>
          )}
          {place.website && (
            <a href={place.website} target="_blank" rel="noreferrer"
              className="h-9 w-9 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50">
              <Globe className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function SavedPlaceCard({ place, onPick }: { place: any; onPick: (place: any) => void }) {
  const meta = PLACE_CATEGORIES[place.category] ?? PLACE_CATEGORIES.other
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden flex">
      {place.photoUrl ? (
        <div className="w-20 h-20 bg-gray-100 shrink-0">
          <img src={place.photoUrl} alt={place.name} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-20 h-20 bg-violet-50 shrink-0 flex items-center justify-center text-3xl">
          {meta.emoji}
        </div>
      )}
      <div className="flex-1 p-3 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">
              {meta.emoji} {meta.label}
            </span>
          </div>
          <p className="font-bold text-gray-900 leading-tight truncate">{place.name}</p>
          {place.address && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{place.address}</p>}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => onPick(place)}
            className="flex-1 h-8 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> เลือกสถานที่นี้
          </button>
          {place.mapsUrl && (
            <a href={place.mapsUrl} target="_blank" rel="noreferrer"
              className="h-8 w-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 shrink-0">
              <Navigation className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function NearbyPlaceCard({ place, onPick }: { place: any; onPick: (place: any) => void }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden flex">
      {place.photo_url ? (
        <div className="w-20 h-20 bg-gray-100 shrink-0">
          <img src={place.photo_url} alt={place.name} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-20 h-20 bg-violet-50 shrink-0 flex items-center justify-center text-3xl">
          {place.emoji ?? "📍"}
        </div>
      )}
      <div className="flex-1 p-3 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-semibold">
              {place.emoji ?? "📍"} {place.label ?? place.type}
            </span>
            <span className="text-[10px] text-gray-400 font-semibold">{fmtDist(place.distance_m)}</span>
            {place.rating && (
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> {place.rating}
              </span>
            )}
          </div>
          <p className="font-bold text-gray-900 leading-tight truncate">{place.name}</p>
          {place.address && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{place.address}</p>}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => onPick({ name: place.name, address: place.address, maps_url: place.maps_url })}
            className="flex-1 h-8 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-semibold flex items-center justify-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> เลือกสถานที่นี้
          </button>
          {place.maps_url && (
            <a href={place.maps_url} target="_blank" rel="noreferrer"
              className="h-8 w-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 shrink-0">
              <Navigation className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

const CATEGORY_CHOICES = Object.entries(PLACE_CATEGORIES)

function AddPlaceSheet({ lineUserId, onClose, onSaved }: {
  lineUserId: string
  onClose: () => void
  onSaved: (place: any) => void
}) {
  const [tab,        setTab]        = useState<"link" | "manual">("link")
  const [mapsUrl,    setMapsUrl]    = useState("")
  const [resolving,  setResolving]  = useState(false)
  const [resolveErr, setResolveErr] = useState("")

  const [name,     setName]     = useState("")
  const [category, setCategory] = useState("other")
  const [address,  setAddress]  = useState("")
  const [lat,      setLat]      = useState<number | null>(null)
  const [lng,      setLng]      = useState<number | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [resolved, setResolved] = useState(false)
  const [saving,   setSaving]   = useState(false)

  const resolveLink = useCallback(async () => {
    if (!mapsUrl.trim()) return
    setResolving(true); setResolveErr("")
    try {
      const res  = await fetch("/api/liff/places", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId, action: "resolve", mapsUrl: mapsUrl.trim() }),
      })
      const data = await res.json()
      if (data.error || !data.name) {
        setResolveErr(data.error || "ไม่สามารถอ่านข้อมูลจากลิงก์นี้ได้ กรุณากรอกเอง")
        setMapsUrl(data.mapsUrl || mapsUrl)
        setTab("manual")
        return
      }
      setName(data.name ?? "")
      setCategory(data.category ?? "other")
      setAddress(data.address ?? "")
      setLat(data.lat ?? null)
      setLng(data.lng ?? null)
      setPhotoUrl(data.photoUrl ?? null)
      setMapsUrl(data.mapsUrl ?? mapsUrl)
      setResolved(true)
    } catch {
      setResolveErr("เกิดข้อผิดพลาด กรุณาลองใหม่")
    } finally {
      setResolving(false)
    }
  }, [mapsUrl, lineUserId])

  const save = useCallback(async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const res  = await fetch("/api/liff/places", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId, action: "create",
          name: name.trim(), category, address: address.trim() || undefined,
          mapsUrl: mapsUrl.trim() || undefined,
          lat: lat ?? undefined, lng: lng ?? undefined,
          photoUrl: photoUrl ?? undefined,
        }),
      })
      const data = await res.json()
      if (data.error) { setResolveErr(data.error); return }
      onSaved(data)
    } catch {
      setResolveErr("บันทึกไม่สำเร็จ กรุณาลองใหม่")
    } finally {
      setSaving(false)
    }
  }, [name, category, address, mapsUrl, lat, lng, photoUrl, lineUserId, onSaved])

  const showForm = tab === "manual" || resolved

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-4 pt-4 pb-2 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">เพิ่มสถานที่ใหม่</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 pt-3 flex gap-2">
          <button onClick={() => setTab("link")}
            className={cn("flex-1 h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5",
              tab === "link" ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white" : "bg-gray-100 text-gray-500")}>
            <Link2 className="w-4 h-4" /> ลิงก์ Google Maps
          </button>
          <button onClick={() => setTab("manual")}
            className={cn("flex-1 h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5",
              tab === "manual" ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white" : "bg-gray-100 text-gray-500")}>
            <Pencil className="w-4 h-4" /> กรอกข้อมูลเอง
          </button>
        </div>

        <div className="p-4 space-y-3">
          {tab === "link" && !resolved && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500">วางลิงก์จาก Google Maps</label>
              <input value={mapsUrl} onChange={e => setMapsUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/..."
                className="w-full h-11 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
              <button onClick={resolveLink} disabled={resolving || !mapsUrl.trim()}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                ดึงข้อมูล
              </button>
            </div>
          )}

          {resolveErr && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              ⚠️ {resolveErr}
            </div>
          )}

          {showForm && (
            <div className="space-y-3">
              {photoUrl && (
                <div className="h-32 rounded-xl overflow-hidden bg-gray-100">
                  <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500">ชื่อสถานที่</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="เช่น สนามแบดมินตัน ABC"
                  className="w-full h-11 px-3 mt-1 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500">ประเภท</label>
                <div className="flex gap-2 overflow-x-auto pb-1 mt-1.5 -mx-0.5 px-0.5">
                  {CATEGORY_CHOICES.map(([id, meta]) => (
                    <button key={id} onClick={() => setCategory(id)}
                      className={cn("flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-semibold whitespace-nowrap shrink-0",
                        category === id ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white" : "bg-gray-100 text-gray-500")}>
                      {meta.emoji} {meta.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500">ที่อยู่ (ถ้ามี)</label>
                <input value={address} onChange={e => setAddress(e.target.value)}
                  placeholder="ที่อยู่"
                  className="w-full h-11 px-3 mt-1 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
              </div>

              {tab === "manual" && (
                <div>
                  <label className="text-xs font-semibold text-gray-500">ลิงก์ Google Maps (ถ้ามี)</label>
                  <input value={mapsUrl} onChange={e => setMapsUrl(e.target.value)}
                    placeholder="https://maps.app.goo.gl/..."
                    className="w-full h-11 px-3 mt-1 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
                </div>
              )}

              <button onClick={save} disabled={saving || !name.trim()}
                className="w-full h-11 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                บันทึก & เลือก
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LiffPlacesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initLat = searchParams.get("lat")
  const initLng = searchParams.get("lng")
  const initType = searchParams.get("type") ?? "all"
  // picker=sport|trip|... — "เลือกสถานที่" flow launched from a create-group form.
  // Selecting a place stores it in sessionStorage and returns to that form.
  const picker     = searchParams.get("picker")
  const lineUserId = searchParams.get("lineUserId") ?? ""

  const pickPlace = useCallback((place: any) => {
    sessionStorage.setItem("slippy_place_picker_result", JSON.stringify({
      name: place.name, address: place.address ?? "", mapsUrl: place.mapsUrl ?? place.maps_url ?? "",
    }))
    router.push(picker === "trip" ? "/liff/trip?restoreCreate=1" : "/liff/sport?restoreCreate=1")
  }, [picker, router])

  // 🆕 สร้างกลุ่ม (อื่นๆ) — seed a new "หารบิล" group's title/note from this
  // place and hand off to /liff/split's create form.
  const createGroupFromPlace = useCallback((place: any) => {
    sessionStorage.setItem("slippy_place_group_seed", JSON.stringify({
      name: place.name, address: place.address ?? "",
    }))
    router.push("/liff/split?seedPlace=1")
  }, [router])

  // ── Picker mode: saved-places list ──────────────────────────────────────
  const [savedPlaces,  setSavedPlaces]  = useState<any[]>([])
  const [loadingSaved, setLoadingSaved] = useState(false)
  const [query,        setQuery]        = useState("")
  const [sheetOpen,    setSheetOpen]    = useState(false)
  const [pickerSource, setPickerSource] = useState<"saved" | "nearby">("saved")

  const loadSavedPlaces = useCallback(async () => {
    if (!lineUserId) return
    setLoadingSaved(true)
    try {
      const params = new URLSearchParams({ lineUserId })
      if (query.trim()) params.set("q", query.trim())
      const res  = await fetch(`/api/liff/places?${params}`)
      const data = await res.json()
      setSavedPlaces(data.places ?? [])
    } catch { setSavedPlaces([]) } finally { setLoadingSaved(false) }
  }, [lineUserId, query])

  useEffect(() => {
    if (!picker) return
    const t = setTimeout(loadSavedPlaces, 250)
    return () => clearTimeout(t)
  }, [picker, loadSavedPlaces])

  // ── Picker mode: "ค้นหาใกล้ฉัน (GPS)" — GPS + Google nearby search ───────
  const [nearbyPlaces,  setNearbyPlaces]  = useState<any[]>([])
  const [loadingNearby, setLoadingNearby] = useState(false)
  const [nearbyError,   setNearbyError]   = useState("")
  const [nearbyOrgId,   setNearbyOrgId]   = useState<string | null>(null)

  useEffect(() => {
    if (!picker || !lineUserId) return
    fetch(`/api/liff/profile?lineUserId=${lineUserId}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.profile?.organizationId) setNearbyOrgId(d.profile.organizationId)
    }).catch(() => {})
  }, [picker, lineUserId])

  const searchNearby = useCallback((searchLat: number, searchLng: number) => {
    setLoadingNearby(true)
    const params = new URLSearchParams({
      lat: String(searchLat), lng: String(searchLng),
      type: picker === "sport" ? "gym" : "all", radius: "1000",
      ...(nearbyOrgId ? { orgId: nearbyOrgId } : {}),
    })
    fetch(`/api/places?${params}`)
      .then(r => r.json())
      .then(d => setNearbyPlaces(d.results ?? []))
      .catch(() => setNearbyPlaces([]))
      .finally(() => setLoadingNearby(false))
  }, [picker, nearbyOrgId])

  const requestNearby = useCallback(() => {
    setNearbyError(""); setNearbyPlaces([])
    if (!navigator.geolocation) { setNearbyError("Browser ไม่รองรับ GPS"); return }
    setLoadingNearby(true)
    navigator.geolocation.getCurrentPosition(
      pos => searchNearby(pos.coords.latitude, pos.coords.longitude),
      err => { setNearbyError(`ไม่สามารถรับตำแหน่งได้: ${err.message}`); setLoadingNearby(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [searchNearby])

  useEffect(() => {
    if (!picker || pickerSource !== "nearby") return
    if (nearbyPlaces.length === 0 && !loadingNearby && !nearbyError) requestNearby()
  }, [picker, pickerSource])

  // ── Non-picker mode: GPS-based nearby search (unchanged) ────────────────
  const [lat,       setLat]       = useState<number | null>(initLat ? Number(initLat) : null)
  const [lng,       setLng]       = useState<number | null>(initLng ? Number(initLng) : null)
  const [type,      setType]      = useState(initType)
  const [places,    setPlaces]    = useState<any[]>([])
  const [lowMeds,   setLowMeds]   = useState<string[]>([])
  const [loading,   setLoading]   = useState(false)
  const [geoError,  setGeoError]  = useState("")
  const [orgId,     setOrgId]     = useState<string | null>(null)

  useEffect(() => {
    if (picker || !lineUserId) return
    fetch(`/api/liff/profile?lineUserId=${lineUserId}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.profile?.organizationId) setOrgId(d.profile.organizationId)
    }).catch(() => {})
  }, [picker, lineUserId])

  const search = useCallback(async (searchLat: number, searchLng: number, searchType: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        lat: String(searchLat), lng: String(searchLng),
        type: searchType, radius: "1000",
        ...(orgId ? { orgId } : {}),
      })
      const res  = await fetch(`/api/places?${params}`)
      const data = await res.json()
      setPlaces(data.results ?? [])
      setLowMeds(data.low_medications ?? [])
    } catch { setPlaces([]) } finally { setLoading(false) }
  }, [orgId])

  // Auto-request location on mount (if not provided in URL) — non-picker mode only
  useEffect(() => {
    if (picker) return
    if (lat && lng) { search(lat, lng, type); return }
    if (!navigator.geolocation) { setGeoError("Browser ไม่รองรับ GPS"); return }
    navigator.geolocation.getCurrentPosition(
      pos => { setLat(pos.coords.latitude); setLng(pos.coords.longitude) },
      err => setGeoError(`ไม่สามารถรับตำแหน่งได้: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [picker])

  useEffect(() => { if (!picker && lat && lng) search(lat, lng, type) }, [picker, lat, lng, type, search])

  // ── Picker UI ─────────────────────────────────────────────────────────
  if (picker) {
    return (
      <div className="min-h-screen bg-gray-50 pb-24">
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 pt-12 pb-5 sticky top-0 z-10">
          <p className="text-white/70 text-xs font-semibold uppercase tracking-wider">Slippy</p>
          <h1 className="text-xl font-black mt-0.5">📍 เลือกสถานที่</h1>

          <div className="relative mt-3">
            <Search className="w-4 h-4 text-white/60 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาสถานที่ที่บันทึกไว้..."
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/20 placeholder:text-white/60 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/40" />
          </div>

          {/* Source switcher */}
          <div className="flex gap-2 mt-3">
            <button onClick={() => setPickerSource("saved")}
              className={cn("flex-1 h-9 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5",
                pickerSource === "saved" ? "bg-white text-violet-700" : "bg-white/20 text-white")}>
              <Star className="w-3.5 h-3.5" /> สถานที่ที่บันทึกไว้
            </button>
            <button onClick={() => setPickerSource("nearby")}
              className={cn("flex-1 h-9 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5",
                pickerSource === "nearby" ? "bg-white text-violet-700" : "bg-white/20 text-white")}>
              <Navigation className="w-3.5 h-3.5" /> ค้นหาใกล้ฉัน (GPS)
            </button>
          </div>
        </div>

        <div className="px-4 pt-4">
          {!lineUserId && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-800">
              ⚠️ ไม่พบข้อมูลผู้ใช้ — กรุณากลับไปหน้าก่อนหน้าแล้วลองใหม่
            </div>
          )}

          {pickerSource === "saved" && (
            <>
              {loadingSaved && (
                <div className="flex flex-col items-center py-16 gap-3 text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                  <p className="text-sm">กำลังโหลด...</p>
                </div>
              )}

              {!loadingSaved && lineUserId && savedPlaces.length === 0 && (
                <div className="flex flex-col items-center py-16 gap-2 text-gray-400 text-center">
                  <MapPin className="w-10 h-10 text-gray-300" />
                  <p className="font-medium">ยังไม่มีสถานที่ที่บันทึกไว้</p>
                  <p className="text-sm">เพิ่มสถานที่แรกกันเลย — แตะปุ่ม + ด้านล่าง</p>
                </div>
              )}

              <div className="space-y-3">
                {savedPlaces.map(p => (
                  <SavedPlaceCard key={p.id} place={p} onPick={pickPlace} />
                ))}
              </div>
            </>
          )}

          {pickerSource === "nearby" && (
            <>
              {nearbyError && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-800 flex items-start justify-between gap-3">
                  <span>⚠️ {nearbyError}</span>
                  <button onClick={requestNearby} className="shrink-0 text-violet-600 font-semibold flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5" /> ลองใหม่
                  </button>
                </div>
              )}

              {loadingNearby && (
                <div className="flex flex-col items-center py-16 gap-3 text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                  <p className="text-sm">กำลังค้นหาสถานที่ใกล้คุณ...</p>
                </div>
              )}

              {!loadingNearby && !nearbyError && nearbyPlaces.length === 0 && (
                <div className="flex flex-col items-center py-16 gap-2 text-gray-400 text-center">
                  <MapPin className="w-10 h-10 text-gray-300" />
                  <p className="font-medium">ไม่พบสถานที่ในรัศมี 1 กม.</p>
                </div>
              )}

              <div className="space-y-3">
                {nearbyPlaces.map((p, i) => (
                  <NearbyPlaceCard key={`${p.id}-${i}`} place={p} onPick={pickPlace} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* FAB */}
        <button onClick={() => setSheetOpen(true)} disabled={!lineUserId}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg flex items-center justify-center disabled:opacity-50">
          <Plus className="w-6 h-6" />
        </button>

        {sheetOpen && (
          <AddPlaceSheet
            lineUserId={lineUserId}
            onClose={() => setSheetOpen(false)}
            onSaved={(place) => { setSheetOpen(false); pickPlace(place) }}
          />
        )}
      </div>
    )
  }

  // ── Non-picker UI (nearby search, unchanged) ─────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 pt-12 pb-5 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-white/70 text-xs font-semibold uppercase tracking-wider">Slippy</p>
            <h1 className="text-xl font-black mt-0.5">📍 สถานที่ใกล้เคียง</h1>
            {lat && lng && <p className="text-white/60 text-xs mt-0.5">รัศมี 1 กิโลเมตร</p>}
          </div>
          {lat && lng && (
            <button onClick={() => search(lat, lng, type)} disabled={loading}
              className="h-9 w-9 rounded-full bg-white/20 flex items-center justify-center">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          )}
        </div>

        {/* Type filter */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-hide">
          {TYPES.map(t => (
            <button key={t.id} onClick={() => setType(t.id)}
              className={cn("flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-semibold whitespace-nowrap transition-colors shrink-0",
                type === t.id ? "bg-white text-violet-700" : "bg-white/20 text-white hover:bg-white/30")}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4">
        {/* Low medication banner */}
        {lowMeds.length > 0 && (
          <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
            <span className="text-2xl shrink-0">💊</span>
            <div>
              <p className="text-sm font-bold text-rose-800">ยาเหลือน้อย!</p>
              <p className="text-xs text-rose-600 mt-0.5">
                {lowMeds.join(", ")} — ร้านยาใกล้คุณแสดงด้านล่าง
              </p>
            </div>
          </div>
        )}

        {/* GPS error */}
        {geoError && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-800">
            ⚠️ {geoError}
          </div>
        )}

        {/* Loading */}
        {loading && !places.length && (
          <div className="flex flex-col items-center py-16 gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
            <p className="text-sm">กำลังค้นหา...</p>
          </div>
        )}

        {/* Results */}
        {!loading && places.length === 0 && lat && (
          <div className="flex flex-col items-center py-16 gap-2 text-gray-400 text-center">
            <MapPin className="w-10 h-10 text-gray-300" />
            <p className="font-medium">ไม่พบสถานที่ในรัศมี 1 กม.</p>
            <p className="text-sm">ลองเปลี่ยนประเภทหรือตรวจสอบการตั้งค่า Google Maps API</p>
          </div>
        )}

        <div className="space-y-3">
          {places.map((p, i) => (
            <PlaceCard key={`${p.id}-${i}`} place={p} lowMeds={type === "pharmacy" ? lowMeds : []}
              onCreateGroup={createGroupFromPlace} />
          ))}
        </div>

        {places.length > 0 && (
          <p className="text-center text-xs text-gray-400 mt-5">
            พบ {places.length} สถานที่ · {places.filter(p => p.source === "internal").length} เคยไป
          </p>
        )}
      </div>
    </div>
  )
}
