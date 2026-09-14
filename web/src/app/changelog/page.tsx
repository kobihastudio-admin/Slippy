import { StaticPageShell } from "@/components/marketing/static-page-shell"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Changelog | Slippy",
  description: "อัปเดตฟีเจอร์และการเปลี่ยนแปลงล่าสุดของ Slippy",
}

const ENTRIES = [
  {
    period: "กรกฎาคม 2569",
    items: [
      "เพิ่มเพื่อนได้ 3 ช่องทาง — สแกน/แสดง QR Code และแชร์ผ่าน LINE ทั้งบนเว็บและแอป iOS",
      "ปรับปรุงความแม่นยำ OCR — ใช้ผล Vision บนเครื่อง iOS ร่วมกับ AI บนเซิร์ฟเวอร์ตรวจสอบไขว้กัน",
      "เพิ่มขั้นตอนครอปรูปก่อนอัปโหลดเอกสารบนเว็บ และปรับกล้องสแกนสลิปให้คมชัดขึ้น",
    ],
  },
  {
    period: "มิถุนายน 2569",
    items: [
      "รองรับการหารบิลทริปแบบมีผู้จ่ายหลายคน พร้อมคำนวณยอดสุทธิที่ต้องโอนให้ใครอัตโนมัติ",
      "เพิ่มการหารแบบ % และตามจำนวนหุ้น นอกเหนือจากหารเท่ากันและระบุจำนวนเอง",
      "ปรับหน้ารายชื่อผู้เข้าร่วมกลุ่มกีฬาเป็นแบบ Tree diagram แสดงว่าใครเพิ่มใครเข้ามา",
      "เพิ่มปุ่มยกเลิกการทำเครื่องหมายชำระแล้ว และปุ่มปิด session ในหน้ากลุ่มกีฬา",
    ],
  },
  {
    period: "พฤษภาคม 2569",
    items: [
      "เพิ่มการรองรับหลายชนิดกีฬาในแอป Apple Watch และแก้ไขการคำนวณอัตราการเต้นหัวใจเฉลี่ย",
      "เพิ่มระบบเชิญเพื่อนแบบ 3 ช่องทางในหน้า LINE LIFF — พิมพ์ชื่อเอง, เลือกจากเพื่อนใน Slippy, เชิญผ่าน LINE",
      "จำกัดสิทธิ์การลบผู้เข้าร่วมในหน้า LIFF ให้ลบได้เฉพาะตัวเองและคนที่ตัวเองเพิ่มเข้ามา",
    ],
  },
]

export default function ChangelogPage() {
  return (
    <StaticPageShell title="Changelog" subtitle="สิ่งที่เปลี่ยนแปลงและอัปเดตใน Slippy">
      <div className="space-y-10">
        {ENTRIES.map(entry => (
          <div key={entry.period}>
            <h2 className="text-sm font-black text-indigo-600 uppercase tracking-wide mb-3">{entry.period}</h2>
            <ul className="space-y-2">
              {entry.items.map(item => (
                <li key={item} className="flex gap-2.5 text-sm text-gray-600 leading-relaxed">
                  <span className="text-indigo-400 shrink-0">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </StaticPageShell>
  )
}
