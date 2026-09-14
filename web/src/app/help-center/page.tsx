import { StaticPageShell } from "@/components/marketing/static-page-shell"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "ศูนย์ช่วยเหลือ | Slippy",
  description: "คำถามที่พบบ่อยและวิธีติดต่อทีมสนับสนุน Slippy",
}

const FAQS = [
  { q: "Slippy ทำงานกับซอฟต์แวร์บัญชีตัวไหนบ้าง?", a: "รองรับซอฟต์แวร์บัญชียอดนิยมหลายระบบ พร้อมเพิ่มอีกในปี 2026 หากใช้ระบบที่ยังไม่ได้เชื่อมตรง สามารถ Export เป็น Excel หรือ CSV ได้ทุกแพ็กเกจ" },
  { q: "AI แม่นยำแค่ไหน? ต้องตรวจสอบเองอีกไหม?", a: "ความแม่นยำเฉลี่ย 95% สำหรับเอกสารภาษาไทยทั่วไป เอกสารที่ confidence ต่ำกว่า 90% จะถูกส่งเข้าหน้า Review ให้คุณตรวจสอบก่อนอัปเดตเข้าบัญชี" },
  { q: "ข้อมูลของฉันปลอดภัยไหม?", a: "เซิร์ฟเวอร์อยู่ในประเทศไทย เข้ารหัสข้อมูลทั้ง in-transit (TLS 1.3) และ at-rest (AES-256) ปฏิบัติตาม PDPA เต็มรูปแบบ" },
  { q: "ใช้กับ LINE Bot อย่างไร?", a: "หลังสมัคร ระบบจะให้รหัสเชื่อมต่อ — เปิด LINE เพิ่ม @slippy เป็นเพื่อน ส่ง /connect ตามด้วยรหัส แค่นั้นเรียบร้อย จากนั้นส่งรูปสลิปได้เลย" },
  { q: "มีค่าเริ่มต้น หรือต้องผูกบัตรไหม?", a: "ไม่มีค่าติดตั้ง ไม่ต้องใช้บัตรเครดิตสำหรับแผน Free และทุกแพ็กเกจสามารถยกเลิกหรือลดระดับได้ทุกเมื่อ" },
  { q: "มีทดลองใช้ Pro ฟรีไหม?", a: "แผน Starter และ Pro มีทดลองใช้ฟรี 14 วัน เต็มฟีเจอร์ ไม่ต้องผูกบัตร และไม่มี auto-renew" },
]

export default function HelpCenterPage() {
  return (
    <StaticPageShell title="ศูนย์ช่วยเหลือ" subtitle="คำถามที่พบบ่อย และวิธีติดต่อทีมงาน">
      <div className="space-y-3">
        {FAQS.map(f => (
          <details key={f.q} className="group rounded-xl border border-gray-100 open:border-indigo-200 transition-colors">
            <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-sm text-gray-900 flex items-center justify-between">
              {f.q}
              <span className="text-gray-300 group-open:rotate-45 transition-transform">+</span>
            </summary>
            <p className="px-5 pb-4 text-sm text-gray-500 leading-relaxed">{f.a}</p>
          </details>
        ))}
      </div>

      <div className="mt-10 bg-indigo-50 border border-indigo-100 rounded-2xl p-5 space-y-2 text-sm">
        <p className="font-bold text-gray-900">ยังไม่เจอคำตอบที่ต้องการ?</p>
        <p>อีเมล: <a href="mailto:support@slippy.app" className="text-indigo-600 hover:underline">support@slippy.app</a></p>
        <p>LINE: <a href="https://line.me/R/ti/p/@slippy" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">@slippy</a></p>
      </div>
    </StaticPageShell>
  )
}
