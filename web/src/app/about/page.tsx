import { StaticPageShell } from "@/components/marketing/static-page-shell"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "เกี่ยวกับเรา | Slippy",
  description: "Slippy คือแพลตฟอร์ม AI Life Assistant ที่แปลงเอกสาร กิจกรรม และความสัมพันธ์ให้กลายเป็น Life Graph",
}

export default function AboutPage() {
  return (
    <StaticPageShell title="เกี่ยวกับ Slippy">
      <div className="space-y-8 text-sm text-gray-600 leading-relaxed">
        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">วิสัยทัศน์</h2>
          <p>
            Slippy แปลงใบเสร็จ เอกสาร ทริป ความสัมพันธ์ และกิจกรรมต่างๆ ในชีวิตประจำวัน
            ให้กลายเป็น <strong>Life Graph</strong> — โครงข่ายข้อมูลที่เชื่อมโยงกัน
            เพื่อขับเคลื่อน AI insight ที่ช่วยให้คุณตัดสินใจได้ดีขึ้น ไม่ว่าจะเป็นเรื่องบัญชี
            การเงินส่วนตัว หรือกิจกรรมกับเพื่อน
          </p>
        </section>

        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">เริ่มต้นจากปัญหาจริง</h2>
          <p>
            เราเริ่มต้นจากปัญหาที่ SME ไทยและนักบัญชีเจอทุกเดือน — ใช้เวลาหลายชั่วโมง
            ในวันศุกร์คีย์ใบเสร็จเข้าระบบบัญชีด้วยมือ Slippy ใช้ AI อ่านเอกสารภาษาไทยและ
            ส่งเข้าระบบบัญชีอัตโนมัติ เพื่อคืนเวลานั้นให้คุณ
          </p>
        </section>

        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">วิธีที่เราทำงาน</h2>
          <div className="flex items-center gap-2 flex-wrap text-xs font-semibold">
            {["LINE OA", "Services", "Life Graph", "AI Memory", "AI Assistant"].map((step, i, arr) => (
              <span key={step} className="flex items-center gap-2">
                <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg">{step}</span>
                {i < arr.length - 1 && <span className="text-gray-300">→</span>}
              </span>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">บริษัท</h2>
          <p>
            Slippy พัฒนาโดย <strong>บริษัท สลิปปี้ จำกัด (Slippy Co., Ltd.)</strong>
            {" "}เซิร์ฟเวอร์และข้อมูลอยู่ในภูมิภาค Asia Pacific รองรับ PDPA เต็มรูปแบบ
            — ดูรายละเอียดที่ <a href="/privacy-policy" className="text-indigo-600 hover:underline">นโยบายความเป็นส่วนตัว</a>
          </p>
        </section>

        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
          <p>มีคำถามหรืออยากคุยกับทีมงาน? ทักมาได้ที่ <a href="mailto:hello@slippy.app" className="text-indigo-600 hover:underline font-semibold">hello@slippy.app</a></p>
        </div>
      </div>
    </StaticPageShell>
  )
}
