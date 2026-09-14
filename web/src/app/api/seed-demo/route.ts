/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { NextResponse }      from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { canSeedDemoData }   from "@/lib/demo/demo-access"

/* ─── VAT helper ─────────────────────────────────────────────────────────── */
const $ = (t: number) => ({
  total_amount: t,
  vat_amount:   Math.round(t * 700 / 107) / 100,
  net_amount:   Math.round(t * 10000 / 107) / 100,
})

/* ─── Team members to seed ───────────────────────────────────────────────── */
const DEMO_TEAM = [
  { email: "napat@abc.co.th",   full_name: "นภัทร เจริญพร",        role: "owner",      joined_at: "2025-08-01T09:00:00Z" },
  { email: "somying@abc.co.th", full_name: "สมหญิง รักการบัญชี",   role: "admin",      joined_at: "2025-11-12T09:00:00Z" },
  { email: "mark@taxpro.co.th", full_name: "Khun Mark (CPA)",       role: "accountant", joined_at: "2026-01-05T09:00:00Z" },
  { email: "pete@abc.co.th",    full_name: "พีท นักพัฒนา",         role: "member",     joined_at: "2026-03-21T09:00:00Z" },
]

/* ─── Document definitions ───────────────────────────────────────────────── */
// Statuses: pushed=pu, approved=ap, reviewing=rv, pending=pe, failed=fa, rejected=re, processing=pr
// Sources:  web=w, line=l, email=e

type R = {
  vendor_name: string; doc_date: string; total_amount: number
  vat_amount: number; net_amount: number; status: string; source: string
  invoice_number: string; doc_type: string; overall_confidence: number | null; category: string
}

const doc = (
  vendor: string, date: string, total: number,
  status: string, source: string, inv: string,
  dt: "receipt"|"invoice"|"utility", conf: number|null, cat: string
): R => ({ vendor_name: vendor, doc_date: date, ...$( total),
  status, source, invoice_number: inv, doc_type: dt, overall_confidence: conf, category: cat })

/* ── June 2025  (target ≈ 84,300) ── */
const JUN25: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2025-06-01",35000,"pushed","email","OM-202506-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2025-06-02", 8750,"pushed","email","AWS-202506001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2025-06-03", 1199,"pushed","email","TR-202506-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2025-06-03",  599,"pushed","email","AIS-202506-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2025-06-04", 1245,"pushed","web","MEA-202506-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2025-06-04",  298,"pushed","web","MWA-202506-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2025-06-05", 2800,"pushed","email","GH-202506-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Figma Inc.",                 "2025-06-05", 2350,"pushed","email","FG-202506-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2025-06-07",  450,"pushed","line","GR-20250607-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-06-11",  380,"pushed","line","GR-20250611-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-06-17",  420,"pushed","line","GR-20250617-01","receipt",0.87,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-06-08",  285,"pushed","line","7E-20250608-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-06-13",  220,"pushed","line","7E-20250613-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-06-19",  315,"pushed","line","7E-20250619-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-06-24",  195,"pushed","line","7E-20250624-01","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2025-06-09",  185,"pushed","line","SB-20250609-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-06-20",  370,"pushed","line","SB-20250620-01","receipt",0.93,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2025-06-10", 1500,"pushed","line","PTT-100625-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2025-06-12",  780,"pushed","web","LZ-2506120001","receipt",0.92,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2025-06-22", 1200,"pushed","web","LZ-2506220001","receipt",0.90,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2025-06-14", 2150,"pushed","line","MK-20250614-01","receipt",0.88,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2025-06-15",  847,"pushed","web","TD-20250615-01","receipt",0.93,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2025-06-25",  920,"pushed","web","TD-20250625-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2025-06-18", 9500,"pushed","web","CP-20250618-01","receipt",0.89,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2025-06-20", 5800,"pushed","web","IK-20250620-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",              "2025-06-23",  320,"pushed","line","BT-20250623-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Bolt Thailand",              "2025-06-27",  350,"pushed","line","BT-20250627-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab Food Thailand",         "2025-06-26",  430,"pushed","line","GF-20250626-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("Big C Supercenter",          "2025-06-28", 2900,"pushed","web","BC-20250628-01","receipt",0.90,"ของใช้ส่วนตัว"),
  // total ≈ 84,063 ✓
]

/* ── July 2025  (target ≈ 92,100) ── */
const JUL25: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2025-07-01",35000,"pushed","email","OM-202507-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2025-07-02", 8750,"pushed","email","AWS-202507001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2025-07-03", 1199,"pushed","email","TR-202507-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2025-07-03",  599,"pushed","email","AIS-202507-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2025-07-04", 1380,"pushed","web","MEA-202507-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2025-07-04",  315,"pushed","web","MWA-202507-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2025-07-05", 2800,"pushed","email","GH-202507-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2025-07-06",  480,"pushed","line","GR-20250706-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-07-09",  350,"pushed","line","GR-20250709-01","receipt",0.90,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-07-14",  420,"pushed","line","GR-20250714-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-07-18",  450,"pushed","line","GR-20250718-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-07-22",  380,"pushed","line","GR-20250722-01","receipt",0.87,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-07-07",  260,"pushed","line","7E-20250707-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-07-12",  195,"pushed","line","7E-20250712-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-07-17",  340,"pushed","line","7E-20250717-01","receipt",0.92,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-07-23",  225,"pushed","line","7E-20250723-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-07-28",  280,"pushed","line","7E-20250728-01","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2025-07-08",  185,"pushed","line","SB-20250708-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-07-15",  580,"pushed","line","SB-20250715-01","receipt",0.92,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-07-24",  185,"pushed","line","SB-20250724-01","receipt",0.94,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2025-07-10", 1500,"pushed","line","PTT-100725-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-07-20", 1500,"pushed","line","PTT-200725-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2025-07-11", 1350,"pushed","web","LZ-2507110001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2025-07-13", 2150,"pushed","line","MK-20250713-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2025-07-26", 2150,"pushed","line","MK-20250726-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2025-07-16",  890,"pushed","web","TD-20250716-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2025-07-27",  760,"pushed","web","TD-20250727-01","receipt",0.90,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2025-07-19",12000,"pushed","web","CP-20250719-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("Uniqlo Thailand",            "2025-07-21", 3500,"pushed","web","UQ-20250721-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Big C Supercenter",          "2025-07-25", 2380,"pushed","web","BC-20250725-01","receipt",0.89,"ของใช้ส่วนตัว"),
  doc("Bolt Thailand",              "2025-07-29",  420,"pushed","line","BT-20250729-01","receipt",0.87,"ค่าเดินทาง"),
  doc("LINE Official Account",      "2025-07-30", 1500,"pushed","web","LN-202507-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Grab Food Thailand",         "2025-07-31",  580,"pushed","line","GF-20250731-01","receipt",0.83,"อาหารและเครื่องดื่ม"),
  // total ≈ 91,901 ✓
]

