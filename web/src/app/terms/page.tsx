/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 */

import Link from "next/link"
import { LogoMark } from "@/components/ui/logo"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "เงื่อนไขการใช้งาน | Slippy",
  description: "เงื่อนไขและข้อตกลงการใช้งานแพลตฟอร์ม Slippy",
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 h-16 flex items-center justify-between max-w-4xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={28} />
          <span className="font-black text-lg text-gray-900">Slippy</span>
        </Link>
        <Link href="/" className="text-sm text-gray-500 hover:text-indigo-600 transition-colors">← กลับหน้าหลัก</Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-black text-gray-900 mb-2">เงื่อนไขการใช้งาน</h1>
        <p className="text-gray-400 text-sm mb-10">อัพเดตล่าสุด: 2 กรกฎาคม 2569 | เวอร์ชัน 1.0</p>

        <div className="space-y-10 text-sm text-gray-600 leading-relaxed">
          <Section num="1" title="การยอมรับเงื่อนไข">
            <p>
              การสมัครใช้งานหรือเข้าใช้แพลตฟอร์ม Slippy (&quot;บริการ&quot;) ถือว่าคุณยอมรับเงื่อนไขการใช้งานฉบับนี้
              และ<Link href="/privacy-policy" className="text-indigo-600 hover:underline">นโยบายความเป็นส่วนตัว</Link>ทั้งหมด
              หากไม่ยอมรับ กรุณาหยุดใช้บริการ
            </p>
          </Section>

          <Section num="2" title="คุณสมบัติผู้ใช้บริการ">
            <p>
              บริการนี้มีไว้สำหรับผู้ที่มีอายุ 18 ปีขึ้นไป หรือนิติบุคคลที่จดทะเบียนถูกต้องตามกฎหมายไทย
              ผู้สมัครต้องให้ข้อมูลที่ถูกต้องและเป็นจริงในการลงทะเบียน
            </p>
          </Section>

          <Section num="3" title="ขอบเขตของบริการ">
            <p className="mb-2">
              Slippy ให้บริการอ่านและสกัดข้อมูลจากเอกสารบัญชีด้วย AI, LINE Bot, และเครื่องมือจัดการกิจกรรม/การเงินส่วนตัว
              ระดับความแม่นยำของ AI อยู่ที่ประมาณ 95% สำหรับเอกสารภาษาไทยทั่วไป — เอกสารความเชื่อมั่นต่ำจะถูกส่งเข้าคิว
              ตรวจสอบก่อนใช้งานจริงเสมอ ผู้ใช้มีหน้าที่ตรวจสอบความถูกต้องของข้อมูลก่อนนำไปใช้ทางบัญชีหรือภาษี
            </p>
            <p>
              คุณสมบัติบางอย่าง (เช่น การเชื่อมต่อระบบบัญชีภายนอกโดยตรง) อาจอยู่ระหว่างพัฒนาและยังไม่เปิดให้ใช้งานเต็มรูปแบบ
              — ดูสถานะฟีเจอร์ล่าสุดได้ที่ <Link href="/changelog" className="text-indigo-600 hover:underline">Changelog</Link>
            </p>
          </Section>

          <Section num="4" title="บัญชีผู้ใช้และความปลอดภัย">
            <p>
              คุณมีหน้าที่รักษาความลับของรหัสผ่านและข้อมูลเข้าสู่ระบบ Slippy จะไม่รับผิดชอบต่อความเสียหาย
              ที่เกิดจากการที่บัญชีของคุณถูกใช้งานโดยไม่ได้รับอนุญาตอันเนื่องมาจากความประมาทของผู้ใช้เอง
            </p>
          </Section>

          <Section num="5" title="แผนการใช้งานและการชำระเงิน">
            <ul className="list-disc list-inside space-y-1.5">
              <li>แผน Free ใช้งานได้โดยไม่มีค่าใช้จ่าย ตามโควตาที่กำหนด</li>
              <li>แผนเสียเงินเรียกเก็บล่วงหน้าเป็นรายเดือนหรือรายปีผ่าน Stripe ยกเลิกได้ทุกเมื่อ มีผลในรอบถัดไป</li>
              <li>ไม่มีการคืนเงินสำหรับรอบบิลที่จ่ายไปแล้ว เว้นแต่กฎหมายกำหนดไว้เป็นอย่างอื่น</li>
              <li>Slippy สงวนสิทธิ์ปรับราคาแผนบริการ โดยจะแจ้งล่วงหน้าอย่างน้อย 30 วัน</li>
            </ul>
          </Section>

          <Section num="6" title="การใช้งานที่ไม่เหมาะสม">
            <p className="mb-2">ห้ามใช้บริการเพื่อ:</p>
            <ul className="list-disc list-inside space-y-1.5">
              <li>อัปโหลดเอกสารปลอมหรือข้อมูลที่ผิดกฎหมาย</li>
              <li>พยายามเจาะระบบ, scrape ข้อมูลผู้อื่น หรือรบกวนการทำงานของแพลตฟอร์ม</li>
              <li>ละเมิดทรัพย์สินทางปัญญาของ Slippy หรือบุคคลที่สาม</li>
            </ul>
          </Section>

          <Section num="7" title="ทรัพย์สินทางปัญญา">
            <p>
              ซอฟต์แวร์, โลโก้, และเนื้อหาทั้งหมดบนแพลตฟอร์ม Slippy เป็นทรัพย์สินของบริษัท สลิปปี้ จำกัด
              ห้ามคัดลอก ทำซ้ำ หรือแจกจ่ายโดยไม่ได้รับอนุญาตเป็นลายลักษณ์อักษร ข้อมูลเอกสารที่คุณอัปโหลดยังคงเป็นของคุณเสมอ
            </p>
          </Section>

          <Section num="8" title="ข้อจำกัดความรับผิด">
            <p>
              Slippy ให้บริการ &quot;ตามสภาพที่เป็นอยู่&quot; ไม่รับประกันว่าผลลัพธ์จาก AI จะถูกต้อง 100%
              ผู้ใช้มีหน้าที่ตรวจสอบก่อนนำข้อมูลไปยื่นภาษีหรือบันทึกบัญชีจริง Slippy จะไม่รับผิดต่อความเสียหายทางอ้อม
              เว้นแต่กรณีที่เกิดจากความประมาทเลินเล่ออย่างร้ายแรงของเรา
            </p>
          </Section>

          <Section num="9" title="การยกเลิกบริการ">
            <p>
              คุณสามารถยกเลิกบัญชีได้ทุกเมื่อจากหน้าตั้งค่า Slippy สงวนสิทธิ์ระงับหรือยกเลิกบัญชีที่ละเมิดเงื่อนไขนี้
              โดยจะแจ้งเหตุผลตามสมควร ข้อมูลจะถูกลบตามที่ระบุใน<Link href="/privacy-policy" className="text-indigo-600 hover:underline">นโยบายความเป็นส่วนตัว</Link>
            </p>
          </Section>

          <Section num="10" title="การเปลี่ยนแปลงเงื่อนไข">
            <p>
              Slippy อาจปรับปรุงเงื่อนไขนี้เป็นครั้งคราว การใช้งานต่อหลังการเปลี่ยนแปลงถือว่ายอมรับเงื่อนไขฉบับใหม่
              การเปลี่ยนแปลงสำคัญจะแจ้งผ่านอีเมลหรือประกาศในระบบ
            </p>
          </Section>

          <Section num="11" title="กฎหมายที่ใช้บังคับ">
            <p>เงื่อนไขนี้อยู่ภายใต้กฎหมายไทย ข้อพิพาทให้อยู่ในเขตอำนาจศาลไทย</p>
          </Section>

          <Section num="12" title="ติดต่อเรา">
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 mt-3 space-y-2">
              <p><strong>บริษัท สลิปปี้ จำกัด (Slippy Co., Ltd.)</strong></p>
              <p>อีเมล: <a href="mailto:hello@slippy.app" className="text-indigo-600 hover:underline">hello@slippy.app</a></p>
              <p>LINE: <a href="https://line.me/R/ti/p/@slippy" className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">@slippy</a></p>
            </div>
          </Section>
        </div>

        <div className="mt-12 flex gap-3">
          <Link href="/privacy-policy"
            className="px-5 py-2.5 text-sm font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-colors">
            📋 นโยบายความเป็นส่วนตัว
          </Link>
          <Link href="/"
            className="px-5 py-2.5 text-sm font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-xl hover:bg-gray-100 transition-colors">
            ← กลับหน้าหลัก
          </Link>
        </div>
      </main>
    </div>
  )
}

function Section({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-black text-gray-900 mb-3 pb-2 border-b border-gray-100">
        <span className="text-indigo-500 mr-2">{num}.</span>{title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}
