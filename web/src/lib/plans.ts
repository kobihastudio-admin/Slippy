/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 *
 * Single source of truth for plan definitions.
 * Source: docs/BUSINESS_MODEL.md — Consumer Subscription + Business SaaS Model
 *
 * Revenue Mix (Target):
 *   Subscription SaaS    40%  — recurring, predictable
 *   Seat + Storage       20%  — scales with org size
 *   Transaction fees     15%  — scales with usage
 *   Professional svc     15%  — high margin, non-AI
 *   Partnership/referral 10%  — passive income
 *
 * AI Model Routing (controls cost):
 *   modelTier: "haiku"    → Haiku-only  (~฿0.22/doc)  — Free/Starter
 *   modelTier: "smart"    → Smart route (~฿0.43/doc)  — Pro/Team
 *   modelTier: "priority" → Sonnet-first (~฿0.91/doc) — Business/Enterprise
 */

export const ANNUAL_DISCOUNT_PCT = 20  // % off monthly price when billed annually

export function annualMonthlyPrice(monthlyTHB: number): number {
  return Math.round(monthlyTHB * (1 - ANNUAL_DISCOUNT_PCT / 100))
}
export function annualTotalPrice(monthlyTHB: number): number {
  return annualMonthlyPrice(monthlyTHB) * 12
}

// ─── Plan IDs ─────────────────────────────────────────────────────────────────
export type PlanId    = "free" | "pro" | "premium" | "team" | "business" | "enterprise"
export type ModelTier = "haiku" | "smart" | "priority"

export interface PlanFeatures {
  aiExtraction:    boolean   // AI OCR + two-pass extraction
  lineBot:         boolean   // LINE Bot integration
  emailIngestion:  boolean   // Email attachment ingestion
  splitBill:       boolean   // Split bill (basic)
  splitBillFee:    boolean   // Split bill with payment collection (fee-based)
  taxReports:      boolean   // ภ.ง.ด.3/53, ภ.พ.30 export
  lifeGraph:       boolean   // Life Graph (Wealth + Journey + Social)
  aiAssistant:     boolean   // AI Chat with Life Graph context
  aiSearch:        boolean   // Semantic document search
  aiCoach:         boolean   // AI Coach (Premium+)
  lifeInsights:    boolean   // AI-generated insights
  multiUser:       boolean   // Multiple team members
  expenseClaims:   boolean   // Team expense claims & approval (Team+)
  flowAccount:     boolean   // FlowAccount / PEAK sync
  apiAccess:       boolean   // REST API access (Business+)
  sso:             boolean   // SSO (Enterprise)
  priorityAI:      boolean   // Priority AI processing queue (Premium+)
  whiteLabel:      boolean   // White-label (Enterprise)
}

export interface Plan {
  id:            PlanId
  nameTh:        string
  nameEn:        string
  taglineTh:     string
  taglineEn:     string
  priceTHB:      number       // 0 = free or contact sales
  docQuota:      number       // docs/month; 0 = unlimited
  /** Fair-use ceiling for "unlimited" (docQuota=0) plans — see
   * supabase/migrations/071_fair_use_doc_caps.sql, which is the actual
   * enforcement point (pricing_plans.doc_quota). Kept here too so the UI can
   * disclose it next to "ไม่จำกัดเอกสาร" instead of advertising a limit that
   * silently exists in the backend but not in the marketing copy.
   * undefined = genuinely no cap (Enterprise, contract-based). */
  fairUseCapDocs?: number
  orgQuota:      number       // max orgs owned; 0 = unlimited
  maxUsers:      number       // max seats; 0 = unlimited
  extraSeatTHB:  number       // ราคา/seat เพิ่ม; 0 = ไม่รองรับ
  modelTier:     ModelTier    // controls AI model routing & cost
  storageGB:     number       // Storage GB; 0 = unlimited
  category:      "consumer" | "business"
  planFeatures:  PlanFeatures
  features:      string[]
  highlighted?:  boolean
  badge?:        string
}