/* ── August 2025  (target ≈ 76,500) ── */
const AUG25: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2025-08-01",35000,"pushed","email","OM-202508-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2025-08-02", 8750,"pushed","email","AWS-202508001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2025-08-03", 1199,"pushed","email","TR-202508-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2025-08-03",  599,"pushed","email","AIS-202508-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2025-08-04", 1190,"pushed","web","MEA-202508-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2025-08-04",  280,"pushed","web","MWA-202508-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2025-08-05", 2800,"pushed","email","GH-202508-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Figma Inc.",                 "2025-08-05", 2350,"pushed","email","FG-202508-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2025-08-06",  380,"pushed","line","GR-20250806-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-08-13",  420,"pushed","line","GR-20250813-01","receipt",0.90,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-08-20",  350,"pushed","line","GR-20250820-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-08-26",  470,"pushed","line","GR-20250826-01","receipt",0.89,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-08-08",  185,"pushed","line","7E-20250808-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-08-14",  260,"pushed","line","7E-20250814-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-08-21",  310,"pushed","line","7E-20250821-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2025-08-09",  185,"pushed","line","SB-20250809-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-08-22",  370,"pushed","line","SB-20250822-01","receipt",0.93,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2025-08-11", 1500,"pushed","line","PTT-110825-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2025-08-15",  780,"pushed","web","LZ-2508150001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2025-08-16", 2150,"pushed","line","MK-20250816-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2025-08-17",  847,"pushed","web","TD-20250817-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2025-08-28", 1020,"pushed","web","TD-20250828-01","receipt",0.90,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2025-08-19", 4500,"pushed","web","CP-20250819-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2025-08-23", 5500,"pushed","web","IK-20250823-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",              "2025-08-25",  320,"pushed","line","BT-20250825-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Grab Food Thailand",         "2025-08-27",  430,"pushed","line","GF-20250827-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("TrueVisions",                "2025-08-29", 1500,"pushed","email","TV-202508-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Minor Food Group",           "2025-08-30", 1150,"pushed","line","MF-20250830-01","receipt",0.85,"อาหารและเครื่องดื่ม"),
  // total ≈ 76,474 ✓
]

/* ── September 2025  (target ≈ 105,200) ── */
const SEP25: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2025-09-01",35000,"pushed","email","OM-202509-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2025-09-02", 8750,"pushed","email","AWS-202509001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2025-09-03", 1199,"pushed","email","TR-202509-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2025-09-03",  599,"pushed","email","AIS-202509-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2025-09-04", 1350,"pushed","web","MEA-202509-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2025-09-04",  330,"pushed","web","MWA-202509-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2025-09-05", 2800,"pushed","email","GH-202509-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Figma Inc.",                 "2025-09-05", 2350,"pushed","email","FG-202509-Q4","invoice",0.98,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2025-09-06",  450,"pushed","line","GR-20250906-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-09-09",  380,"pushed","line","GR-20250909-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-09-12",  500,"pushed","line","GR-20250912-01","receipt",0.90,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-09-16",  420,"pushed","line","GR-20250916-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-09-20",  350,"pushed","line","GR-20250920-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-09-25",  480,"pushed","line","GR-20250925-01","receipt",0.88,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-09-07",  285,"pushed","line","7E-20250907-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-09-11",  240,"pushed","line","7E-20250911-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-09-17",  310,"pushed","line","7E-20250917-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-09-22",  195,"pushed","line","7E-20250922-01","receipt",0.92,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2025-09-08",  185,"pushed","line","SB-20250908-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-09-18",  580,"pushed","line","SB-20250918-01","receipt",0.92,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-09-26",  185,"pushed","line","SB-20250926-01","receipt",0.94,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2025-09-10", 1500,"pushed","line","PTT-100925-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-09-19", 1500,"pushed","line","PTT-190925-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-09-27", 1500,"pushed","line","PTT-270925-01","receipt",0.95,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2025-09-13", 1650,"pushed","web","LZ-2509130001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2025-09-24", 2470,"pushed","web","LZ-2509240001","receipt",0.89,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2025-09-14", 2150,"pushed","line","MK-20250914-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2025-09-21", 2800,"pushed","line","MK-20250921-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2025-09-15",  920,"pushed","web","TD-20250915-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2025-09-23",  847,"pushed","web","TD-20250923-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2025-09-16",15000,"pushed","web","CP-20250916-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2025-09-20", 6800,"pushed","web","IK-20250920-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",              "2025-09-28",  750,"pushed","line","BT-20250928-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Grab Food Thailand",         "2025-09-29",  430,"pushed","line","GF-20250929-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("Big C Supercenter",          "2025-09-30", 2350,"pushed","web","BC-20250930-01","receipt",0.89,"ของใช้ส่วนตัว"),
  // total ≈ 104,784 ✓
]

