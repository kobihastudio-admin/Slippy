import { StaticPageShell } from "@/components/marketing/static-page-shell"
import { ComingSoonPanel } from "@/components/marketing/coming-soon-panel"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "บล็อก | Slippy",
  description: "บทความและอัปเดตจากทีม Slippy",
}

export default function BlogPage() {
  return (
    <StaticPageShell
      title="บล็อก"
      subtitle="ยังไม่มีบทความเผยแพร่ในตอนนี้"
    >
      <ComingSoonPanel
        emoji="✍️"
        message="เรากำลังเตรียมเขียนบทความเกี่ยวกับการทำบัญชี, AI และการจัดการเอกสารสำหรับ SME ไทย — ถ้าอยากให้แจ้งเตือนตอนบทความแรกออก ทักมาบอกได้เลย"
        contactLabel="แจ้งเตือนเมื่อมีบทความใหม่"
      />
    </StaticPageShell>
  )
}
