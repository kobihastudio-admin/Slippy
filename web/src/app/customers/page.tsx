import { StaticPageShell } from "@/components/marketing/static-page-shell"
import { ComingSoonPanel } from "@/components/marketing/coming-soon-panel"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "ลูกค้าของเรา | Slippy",
  description: "ลูกค้าและกรณีศึกษาการใช้งาน Slippy",
}

export default function CustomersPage() {
  return (
    <StaticPageShell
      title="ลูกค้าของเรา"
      subtitle="ยังไม่มีกรณีศึกษาเผยแพร่ในตอนนี้"
    >
      <div className="space-y-6">
        <p className="text-sm text-gray-600 leading-relaxed">
          Slippy ออกแบบมาสำหรับ SME ไทยและนักบัญชีที่ดูแลหลายลูกค้าพร้อมกัน —
          ตั้งแต่ร้านค้าเจ้าของคนเดียวไปจนถึงบริษัทขนาดเล็กที่ต้องการลดเวลาคีย์เอกสารบัญชีด้วยมือ
        </p>
        <ComingSoonPanel
          emoji="🤝"
          message="ยังไม่มีกรณีศึกษาหรือรีวิวจากลูกค้าเผยแพร่อย่างเป็นทางการในตอนนี้ ถ้าคุณใช้ Slippy อยู่แล้วและอยากแชร์ประสบการณ์ ยินดีมากเลยครับ"
          contactLabel="แชร์ประสบการณ์การใช้งาน"
        />
      </div>
    </StaticPageShell>
  )
}