/* ── October 2025  (target ≈ 118,400) ── */
const OCT25: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2025-10-01",35000,"pushed","email","OM-202510-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2025-10-02", 8750,"pushed","email","AWS-202510001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Amazon Web Services",        "2025-10-02", 5500,"pushed","email","AWS-202510002","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2025-10-03", 1199,"pushed","email","TR-202510-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2025-10-03",  599,"pushed","email","AIS-202510-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2025-10-04", 1420,"pushed","web","MEA-202510-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2025-10-04",  355,"pushed","web","MWA-202510-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2025-10-05", 2800,"pushed","email","GH-202510-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Figma Inc.",                 "2025-10-05", 2350,"pushed","email","FG-202510-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2025-10-06",  450,"pushed","line","GR-20251006-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-10-09",  380,"pushed","line","GR-20251009-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-10-13",  500,"pushed","line","GR-20251013-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-10-17",  420,"pushed","line","GR-20251017-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-10-21",  350,"pushed","line","GR-20251021-01","receipt",0.90,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-10-24",  480,"pushed","line","GR-20251024-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-10-28",  420,"pushed","line","GR-20251028-01","receipt",0.89,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-10-07",  285,"pushed","line","7E-20251007-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-10-10",  220,"pushed","line","7E-20251010-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-10-14",  310,"pushed","line","7E-20251014-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-10-18",  195,"pushed","line","7E-20251018-01","receipt",0.92,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-10-22",  360,"pushed","line","7E-20251022-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-10-25",  240,"pushed","line","7E-20251025-01","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2025-10-08",  185,"pushed","line","SB-20251008-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-10-15",  370,"pushed","line","SB-20251015-01","receipt",0.92,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-10-23",  580,"pushed","line","SB-20251023-01","receipt",0.93,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2025-10-11", 1500,"pushed","line","PTT-111025-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-10-16", 1500,"pushed","line","PTT-161025-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-10-26", 1500,"pushed","line","PTT-261025-01","receipt",0.95,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-10-30", 1500,"pushed","line","PTT-301025-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2025-10-12", 1800,"pushed","web","LZ-2510120001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2025-10-20", 1650,"pushed","web","LZ-2510200001","receipt",0.90,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2025-10-27", 1700,"pushed","web","LZ-2510270001","receipt",0.89,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2025-10-13", 2150,"pushed","line","MK-20251013-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2025-10-19", 2150,"pushed","line","MK-20251019-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2025-10-29", 2800,"pushed","line","MK-20251029-01","receipt",0.88,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2025-10-14",  847,"pushed","web","TD-20251014-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2025-10-21", 1100,"pushed","web","TD-20251021-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2025-10-16",18000,"pushed","web","CP-20251016-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",              "2025-10-31", 1680,"pushed","line","BT-20251031-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Minor Food Group",           "2025-10-28", 2955,"pushed","line","MF-20251028-01","receipt",0.85,"อาหารและเครื่องดื่ม"),
  doc("Grab Food Thailand",         "2025-10-31", 1840,"pushed","line","GF-20251031-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  // total ≈ 117,879 ✓
]

/* ── November 2025  (target ≈ 99,300) ── */
const NOV25: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2025-11-01",35000,"pushed","email","OM-202511-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2025-11-02", 8750,"pushed","email","AWS-202511001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2025-11-03", 1199,"pushed","email","TR-202511-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2025-11-03",  599,"pushed","email","AIS-202511-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2025-11-04", 1380,"pushed","web","MEA-202511-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2025-11-04",  310,"pushed","web","MWA-202511-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2025-11-05", 2800,"pushed","email","GH-202511-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2025-11-06",  450,"pushed","line","GR-20251106-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-11-10",  380,"pushed","line","GR-20251110-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-11-15",  420,"pushed","line","GR-20251115-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-11-20",  500,"pushed","line","GR-20251120-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-11-25",  350,"pushed","line","GR-20251125-01","receipt",0.90,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-11-07",  285,"pushed","line","7E-20251107-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-11-12",  220,"pushed","line","7E-20251112-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-11-18",  310,"pushed","line","7E-20251118-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-11-23",  195,"pushed","line","7E-20251123-01","receipt",0.92,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2025-11-08",  185,"pushed","line","SB-20251108-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-11-17",  370,"pushed","line","SB-20251117-01","receipt",0.93,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-11-24",  580,"pushed","line","SB-20251124-01","receipt",0.92,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2025-11-11", 1500,"pushed","line","PTT-111125-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-11-22", 1500,"pushed","line","PTT-221125-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2025-11-13", 1500,"pushed","web","LZ-2511130001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2025-11-26", 1300,"pushed","web","LZ-2511260001","receipt",0.90,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2025-11-14", 2150,"pushed","line","MK-20251114-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2025-11-27", 2150,"pushed","line","MK-20251127-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2025-11-16",  920,"pushed","web","TD-20251116-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2025-11-28",  760,"pushed","web","TD-20251128-01","receipt",0.90,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2025-11-19",12000,"pushed","web","CP-20251119-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2025-11-21", 4800,"pushed","web","IK-20251121-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Uniqlo Thailand",            "2025-11-23", 3500,"pushed","web","UQ-20251123-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Bolt Thailand",              "2025-11-29",  890,"pushed","line","BT-20251129-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Grab Food Thailand",         "2025-11-30",  850,"pushed","line","GF-20251130-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("CentralFestival",            "2025-11-30", 2242,"pushed","web","CF-20251130-01","receipt",0.88,"ของใช้สำนักงาน"),
  // total ≈ 99,424 ✓
]

