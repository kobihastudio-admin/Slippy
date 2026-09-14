/**
 * Demo trip — run with:  npm run seed:japan-trip
 *
 * Builds "Hiroshima & Fukuoka Japan 2026" in the PERSONAL organization so the
 * Journey screens have something real to render: every tab (Overview,
 * Itinerary, Map, Budget, More) reads from these rows, and a screen with no
 * data cannot show whether it works.
 *
 * Idempotent. It deletes any journey with the same title in the same org first,
 * so re-running replaces rather than duplicates — the seeded trip is disposable
 * by design. It scopes that delete to ONE organization and ONE title, because a
 * seed script that can reach further than the thing it seeds is a foot-gun
 * pointed at production data.
 *
 * The costs are deliberately realistic: JPY originals with a THB conversion, so
 * the multi-currency handling (migration 073) is actually exercised instead of
 * being demonstrated with round numbers that would look right either way.
 */
import { supabase } from "../lib/supabase"

// ── Target ───────────────────────────────────────────────────────────────────
const ORG_ID  = "8b667cbd-ec8e-482a-b0e6-b97182c6cada"  // "รายรับ/จ่ายส่วนตัว" (account_type: personal)
const USER_ID = "dfae3bc6-42e4-4e94-964d-cb5f79a5e1dd"  // chainimit@gmail.com
const TITLE   = "Hiroshima & Fukuoka Japan 2026"

/** JPY → THB. One rate for the whole trip, as a traveller's card statement would. */
const JPY = 0.24
const thb = (yen: number) => +(yen * JPY).toFixed(2)

type Item = {
  type: string
  title: string
  subtitle?: string
  location?: string
  lat?: number; lng?: number
  end_location?: string; end_lat?: number; end_lng?: number
  /** "HH:MM" local to where it happens. */
  from?: string; to?: string
  /** Minutes past `from` that it ends, when it crosses midnight or a timezone. */
  yen?: number
  status?: "planned" | "confirmed" | "optional" | "cancelled"
  provider?: string
  code?: string
  notes?: string
  details?: Record<string, unknown>
  /** Book this as a trip_expenses row too, and link the two. */
  expense?: { category: string; paidBy?: string }
}

type Day = { date: string; city: string; title: string; summary: string; items: Item[] }

