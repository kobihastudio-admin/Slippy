import Link from "next/link"
import { StaticPageShell } from "@/components/marketing/static-page-shell"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Data Processing Agreement | Slippy",
  description: "ข้อตกลงการประมวลผลข้อมูลสำหรับลูกค้าองค์กรของ Slippy",
}

export default function DpaPage() {
  return (
    <StaticPageShell
      title="Data Processing Agreement (DPA)"
      subtitle="สรุปเงื่อนไขการประมวลผลข้อมูลสำหรับลูกค้าที่ใช้ Slippy ในนามองค์กร"
    >
      <div className="space-y-8 text-sm text-gray-600 leading-relaxed">
        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">1. ความสัมพันธ์ของทั้งสองฝ่าย</h2>
          <p>
            เมื่อคุณใช้ Slippy ในนามองค์กร คุณ (&quot;Data Controller&quot;) เป็นผู้ควบคุมข้อมูล
            ส่วน Slippy (&quot;Data Processor&quot;) ประมวลผลข้อมูลส่วนบุคคลในเอกสารที่คุณอัปโหลด
            ตามคำสั่งของคุณเท่านั้น เพื่อวัตถุประสงค์ในการให้บริการตามที่ระบุในเงื่อนไขการใช้งาน
          </p>
        </section>

        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">2. ขอบเขตการประมวลผล</h2>
          <p>
            Slippy ประมวลผลข้อมูลที่ปรากฏในเอกสารบัญชี (ใบเสร็จ ใบกำกับภาษี) ที่คุณอัปโหลด
            เพื่อสกัดข้อมูลด้วย AI และส่งเข้าระบบบัญชีที่คุณเชื่อมต่อไว้ รายละเอียดประเภทข้อมูล
            และวัตถุประสงค์ดูได้ที่ <Link href="/privacy-policy" className="text-indigo-600 hover:underline">นโยบายความเป็นส่วนตัว</Link>
          </p>
        </section>

        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">3. Sub-processors</h2>
          <p className="mb-3">เราใช้ผู้ให้บริการต่อไปนี้ในการประมวลผลข้อมูลแทนเรา:</p>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {["ผู้ให้บริการ", "บทบาท"].map(h => (
                    <th key={h} className="text-left px-4 py-3 font-bold text-gray-700">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Supabase", "ฐานข้อมูลและระบบยืนยันตัวตน"],
                  ["Google Cloud", "โครงสร้างพื้นฐานเซิร์ฟเวอร์"],
                  ["Stripe", "ประมวลผลการชำระเงิน"],
                  ["Postmark", "ส่งอีเมลแจ้งเตือนระบบ"],
                  ["LINE Corporation", "การเชื่อมต่อ LINE Bot / LIFF"],
                ].map(([name, role], i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="px-4 py-3 text-gray-700 font-medium">{name}</td>
                    <td className="px-4 py-3 text-gray-500">{role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">4. มาตรการรักษาความปลอดภัย</h2>
          <p>
            ข้อมูลเข้ารหัสทั้งระหว่างส่ง (TLS 1.3) และขณะจัดเก็บ (AES-256)
            เก็บบนเซิร์ฟเวอร์ในภูมิภาค Asia Pacific บนโครงสร้างพื้นฐานที่มีมาตรฐาน SOC 2, ISO 27001
          </p>
        </section>

        <section>
          <h2 className="text-lg font-black text-gray-900 mb-3">5. ระยะเวลาและการลบข้อมูล</h2>
          <p>
            ข้อมูลจะถูกเก็บตลอดระยะเวลาที่ใช้งาน และลบภายใน 30 วันหลังยกเลิกบัญชี
            ยกเว้นกรณีที่กฎหมายไทยกำหนดให้ต้องเก็บเอกสารบัญชีไว้ (โดยทั่วไป 5 ปี)
          </p>
        </section>

        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 space-y-2">
          <p className="font-bold text-gray-900">ต้องการเอกสาร DPA ฉบับเต็มสำหรับลงนาม?</p>
          <p>ติดต่อทีมงานเพื่อขอเอกสารฉบับเต็มที่ปรับให้เหมาะกับข้อกำหนดขององค์กรคุณ</p>
          <p>อีเมล: <a href="mailto:dpo@slippy.app" className="text-indigo-600 hover:underline font-semibold">dpo@slippy.app</a></p>
        </div>
      </div>
    </StaticPageShell>
  )
}