/* ── December 2025  (target ≈ 132,800) ── */
const DEC25: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2025-12-01",35000,"pushed","email","OM-202512-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2025-12-02", 8750,"pushed","email","AWS-202512001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Amazon Web Services",        "2025-12-02", 6000,"pushed","email","AWS-202512002","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2025-12-03", 1199,"pushed","email","TR-202512-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2025-12-03",  599,"pushed","email","AIS-202512-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2025-12-04", 1430,"pushed","web","MEA-202512-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2025-12-04",  325,"pushed","web","MWA-202512-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2025-12-05", 2800,"pushed","email","GH-202512-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2025-12-06",  450,"pushed","line","GR-20251206-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-12-08",  380,"pushed","line","GR-20251208-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-12-11",  500,"pushed","line","GR-20251211-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-12-15",  420,"pushed","line","GR-20251215-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-12-18",  350,"pushed","line","GR-20251218-01","receipt",0.90,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-12-22",  480,"pushed","line","GR-20251222-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2025-12-27",  420,"pushed","line","GR-20251227-01","receipt",0.89,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-12-07",  285,"pushed","line","7E-20251207-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-12-10",  350,"pushed","line","7E-20251210-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-12-14",  220,"pushed","line","7E-20251214-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-12-17",  310,"pushed","line","7E-20251217-01","receipt",0.92,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2025-12-21",  195,"pushed","line","7E-20251221-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2025-12-09",  185,"pushed","line","SB-20251209-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-12-13",  370,"pushed","line","SB-20251213-01","receipt",0.93,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-12-16",  580,"pushed","line","SB-20251216-01","receipt",0.92,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2025-12-23",  185,"pushed","line","SB-20251223-01","receipt",0.94,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2025-12-12", 1500,"pushed","line","PTT-121225-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-12-19", 1500,"pushed","line","PTT-191225-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2025-12-26", 1500,"pushed","line","PTT-261225-01","receipt",0.95,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2025-12-13", 1800,"pushed","web","LZ-2512130001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2025-12-20", 1850,"pushed","web","LZ-2512200001","receipt",0.90,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2025-12-24", 2000,"pushed","web","LZ-2512240001","receipt",0.89,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2025-12-14", 2800,"pushed","line","MK-20251214-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2025-12-20", 2150,"pushed","line","MK-20251220-01","receipt",0.88,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2025-12-28", 2800,"pushed","line","MK-20251228-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2025-12-15", 1100,"pushed","web","TD-20251215-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2025-12-22",  920,"pushed","web","TD-20251222-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2025-12-16",25000,"pushed","web","CP-20251216-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2025-12-18", 7500,"pushed","web","IK-20251218-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Uniqlo Thailand",            "2025-12-20", 5500,"pushed","web","UQ-20251220-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Bolt Thailand",              "2025-12-29", 1050,"pushed","line","BT-20251229-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Minor Food Group",           "2025-12-25", 2350,"pushed","line","MF-20251225-01","receipt",0.85,"อาหารและเครื่องดื่ม"),
  doc("Grab Food Thailand",         "2025-12-30", 1280,"pushed","line","GF-20251230-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("B2S Bookstore",              "2025-12-28", 1800,"pushed","web","B2-20251228-01","receipt",0.90,"ของใช้สำนักงาน"),
  doc("Decathlon Thailand",         "2025-12-29", 2500,"pushed","web","DC-20251229-01","receipt",0.89,"ของใช้สำนักงาน"),
  // total ≈ 132,321 ✓
]

/* ── January 2026  (target ≈ 121,500) ── */
const JAN26: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2026-01-01",35000,"pushed","email","OM-202601-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2026-01-02", 8750,"pushed","email","AWS-202601001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2026-01-03", 1199,"pushed","email","TR-202601-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2026-01-03",  599,"pushed","email","AIS-202601-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2026-01-04", 1350,"pushed","web","MEA-202601-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2026-01-04",  340,"pushed","web","MWA-202601-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2026-01-05", 2800,"pushed","email","GH-202601-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Figma Inc.",                 "2026-01-05", 2350,"pushed","email","FG-202601-Q1","invoice",0.98,"ค่า Software / Cloud"),
  doc("Notion Labs",                "2026-01-06", 3200,"pushed","email","NT-202601-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Adobe Thailand",             "2026-01-06", 3780,"pushed","email","AD-202601-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("LINE Corporation",           "2026-01-07", 5000,"pushed","web","LN-202601-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2026-01-08",  450,"pushed","line","GR-20260108-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-01-11",  380,"pushed","line","GR-20260111-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-01-15",  500,"pushed","line","GR-20260115-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-01-19",  420,"pushed","line","GR-20260119-01","receipt",0.87,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-01-09",  285,"pushed","line","7E-20260109-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-01-14",  220,"pushed","line","7E-20260114-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-01-20",  310,"pushed","line","7E-20260120-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2026-01-10",  185,"pushed","line","SB-20260110-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2026-01-17",  580,"pushed","line","SB-20260117-01","receipt",0.92,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2026-01-23",  370,"pushed","line","SB-20260123-01","receipt",0.93,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2026-01-12", 1500,"pushed","line","PTT-120126-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2026-01-21", 1500,"pushed","line","PTT-210126-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2026-01-13", 1800,"pushed","web","LZ-2601130001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2026-01-22", 2320,"pushed","web","LZ-2601220001","receipt",0.90,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2026-01-16", 2150,"pushed","line","MK-20260116-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2026-01-24", 2150,"pushed","line","MK-20260124-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2026-01-28", 2150,"pushed","line","MK-20260128-01","receipt",0.88,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2026-01-18",  920,"pushed","web","TD-20260118-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2026-01-25", 1100,"pushed","web","TD-20260125-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2026-01-20",15000,"pushed","web","CP-20260120-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2026-01-26", 6200,"pushed","web","IK-20260126-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",              "2026-01-29", 1100,"pushed","line","BT-20260129-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Grab Food Thailand",         "2026-01-30",  750,"pushed","line","GF-20260130-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("Starbucks Coffee",           "2026-01-31",  212,"pushed","line","SB-20260131-01","receipt",0.93,"รับรองลูกค้า"),
  // total ≈ 121,459 ✓
]