// ─── Plans ────────────────────────────────────────────────────────────────────
export const PLANS: Plan[] = [

  // ── Free — ลองใช้งาน ──────────────────────────────────────────────────────
  {
    id:           "free",
    nameTh:       "ฟรี",
    nameEn:       "Free",
    taglineTh:    "เริ่มต้นใช้งาน — ไม่ต้องใส่บัตรเครดิต",
    taglineEn:    "Get started — no credit card needed",
    priceTHB:     0,
    docQuota:     15,       // 15 docs/เดือน (ลองได้จริง)
    orgQuota:     1,
    maxUsers:     1,
    extraSeatTHB: 0,
    modelTier:    "haiku",  // Haiku-only — cost ~฿0.22/doc × 15 = ฿3.3/user
    storageGB:    1,
    category:     "consumer",
    planFeatures: {
      aiExtraction:  true,  lineBot:       true,  emailIngestion: false,
      splitBill:     true,  splitBillFee:  true,  taxReports:     false,
      lifeGraph:     true,  aiAssistant:   false, aiSearch:       false,
      aiCoach:       false, lifeInsights:  false, multiUser:      true,
      expenseClaims: false, flowAccount:   false, apiAccess:      false,
      sso:           false, priorityAI:    false, whiteLabel:     false,
    },
    features: [
      "หารบิล + เก็บเงินออนไลน์ ไม่จำกัด",
      "นัดกีฬา + ทริปกับเพื่อน ไม่จำกัด",
      "เพิ่มเพื่อนผ่าน QR / LINE ไม่จำกัด",
      "15 เอกสาร AI / เดือน",
      "AI อ่านใบเสร็จ + ใบกำกับภาษี",
      "เชื่อมต่อ LINE Bot",
      "Dashboard ค่าใช้จ่าย",
      "ซัพพอร์ตทางอีเมล",
    ],
  },

  // ── Pro ฿199 — Smart routing, AI ครบ, แนะนำ ──────────────────────────────
  {
    id:           "pro",
    nameTh:       "Pro",
    nameEn:       "Pro",
    taglineTh:    "สำหรับผู้ใช้ส่วนตัว — AI ครบทุกฟีเจอร์",
    taglineEn:    "Personal users — full AI features",
    priceTHB:     199,
    docQuota:     0,        // unlimited (fair use — see fairUseCapDocs)
    fairUseCapDocs: 500,
    orgQuota:     3,
    maxUsers:     1,
    extraSeatTHB: 99,       // เพิ่ม seat ได้ ฿99/คน/เดือน
    modelTier:    "smart",  // Haiku 70% / Sonnet 30% — avg ~฿0.43/doc
    storageGB:    20,
    category:     "consumer",
    highlighted:  true,
    badge:        "แนะนำ",
    planFeatures: {
      aiExtraction:  true,  lineBot:       true,  emailIngestion: true,
      splitBill:     true,  splitBillFee:  true,  taxReports:     true,
      lifeGraph:     true,  aiAssistant:   true,  aiSearch:       true,
      aiCoach:       false, lifeInsights:  true,  multiUser:      false,
      expenseClaims: false, flowAccount:   false, apiAccess:      false,
      sso:           false, priorityAI:    false, whiteLabel:     false,
    },
    features: [
      "ไม่จำกัดเอกสาร (Fair use ~500/เดือน)",
      "AI OCR แม่นยำสูง (Smart routing)",
      "AI Assistant — ถามตอบเอกสาร",
      "AI Search — ค้นด้วยภาษาธรรมชาติ",
      "Life Graph — Wealth + Journey + Social",
      "Export ภ.ง.ด.3/53, ภ.พ.30",
      "รับเอกสารทางอีเมล",
      "20 GB Storage",
    ],
  },

  // ── Premium ฿499 — Sonnet priority, AI Coach ──────────────────────────────
  {
    id:           "premium",
    nameTh:       "Premium",
    nameEn:       "Premium",
    taglineTh:    "สำหรับ Power Users — AI Coach ส่วนตัว",
    taglineEn:    "Power users — personal AI Coach",
    priceTHB:     499,
    docQuota:     0,
    fairUseCapDocs: 600,
    orgQuota:     5,
    maxUsers:     1,
    extraSeatTHB: 149,
    modelTier:    "priority", // Sonnet-first — ความแม่นสูงสุด
    storageGB:    50,
    category:     "consumer",
    badge:        "AI Coach",
    planFeatures: {
      aiExtraction:  true,  lineBot:       true,  emailIngestion: true,
      splitBill:     true,  splitBillFee:  true,  taxReports:     true,
      lifeGraph:     true,  aiAssistant:   true,  aiSearch:       true,
      aiCoach:       true,  lifeInsights:  true,  multiUser:      false,
      expenseClaims: false, flowAccount:   false, apiAccess:      false,
      sso:           false, priorityAI:    true,  whiteLabel:     false,
    },
    features: [
      "ทุกอย่างใน Pro",
      "AI OCR Priority (Sonnet เต็มรูปแบบ)",
      "AI Coach ส่วนตัว",
      "Life Score (4 domains)",
      "Advanced Analytics",
      "Priority AI Processing",
      "Life Insights รายสัปดาห์",
      "Budget AI Recommendations",
      "50 GB Storage",
    ],
  },

  // ── Team ฿999 — Multi-user, expense workflow ──────────────────────────────
  {
    id:           "team",
    nameTh:       "ทีม",
    nameEn:       "Team",
    taglineTh:    "สำหรับธุรกิจขนาดเล็ก — จัดการค่าใช้จ่ายทีม",
    taglineEn:    "Small business — team expense management",
    priceTHB:     999,
    docQuota:     0,
    fairUseCapDocs: 2500,
    orgQuota:     0,
    maxUsers:     10,
    extraSeatTHB: 99,
    modelTier:    "smart",
    storageGB:    100,
    category:     "business",
    planFeatures: {
      aiExtraction:  true,  lineBot:       true,  emailIngestion: true,
      splitBill:     true,  splitBillFee:  true,  taxReports:     true,
      lifeGraph:     true,  aiAssistant:   true,  aiSearch:       true,
      aiCoach:       false, lifeInsights:  true,  multiUser:      true,
      expenseClaims: true,  flowAccount:   false, apiAccess:      false,
      sso:           false, priorityAI:    false, whiteLabel:     false,
    },
    features: [
      "ไม่จำกัดเอกสาร (Fair use ~2,500/เดือน)",
      "10 สมาชิก (เพิ่มได้ ฿99/คน)",
      "เบิกค่าใช้จ่าย + Approval Workflow",
      "Audit Trail ทุกรายการ",
      "Reports VAT + WHT ครบ",
      "AI Assistant สำหรับทีม",
      "100 GB Storage",
    ],
  },

  // ── Business ฿2,990 — Priority Sonnet, FlowAccount, API ──────────────────
  {
    id:           "business",
    nameTh:       "ธุรกิจ",
    nameEn:       "Business",
    taglineTh:    "สำหรับ SME — ระบบบัญชีครบวงจร",
    taglineEn:    "SME — complete accounting system",
    priceTHB:     2990,
    docQuota:     0,
    fairUseCapDocs: 5000,
    orgQuota:     0,
    maxUsers:     0,        // unlimited
    extraSeatTHB: 149,
    modelTier:    "priority",
    storageGB:    500,
    category:     "business",
    highlighted:  true,
    badge:        "SME",
    planFeatures: {
      aiExtraction:  true,  lineBot:       true,  emailIngestion: true,
      splitBill:     true,  splitBillFee:  true,  taxReports:     true,
      lifeGraph:     true,  aiAssistant:   true,  aiSearch:       true,
      aiCoach:       true,  lifeInsights:  true,  multiUser:      true,
      expenseClaims: true,  flowAccount:   true,  apiAccess:      true,
      sso:           false, priorityAI:    true,  whiteLabel:     false,
    },
    features: [
      "ไม่จำกัดเอกสาร (Fair use ~5,000/เดือน)",
      "ไม่จำกัดสมาชิก (฿149/คน)",
      "AI OCR Priority (Sonnet เต็มรูปแบบ)",
      "หลายแผนก / หน่วยงาน",
      "Export เข้า Google Sheets อัตโนมัติ (เชื่อมต่อระบบบัญชีอื่นๆ เร็วๆ นี้)",
      "API Access + Webhook",
      "Advanced Reports + VAT ภ.พ.30",
      "Priority Support",
      "500 GB Storage",
    ],
  },

  // ── Enterprise — White-label, SSO ────────────────────────────────────────
  {
    id:           "enterprise",
    nameTh:       "องค์กร",
    nameEn:       "Enterprise",
    taglineTh:    "สำหรับองค์กรขนาดใหญ่ — ราคาพิเศษ",
    taglineEn:    "Large corporations — custom pricing",
    priceTHB:     0,
    docQuota:     0,
    orgQuota:     0,
    maxUsers:     0,
    extraSeatTHB: 0,
    modelTier:    "priority",
    storageGB:    0,
    category:     "business",
    planFeatures: {
      aiExtraction:  true,  lineBot:       true,  emailIngestion: true,
      splitBill:     true,  splitBillFee:  true,  taxReports:     true,
      lifeGraph:     true,  aiAssistant:   true,  aiSearch:       true,
      aiCoach:       true,  lifeInsights:  true,  multiUser:      true,
      expenseClaims: true,  flowAccount:   true,  apiAccess:      true,
      sso:           true,  priorityAI:    true,  whiteLabel:     true,
    },
    features: [
      "White-label (แบรนด์บริษัทบัญชีเอง)",
      "SSO / SAML Integration",
      "SLA 99.9% + Dedicated Support",
      "On-premise option",
      "Custom AI Model",
      "ไม่จำกัดสมาชิก + Storage",
      "ทุกฟีเจอร์ใน Business",
    ],
  },
]

