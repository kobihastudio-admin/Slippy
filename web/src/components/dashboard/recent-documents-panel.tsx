"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

/**
 * RecentDocumentsPanel — "เอกสารล่าสุด" table on the dashboard.
 *
 * Three source tabs, each pre-fetched on the server so switching is instant:
 *   • ล่าสุด        — everything in the org, newest first
 *   • ที่ฉันอัปโหลด  — documents.uploaded_by = current user
 *   • แชร์กับฉัน     — via document_shares (see 078_document_tags_and_shares.sql)
 *
 * View toggle mirrors the documents page: table (dense) / grid (cards).
 */

import { useState } from "react"
import Link from "next/link"
import { List, LayoutGrid, Eye, Inbox, ArrowUpRight } from "lucide-react"
import { formatThb, formatDate, cn } from "@/lib/utils"

export interface HubDoc {
  id:              string
  vendorName:      string | null
  docNumber:       string | null
  fileType:        string | null
  docType:         string | null
  expenseCategory: string | null
  docDate:         string | null
  createdAt:       string | null
  totalAmount:     number | null
  status:          string
  source:          string
}

const TABS = [
  { id: "recent", label: "ล่าสุด" },
  { id: "mine",   label: "ที่ฉันอัปโหลด" },
  { id: "shared", label: "แชร์กับฉัน" },
] as const
type TabId = typeof TABS[number]["id"]

const DOC_TYPE_LABEL: Record<string, string> = {
  receipt:     "ใบเสร็จรับเงิน",
  expense:     "บิล / ค่าใช้จ่าย",
  invoice:     "ใบแจ้งหนี้",
  tax_invoice: "ใบกำกับภาษี",
  credit_note: "ใบลดหนี้",
  unknown:     "ไม่ระบุประเภท",
}