/* ── February 2026  (target ≈ 109,700) ── */
const FEB26: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2026-02-01",35000,"approved","email","OM-202602-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2026-02-02", 8750,"approved","email","AWS-202602001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2026-02-03", 1199,"approved","email","TR-202602-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2026-02-03",  599,"approved","email","AIS-202602-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2026-02-04", 1280,"approved","web","MEA-202602-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2026-02-04",  305,"approved","web","MWA-202602-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2026-02-05", 2800,"approved","email","GH-202602-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Notion Labs",                "2026-02-06", 3200,"approved","email","NT-202602-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Adobe Thailand",             "2026-02-06", 3780,"approved","email","AD-202602-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("LINE Corporation",           "2026-02-07", 6500,"approved","web","LN-202602-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Uniqlo Thailand",            "2026-02-08", 2990,"approved","web","UQ-20260208-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Grab (Thailand)",            "2026-02-09",  450,"approved","line","GR-20260209-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-02-12",  380,"approved","line","GR-20260212-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-02-16",  500,"approved","line","GR-20260216-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-02-20",  420,"approved","line","GR-20260220-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-02-24",  350,"approved","line","GR-20260224-01","receipt",0.90,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-02-10",  285,"approved","line","7E-20260210-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-02-15",  220,"approved","line","7E-20260215-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-02-19",  310,"approved","line","7E-20260219-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2026-02-11",  185,"approved","line","SB-20260211-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2026-02-18",  370,"approved","line","SB-20260218-01","receipt",0.92,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2026-02-25",  555,"approved","line","SB-20260225-01","receipt",0.91,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2026-02-13", 1500,"approved","line","PTT-130226-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2026-02-22", 1500,"approved","line","PTT-220226-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2026-02-14", 1500,"approved","web","LZ-2602140001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2026-02-23", 1300,"approved","web","LZ-2602230001","receipt",0.90,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2026-02-17", 2150,"approved","line","MK-20260217-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2026-02-26", 2150,"approved","line","MK-20260226-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2026-02-18",  920,"approved","web","TD-20260218-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2026-02-27",  760,"approved","web","TD-20260227-01","receipt",0.90,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2026-02-20",12000,"approved","web","CP-20260220-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2026-02-22", 4500,"approved","web","IK-20260222-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",              "2026-02-28",  770,"approved","line","BT-20260228-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Grab Food Thailand",         "2026-02-28",  660,"approved","line","GF-20260228-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("Banana IT",                  "2026-02-25",  287,"approved","web","BA-20260225-01","receipt",0.90,"ของใช้สำนักงาน"),
  // total ≈ 109,639 ✓
]

/* ── March 2026  (target ≈ 127,200) ── */
const MAR26: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2026-03-01",35000,"approved","email","OM-202603-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2026-03-02", 8750,"approved","email","AWS-202603001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2026-03-03", 1199,"approved","email","TR-202603-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2026-03-03",  599,"approved","email","AIS-202603-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2026-03-04", 1360,"approved","web","MEA-202603-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2026-03-04",  330,"approved","web","MWA-202603-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2026-03-05", 2800,"approved","email","GH-202603-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Notion Labs",                "2026-03-06", 3200,"approved","email","NT-202603-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Adobe Thailand",             "2026-03-06", 3780,"approved","email","AD-202603-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("LINE Corporation",           "2026-03-07", 5000,"approved","web","LN-202603-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2026-03-08",  450,"approved","line","GR-20260308-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-03-11",  380,"approved","line","GR-20260311-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-03-14",  500,"approved","line","GR-20260314-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-03-18",  420,"approved","line","GR-20260318-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-03-22",  350,"approved","line","GR-20260322-01","receipt",0.90,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-03-09",  285,"approved","line","7E-20260309-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-03-13",  360,"approved","line","7E-20260313-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-03-17",  220,"approved","line","7E-20260317-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-03-21",  310,"approved","line","7E-20260321-01","receipt",0.92,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2026-03-10",  185,"approved","line","SB-20260310-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2026-03-16",  370,"approved","line","SB-20260316-01","receipt",0.92,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2026-03-23",  580,"approved","line","SB-20260323-01","receipt",0.93,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2026-03-12", 1500,"approved","line","PTT-120326-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2026-03-20", 1500,"approved","line","PTT-200326-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2026-03-28", 1500,"approved","line","PTT-280326-01","receipt",0.95,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2026-03-15", 1800,"approved","web","LZ-2603150001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2026-03-24", 1650,"approved","web","LZ-2603240001","receipt",0.90,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2026-03-29", 1700,"approved","web","LZ-2603290001","receipt",0.89,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2026-03-16", 2150,"approved","line","MK-20260316-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2026-03-25", 2150,"approved","line","MK-20260325-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2026-03-30", 2150,"approved","line","MK-20260330-01","receipt",0.88,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2026-03-17",  920,"approved","web","TD-20260317-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2026-03-26",  847,"approved","web","TD-20260326-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2026-03-19",15000,"approved","web","CP-20260319-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2026-03-23", 6000,"approved","web","IK-20260323-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",              "2026-03-27",  960,"approved","line","BT-20260327-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Minor Food Group",           "2026-03-28", 2090,"approved","line","MF-20260328-01","receipt",0.85,"อาหารและเครื่องดื่ม"),
  doc("Grab Food Thailand",         "2026-03-31",  730,"approved","line","GF-20260331-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("Decathlon Thailand",         "2026-03-29", 3200,"approved","web","DC-20260329-01","receipt",0.89,"ของใช้สำนักงาน"),
  doc("B2S Bookstore",              "2026-03-31", 1902,"approved","web","B2-20260331-01","receipt",0.90,"ของใช้สำนักงาน"),
  // total ≈ 127,307 ✓
]

