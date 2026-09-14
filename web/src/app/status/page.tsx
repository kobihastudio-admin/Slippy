import { StaticPageShell } from "@/components/marketing/static-page-shell"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "System Status | Slippy",
  description: "สถานะการทำงานของระบบ Slippy",
}

const SERVICES = [
  { name: "Web App", desc: "แดชบอร์ดและหน้าเว็บหลัก" },
  { name: "Document AI Pipeline", desc: "การประมวลผลเอกสารด้วย AI" },
  { name: "LINE Bot", desc: "@slippy บน LINE Official Account" },
  { name: "Mobile App", desc: "แอป iOS/Android" },
]

export default function StatusPage() {
  return (
    <StaticPageShell title="System Status">
      <p className="text-sm text-gray-500 mb-8 leading-relaxed">
        หน้านี้อัปเดตด้วยมือโดยทีมงาน ยังไม่มีระบบ monitoring อัตโนมัติแบบ real-time —
        หากพบปัญหาการใช้งาน แจ้งเราได้ทันทีที่ <a href="mailto:support@slippy.app" className="text-indigo-600 hover:underline">support@slippy.app</a>
      </p>

      <div className="space-y-2">
        {SERVICES.map(s => (
          <div key={s.name} className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-xl">
            <div>
              <p className="font-semibold text-sm text-gray-900">{s.name}</p>
              <p className="text-xs text-gray-400">{s.desc}</p>
            </div>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              ปกติ
            </span>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-gray-400">
        ไม่มีเหตุการณ์ผิดปกติที่รายงานล่าสุด — อัปเดต 2 กรกฎาคม 2569
      </p>
    </StaticPageShell>
  )
}
