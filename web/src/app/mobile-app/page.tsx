import { StaticPageShell } from "@/components/marketing/static-page-shell"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "แอปมือถือ | Slippy",
  description: "แอป Slippy สำหรับ iOS และ Android — กำลังพัฒนา",
}

const FEATURES = [
  { emoji: "📸", title: "ถ่ายรูปสลิปได้ทันที", desc: "ถ่ายที่ร้านแล้วส่งเข้าระบบทันที ไม่ต้องรอกลับออฟฟิศ" },
  { emoji: "🔔", title: "แจ้งเตือนแบบเรียลไทม์", desc: "รู้ทันทีเมื่อเอกสารประมวลผลเสร็จหรือต้องตรวจสอบ" },
  { emoji: "🏸", title: "นัดกีฬา & หารบิล", desc: "จัดกลุ่มกีฬา หารค่าใช้จ่ายกับเพื่อนได้จากมือถือ" },
]

export default function MobileAppPage() {
  return (
    <StaticPageShell title="แอปมือถือ Slippy">
      <div className="text-center py-12 px-6 bg-gray-50 rounded-2xl border border-gray-100 mb-10">
        <div className="text-4xl mb-4">🚧</div>
        <p className="font-bold text-gray-900 mb-1">กำลังพัฒนา</p>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">
          แอป iOS และ Android ยังอยู่ระหว่างพัฒนา ยังไม่เปิดให้ดาวน์โหลดบน App Store หรือ Play Store
          ในตอนนี้ — ใช้งาน Slippy ผ่านเว็บและ LINE Bot ได้เต็มรูปแบบระหว่างนี้
        </p>
        <a
          href="mailto:hello@slippy.app?subject=อยากทดลองแอป Slippy"
          className="inline-block mt-5 px-5 py-2.5 text-sm font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-colors"
        >
          แจ้งเตือนฉันเมื่อเปิดให้ใช้งาน
        </a>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {FEATURES.map(f => (
          <div key={f.title} className="p-4 bg-white border border-gray-100 rounded-xl text-center">
            <div className="text-2xl mb-2">{f.emoji}</div>
            <p className="font-bold text-sm text-gray-900 mb-1">{f.title}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </StaticPageShell>
  )
}