// ── The trip ────────────────────────────────────────────────────────────────
const DAYS: Day[] = [
  {
    date: "2026-11-20", city: "Fukuoka", title: "บินถึงฟุกุโอกะ",
    summary: "บินตรง BKK → FUK เข้าที่พักย่านฮากาตะ แล้วออกไปกินราเมนกับยาไต",
    items: [
      { type: "flight", title: "TG648 กรุงเทพฯ → ฟุกุโอกะ", subtitle: "Thai Airways · 5 ชม. 25 นาที",
        location: "สนามบินสุวรรณภูมิ (BKK)", lat: 13.6900, lng: 100.7501,
        end_location: "สนามบินฟุกุโอกะ (FUK)", end_lat: 33.5859, end_lng: 130.4507,
        from: "09:15", to: "16:40", yen: 96000, status: "confirmed", provider: "Thai Airways",
        code: "TG648-4KQ2M9",
        details: { flight_number: "TG648", seat: "32A / 32B", terminal_dep: "Suvarnabhumi Intl", terminal_arr: "FUK International", baggage: "30 kg", tz_note: "BKK +07 → FUK +09" },
        expense: { category: "transport" } },
      { type: "subway", title: "รถไฟใต้ดินเข้าเมือง", subtitle: "Fukuoka Airport → Hakata · 5 นาที",
        location: "Fukuoka Airport Station", lat: 33.5859, lng: 130.4507,
        end_location: "Hakata Station", end_lat: 33.5898, end_lng: 130.4207,
        from: "17:30", to: "17:40", yen: 260, status: "confirmed", provider: "Fukuoka City Subway",
        details: { line: "Kuko Line", ic_card: "SUGOCA" } },
      { type: "hotel", title: "Hotel Nikko Fukuoka", subtitle: "เช็คอิน · 3 คืน",
        location: "2-18-25 Hakataekimae, Hakata-ku, Fukuoka", lat: 33.5906, lng: 130.4180,
        from: "18:00", yen: 62400, status: "confirmed", provider: "Hotel Nikko",
        code: "NK-2026-118834",
        details: { room_type: "Deluxe Twin ×2", guests: 4, nights: 3, checkout: "2026-11-23 09:00", breakfast: true },
        expense: { category: "accommodation" } },
      { type: "restaurant", title: "Ichiran Honsha", subtitle: "ราเมนทงคตสึ ต้นตำรับ",
        location: "5-3-2 Nakasu, Hakata-ku", lat: 33.5931, lng: 130.4053,
        from: "19:30", to: "20:30", yen: 4600, status: "confirmed",
        details: { cuisine: "Tonkotsu ramen", seats: "บูธเดี่ยว", queue: "~20 นาที" },
        expense: { category: "food" } },
      { type: "activity", title: "ยาไตนากาสึ (Nakasu Yatai)", subtitle: "แผงลอยริมแม่น้ำ",
        location: "Nakasu riverside", lat: 33.5920, lng: 130.4060,
        from: "21:00", to: "22:30", yen: 5200, status: "optional",
        notes: "ถ้าไม่เหนื่อยเกินไปจากไฟลต์ — เปิดถึงตี 2",
        details: { kind: "Street food" } },
    ],
  },
  {
    date: "2026-11-21", city: "Fukuoka", title: "ดาไซฟุ & เมืองฟุกุโอกะ",
    summary: "ศาลเจ้าดาไซฟุช่วงใบไม้เปลี่ยนสี บ่ายขึ้นหอคอย เย็นกินโมสึนาเบะ",
    items: [
      { type: "meal", title: "อาหารเช้าที่โรงแรม", location: "Hotel Nikko Fukuoka", lat: 33.5906, lng: 130.4180,
        from: "08:00", to: "09:00", yen: 0, status: "confirmed", notes: "รวมในค่าห้องแล้ว" },
      { type: "train", title: "Nishitetsu → Dazaifu", subtitle: "เปลี่ยนขบวนที่ Futsukaichi · 45 นาที",
        location: "Nishitetsu Fukuoka (Tenjin)", lat: 33.5895, lng: 130.3985,
        end_location: "Dazaifu Station", end_lat: 33.5195, end_lng: 130.5240,
        from: "09:30", to: "10:15", yen: 4200, status: "confirmed", provider: "Nishitetsu",
        details: { ticket: "Dazaifu Sanpo Kippu ×4" } },
      { type: "activity", title: "ศาลเจ้าดาไซฟุ เทนมังงู", subtitle: "ใบไม้แดงพีคพอดี · 2 ชม.",
        location: "4-7-1 Saifu, Dazaifu", lat: 33.5215, lng: 130.5350,
        from: "10:30", to: "12:30", yen: 0, status: "confirmed",
        details: { kind: "Shrine", note: "ทางเดินหน้าศาลเจ้ามีร้านอุเมงาเอะโมจิ" } },
      { type: "restaurant", title: "Umegae Mochi + ข้าวกลางวัน", subtitle: "หน้าศาลเจ้า",
        location: "Dazaifu Omotesando", lat: 33.5210, lng: 130.5330,
        from: "12:30", to: "13:30", yen: 3800, status: "planned",
        expense: { category: "food" } },
      { type: "activity", title: "Fukuoka Tower", subtitle: "จุดชมวิว 234 ม.",
        location: "2-3-26 Momochihama, Sawara-ku", lat: 33.5933, lng: 130.3514,
        from: "15:30", to: "17:00", yen: 3200, status: "confirmed",
        details: { kind: "Observation deck", tip: "ขึ้นก่อนพระอาทิตย์ตก ~17:10" },
        expense: { category: "activity" } },
      { type: "shopping", title: "Canal City Hakata", location: "1-2 Sumiyoshi, Hakata-ku",
        lat: 33.5897, lng: 130.4110, from: "18:00", to: "19:30", yen: 0, status: "planned",
        details: { kind: "Mall", show: "น้ำพุมีโชว์ทุกครึ่งชั่วโมง" } },
      { type: "restaurant", title: "Motsunabe Ooyama", subtitle: "หม้อไฟเครื่องในวัวฟุกุโอกะ",
        location: "1-8-2 Hakataekimae", lat: 33.5905, lng: 130.4145,
        from: "20:00", to: "21:30", yen: 12800, status: "confirmed", code: "OY-1121-19",
        details: { cuisine: "Motsunabe", booking: "จองโต๊ะ 4 ที่" },
        expense: { category: "food" } },
    ],
  },
  {
    date: "2026-11-22", city: "Hiroshima", title: "ชินคันเซ็นสู่ฮิโรชิมา",
    summary: "Nozomi ชั่วโมงเดียวถึง บ่ายเดินสวนสันติภาพ เย็นกินโอโคโนมิยากิ",
    items: [
      { type: "hotel", title: "เช็คเอาต์ Hotel Nikko Fukuoka", location: "Hakata", lat: 33.5906, lng: 130.4180,
        from: "09:00", to: "09:30", yen: 0, status: "confirmed" },
      { type: "shinkansen", title: "Nozomi 41 · ฮากาตะ → ฮิโรชิมา", subtitle: "1 ชม. 5 นาที · ตู้ 8",
        location: "Hakata Station", lat: 33.5898, lng: 130.4207,
        end_location: "Hiroshima Station", end_lat: 34.3979, end_lng: 132.4753,
        from: "10:12", to: "11:17", yen: 35600, status: "confirmed", provider: "JR West",
        code: "JRW-NZ41-2026112202",
        details: { train_no: "Nozomi 41", car: 8, seats: "3A 3B 3C 3D", class: "Reserved (指定席)",
                   note: "ฝั่ง D–E เห็นวิวทะเลเซโตะช่วงท้าย" },
        expense: { category: "transport" } },
      { type: "hotel", title: "Sheraton Grand Hiroshima", subtitle: "เช็คอิน · 3 คืน · ติดสถานี",
        location: "12-1 Wakakusa-cho, Higashi-ku, Hiroshima", lat: 34.3985, lng: 132.4740,
        from: "11:30", yen: 71400, status: "confirmed", provider: "Marriott",
        code: "MR-88420117",
        details: { room_type: "Grand Twin ×2", guests: 4, nights: 3, checkout: "2026-11-25 09:00" },
        expense: { category: "accommodation" } },
      { type: "restaurant", title: "Okonomi-mura", subtitle: "โอโคโนมิยากิสไตล์ฮิโรชิมา",
        location: "5-13 Shintenchi, Naka-ku", lat: 34.3925, lng: 132.4610,
        from: "13:00", to: "14:15", yen: 5600, status: "confirmed",
        details: { cuisine: "Okonomiyaki", note: "ตึกรวมร้าน 24 ร้าน ชั้น 2–4" },
        expense: { category: "food" } },
      { type: "activity", title: "สวนอนุสรณ์สันติภาพ + พิพิธภัณฑ์", subtitle: "2 ชม. 30 นาที",
        location: "1-2 Nakajima-cho, Naka-ku", lat: 34.3917, lng: 132.4518,
        from: "15:00", to: "17:30", yen: 800, status: "confirmed",
        details: { kind: "Museum", admission: "¥200/คน", audio_guide: "มีภาษาไทย" },
        expense: { category: "activity" } },
      { type: "activity", title: "Atomic Bomb Dome ตอนพระอาทิตย์ตก",
        location: "1-10 Otemachi, Naka-ku", lat: 34.3955, lng: 132.4536,
        from: "17:30", to: "18:15", yen: 0, status: "confirmed",
        details: { kind: "UNESCO World Heritage" } },
      { type: "restaurant", title: "Nagataya", subtitle: "โอโคโนมิยากิร้านดัง หน้าสวนสันติภาพ",
        location: "1-7-19 Otemachi, Naka-ku", lat: 34.3936, lng: 132.4530,
        from: "19:30", to: "20:45", yen: 6400, status: "planned",
        notes: "ต่อคิวประมาณ 30 นาที ถ้าเต็มไป Hassei แทน",
        expense: { category: "food" } },
    ],
  },
  {
    date: "2026-11-23", city: "Miyajima", title: "มิยาจิมะ · เสาโทริอิลอยน้ำ",
    summary: "รถไฟต่อเรือเฟอร์รี ขึ้นกระเช้ามิเซ็น กลับมากินหอยนางรม",
    items: [
      { type: "train", title: "JR Sanyo Line → Miyajimaguchi", subtitle: "27 นาที",
        location: "Hiroshima Station", lat: 34.3979, lng: 132.4753,
        end_location: "Miyajimaguchi Station", end_lat: 34.3110, end_lng: 132.3035,
        from: "08:30", to: "08:57", yen: 1720, status: "confirmed", provider: "JR West",
        details: { line: "Sanyo Main Line", pass: "ใช้ Hiroshima Wide Area Pass" } },
      { type: "ferry", title: "JR Miyajima Ferry", subtitle: "10 นาที · ผ่านหน้าเสาโทริอิ",
        location: "Miyajimaguchi Pier", lat: 34.3103, lng: 132.3030,
        end_location: "Miyajima Pier", end_lat: 34.2977, end_lng: 132.3229,
        from: "09:20", to: "09:30", yen: 1600, status: "confirmed", provider: "JR West Miyajima Ferry",
        details: { vessel: "Misen Maru", pier: "ท่า 1", tip: "เที่ยว 9:10–16:10 วิ่งเข้าใกล้โทริอิ ยืนกราบขวา" },
        expense: { category: "transport" } },
      { type: "activity", title: "ศาลเจ้าอิสึกุชิมะ", subtitle: "น้ำขึ้นเต็มที่ 10:40 · เสาโทริอิลอยน้ำ",
        location: "1-1 Miyajima-cho", lat: 34.2960, lng: 132.3197,
        from: "10:00", to: "12:00", yen: 1600, status: "confirmed",
        details: { kind: "Shrine", admission: "¥300/คน", high_tide: "10:40" },
        expense: { category: "activity" } },
      { type: "restaurant", title: "Anago-meshi Ueno", subtitle: "ข้าวหน้าปลาไหลทะเล",
        location: "1-5-11 Miyajimaguchi", lat: 34.3110, lng: 132.3040,
        from: "12:15", to: "13:15", yen: 11200, status: "planned",
        notes: "ร้านนี้อยู่ฝั่งท่าเรือแผ่นดินใหญ่ — ซื้อกล่องข้ามไปกินบนเกาะก็ได้",
        expense: { category: "food" } },
      { type: "activity", title: "กระเช้ามิเซ็น (Miyajima Ropeway)", subtitle: "ขึ้นยอดเขามิเซ็น",
        location: "Momijidani Station", lat: 34.2925, lng: 132.3220,
        from: "13:30", to: "16:00", yen: 8000, status: "confirmed",
        details: { kind: "Ropeway", round_trip: "¥2,000/คน", walk: "จากสถานีบน เดินอีก 30 นาทีถึงยอด" },
        expense: { category: "activity" } },
      { type: "ferry", title: "เฟอร์รีกลับฝั่ง", location: "Miyajima Pier", lat: 34.2977, lng: 132.3229,
        end_location: "Miyajimaguchi Pier", end_lat: 34.3103, end_lng: 132.3030,
        from: "16:30", to: "16:40", yen: 1600, status: "confirmed", provider: "JR West Miyajima Ferry" },
      { type: "restaurant", title: "หอยนางรมย่าง ริมทางฮิโรชิมา", subtitle: "ฤดูหอยนางรมพอดี",
        location: "Hondori, Naka-ku", lat: 34.3930, lng: 132.4570,
        from: "19:00", to: "20:30", yen: 7800, status: "planned",
        expense: { category: "food" } },
    ],
  },
  {
    date: "2026-11-24", city: "Onomichi", title: "เช่ารถไปโอโนมิจิ",
    summary: "ขับเลียบทะเลเซโตะ ขึ้นวัดเซนโคจิ แวะสะพานชิมานามิ",
    items: [
      { type: "car_rental", title: "รับรถ Toyota Rent a Car", subtitle: "Corolla Cross · 2 วัน",
        location: "Hiroshima Ekimae Branch", lat: 34.3970, lng: 132.4760,
        from: "09:00", to: "09:30", yen: 18600, status: "confirmed", provider: "Toyota Rent a Car",
        code: "TRC-HIR-770213",
        details: { car_model: "Corolla Cross Hybrid", transmission: "AT", plate: "広島 302 は 45-67",
                   insurance: "ประกันเต็ม + NOC", return_at: "2026-11-25 09:30",
                   note: "ต้องมีใบขับขี่สากล (IDP) ตัวจริง + พาสปอร์ต", etc_card: true },
        expense: { category: "transport" } },
      { type: "car_rental", title: "ขับสู่โอโนมิจิ", subtitle: "ทางด่วน Sanyo · 1 ชม. 30 นาที",
        location: "Hiroshima", lat: 34.3970, lng: 132.4760,
        end_location: "Onomichi", end_lat: 34.4046, end_lng: 133.1949,
        from: "09:30", to: "11:00", yen: 3400, status: "confirmed",
        details: { kind: "Drive", distance_km: 88, toll: "¥2,200", fuel: "¥1,200" } },
      { type: "restaurant", title: "ราเมนโอโนมิจิ", subtitle: "น้ำซุปโชยุ + มันหมู",
        location: "Onomichi Hondori", lat: 34.4050, lng: 133.1970,
        from: "12:00", to: "13:00", yen: 4400, status: "planned",
        expense: { category: "food" } },
      { type: "activity", title: "วัดเซนโคจิ + กระเช้า", subtitle: "วิวช่องแคบโอโนมิจิ",
        location: "15-1 Higashitsuchidocho, Onomichi", lat: 34.4090, lng: 133.2010,
        from: "14:00", to: "15:30", yen: 2400, status: "confirmed",
        details: { kind: "Temple", ropeway: "¥700 ไป-กลับ", walk: "ขาลงเดิน Path of Literature" },
        expense: { category: "activity" } },
      { type: "activity", title: "จุดชมวิวสะพานชิมานามิ ไคโด", subtitle: "สะพานอินโนชิมะ",
        location: "Innoshima Bridge viewpoint", lat: 34.3320, lng: 133.1780,
        from: "16:00", to: "17:00", yen: 0, status: "optional",
        details: { kind: "Scenic drive", note: "ถ้าแดดดี ขับต่ออีก 20 นาทีถึงจุดชมวิวอิคุจิ" } },
      { type: "car_rental", title: "ขับกลับฮิโรชิมา", location: "Onomichi", lat: 34.4046, lng: 133.1949,
        end_location: "Hiroshima", end_lat: 34.3970, end_lng: 132.4760,
        from: "17:30", to: "19:00", yen: 3400, status: "confirmed",
        details: { kind: "Drive", toll: "¥2,200" } },
      { type: "restaurant", title: "อาหารเย็นแถวโรงแรม", location: "Wakakusa-cho", lat: 34.3985, lng: 132.4740,
        from: "19:30", to: "20:45", yen: 6200, status: "planned", expense: { category: "food" } },
    ],
  },
  {
    date: "2026-11-25", city: "Fukuoka", title: "กลับฟุกุโอกะ",
    summary: "คืนรถ นั่ง Sakura กลับฮากาตะ บ่ายสวนโอโฮริ เย็นช้อปเทนจิน",
    items: [
      { type: "car_rental", title: "คืนรถ", location: "Hiroshima Ekimae Branch", lat: 34.3970, lng: 132.4760,
        from: "09:30", to: "10:00", yen: 0, status: "confirmed", provider: "Toyota Rent a Car",
        details: { note: "เติมน้ำมันเต็มถังก่อนคืน — ปั๊มอยู่หัวมุมถัดไป" } },
      { type: "shinkansen", title: "Sakura 549 · ฮิโรชิมา → ฮากาตะ", subtitle: "1 ชม. 8 นาที",
        location: "Hiroshima Station", lat: 34.3979, lng: 132.4753,
        end_location: "Hakata Station", end_lat: 33.5898, end_lng: 130.4207,
        from: "11:00", to: "12:08", yen: 35600, status: "confirmed", provider: "JR West",
        code: "JRW-SK549-2026112501",
        details: { train_no: "Sakura 549", car: 6, seats: "2A 2B 2C 2D", class: "Reserved",
                   note: "Sakura ที่นั่ง 2+2 กว้างกว่า Nozomi" },
        expense: { category: "transport" } },
      { type: "hotel", title: "The Blossom Hakata Premier", subtitle: "เช็คอิน · 2 คืน",
        location: "1-8-12 Hakataekimae, Hakata-ku", lat: 33.5901, lng: 130.4172,
        from: "12:30", yen: 48800, status: "confirmed", provider: "JR Kyushu Hotels",
        code: "BH-2026-45102",
        details: { room_type: "Superior Twin ×2", guests: 4, nights: 2, checkout: "2026-11-27 09:00", onsen: "มีออนเซ็นรวมชั้น 12" },
        expense: { category: "accommodation" } },
      { type: "activity", title: "สวนโอโฮริ + ปราสาทฟุกุโอกะ", subtitle: "เดินเล่นรอบบึง 2 กม.",
        location: "1-2 Ohorikoen, Chuo-ku", lat: 33.5860, lng: 130.3760,
        from: "14:00", to: "16:00", yen: 0, status: "confirmed",
        details: { kind: "Park", note: "ซากปราสาทอยู่ฝั่งตะวันออกของสวน" } },
      { type: "shopping", title: "เทนจิน + Tenjin Chikagai", subtitle: "ทางเดินใต้ดินสายช้อป",
        location: "Tenjin, Chuo-ku", lat: 33.5900, lng: 130.3990,
        from: "16:30", to: "18:30", yen: 0, status: "planned" },
      { type: "restaurant", title: "ซูชิ Hyotan", subtitle: "ซูชิเคาน์เตอร์ ราคาไม่โหด",
        location: "Tenjin, Chuo-ku", lat: 33.5908, lng: 130.3985,
        from: "19:00", to: "20:30", yen: 14200, status: "planned",
        notes: "ไม่รับจอง ไปต่อคิวก่อนเปิดรอบเย็น",
        expense: { category: "food" } },
    ],
  },
  {
    date: "2026-11-26", city: "Yanagawa", title: "ยานางาวะ · ล่องเรือ",
    summary: "นั่งเรือท้องแบนในคลองเมืองเก่า กินอุนางิเซโระมุชิ",
    items: [
      { type: "train", title: "Nishitetsu → Yanagawa", subtitle: "ด่วนพิเศษ · 48 นาที",
        location: "Nishitetsu Fukuoka (Tenjin)", lat: 33.5895, lng: 130.3985,
        end_location: "Nishitetsu Yanagawa", end_lat: 33.1630, end_lng: 130.4060,
        from: "09:00", to: "09:48", yen: 8400, status: "confirmed", provider: "Nishitetsu",
        details: { ticket: "Yanagawa Tokumori Kippu ×4 (รวมค่าเรือ + ส่วนลดร้านอาหาร)" },
        expense: { category: "transport" } },
      { type: "activity", title: "ล่องเรือดงโกบุเนะ", subtitle: "70 นาที · คนแจวร้องเพลงพื้นบ้าน",
        location: "Matsuya Wharf, Yanagawa", lat: 33.1638, lng: 130.4030,
        from: "10:30", to: "11:50", yen: 0, status: "confirmed",
        details: { kind: "River boat", included_in: "Tokumori Kippu", tip: "มีผ้าห่มให้ อากาศพฤศจิกายนเย็น" } },
      { type: "restaurant", title: "Wakamatsuya · อุนางิเซโระมุชิ", subtitle: "ปลาไหลนึ่งบนข้าวหุงซีอิ๊ว",
        location: "69 Okinohata-machi, Yanagawa", lat: 33.1615, lng: 130.4008,
        from: "12:15", to: "13:30", yen: 16800, status: "confirmed", code: "WK-1126-4",
        details: { cuisine: "Unagi", note: "จองไว้แล้ว 4 ที่ — ร้านนี้คิวยาวมากวันหยุด" },
        expense: { category: "food" } },
      { type: "activity", title: "บ้านพักตระกูลทาจิบานะ (Ohana)", subtitle: "สวนญี่ปุ่น + เรือนแบบตะวันตก",
        location: "1 Shinhoka-machi, Yanagawa", lat: 33.1602, lng: 130.4022,
        from: "14:00", to: "15:30", yen: 4000, status: "optional",
        expense: { category: "activity" } },
      { type: "train", title: "กลับฟุกุโอกะ", location: "Nishitetsu Yanagawa", lat: 33.1630, lng: 130.4060,
        end_location: "Nishitetsu Fukuoka (Tenjin)", end_lat: 33.5895, end_lng: 130.3985,
        from: "16:10", to: "16:58", yen: 0, status: "confirmed", provider: "Nishitetsu",
        details: { ticket: "อยู่ใน Tokumori Kippu แล้ว" } },
      { type: "shopping", title: "ซื้อของฝากที่ Hakata Deitos", subtitle: "ชั้นของฝากในสถานีฮากาตะ",
        location: "Hakata Station", lat: 33.5898, lng: 130.4207,
        from: "17:30", to: "19:00", yen: 18000, status: "planned",
        details: { list: "Hakata Torimon, เมนไทโกะ, Tokyo Banana เวอร์ชันคิวชู" },
        expense: { category: "shopping" } },
      { type: "free_time", title: "เก็บกระเป๋า / พักผ่อน", location: "The Blossom Hakata Premier",
        lat: 33.5901, lng: 130.4172, from: "20:00", status: "planned" },
    ],
  },
  {
    date: "2026-11-27", city: "Fukuoka", title: "บินกลับกรุงเทพฯ",
    summary: "เช็คเอาต์ นั่งรถไฟใต้ดินไปสนามบิน บินกลับช่วงบ่าย",
    items: [
      { type: "hotel", title: "เช็คเอาต์", location: "The Blossom Hakata Premier", lat: 33.5901, lng: 130.4172,
        from: "09:00", to: "09:30", yen: 0, status: "confirmed" },
      { type: "subway", title: "ฮากาตะ → สนามบินฟุกุโอกะ", subtitle: "5 นาที",
        location: "Hakata Station", lat: 33.5898, lng: 130.4207,
        end_location: "Fukuoka Airport Station", end_lat: 33.5859, end_lng: 130.4507,
        from: "11:00", to: "11:10", yen: 260, status: "confirmed", provider: "Fukuoka City Subway" },
      { type: "flight", title: "TG649 ฟุกุโอกะ → กรุงเทพฯ", subtitle: "Thai Airways · 6 ชม.",
        location: "สนามบินฟุกุโอกะ (FUK)", lat: 33.5859, lng: 130.4507,
        end_location: "สนามบินสุวรรณภูมิ (BKK)", end_lat: 13.6900, end_lng: 100.7501,
        from: "13:40", to: "17:40", yen: 0, status: "confirmed", provider: "Thai Airways",
        code: "TG648-4KQ2M9",
        details: { flight_number: "TG649", seat: "34A / 34B", note: "ตั๋วไป-กลับใบเดียวกับขาไป",
                   tz_note: "FUK +09 → BKK +07" } },
    ],
  },
]

