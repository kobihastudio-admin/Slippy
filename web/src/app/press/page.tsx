import { StaticPageShell } from "@/components/marketing/static-page-shell"
import { ComingSoonPanel } from "@/components/marketing/coming-soon-panel"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "ข่าวสาร & สื่อมวลชน | Slippy",
  description: "ข่าวสารและข้อมูลสำหรับสื่อมวลชนเกี่ยวกับ Slippy",
}

export default function PressPage() {
  return (
    <StaticPageShell
      title="ข่าวสาร & สื่อมวลชน"
      subtitle="ยังไม่มีข่าวหรือ media kit เผยแพร่ในตอนนี้"
    >
      <ComingSoonPanel
        emoji="📰"
        message="Slippy ยังไม่มีข่าวสารหรือชุดข้อมูลสื่อ (media kit) ให้ดาวน์โหลดในตอนนี้ หากเป็นสื่อมวลชนหรือต้องการข้อมูลเพื่อการนำเสนอข่าว ติดต่อทีมงานได้โดยตรง"
        contactLabel="ติดต่อทีม PR"
      />
    </StaticPageShell>
  )
}
