"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Single source of truth: @/lib/plans.ts
 * All plan names, quotas, and features are imported from there.
 * To add/change a plan → edit lib/plans.ts + run migration 012_pricing_plans.sql
 */

import { useState } from "react"
import {
  Check, Download, Zap, Star, PackagePlus,
  Loader2, AlertCircle, CheckCircle2, ToggleLeft, ToggleRight,
  FileText,
} from "lucide-react"
import { formatThb, formatDate, cn } from "@/lib/utils"
import { PLANS, ADDONS as PLAN_ADDONS, ANNUAL_DISCOUNT_PCT, annualMonthlyPrice, annualTotalPrice, type PlanId } from "@/lib/plans"

// ─── UI-only metadata — aligned with BUSINESS_MODEL.md plan structure ────────
// Consumer: free → pro → premium  |  Business: team → business → enterprise
const PLAN_UI: Record<string, {
  color:  string; ring: string; badge?: string; gradient?: string
}> = {
  free:       { color: "text-muted-foreground", ring: "" },
  // Consumer Subscription (40-50% revenue)
  pro:        { color: "text-indigo-600",  ring: "ring-2 ring-indigo-500/30", badge: "แนะนำ",
                gradient: "from-indigo-500/5 to-violet-500/5" },
  premium:    { color: "text-violet-600",  ring: "",
                gradient: "from-violet-500/5 to-pink-500/5" },
  // Business SaaS (30-40% revenue)
  team:       { color: "text-emerald-600", ring: "",
                gradient: "from-emerald-500/5 to-teal-500/5" },
  business:   { color: "text-brand-600",  ring: "ring-2 ring-brand-500/30", badge: "SME",
                gradient: "from-brand-500/5 to-indigo-500/5" },
  enterprise: { color: "text-slate-500",  ring: "" },
  // Legacy (inactive)
  starter:    { color: "text-sky-600",     ring: "" },
  personal:   { color: "text-indigo-600",  ring: "" },
  sme:        { color: "text-brand-600",   ring: "" },
}

const ADDONS = [
  { qty: 100, price: 199,  per: 1.99 },
  { qty: 300, price: 499,  per: 1.66, best: true },
  { qty: 500, price: 799,  per: 1.60 },
]

interface Props {
  org:      any
  invoices: any[]
  userRole: string
}