const PARTICIPANTS = [
  { display_name: "ชายนิมิต สาคร", is_host: true,  user_id: USER_ID },
  { display_name: "แนน",           is_host: false },
  { display_name: "โจ้",           is_host: false },
  { display_name: "วิ",            is_host: false },
]

const CHECKLIST = [
  { title: "พาสปอร์ตเหลืออายุเกิน 6 เดือน", category: "documents", is_done: true },
  { title: "ใบขับขี่สากล (IDP) — ต้องมีตัวจริงตอนรับรถ", category: "documents", is_done: true },
  { title: "ประกันเดินทาง ครอบคลุมการขับรถ", category: "documents", is_done: true },
  { title: "จองชินคันเซ็นล่วงหน้า (ที่นั่งระบุ)", category: "booking", is_done: true },
  { title: "Hiroshima Wide Area Pass — รับที่ JR ฮากาตะ", category: "booking", is_done: false },
  { title: "แลกเยนสด ~¥80,000", category: "money", is_done: true },
  { title: "บัตร IC (SUGOCA/ICOCA) หรือใช้ Suica ใน Apple Wallet", category: "money", is_done: false },
  { title: "Pocket WiFi / eSIM 8 วัน", category: "tech", is_done: true },
  { title: "ดาวน์โหลดแผนที่ฮิโรชิมา + ฟุกุโอกะ ไว้ออฟไลน์", category: "tech", is_done: false },
  { title: "เสื้อกันหนาว — พฤศจิกายน 10–17°C", category: "packing", is_done: false },
  { title: "ยาประจำตัว + ใบรับรองแพทย์ภาษาอังกฤษ", category: "packing", is_done: false },
  { title: "เช็กตารางน้ำขึ้นน้ำลงมิยาจิมะอีกรอบก่อนไป", category: "general", is_done: false },
]

