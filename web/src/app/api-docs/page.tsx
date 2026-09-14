import { StaticPageShell } from "@/components/marketing/static-page-shell"
import { ComingSoonPanel } from "@/components/marketing/coming-soon-panel"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "API Docs | Slippy",
  description: "เอกสาร API สำหรับนักพัฒนา",
}

export default function ApiDocsPage() {
  return (
    <StaticPageShell
      title="API Documentation"
      subtitle="ยังไม่เปิด public API ให้นักพัฒนาภายนอกในตอนนี้"
    >
      <div className="space-y-6">
        <p className="text-sm text-gray-600 leading-relaxed">
          ตอนนี้ Slippy เชื่อมต่อกับระบบบัญชี, LINE Bot และแอปมือถือผ่าน integration
          ที่เราดูแลเองในระบบ ยังไม่มี public API สำหรับนักพัฒนาภายนอกให้เชื่อมต่อโดยตรง
        </p>
        <ComingSoonPanel
          emoji="🔌"
          message="กำลังวางแผนเปิด public API สำหรับดึงข้อมูลเอกสารและ webhook แจ้งเตือน หากสนใจใช้งานหรืออยากให้พัฒนาก่อน ติดต่อทีมพัฒนาได้เลย"
          contactLabel="สอบถามเรื่อง API"
        />
      </div>
    </StaticPageShell>
  )
}