export function BillingClient({ org, invoices: dbInvoices, userRole }: Props) {
  const [yearly,        setYearly]        = useState(false)
  const [selectedPlan,  setSelectedPlan]  = useState<PlanId | null>(null)
  const [upgrading,     setUpgrading]     = useState<PlanId | null>(null)
  const [selectedAddon, setSelectedAddon] = useState<number | null>(null)
  const [buyingAddon,   setBuyingAddon]   = useState(false)
  const [successBanner, setSuccessBanner] = useState(
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("success") === "true"
  )

  const currentPlanId = (org?.plan ?? "free") as PlanId
  const currentPlan   = PLANS.find(p => p.id === currentPlanId)
  const used          = org?.doc_used  ?? 0
  const cap           = org?.doc_quota ?? currentPlan?.docQuota ?? 15
  const pct           = Math.min(100, Math.round((used / Math.max(cap, 1)) * 100))
  const barTone       = pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-brand-500"
  const isOwner       = userRole === "owner"

  const invoices = dbInvoices

  // ── Upgrade (uses selectedPlan or explicit planId) ────────────────────────
  const handleUpgrade = async (planId: PlanId) => {
    if (!isOwner) return
    setUpgrading(planId)
    try {
      const res = await fetch("/api/stripe/create-checkout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ planId, orgId: org?.id, yearly }),
      })
      const { url, error } = await res.json()
      if (error) throw new Error(error)
      window.location.href = url
    } catch (e: any) {
      alert("เกิดข้อผิดพลาด: " + e.message)
    } finally {
      setUpgrading(null)
    }
  }

  const handleManage = async () => {
    const res = await fetch("/api/stripe/portal", { method: "POST" })
    const { url } = await res.json()
    if (url) window.location.href = url
  }

  const handleBuyPack = async () => {
    if (selectedAddon === null) return
    setBuyingAddon(true)
    try {
      const qty = ADDONS[selectedAddon].qty
      const res = await fetch("/api/stripe/buy-pack", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ qty, orgId: org?.id }),
      })
      const { url, error } = await res.json()
      if (error) throw new Error(error)
      window.location.href = url
    } catch (e: any) {
      alert("เกิดข้อผิดพลาด: " + e.message)
    } finally {
      setBuyingAddon(false)
    }
  }

  return (
    <div className="page space-y-6 animate-fade-in">

      {/* ── Success banner ─────────────────────────────────────────────────── */}
      {successBanner && (
        <div className="rounded-[12px] bg-emerald-50 dark:bg-emerald-500/10 border
          border-emerald-200 dark:border-emerald-500/30 p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              อัปเกรดสำเร็จ! 🎉
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
              แพ็กเกจของคุณได้รับการอัปเดตแล้ว
            </p>
          </div>
          <button onClick={() => setSuccessBanner(false)}
            className="text-emerald-500 hover:text-emerald-700 text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[20px] font-bold">การเรียกเก็บเงิน</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">จัดการแพ็กเกจและการชำระเงิน</p>
        </div>
        {currentPlanId !== "free" && (
          <button onClick={handleManage}
            className="h-9 px-4 rounded-[10px] border border-border text-sm font-medium
              hover:bg-muted transition-colors">
            จัดการการสมัคร
          </button>
        )}
      </div>

      {/* ── Current plan card ──────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-[12px] p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              แพ็กเกจปัจจุบัน
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[24px] font-bold">
                {currentPlan?.nameEn ?? currentPlanId}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]
                font-medium bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> ใช้งานอยู่
              </span>
            </div>
            <p className="text-[12.5px] text-muted-foreground mt-1">
              {currentPlanId === "free"
                ? "ฟรีตลอด · ไม่มีหมดอายุ"
                : currentPlanId === "enterprise"
                ? "ติดต่อทีมงานเพื่อต่ออายุ"
                : "ต่ออายุอัตโนมัติทุกเดือน · ยกเลิกได้ทุกเมื่อ"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[28px] font-bold tabular-nums">
              {currentPlan?.priceTHB === 0
                ? currentPlanId === "enterprise" ? "Custom" : "฿0"
                : `฿${currentPlan?.priceTHB?.toLocaleString()}`}
            </div>
            {currentPlan?.priceTHB !== undefined && currentPlan.priceTHB > 0 && (
              <div className="text-[12px] text-muted-foreground">/เดือน</div>
            )}
          </div>
        </div>

        {/* Usage bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] font-medium">เอกสารที่ใช้เดือนนี้</span>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {used.toLocaleString()} / {cap === 0 ? "∞" : cap.toLocaleString()} ใบ
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barTone}`}
              style={{ width: `${cap === 0 ? 10 : pct}%` }} />
          </div>
          {pct >= 80 && cap > 0 && (
            <p className="text-[11.5px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              ใช้โควต้าไปแล้ว {pct}% — พิจารณาอัปเกรดหรือซื้อแพ็กเสริม
            </p>
          )}
        </div>
      </div>

      {/* ── Plan comparison ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-[15px] font-semibold">เปรียบเทียบแพ็กเกจ</h3>

        {/* monthly / annual toggle — matches landing page style */}
        <div className="inline-flex items-center gap-2 bg-muted/50 border border-border rounded-xl p-1">
          <button
            onClick={() => setYearly(false)}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all",
              !yearly ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            รายเดือน
          </button>
          <button
            onClick={() => setYearly(true)}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all flex items-center gap-1.5",
              yearly ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
            รายปี
            <span className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded-full transition-all",
              yearly
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
            )}>
              -{ANNUAL_DISCOUNT_PCT}%
            </span>
          </button>
        </div>
      </div>

      {yearly && (
        <p className="text-[12px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10
          border border-emerald-100 dark:border-emerald-500/20 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <Check className="w-3.5 h-3.5 shrink-0" />
          ชำระรายปี ประหยัด {ANNUAL_DISCOUNT_PCT}% เท่ากับได้ใช้ฟรี {Math.round(12 * ANNUAL_DISCOUNT_PCT / 100)} เดือน
          — ราคาที่แสดงคือต่อเดือนเมื่อชำระล่วงหน้า 12 เดือน
        </p>
      )}

      {/* Plan cards — rendered directly from lib/plans.ts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {PLANS.map(plan => {
          const ui           = PLAN_UI[plan.id] ?? { color: "", ring: "" }
          const isCurrent    = plan.id === currentPlanId
          const isSelected   = selectedPlan === plan.id
          const isLoading    = upgrading === plan.id
          const isEnterprise = plan.id === "enterprise"
          const isFree       = plan.priceTHB === 0 && !isEnterprise
          const canUpgrade   = isOwner && !isCurrent && !isEnterprise && !isFree

          // price to display — effective monthly (same logic as landing page)
          const effectiveMonthly = (yearly && plan.priceTHB > 0)
            ? annualMonthlyPrice(plan.priceTHB)
            : plan.priceTHB
          const yearlySavings = plan.priceTHB > 0
            ? (plan.priceTHB * 12) - annualTotalPrice(plan.priceTHB)
            : 0

          return (
            <div
              key={plan.id}
              onClick={() => canUpgrade && setSelectedPlan(isSelected ? null : plan.id as PlanId)}
              className={cn(
                "bg-card border rounded-[12px] p-5 flex flex-col relative transition-all duration-200",
                canUpgrade ? "cursor-pointer" : "cursor-default",
                isSelected
                  ? "border-brand-500 ring-2 ring-brand-500/40 shadow-lg shadow-brand-500/10 scale-[1.02]"
                  : plan.highlighted && !isCurrent
                  ? `border-brand-400 ${ui.ring}`
                  : "border-border",
                isCurrent && !isSelected && "border-brand-500/50 bg-brand-50/30 dark:bg-brand-500/5",
                canUpgrade && !isSelected && "hover:border-brand-300 hover:shadow-md",
              )}
            >
              {/* Popular badge */}
              {ui.badge && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                    text-[11px] font-semibold bg-brand-500 text-white whitespace-nowrap">
                    <Star className="w-3 h-3" /> {ui.badge}
                  </span>
                </div>
              )}

              {/* Plan tagline + name */}
              <div>
                <p className={`text-[11px] font-medium ${ui.color}`}>
                  {plan.taglineTh}
                </p>
                <h4 className="text-[17px] font-bold mt-0.5">{plan.nameEn}</h4>

                {/* Price block */}
                <div className="mt-3">
                  {isEnterprise ? (
                    <span className="text-[22px] font-bold">Custom</span>
                  ) : isFree ? (
                    <span className="text-[22px] font-bold">ฟรี</span>
                  ) : (
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      {/* strikethrough original when yearly */}
                      {yearly && (
                        <span className="text-[13px] line-through text-muted-foreground/60 tabular-nums">
                          ฿{plan.priceTHB.toLocaleString()}
                        </span>
                      )}
                      <span className="text-[22px] font-bold tabular-nums">
                        ฿{effectiveMonthly.toLocaleString()}
                      </span>
                      <span className="text-[11px] text-muted-foreground pb-0.5">
                        /เดือน{yearly ? " (ชำระรายปี)" : ""}
                      </span>
                    </div>
                  )}

                  {/* savings line when yearly */}
                  {yearly && plan.priceTHB > 0 && (
                    <p className="text-[10.5px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium">
                      ประหยัด ฿{yearlySavings.toLocaleString()}/ปี
                    </p>
                  )}
                </div>

                {/* Quota pill */}
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                  bg-muted text-[11px] text-muted-foreground">
                  <FileText className="w-3 h-3" />
                  {plan.docQuota === 0
                    ? `ไม่จำกัด${plan.fairUseCapDocs ? ` (Fair use ~${plan.fairUseCapDocs.toLocaleString()}/เดือน)` : ""}`
                    : `${plan.docQuota.toLocaleString()} ใบ/เดือน`}
                </div>
              </div>

              {/* Features — from lib/plans.ts */}
              <ul className="mt-4 space-y-2 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-foreground">
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                disabled={!canUpgrade || isLoading}
                onClick={e => {
                  e.stopPropagation()
                  if (isEnterprise) {
                    window.location.href = "mailto:hello@slippy.app?subject=Enterprise Plan"
                    return
                  }
                  if (canUpgrade) handleUpgrade(plan.id as PlanId)
                }}
                className={cn(
                  "mt-5 h-9 rounded-[10px] text-sm font-medium transition-all w-full",
                  "inline-flex items-center justify-center gap-2",
                  isCurrent
                    ? "bg-muted text-muted-foreground cursor-default"
                    : isFree
                    ? "bg-muted text-muted-foreground cursor-default"
                    : isSelected
                    ? "bg-brand-500 hover:bg-brand-600 text-white shadow-md"
                    : isEnterprise
                    ? "border border-border bg-card text-foreground hover:bg-muted"
                    : plan.highlighted
                    ? "bg-brand-500 hover:bg-brand-600 text-white"
                    : "border border-border bg-card text-foreground hover:bg-muted"
                )}
              >
                {isLoading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลด...</>
                  : isCurrent
                  ? <><Check className="w-3.5 h-3.5" /> แพ็กเกจปัจจุบัน</>
                  : isEnterprise
                  ? "ติดต่อทีมงาน"
                  : isFree
                  ? "แพ็กเกจเริ่มต้น"
                  : isSelected
                  ? <><Zap className="w-3.5 h-3.5" /> อัปเกรดเลย</>
                  : "เลือก"}
              </button>

              {!isCurrent && !isFree && !isEnterprise && (
                <p className="text-[10px] text-muted-foreground text-center mt-1.5">
                  ยกเลิกได้ทุกเมื่อ
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Floating upgrade bar (appears when a plan is selected) ──────────── */}
      {selectedPlan && isOwner && (() => {
        const sp            = PLANS.find(p => p.id === selectedPlan)!
        const effMonthly    = yearly ? annualMonthlyPrice(sp.priceTHB) : sp.priceTHB
        const totalLabel    = yearly
          ? `฿${annualTotalPrice(sp.priceTHB).toLocaleString()}/ปี`
          : `฿${sp.priceTHB.toLocaleString()}/เดือน`
        const savings       = yearly ? (sp.priceTHB * 12) - annualTotalPrice(sp.priceTHB) : 0
        return (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
            bg-card border border-brand-500/40 shadow-xl shadow-brand-500/10
            rounded-2xl px-6 py-3.5 flex items-center gap-5 animate-fade-in">
            <div>
              <p className="text-[12px] text-muted-foreground">แพ็กเกจที่เลือก</p>
              <p className="text-[15px] font-bold">{sp.nameEn}
                <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                  ฿{effMonthly.toLocaleString()}/เดือน{yearly ? " (ชำระรายปี)" : ""} · {sp.docQuota} ใบ/เดือน
                </span>
              </p>
              {yearly && savings > 0 && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {totalLabel} · ประหยัด ฿{savings.toLocaleString()}/ปี
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setSelectedPlan(null)}
                className="h-9 px-4 rounded-[10px] border border-border text-sm
                  hover:bg-muted transition-colors"
              >
                ยกเลิก
              </button>
              <button
                disabled={!!upgrading}
                onClick={() => handleUpgrade(selectedPlan)}
                className="h-9 px-5 rounded-[10px] bg-brand-500 hover:bg-brand-600
                  text-white text-sm font-medium transition-colors
                  inline-flex items-center gap-2 disabled:opacity-60"
              >
                {upgrading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />กำลังโหลด...</>
                  : <><Zap className="w-3.5 h-3.5" />อัปเกรดเป็น {sp.nameEn}</>}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Not owner warning */}
      {!isOwner && (
        <p className="text-[12.5px] text-muted-foreground flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          เฉพาะ Owner ขององค์กรเท่านั้นที่สามารถเปลี่ยนแพ็กเกจได้
        </p>
      )}

      {/* ── Doc pack add-ons ──────────────────────────────────────────────── */}
      {currentPlanId !== "free" && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[15px] font-semibold">ซื้อเอกสารเพิ่ม</h3>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]
              font-medium bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <Zap className="w-3 h-3" /> One-time
            </span>
          </div>
          <p className="text-[12.5px] text-muted-foreground mb-4">
            ซื้อครั้งเดียว ใช้ได้ทันที ไม่มีวันหมดอายุ
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {ADDONS.map((a, i) => (
              <div
                key={i}
                onClick={() => setSelectedAddon(selectedAddon === i ? null : i)}
                className={cn(
                  "bg-card border rounded-[12px] p-5 relative cursor-pointer transition-all",
                  selectedAddon === i
                    ? "border-brand-500 ring-2 ring-brand-500/20"
                    : "border-border hover:border-brand-300"
                )}
              >
                {a.best && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                      text-[11px] font-semibold bg-emerald-500 text-white whitespace-nowrap">
                      คุ้มที่สุด
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-[10px] bg-brand-500/10 flex items-center justify-center">
                    <PackagePlus className="w-5 h-5 text-brand-500" />
                  </div>
                  <div>
                    <div className="text-[18px] font-bold tabular-nums">+{a.qty} ใบ</div>
                    <div className="text-[11.5px] text-muted-foreground">฿{a.per.toFixed(2)}/ใบ</div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-[20px] font-bold tabular-nums">฿{a.price}</div>
                    <div className="text-[11px] text-muted-foreground">one-time</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {selectedAddon !== null && (
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleBuyPack}
                disabled={buyingAddon}
                className="h-9 px-5 rounded-[10px] bg-brand-500 hover:bg-brand-600 text-white
                  text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-60"
              >
                {buyingAddon
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />กำลังโหลด...</>
                  : <><Zap className="w-3.5 h-3.5" />ซื้อ +{ADDONS[selectedAddon].qty} ใบ · ฿{ADDONS[selectedAddon].price}</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Tax Report Add-ons ────────────────────────────────────────────── */}
      {["pro", "premium", "team", "business", "enterprise"].includes(currentPlanId) && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[15px] font-semibold">รายงานภาษี (Add-on)</h3>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]
              font-medium bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
              <FileText className="w-3 h-3" /> One-time
            </span>
          </div>
          <p className="text-[12.5px] text-muted-foreground mb-4">
            Export รายงานภาษีสรอ.กรมสรรพากร · จ่ายครั้งเดียวต่อรอบภาษี
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Object.entries(PLAN_ADDONS.taxReport).map(([key, addon]) => (
              <div key={key}
                className="bg-card border border-border rounded-[12px] p-5 flex items-center
                  justify-between hover:border-violet-300 transition-colors cursor-pointer"
                onClick={async () => {
                  const res = await fetch("/api/stripe/buy-addon", {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify({ addonKey: key, orgId: org?.id }),
                  })
                  const { url, error: err } = await res.json()
                  if (err) { alert("เกิดข้อผิดพลาด: " + err); return }
                  if (url) window.location.href = url
                }}
              >
                <div>
                  <div className="text-[14px] font-semibold">{addon.nameTh}</div>
                  <div className="text-[11.5px] text-muted-foreground mt-0.5">Export PDF/Excel</div>
                </div>
                <div className="text-right">
                  <div className="text-[20px] font-bold tabular-nums">฿{addon.priceTHB}</div>
                  <div className="text-[11px] text-muted-foreground">ครั้งเดียว</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Extra Seats info ──────────────────────────────────────────────── */}
      {(() => {
        const cp = PLANS.find(p => p.id === currentPlanId)
        if (!cp || cp.extraSeatTHB === 0) return null
        return (
          <div className="bg-muted/30 border border-border rounded-[12px] p-5 flex
            items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-[14px] font-semibold">เพิ่มสมาชิกทีม</h3>
              <p className="text-[12.5px] text-muted-foreground mt-0.5">
                แพ็กเกจปัจจุบันรองรับ{cp.maxUsers > 0 ? ` ${cp.maxUsers} คน` : "ไม่จำกัดคน"} ·
                เพิ่มได้ ฿{cp.extraSeatTHB}/คน/เดือน
              </p>
            </div>
            <button
              onClick={handleManage}
              className="h-9 px-4 rounded-[10px] border border-border text-sm font-medium
                hover:bg-muted transition-colors whitespace-nowrap"
            >
              จัดการสมาชิก
            </button>
          </div>
        )
      })()}

      {/* ── Invoice history ───────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-[12px] overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-[15px] font-semibold">ประวัติการชำระเงิน</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11.5px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">เลขที่</th>
                <th className="text-left px-3 py-2.5 font-medium">วันที่</th>
                <th className="text-left px-3 py-2.5 font-medium">รายการ</th>
                <th className="text-right px-3 py-2.5 font-medium">ยอด</th>
                <th className="text-left px-3 py-2.5 font-medium">สถานะ</th>
                <th className="text-right pr-5 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                        <FileText className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <p className="text-[13px] font-medium text-foreground">ยังไม่มีประวัติการชำระเงิน</p>
                      <p className="text-[12px] text-muted-foreground">
                        {currentPlanId === "free"
                          ? "อัปเกรดแพ็กเกจเพื่อเริ่มใช้งานฟีเจอร์เพิ่มเติม"
                          : "ใบเสร็จจะปรากฏที่นี่หลังการชำระเงินครั้งแรก"}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                invoices.map((inv: any, i: number) => (
                  <tr key={inv.no ?? inv.id ?? i} className="hover:bg-muted/30">
                    <td className="px-5 py-3 font-mono text-[12px] text-muted-foreground">
                      {inv.no ?? inv.invoice_number ?? `INV-${i + 1}`}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatDate(inv.date ?? inv.created_at ?? "")}
                    </td>
                    <td className="px-3 py-3 font-medium">{inv.plan ?? inv.description ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold">
                      {formatThb(inv.amount ?? inv.amount_thb ?? 0)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
                        text-[11px] font-medium bg-emerald-50 text-emerald-700
                        dark:bg-emerald-500/10 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> ชำระแล้ว
                      </span>
                    </td>
                    <td className="px-3 py-3 pr-5 text-right">
                      <button className="h-7 w-7 rounded-[6px] hover:bg-muted flex items-center
                        justify-center text-muted-foreground ml-auto transition-colors">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