/**
 * Every entry states `is_pinned` explicitly.
 *
 * Not redundant: this is inserted as a BATCH, and PostgREST builds one column
 * list from the union of the rows' keys. The first note sets is_pinned, so the
 * column is present for all of them, and the rows that omitted it were sent an
 * explicit NULL rather than falling back to the column default — which the
 * NOT NULL constraint rejected, taking all five notes with it.
 */
const NOTES = [
  { title: "ข้อควรรู้เรื่องรถเช่า", is_pinned: true, tag: "รถเช่า",
    body: "ญี่ปุ่นขับเลนซ้ายเหมือนไทย · ต้องมี IDP ตัวจริง สำเนาไม่ได้ · ETC card ติดรถมาแล้ว ค่าทางด่วนหักตอนคืนรถ · ห้ามดื่มแล้วขับเด็ดขาด โทษหนักมากทั้งคนขับและคนนั่ง" },
  { title: "น้ำขึ้นน้ำลงที่มิยาจิมะ", is_pinned: true, tag: "มิยาจิมะ",
    body: "23 พ.ย. น้ำขึ้นสูงสุด 10:40 — เสาโทริอิลอยน้ำสวยที่สุดช่วง ±2 ชม. รอบนั้น · ถ้าอยากเดินไปถึงตีนเสา ต้องรอน้ำลงบ่ายแก่ๆ" },
  { title: "เบอร์ติดต่อฉุกเฉิน", is_pinned: false, tag: "ฉุกเฉิน",
    body: "ตำรวจ 110 · รถพยาบาล/ดับเพลิง 119 · สถานกงสุลใหญ่ ณ นครโอซากา +81-6-6262-9226 · Japan Visitor Hotline 050-3816-2787 (24 ชม. มีภาษาไทย)" },
  { title: "ของกินที่ต้องไม่พลาด", is_pinned: false, tag: "อาหาร",
    body: "ฟุกุโอกะ: ราเมนทงคตสึ · โมสึนาเบะ · เมนไทโกะ · ยาไตนากาสึ\nฮิโรชิมา: โอโคโนมิยากิใส่เส้น · หอยนางรม (ฤดูพอดี) · อานาโกะเมชิที่มิยาจิมะ\nยานางาวะ: อุนางิเซโระมุชิ" },
  { title: "งบที่ตั้งไว้", is_pinned: false, tag: "งบ",
    body: "ตั้งไว้คนละ ~฿45,000 รวมตั๋วเครื่องบิน · ที่พักกับตั๋วรถไฟจ่ายล่วงหน้าแล้ว เหลือเป็นค่ากินกับของฝากเป็นหลัก" },
]

