/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { HelpCircle, BookOpen, MessageCircle, FileText, Zap, ShieldCheck } from "lucide-react"

const topics = [
  { icon: Zap,          title: "เริ่มต้นใช้งาน",            desc: "การตั้งค่าครั้งแรก, อัปโหลดเอกสาร", count: 8  },
  { icon: FileText,     title: "อัปโหลดและ OCR",             desc: "ประเภทไฟล์, ข้อจำกัด, แก้ไขข้อมูล", count: 6  },
  { icon: BookOpen,     title: "เชื่อมต่อ FlowAccount",      desc: "ตั้งค่า API Key, sync ข้อมูล",       count: 9  },
  { icon: ShieldCheck,  title: "ความเป็นส่วนตัว · PDPA",    desc: "การยินยอม, ข้อมูลของคุณ",            count: 5  },
  { icon: MessageCircle,"title": "LINE Bot",                   desc: "เชื่อมบัญชี, รับสลิป, คำสั่ง",      count: 7  },
  { icon: HelpCircle,   title: "การชำระเงิน",                desc: "แผน, Add-on, Invoice",               count: 4  },
]

export default function HelpPage() {
  return (
    <div className="page-narrow animate-fade-in">
      <div className="mb-8">
        <h2 className="text-2xl font-bold">ช่วยเหลือ & คำถามที่พบบ่อย</h2>
        <p className="text-muted-foreground mt-1">ค้นหาคำตอบหรือติดต่อทีมงาน</p>
      </div>

      <div className="relative mb-8">
        <HelpCircle className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          type="search"
          placeholder="ค้นหาบทความ เช่น OCR, LINE Bot, ภาษี..."
          className="w-full h-12 pl-12 pr-4 rounded-xl border bg-card text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition"
        />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {topics.map((t) => (
          <button key={t.title} className="rounded-xl border bg-card p-5 text-left hover:shadow-md hover:border-brand-300 transition-all group">
            <div className="w-10 h-10 rounded-[10px] bg-brand-500/10 flex items-center justify-center mb-3 group-hover:bg-brand-500/20 transition-colors">
              <t.icon className="w-5 h-5 text-brand-500" />
            </div>
            <p className="font-semibold text-sm">{t.title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t.desc}</p>
            <p className="text-xs text-brand-600 mt-2.5 font-medium">{t.count} บทความ →</p>
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card p-6 flex items-center gap-5">
        <div className="w-12 h-12 rounded-xl bg-[#06C755]/10 flex items-center justify-center shrink-0">
          <MessageCircle className="w-6 h-6 text-[#06C755]" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">ยังหาคำตอบไม่เจอ?</p>
          <p className="text-sm text-muted-foreground mt-0.5">ติดต่อทีมงานผ่าน LINE Official หรืออีเมล support@slippy.app</p>
        </div>
        <button className="px-4 py-2 rounded-lg bg-[#06C755] text-white text-sm font-medium hover:bg-[#05B54A] transition-colors shrink-0">
          แชทกับเรา
        </button>
      </div>
    </div>
  )
}