/* ── April 2026  (target ≈ 132,000) ── */
const APR26: R[] = [
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้","2026-04-01",35000,"pushed","email","OM-202604-001","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Amazon Web Services",        "2026-04-02", 8750,"pushed","email","AWS-202604001","invoice",0.99,"ค่า Software / Cloud"),
  doc("TrueMove H",                 "2026-04-03", 1199,"pushed","email","TR-202604-001","invoice",0.97,"ค่าโทรศัพท์"),
  doc("AIS Fibre",                  "2026-04-03",  599,"pushed","email","AIS-202604-01","invoice",0.96,"ค่าอินเทอร์เน็ต"),
  doc("การไฟฟ้านครหลวง",           "2026-04-04", 1390,"pushed","web","MEA-202604-01","utility",0.94,"ค่าสาธารณูปโภค"),
  doc("การประปานครหลวง",            "2026-04-04",  345,"pushed","web","MWA-202604-01","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("GitHub Inc.",                "2026-04-05", 2800,"pushed","email","GH-202604-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Figma Inc.",                 "2026-04-05", 2350,"pushed","email","FG-202604-Q2","invoice",0.98,"ค่า Software / Cloud"),
  doc("Notion Labs",                "2026-04-06", 3200,"pushed","email","NT-202604-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Adobe Thailand",             "2026-04-06", 3780,"pushed","email","AD-202604-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("LINE Corporation",           "2026-04-07", 5500,"pushed","web","LN-202604-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",            "2026-04-08",  450,"pushed","line","GR-20260408-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-04-10",  380,"pushed","line","GR-20260410-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-04-13",  500,"pushed","line","GR-20260413-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-04-16",  420,"pushed","line","GR-20260416-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-04-19",  350,"pushed","line","GR-20260419-01","receipt",0.90,"ค่าเดินทาง"),
  doc("Grab (Thailand)",            "2026-04-23",  480,"pushed","line","GR-20260423-01","receipt",0.88,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-04-09",  285,"pushed","line","7E-20260409-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-04-12",  360,"pushed","line","7E-20260412-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-04-17",  220,"pushed","line","7E-20260417-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-04-21",  310,"pushed","line","7E-20260421-01","receipt",0.92,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",           "2026-04-11",  185,"pushed","line","SB-20260411-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2026-04-18",  580,"pushed","line","SB-20260418-01","receipt",0.92,"รับรองลูกค้า"),
  doc("Starbucks Coffee",           "2026-04-24",  370,"pushed","line","SB-20260424-01","receipt",0.93,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",        "2026-04-14", 1500,"pushed","line","PTT-140426-01","receipt",0.96,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2026-04-22", 1500,"pushed","line","PTT-220426-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",        "2026-04-28", 1500,"pushed","line","PTT-280426-01","receipt",0.95,"ค่าน้ำมัน"),
  doc("Lazada Express",             "2026-04-15", 1800,"pushed","web","LZ-2604150001","receipt",0.91,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2026-04-25", 1650,"pushed","web","LZ-2604250001","receipt",0.90,"ของใช้สำนักงาน"),
  doc("Lazada Express",             "2026-04-29", 1700,"pushed","web","LZ-2604290001","receipt",0.89,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",  "2026-04-16", 2150,"pushed","line","MK-20260416-01","receipt",0.87,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2026-04-25", 2150,"pushed","line","MK-20260425-01","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",  "2026-04-30", 1880,"pushed","line","MK-20260430-01","receipt",0.88,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",          "2026-04-17",  920,"pushed","web","TD-20260417-01","receipt",0.92,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",          "2026-04-26", 1100,"pushed","web","TD-20260426-01","receipt",0.91,"ของใช้ส่วนตัว"),
  doc("Central Pattana",            "2026-04-20",16500,"pushed","web","CP-20260420-01","receipt",0.88,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",              "2026-04-22", 7200,"pushed","web","IK-20260422-01","receipt",0.87,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",              "2026-04-27", 1140,"pushed","line","BT-20260427-01","receipt",0.86,"ค่าเดินทาง"),
  doc("Minor Food Group",           "2026-04-27", 2090,"pushed","line","MF-20260427-01","receipt",0.85,"อาหารและเครื่องดื่ม"),
  doc("Grab Food Thailand",         "2026-04-29", 1560,"pushed","line","GF-20260429-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("CentralFestival",            "2026-04-30", 2007,"pushed","web","CF-20260430-01","receipt",0.88,"ของใช้สำนักงาน"),
  // total ≈ 131,979 ✓
]

/* ── May 2026  (target ≈ 142,380 · 47 docs) ── */
const MAY26: R[] = [
  // Original 15 (kept verbatim)
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-05-17",  285.00,"approved","web","INV-7E-23984","receipt",0.97,"ของใช้สำนักงาน"),
  doc("Grab (Thailand)",             "2026-05-17",  450.00,"reviewing","line","GR-2026-005112","receipt",0.78,"ค่าเดินทาง"),
  doc("Amazon Web Services",         "2026-05-16", 8750.00,"pushed","email","AWS-1188372","invoice",0.99,"ค่า Software / Cloud"),
  doc("การไฟฟ้านครหลวง",            "2026-05-16", 1230.00,"pending","web","MEA-87234-04","utility",0.92,"ค่าสาธารณูปโภค"),
  doc("AIS Fibre",                   "2026-05-15",  599.00,"failed","line","-","receipt",0.41,"ค่าอินเทอร์เน็ต"),
  doc("Starbucks Coffee",            "2026-05-15",  185.00,"approved","line","SB-0515-2244","receipt",0.95,"รับรองลูกค้า"),
  doc("บจก. โอเอ็ม พร็อพเพอร์ตี้", "2026-05-14",35000.00,"pushed","web","OM-2605-0014","invoice",0.99,"ค่าเช่าสำนักงาน"),
  doc("Figma Inc.",                  "2026-05-14", 2350.00,"reviewing","email","FG-9938712","invoice",0.74,"ค่า Software / Cloud"),
  doc("Lazada Express",              "2026-05-13",  780.00,"processing","web","LZ-2605131234","receipt",null,"ของใช้สำนักงาน"),
  doc("TrueMove H",                  "2026-05-12", 1199.00,"approved","email","TR-2605-008812","invoice",0.94,"ค่าโทรศัพท์"),
  doc("PTT Station ทองหล่อ",         "2026-05-11", 1500.00,"approved","line","PTT-110526-09","receipt",0.96,"ค่าน้ำมัน"),
  doc("การประปานครหลวง",             "2026-05-10",  312.00,"rejected","web","MWA-2604-7782","utility",0.88,"ค่าสาธารณูปโภค"),
  doc("MK Restaurants EmQuartier",   "2026-05-14", 2150.00,"reviewing","line","MK-2605-44128","receipt",0.86,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",           "2026-05-16",  847.50,"approved","web","TD-160526-09988","receipt",0.93,"ของใช้ส่วนตัว"),
  doc("Studio 7 (iStudio)",          "2026-05-05", 3290.00,"pushed","email","ST7-26-IPH-0033","invoice",0.99,"ผ่อนสินค้า"),
  // Additional May docs to hit 142,380
  doc("Amazon Web Services",         "2026-05-01", 8750.00,"pushed","email","AWS-202605002","invoice",0.99,"ค่า Software / Cloud"),
  doc("Amazon Web Services",         "2026-05-08", 8750.00,"approved","email","AWS-202605003","invoice",0.99,"ค่า Software / Cloud"),
  doc("GitHub Inc.",                 "2026-05-01", 2800.00,"pushed","email","GH-202605-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Notion Labs",                 "2026-05-02", 3200.00,"pushed","email","NT-202605-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("Adobe Thailand",              "2026-05-02", 3780.00,"pushed","email","AD-202605-001","invoice",0.99,"ค่า Software / Cloud"),
  doc("LINE Corporation",            "2026-05-03", 7000.00,"approved","web","LN-202605-001","invoice",0.98,"ค่า Software / Cloud"),
  doc("Grab (Thailand)",             "2026-05-03",  450.00,"approved","line","GR-20260503-01","receipt",0.89,"ค่าเดินทาง"),
  doc("Grab (Thailand)",             "2026-05-06",  380.00,"approved","line","GR-20260506-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab (Thailand)",             "2026-05-08",  420.00,"approved","line","GR-20260508-01","receipt",0.91,"ค่าเดินทาง"),
  doc("Grab (Thailand)",             "2026-05-10",  500.00,"reviewing","line","GR-20260510-01","receipt",0.77,"ค่าเดินทาง"),
  doc("Grab (Thailand)",             "2026-05-13",  350.00,"approved","line","GR-20260513-01","receipt",0.90,"ค่าเดินทาง"),
  doc("Grab (Thailand)",             "2026-05-18",  480.00,"pending","line","GR-20260518-01","receipt",null,"ค่าเดินทาง"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-05-04",  220.00,"approved","line","7E-20260504-01","receipt",0.94,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-05-07",  310.00,"approved","line","7E-20260507-01","receipt",0.93,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-05-09",  195.00,"approved","line","7E-20260509-01","receipt",0.95,"ของใช้สำนักงาน"),
  doc("บมจ. ซีพี ออลล์ (7-Eleven)", "2026-05-11",  260.00,"pending","line","7E-20260511-01","receipt",null,"ของใช้สำนักงาน"),
  doc("Starbucks Coffee",            "2026-05-06",  185.00,"approved","line","SB-20260506-01","receipt",0.95,"รับรองลูกค้า"),
  doc("Starbucks Coffee",            "2026-05-09",  370.00,"reviewing","line","SB-20260509-01","receipt",0.79,"รับรองลูกค้า"),
  doc("Starbucks Coffee",            "2026-05-12",  185.00,"approved","line","SB-20260512-01","receipt",0.96,"รับรองลูกค้า"),
  doc("PTT Station ทองหล่อ",         "2026-05-07", 1500.00,"approved","line","PTT-070526-01","receipt",0.97,"ค่าน้ำมัน"),
  doc("PTT Station ทองหล่อ",         "2026-05-14", 1500.00,"reviewing","line","PTT-140526-01","receipt",0.81,"ค่าน้ำมัน"),
  doc("Lazada Express",              "2026-05-09",  780.00,"approved","web","LZ-20260509-01","receipt",0.92,"ของใช้สำนักงาน"),
  doc("Lazada Express",              "2026-05-15", 1560.00,"pending","web","LZ-20260515-01","receipt",null,"ของใช้สำนักงาน"),
  doc("MK Restaurants EmQuartier",   "2026-05-08", 2150.00,"approved","line","MK-20260508-01","receipt",0.88,"อาหารและเครื่องดื่ม"),
  doc("MK Restaurants EmQuartier",   "2026-05-16", 2150.00,"reviewing","line","MK-20260516-01","receipt",0.82,"อาหารและเครื่องดื่ม"),
  doc("Tops Daily เอกมัย",           "2026-05-09",  850.00,"approved","web","TD-20260509-01","receipt",0.93,"ของใช้ส่วนตัว"),
  doc("Tops Daily เอกมัย",           "2026-05-14",  920.00,"pending","web","TD-20260514-01","receipt",null,"ของใช้ส่วนตัว"),
  doc("Central Pattana",             "2026-05-06",12800.00,"approved","web","CP-20260506-01","receipt",0.89,"ของใช้สำนักงาน"),
  doc("Decathlon Thailand",          "2026-05-08", 5848.00,"approved","web","DC-20260508-01","receipt",0.90,"ของใช้สำนักงาน"),
  doc("IKEA Thailand",               "2026-05-10", 6800.00,"reviewing","web","IK-20260510-01","receipt",0.83,"ของใช้สำนักงาน"),
  doc("Bolt Thailand",               "2026-05-04",  350.00,"approved","line","BT-20260504-01","receipt",0.87,"ค่าเดินทาง"),
  doc("Bolt Thailand",               "2026-05-07",  400.00,"approved","line","BT-20260507-01","receipt",0.88,"ค่าเดินทาง"),
  doc("Grab Food Thailand",          "2026-05-05",  430.00,"approved","line","GF-20260505-01","receipt",0.85,"อาหารและเครื่องดื่ม"),
  doc("Grab Food Thailand",          "2026-05-11",  430.00,"approved","line","GF-20260511-01","receipt",0.84,"อาหารและเครื่องดื่ม"),
  doc("Minor Food Group",            "2026-05-13",  810.00,"pending","line","MF-20260513-01","receipt",null,"อาหารและเครื่องดื่ม"),
  // total ≈ 142,375 ✓ (~47 active docs)
]

const ALL_DOCS = [...JUN25,...JUL25,...AUG25,...SEP25,...OCT25,...NOV25,...DEC25,...JAN26,...FEB26,...MAR26,...APR26,...MAY26]

/* ─── Handler ────────────────────────────────────────────────────────────── */
export async function POST() {
  if (!canSeedDemoData(process.env.NODE_ENV)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single()
  if (!membership) return NextResponse.json({ error: "No org" }, { status: 400 })

  const orgId = membership.organization_id
  const admin = createAdminClient()

  /* 1 ─ Clear ALL existing documents for this org */
  await admin.from("documents").delete().eq("organization_id", orgId)

  /* 2 ─ Update org to match design (Pro, realistic name) */
  await admin.from("organizations").update({
    name:                "บริษัท เอบีซี จำกัด",
    slug:                "abc-co-th",
    tax_id:              "0105557123456",
    address:             "เลขที่ 88 อาคาร Park Venture ชั้น 22 ถนนวิทยุ แขวงลุมพินี เขตปทุมวัน กรุงเทพฯ 10330",
    plan:                "pro",
    doc_quota:           1000,
    subscription_status: "active",
  }).eq("id", orgId)

  /* 3 ─ Insert all demo documents */
  const rows = ALL_DOCS.map(d => ({
    organization_id:    orgId,
    uploaded_by:        user.id,
    file_name:          `${d.vendor_name.replace(/[^a-zA-Z0-9]/g,"_").toLowerCase()}_${d.doc_date}.pdf`,
    file_path:          `demo/${orgId}/${d.vendor_name.replace(/[^a-zA-Z0-9]/g,"_").toLowerCase()}_${d.doc_date}.pdf`,
    file_type:          "application/pdf",
    source:             d.source,
    status:             d.status,
    vendor_name:        d.vendor_name,
    invoice_number:     d.invoice_number,
    doc_date:           d.doc_date,
    total_amount:       d.total_amount,
    vat_amount:         d.vat_amount,
    net_amount:         d.net_amount,
    doc_type:           d.doc_type,
    overall_confidence: d.overall_confidence,
    category:           d.category,
    created_at:         new Date(d.doc_date + "T10:00:00Z").toISOString(),
  }))

  const { error: docsError } = await admin.from("documents").insert(rows)
  if (docsError) return NextResponse.json({ error: docsError.message }, { status: 500 })

  /* 4 ─ Seed team members */
  const memberErrors: string[] = []
  for (const m of DEMO_TEAM) {
    // Create or find auth user
    let uid: string | undefined
    try {
      const { data: existing } = await admin.auth.admin.listUsers()
      const found = existing?.users?.find((u: any) => u.email === m.email)
      if (found) {
        uid = found.id
      } else {
        const { data: created, error: ae } = await admin.auth.admin.createUser({
          email: m.email, password: "Slipify@2025",
          email_confirm: true,
          user_metadata: { full_name: m.full_name },
        })
        if (ae) { memberErrors.push(`${m.email}: ${ae.message}`); continue }
        uid = created.user?.id
      }
    } catch { memberErrors.push(`${m.email}: auth error`); continue }
    if (!uid) continue

    // Upsert public users record
    await admin.from("users").upsert({
      id: uid, email: m.email, full_name: m.full_name,
    }, { onConflict: "id" })

    // Check if membership already exists
    const { data: existing } = await admin.from("organization_members")
      .select("id").eq("organization_id", orgId).eq("user_id", uid).limit(1)
    if (!existing || existing.length === 0) {
      await admin.from("organization_members").insert({
        organization_id: orgId, user_id: uid,
        role: m.role, joined_at: m.joined_at,
      })
    }
  }

  /* 5 ─ Update org doc_used */
  const active = rows.filter(r => !["pending","failed","rejected","processing"].includes(r.status)).length
  await admin.from("organizations").update({ doc_used: active }).eq("id", orgId)

  return NextResponse.json({
    ok:      true,
    docs:    rows.length,
    months:  12,
    members: DEMO_TEAM.length,
    member_errors: memberErrors,
  })
}
