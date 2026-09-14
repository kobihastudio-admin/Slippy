import { StaticPageShell } from "@/components/marketing/static-page-shell"
import { ComingSoonPanel } from "@/components/marketing/coming-soon-panel"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "ร่วมงานกับเรา | Slippy",
  description: "ตำแหน่งงานเปิดรับที่ Slippy",
}

export default function CareersPage() {
  return (
    <StaticPageShell
      title="ร่วมงานกับเรา"
      subtitle="ตอนนี้ยังไม่มีตำแหน่งเปิดรับอย่างเป็นทางการ"
    >
      <ComingSoonPanel
        emoji="🌱"
        message="ทีม Slippy ยังเล็กอยู่ และตอนนี้ยังไม่มีตำแหน่งงานเปิดรับอย่างเป็นทางการ แต่ถ้าสนใจร่วมงานหรืออยากฝากประวัติไว้ก่อน ส่งมาคุยกันได้เลย"
        contactLabel="ส่งประวัติ / ทักทาย"
      />
    </StaticPageShell>
  )
}