// ── Build ───────────────────────────────────────────────────────────────────

/** "2026-11-20" + "10:12" → ISO instant, treating the clock as Japan time (+09). */
const jstInstant = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+09:00`).toISOString()

async function main() {
  // Replace any previous run. Scoped to this org AND this title — see the header.
  const { data: existing } = await supabase.from("life_journeys")
    .select("id").eq("organization_id", ORG_ID).eq("title", TITLE)
  for (const j of existing ?? []) {
    await supabase.from("life_journeys").delete().eq("id", j.id)
    console.log(`ลบทริปเดิม ${j.id.slice(0, 8)} แล้ว (seed ซ้ำได้)`)
  }

  const startDate = DAYS[0].date
  const endDate   = DAYS[DAYS.length - 1].date

  const { data: journey, error: jErr } = await supabase.from("life_journeys").insert({
    organization_id: ORG_ID,
    user_id:         USER_ID,
    creator_id:      USER_ID,
    title:           TITLE,
    description:     "8 วันในคิวชูและชูโงกุ ช่วงใบไม้เปลี่ยนสี — ฟุกุโอกะ ฮิโรชิมา มิยาจิมะ โอโนมิจิ ยานางาวะ",
    journey_type:    "trip",
    trip_type:       "travel",
    status:          "active",
    destination:     "Hiroshima & Fukuoka, Japan",
    started_at:      `${startDate}T00:00:00+09:00`,
    ended_at:        `${endDate}T23:59:59+09:00`,
    event_date:      startDate,
    base_currency:   "THB",
    split_mode:      "equal",
    cover_emoji:     "🇯🇵",
    latitude:  34.3853, longitude: 132.4553,   // Hiroshima — where the map opens
    notes: "อัตราแลกเปลี่ยนที่ใช้ทั้งทริป: ¥1 = ฿0.24",
    metadata: { seeded: true, seeded_at: new Date().toISOString(), fx_jpy_thb: JPY },
  }).select("id").single()
  if (jErr) throw new Error(`สร้างทริปไม่สำเร็จ: ${jErr.message}`)
  const journeyId = journey!.id
  console.log(`สร้างทริป ${TITLE}\n  id ${journeyId}\n  org ${ORG_ID} (ส่วนตัว)\n`)

  // Participants
  const { data: parts, error: pErr } = await supabase.from("trip_participants")
    .insert(PARTICIPANTS.map(p => ({ ...p, journey_id: journeyId })))
    .select("id, display_name, is_host")
  if (pErr) throw new Error(`เพิ่มสมาชิกไม่สำเร็จ: ${pErr.message}`)
  const host = parts!.find(p => p.is_host)!
  console.log(`สมาชิก ${parts!.length} คน — เจ้าภาพ ${host.display_name}`)

  let itemCount = 0, expenseCount = 0, totalTHB = 0

  for (const [i, day] of DAYS.entries()) {
    const { data: dayRow, error: dErr } = await supabase.from("trip_itinerary_days").insert({
      journey_id: journeyId,
      day_number: i + 1,
      date:       day.date,
      title:      day.title,
      city:       day.city,
      summary:    day.summary,
    }).select("id").single()
    if (dErr) throw new Error(`สร้างวันที่ ${i + 1} ไม่สำเร็จ: ${dErr.message}`)

    for (const [k, it] of day.items.entries()) {
      const amountTHB = it.yen ? thb(it.yen) : 0

      // The expense first, so the itinerary item can point at it. Only for the
      // things that actually cost money and are worth seeing in the Budget tab.
      let expenseId: string | null = null
      if (it.expense && amountTHB > 0) {
        // `amount` stays in what was actually charged (JPY) and
        // `amount_base_currency` carries the THB figure settlement uses — the
        // convention trip_expenses set in 073 and the itinerary now shares.
        const { data: exp, error: eErr } = await supabase.from("trip_expenses").insert({
          journey_id:   journeyId,
          paid_by_id:   host.id,
          title:        it.title,
          amount:               it.yen!,
          currency:             "JPY",
          exchange_rate:        JPY,
          amount_base_currency: amountTHB,
          category:     it.expense.category,
          split_mode:   "equal",
          note:         it.subtitle ?? null,
          expense_date: day.date,
        }).select("id").single()
        if (eErr) throw new Error(`สร้างค่าใช้จ่าย "${it.title}" ไม่สำเร็จ: ${eErr.message}`)
        expenseId = exp!.id
        expenseCount++

        // Split equally across everyone — what split_mode 'equal' means.
        const share = +(amountTHB / parts!.length).toFixed(2)
        await supabase.from("expense_splits").insert(
          parts!.map(p => ({ expense_id: expenseId, participant_id: p.id, amount: share,
                             is_paid: p.id === host.id })),
        )
      }

      const { error: iErr } = await supabase.from("trip_itinerary_items").insert({
        day_id:     dayRow!.id,
        sort_order: k,
        type:       it.type,
        title:      it.title,
        subtitle:   it.subtitle ?? null,
        location:   it.location ?? null,
        lat: it.lat ?? null, lng: it.lng ?? null,
        end_location: it.end_location ?? null,
        end_lat: it.end_lat ?? null, end_lng: it.end_lng ?? null,
        time_from: it.from ?? null,
        time_to:   it.to ?? null,
        starts_at: it.from ? jstInstant(day.date, it.from) : null,
        ends_at:   it.to   ? jstInstant(day.date, it.to)   : null,
        status:    it.status ?? "planned",
        provider:  it.provider ?? null,
        confirmation_code: it.code ?? null,
        amount:               it.yen ?? 0,
        currency:             it.yen ? "JPY" : "THB",
        exchange_rate:        it.yen ? JPY : 1,
        amount_base_currency: amountTHB,
        notes:     it.notes ?? null,
        details:   it.details ?? {},
        expense_id: expenseId,
      })
      if (iErr) throw new Error(`สร้างรายการ "${it.title}" ไม่สำเร็จ: ${iErr.message}`)
      itemCount++
      totalTHB += amountTHB
    }
    console.log(`  วันที่ ${i + 1} · ${day.date} · ${day.city.padEnd(9)} ${day.items.length} รายการ`)
  }

  // Checked, not fired-and-forgotten. These two were unchecked at first and the
  // notes insert failed silently for an entire run — the seed reported "โน้ต 5"
  // because it counted the array it tried to write, not the rows that landed,
  // and the gap only surfaced when a PDF came out with no notes in it. Counting
  // your own intentions is not a check.
  const { error: cErr } = await supabase.from("trip_checklist_items").insert(
    CHECKLIST.map((c, i) => ({ ...c, journey_id: journeyId, sort_order: i,
                               done_at: c.is_done ? new Date().toISOString() : null })),
  )
  if (cErr) throw new Error(`สร้าง checklist ไม่สำเร็จ: ${cErr.message}`)

  const { error: nErr } = await supabase.from("trip_notes").insert(
    NOTES.map(n => ({ ...n, journey_id: journeyId, created_by: host.id })),
  )
  if (nErr) throw new Error(`สร้างโน้ตไม่สำเร็จ: ${nErr.message}`)

  // Participant balances — what the trip list and the Budget tab total.
  const share = +(totalTHB / parts!.length).toFixed(2)
  for (const p of parts!) {
    await supabase.from("trip_participants").update({
      amount_owed: share,
      amount_paid: p.id === host.id ? totalTHB : 0,
    }).eq("id", p.id)
  }
  await supabase.from("life_journeys").update({ total_spent: totalTHB }).eq("id", journeyId)

  // Read the counts back from the database. What was sent and what was stored
  // are different questions, and only the second one matters.
  const [{ count: checkRows }, { count: noteRows }, { count: itemRows }] = await Promise.all([
    supabase.from("trip_checklist_items").select("*", { count: "exact", head: true }).eq("journey_id", journeyId),
    supabase.from("trip_notes").select("*", { count: "exact", head: true }).eq("journey_id", journeyId),
    supabase.from("trip_expenses").select("*", { count: "exact", head: true }).eq("journey_id", journeyId),
  ])
  console.log(`\nรายการทั้งหมด ${itemCount} · ค่าใช้จ่าย ${itemRows} รายการ`)
  console.log(`Checklist ${checkRows}/${CHECKLIST.length} · โน้ต ${noteRows}/${NOTES.length}`)
  if (checkRows !== CHECKLIST.length || noteRows !== NOTES.length || itemRows !== expenseCount) {
    throw new Error("จำนวนแถวที่บันทึกได้ไม่ตรงกับที่ตั้งใจเขียน — ตรวจสอบก่อนใช้ข้อมูลนี้")
  }
  console.log(`ยอดรวม ฿${totalTHB.toLocaleString("th-TH", { minimumFractionDigits: 2 })} · คนละ ฿${share.toLocaleString("th-TH")}`)
  console.log(`\nเปิดดูที่ /trips/${journeyId}`)
}

await main()