export const PLAN_MAP = Object.fromEntries(
  PLANS.map(p => [p.id, p])
) as Record<PlanId, Plan>

// ─── Add-on pricing (transaction / one-time) ──────────────────────────────────
export const ADDONS = {
  taxReport: {
    wht3_53:  { nameTh: "ภ.ง.ด. 3 / 53",        priceTHB: 49  },
    vat30:    { nameTh: "ภ.พ. 30 (VAT return)",  priceTHB: 99  },
    annual:   { nameTh: "สรุปประจำปี PDF",        priceTHB: 199 },
  },
  splitBillFee:  0.015,   // 1.5% ของยอดที่เก็บ (ขั้นต่ำ ฿5)
  extraStorage:  49,      // ฿49/GB/เดือน เกิน quota
  lineOaSetup:   2990,    // ฿2,990 ครั้งเดียว (professional service)
  lineOaMaintain: 499,    // ฿499/เดือน maintenance
} as const

// ─── Helper functions ─────────────────────────────────────────────────────────
export function getPlan(planId: string): Plan {
  return PLAN_MAP[planId as PlanId] ?? PLAN_MAP.free
}

export function getModelTier(planId: string): ModelTier {
  return getPlan(planId).modelTier
}

export function getDocQuota(planId: string): number {
  return getPlan(planId).docQuota
}