const SOURCE_LABEL: Record<string, string> = {
  web:     "อัปโหลดผ่านเว็บ",
  mobile:  "แอปมือถือ",
  gallery: "คลังรูปภาพ",
  liff:    "LINE LIFF",
  line:    "LINE",
  email:   "อีเมล",
}

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  pending:    { cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300",         label: "รอดำเนินการ" },
  processing: { cls: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",              label: "กำลังประมวลผล" },
  reviewing:  { cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",          label: "รอตรวจสอบ" },
  approved:   { cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",  label: "อนุมัติแล้ว" },
  pushed:     { cls: "bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300",      label: "ส่งเข้าบัญชี" },
  failed:     { cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",              label: "ล้มเหลว" },
  rejected:   { cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300",         label: "ปฏิเสธ" },
  flagged:    { cls: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",      label: "ต้องตรวจซ้ำ" },
}

/** Colour-coded file-kind chip, same idea as the PDF/JPG tags in the mockup. */
function FileTag({ fileType }: { fileType: string | null }) {
  const kind = (fileType ?? "pdf").toLowerCase()
  const isPdf = kind === "pdf"
  return (
    <span
      className={cn(
        "h-9 w-9 shrink-0 rounded-[9px] flex items-center justify-center text-[9px] font-bold tracking-tight uppercase",
        isPdf
          ? "bg-rose-500/10 text-rose-600 dark:text-rose-300"
          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      )}
    >
      {isPdf ? "PDF" : kind === "png" ? "PNG" : "JPG"}
    </span>
  )
}

function docTitle(doc: HubDoc): string {
  return doc.docNumber?.trim() || doc.vendorName?.trim() || "เอกสารไม่มีชื่อ"
}

function docSubtitle(doc: HubDoc): string {
  return DOC_TYPE_LABEL[doc.docType ?? "unknown"] ?? "ไม่ระบุประเภท"
}

function docFrom(doc: HubDoc): string {
  return doc.vendorName?.trim() || SOURCE_LABEL[doc.source] || "—"
}

function docTime(doc: HubDoc): string | null {
  if (!doc.createdAt) return null
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok",
  }).format(new Date(doc.createdAt)) + " น."
}

export function RecentDocumentsPanel({ recent, mine, shared }: {
  recent: HubDoc[]
  mine:   HubDoc[]
  shared: HubDoc[]
}) {
  const [tab,  setTab]  = useState<TabId>("recent")
  const [view, setView] = useState<"table" | "grid">("table")

  const byTab: Record<TabId, HubDoc[]> = { recent, mine, shared }
  const docs = byTab[tab]

  const emptyCopy: Record<TabId, string> = {
    recent: "ยังไม่มีเอกสารในระบบ — อัปโหลดใบแรกได้เลย",
    mine:   "คุณยังไม่ได้อัปโหลดเอกสารด้วยตัวเอง",
    shared: "ยังไม่มีใครแชร์เอกสารให้คุณ",
  }

  return (
    <section className="dashboard-violet-panel rounded-2xl border bg-card overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <h3 className="text-[15px] font-semibold">เอกสารล่าสุด</h3>
        <Link
          href="/documents"
          className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline"
        >
          ดูทั้งหมด <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Tabs + view toggle */}
      <div className="flex items-center justify-between gap-3 px-5 pb-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={cn(
                "px-3.5 h-8 rounded-full text-[12.5px] font-medium transition-colors",
                tab === id
                  ? "bg-brand-500/12 text-brand-600 dark:text-brand-300"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {label}
              {byTab[id].length > 0 && (
                <span className="ml-1.5 text-[11px] opacity-70 tabular-nums">{byTab[id].length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {([
            { id: "table", Icon: List,       label: "มุมมองตาราง" },
            { id: "grid",  Icon: LayoutGrid, label: "มุมมองการ์ด" },
          ] as const).map(({ id, Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-pressed={view === id}
              aria-label={label}
              title={label}
              className={cn(
                "h-8 w-8 rounded-[9px] border flex items-center justify-center transition-colors",
                view === id
                  ? "border-brand-500/40 bg-brand-500/10 text-brand-600 dark:text-brand-300"
                  : "border-transparent text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-14 text-muted-foreground">
          <Inbox className="h-9 w-9 opacity-30" />
          <p className="text-[13px]">{emptyCopy[tab]}</p>
        </div>
      ) : view === "table" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left border-collapse">
            <thead>
              <tr className="border-y bg-muted/30 text-[11px] font-medium text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">ชื่อเอกสาร</th>
                <th className="px-3 py-2.5 font-medium">หมวดหมู่</th>
                <th className="px-3 py-2.5 font-medium">จาก</th>
                <th className="px-3 py-2.5 font-medium">วันที่</th>
                <th className="px-3 py-2.5 font-medium text-right">ยอดเงิน</th>
                <th className="px-5 py-2.5 font-medium text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {docs.map(doc => {
                const st = STATUS_STYLE[doc.status] ?? STATUS_STYLE.pending
                return (
                  <tr key={doc.id} className="hover:bg-muted/40 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <FileTag fileType={doc.fileType} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium truncate max-w-[220px]">{docTitle(doc)}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{docSubtitle(doc)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-300 text-[11px] font-medium whitespace-nowrap">
                        {doc.expenseCategory?.trim() || docSubtitle(doc)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-[12.5px] truncate max-w-[180px]">{docFrom(doc)}</p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <p className="text-[12.5px]">{formatDate(doc.docDate ?? doc.createdAt)}</p>
                      {docTime(doc) && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{docTime(doc)}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <p className="text-[13px] font-semibold tabular-nums">{formatThb(doc.totalAmount)}</p>
                      <span className={cn("inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium", st.cls)}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/documents/${doc.id}/review`}
                        aria-label={`เปิดเอกสาร ${docTitle(doc)}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full
                          text-muted-foreground hover:text-brand-600 hover:bg-brand-500/10 transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 px-5 pb-5">
          {docs.map(doc => {
            const st = STATUS_STYLE[doc.status] ?? STATUS_STYLE.pending
            return (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}/review`}
                className="dashboard-violet-action rounded-xl border bg-card p-3.5 block"
              >
                <div className="flex items-start gap-3">
                  <FileTag fileType={doc.fileType} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium truncate">{docTitle(doc)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{docFrom(doc)}</p>
                  </div>
                </div>
                <div className="flex items-end justify-between gap-2 mt-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold tabular-nums">{formatThb(doc.totalAmount)}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(doc.docDate ?? doc.createdAt)}</p>
                  </div>
                  <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0", st.cls)}>
                    {st.label}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}