export function isQuotaExceeded(planId: string, docUsed: number): boolean {
  const quota = getDocQuota(planId)
  return quota > 0 && docUsed >= quota
}

export function getPlanFeatures(planId: string): PlanFeatures {
  return getPlan(planId).planFeatures
}

export function hasFeature(planId: string, feature: keyof PlanFeatures): boolean {
  return getPlanFeatures(planId)[feature] ?? false
}

export function getOrgQuota(planId: string): number {
  return getPlan(planId).orgQuota
}

export function isOrgQuotaExceeded(planId: string, ownedOrgCount: number): boolean {
  const quota = getOrgQuota(planId)
  return quota > 0 && ownedOrgCount >= quota
}

export function getMaxUsers(planId: string): number {
  return getPlan(planId).maxUsers
}

export function canAddUser(planId: string, currentUsers: number): boolean {
  const max = getMaxUsers(planId)
  return max === 0 || currentUsers < max
}

// ─── AI cost estimation (for admin dashboard) ─────────────────────────────────
const AI_COST_PER_DOC_THB: Record<ModelTier, number> = {
  haiku:    0.22,
  smart:    0.43,
  priority: 0.91,
}

export function estimateAiCostThb(planId: string, docCount: number): number {
  return AI_COST_PER_DOC_THB[getModelTier(planId)] * docCount
}

export function estimateMarginThb(planId: string, docCount: number): number {
  const plan = getPlan(planId)
  return plan.priceTHB - estimateAiCostThb(planId, docCount)
}

// ─── Creator Economy (from BUSINESS_MODEL.md) ─────────────────────────────────
export const CREATOR_LEVELS = [
  { level: 1, title: "Referral",            reward: "User Acquisition",        revenue: null },
  { level: 2, title: "Community Leader",    reward: "Community Subscription",  revenue: "70/30 split" },
  { level: 3, title: "AI Coach Creator",    reward: "AI Persona Subscription", revenue: "50/50 split" },
  { level: 4, title: "Marketplace Creator", reward: "Product/Affiliate Sales", revenue: "80/20 split" },
]

export const COMMUNITY_PRICE_THB = 99  // per community subscription/month

// ─── Revenue Mix Targets ──────────────────────────────────────────────────────
export const REVENUE_MIX = {
  subscription: { pct: 40, label: "Subscription SaaS" },
  seatStorage:  { pct: 20, label: "Seat + Storage" },
  transaction:  { pct: 15, label: "Transaction Fees" },
  services:     { pct: 15, label: "Professional Services" },
  partnership:  { pct: 10, label: "Partnership / Referral" },
}

// ─── North Star Metric ────────────────────────────────────────────────────────
export const NORTH_STAR_METRIC   = "WALU"
export const ANNUAL_DISCOUNT_LABEL = `ประหยัด ${ANNUAL_DISCOUNT_PCT}% เมื่อจ่ายรายปี`
