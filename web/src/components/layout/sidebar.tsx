"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useState }                    from "react"
import Link                            from "next/link"
import { usePathname, useRouter }      from "next/navigation"
import { useTranslations }             from "next-intl"
import { Icons }         from "@/components/ui/icons"
import { cn }            from "@/lib/utils"
import { createClient }  from "@/lib/supabase/client"
import { LogoMark }      from "@/components/ui/logo"
import type { OrgOption } from "./app-shell"

// ─── Phase 1 feature flags ────────────────────────────────────────────────────
// Set to true when ready to enable
//
// The four below are OFF because the features exist but are not in use yet, and
// an unused entry in a sidebar is worse than a missing one — it costs a click to
// find out it is empty. Every route, page and API still works; only the way in
// is hidden, so turning one back on is a one-line change and nothing else.
const SHOW_PERSONAL_SPACE = false  // group "พื้นที่ส่วนตัว" — ยังไม่ได้ใช้ (22 Aug 2026)
const SHOW_SOCIAL_SPACE   = false  // group "Vita Social"   — ยังไม่ได้ใช้ (22 Aug 2026)
const SHOW_LIFE_GRAPH     = false  // /life                 — ยังไม่ได้ใช้ (22 Aug 2026)
const SHOW_BUDGET         = false  // /budget งบประมาณ       — ยังไม่ได้ใช้ (22 Aug 2026)
const SHOW_CLAIMS         = false  // /claims เบิกค่าใช้จ่าย  — ยังไม่ได้ใช้ (22 Aug 2026)
/**
 * /tax renders corporate tax (VAT ภ.พ.30 + WHT) for an organization account and
 * personal tax for a personal one — one route, two faces. Only the personal face
 * is unused, so this hides the entry in personal mode and leaves ภาษีองค์กร,
 * which is in active use, exactly where it was.
 */
const SHOW_PERSONAL_TAX   = false  // "ภาษีส่วนบุคคล"        — ยังไม่ได้ใช้ (22 Aug 2026)
const SHOW_LINE_STUDIO    = true   // Phase 1: LINE Bot management

// ─── Business / Organization (Phase 1) ───────────────────────────────────────
// Tax here = VAT (ภ.พ.30) + WHT (ภ.ง.ด.3/53) — corporate tax only

// Group 1: ภาพรวม (Overview) — core, always-visible items
const navItems = [
  { key: "dashboard",  href: "/dashboard",   icon: Icons.Dashboard },
  ...(SHOW_LIFE_GRAPH ? [{ key: "life", href: "/life", icon: Icons.Brain }] : []),
  { key: "documents",  href: "/documents",   icon: Icons.FileText  },
]

// Group 2: การเงิน & ภาษี (Finance & Tax)
const financeItems = [
  { key: "analytics",  href: "/analytics",   icon: Icons.BarChart  },
  ...(SHOW_BUDGET ? [{ key: "budget", href: "/budget",  icon: Icons.Target    }] : []),
  ...(SHOW_CLAIMS ? [{ key: "claims", href: "/claims",  icon: Icons.Briefcase }] : []),  // Business Suite V4
  { key: "tax",        href: "/tax",          icon: Icons.Receipt   },
  { key: "vendors",    href: "/vendors",      icon: Icons.Building  },
]

// Group 3: กิจกรรม & เครื่องมือ (Activities & Tools)
const activityItems = [
  { key: "trips",      href: "/trips",        icon: Icons.MapPin,       label: undefined },  // ทริป & กิจกรรม
  { key: "activities", href: "/activities",   icon: Icons.Calendar,     label: undefined },
  { key: "split",      href: "/split",        icon: Icons.Split,        label: undefined },  // หารบิล (ใช้ร่วมกันทั้งโหมดองค์กร/ส่วนตัว)
  { key: "incomeBills", href: "/split/income", icon: Icons.Wallet,      label: undefined },  // บิลรายรับ — สลิป + สถิติจากกลุ่มต่างๆ
  { key: "messages",   href: "/messages",     icon: Icons.MessageSquare, label: "ข้อความ" },
  { key: "friends",    href: "/social/friends", icon: Icons.Users2,     label: "เพื่อน" },
  ...(SHOW_LINE_STUDIO    ? [{ key: "lineStudio", href: "/line-studio", icon: Icons.LineBot,    label: undefined }] : []),
]

// ─── Personal Space (Phase 2) ─────────────────────────────────────────────────
// Note: tax/split live in the shared groups above — /tax has org + personal tabs,
// and หารบิล works the same in both modes, so we don't duplicate them here.
const personalItems = [
  { key: "personal",   href: "/personal",          icon: Icons.Leaf     },  // overview
  { key: "health",     href: "/personal/health",   icon: Icons.Activity },
  { key: "planner",    href: "/personal/planner",  icon: Icons.Target   },
  // Phase 2 — hidden until Vita scoring is stable:
  // { key: "wealth", href: "/personal/wealth", icon: Icons.Wallet },
  // { key: "vita",   href: "/personal/vita",   icon: Icons.Heart  },
]

// ─── Vita Social (Phase 2) ────────────────────────────────────────────────────
const socialItems = [
  { key: "social",     href: "/social",          icon: Icons.Globe,       label: "Social Feed", color: "text-violet-500 dark:text-violet-400" },
  { key: "discover",   href: "/social/discover", icon: Icons.Compass,     label: "ค้นพบ",       color: "text-indigo-500 dark:text-indigo-400" },
  { key: "createPost", href: "/social/create",   icon: Icons.PenLine,     label: "สร้าง Post",  color: "text-pink-500 dark:text-pink-400"    },
  { key: "shop",       href: "/shop",            icon: Icons.ShoppingBag, label: "ร้านค้า",     color: "text-fuchsia-500 dark:text-fuchsia-400" },
]

const bottomItems = [
  { key: "billing",       href: "/billing",               icon: Icons.CreditCard },
  { key: "members",       href: "/settings/members",      icon: Icons.Users },
  { key: "integrations",  href: "/settings/integrations", icon: Icons.Plug },
  { key: "notifications", href: "/notifications",         icon: Icons.Bell },
  { key: "privacy",       href: "/privacy",               icon: Icons.ShieldCheck },
  { key: "profile",       href: "/profile",               icon: Icons.User },
  { key: "settings",      href: "/settings",              icon: Icons.Settings },
  { key: "help",          href: "/help",                  icon: Icons.HelpCircle },
]

interface SidebarProps {
  org:            { id: string; name: string; plan: string }
  allOrgs:        OrgOption[]
  user:           { full_name: string; email: string; avatar_url?: string }
  collapsed:      boolean
  mobileOpen:     boolean
  onToggle:       () => void
  onMobileClose:  () => void
  isSuperadmin?:  boolean
  accountType?:   "business" | "personal"
}

export function Sidebar({ org, allOrgs, user, collapsed, mobileOpen, onToggle, onMobileClose, isSuperadmin = false, accountType = "business" }: SidebarProps) {
  const t        = useTranslations("nav")
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [switching,   setSwitching]   = useState<string | null>(null)

  // Track current account type locally so it updates instantly on org switch
  // (before server re-render completes)
  const [currentAccountType, setCurrentAccountType] = useState<"business" | "personal">(accountType)

  // Sync with prop when server re-renders with new org
  const prevOrgId = useState(org.id)[0]
  if (org.id !== prevOrgId || accountType !== currentAccountType) {
    // Intentional render-time update (safe: just syncing prop → state)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === org.id) { setOrgMenuOpen(false); return }
    setSwitching(orgId)

    // Update local account type immediately for instant UI feedback
    const targetOrg = allOrgs.find(o => o.id === orgId)
    if (targetOrg?.accountType) {
      setCurrentAccountType(targetOrg.accountType)
    }

    await fetch("/api/org/switch", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ orgId }),
    })
    setOrgMenuOpen(false)
    setSwitching(null)
    router.push("/dashboard")
    router.refresh()
  }

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard"
    if (href === "/trips") return pathname === "/trips" || pathname.startsWith("/trips/")
    if (href === "/activities") return pathname === "/activities" || pathname.startsWith("/activities/")
    if (href === "/split") return pathname === "/split" || (pathname.startsWith("/split/") && !pathname.startsWith("/split/income"))
    return pathname.startsWith(href)
  }

  const avatar = user.full_name?.[0]?.toUpperCase() ?? user.email[0].toUpperCase()

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 w-72",
        "transition-transform duration-200 ease-in-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "lg:static lg:inset-auto lg:translate-x-0 lg:shrink-0",
        "lg:transition-[width] lg:duration-200",
        collapsed ? "lg:w-[60px]" : "lg:w-64",
        "flex flex-col h-screen",
        "bg-sidebar border-r border-sidebar-border overflow-hidden"
      )}
    >
      {/* ── Logo + controls ── */}
      <div className={cn(
        "flex items-center gap-3 border-b border-sidebar-border py-[18px]",
        collapsed ? "lg:justify-center lg:px-0 px-5" : "px-5"
      )}>
        <LogoMark size={32} />
        <span className={cn(
          "flex-1 text-sidebar-fg font-bold text-lg tracking-tight whitespace-nowrap",
          collapsed && "lg:hidden"
        )}>
          Slippy
        </span>
        {!collapsed && (
          <button
            onClick={onToggle}
            className="hidden lg:flex p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-fg
              hover:bg-sidebar-muted/10 transition-colors"
            title="ย่อเมนู"
          >
            <Icons.PanelLeftClose size={16} />
          </button>
        )}
        <button
          onClick={onMobileClose}
          className="flex lg:hidden p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-fg
            hover:bg-sidebar-muted/10 transition-colors"
          title="ปิดเมนู"
        >
          <Icons.X size={16} />
        </button>
      </div>

      {collapsed && (
        <button
          onClick={onToggle}
          className="hidden lg:flex items-center justify-center py-2 text-sidebar-muted
            hover:text-sidebar-fg hover:bg-sidebar-muted/10 transition-colors"
          title="ขยายเมนู"
        >
          <Icons.PanelLeftOpen size={16} />
        </button>
      )}

      {/* ── Organization switcher ── */}
      <div className={cn(
        "border-b border-sidebar-border relative",
        collapsed ? "lg:px-2 px-3 py-3" : "px-3 py-3"
      )}>
        {/* Icon-only (desktop collapsed) */}
        <div className={cn(collapsed ? "lg:flex hidden justify-center" : "hidden")}>
          <div className="w-8 h-8 rounded-md bg-brand-500/20 flex items-center justify-center" title={org.name}>
            <Icons.Building2 size={16} className="text-brand-500" />
          </div>
        </div>

        {/* Full button */}
        <button
          onClick={() => setOrgMenuOpen(o => !o)}
          className={cn(
            "w-full flex items-center gap-2.5 p-2 rounded-[10px] hover:bg-sidebar-muted/10 transition-colors border border-sidebar-border",
            collapsed && "lg:hidden"
          )}
        >
          <span className="h-8 w-8 rounded-[8px] bg-gradient-to-br from-brand-400 to-brand-700 text-white flex items-center justify-center shrink-0">
            <Icons.Building2 size={16} />
          </span>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sidebar-fg text-[13px] font-semibold truncate">{org.name}</p>
            <p className="text-sidebar-muted text-[11px] uppercase tracking-wider">{org.plan}</p>
          </div>
          <Icons.ChevronDown size={14} className={cn(
            "text-sidebar-muted shrink-0 transition-transform duration-150",
            orgMenuOpen && "rotate-180"
          )} />
        </button>

        {/* Dropdown */}
        {orgMenuOpen && !collapsed && (
          <div className="absolute left-3 right-3 top-full mt-1 z-50
            rounded-xl border bg-popover shadow-lg overflow-hidden">
            <div className="p-1 space-y-0.5 max-h-56 overflow-y-auto">
              {allOrgs.map(o => {
                const isPersonal = o.accountType === "personal"
                return (
                  <button
                    key={o.id}
                    onClick={() => handleSwitchOrg(o.id)}
                    disabled={switching === o.id}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                      hover:bg-muted transition-colors disabled:opacity-60"
                  >
                    {/* Icon ต่างกันตาม account type */}
                    <div className={cn(
                      "w-7 h-7 rounded-md flex items-center justify-center shrink-0",
                      isPersonal
                        ? "bg-emerald-500/10"
                        : "bg-brand-500/10"
                    )}>
                      {isPersonal
                        ? <Icons.User size={14} className="text-emerald-600 dark:text-emerald-400" />
                        : <Icons.Building2 size={14} className="text-brand-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{o.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {isPersonal ? "ส่วนตัว" : "องค์กร"} · {o.plan} · {o.role}
                      </p>
                    </div>
                    {o.id === org.id && <Icons.Check size={16} className="text-brand-500 shrink-0" />}
                  </button>
                )
              })}
            </div>
            <div className="border-t p-1">
              <Link
                href="/new-org"
                onClick={() => setOrgMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                  text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Icons.Plus size={16} />
                สร้างองค์กรใหม่
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ── Main navigation ── */}
      <nav className={cn(
        "flex-1 overflow-y-auto py-4 space-y-0.5 scrollbar-thin",
        collapsed ? "lg:px-2 px-3" : "px-3"
      )}>
        {/* ── Group 1: ภาพรวม ── */}
        {navItems.map(({ key, href, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={key}
              href={href}
              title={collapsed ? t(key as any) : undefined}
              className={cn(
                "sidebar-item",
                active && "active",
                collapsed && "lg:justify-center lg:px-0"
              )}
            >
              <Icon className={cn("w-[18px] h-[18px] shrink-0", active ? "text-brand-600 dark:text-brand-300" : "text-sidebar-muted")} />
              <span className={cn("truncate", collapsed && "lg:hidden")}>{t(key as any)}</span>
              {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0 lg:block hidden" />}
            </Link>
          )
        })}

        {/* ── Group 2: การเงิน & ภาษี ── */}
        <div className={cn(collapsed ? "lg:block hidden pt-3 pb-1" : "hidden")}>
          <div className="border-t border-sidebar-border" />
        </div>
        <div className={cn(collapsed ? "lg:hidden pt-4 pb-1" : "pt-4 pb-1")}>
          <p className="px-3 text-xs font-medium text-sidebar-muted uppercase tracking-wider">
            การเงิน & ภาษี
          </p>
        </div>
        {financeItems.map(({ key, href, icon: Icon }) => {
          const active = isActive(href)
          // Show tax label based on current account type
          const isPersonalTax = key === "tax" && currentAccountType === "personal"
          if (isPersonalTax && !SHOW_PERSONAL_TAX) return null
          const label = key === "tax"
            ? (isPersonalTax ? "ภาษีส่วนบุคคล" : "ภาษีองค์กร")
            : t(key as any)
          return (
            <Link
              key={key}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "sidebar-item",
                active && "active",
                collapsed && "lg:justify-center lg:px-0"
              )}
            >
              <Icon className={cn("w-[18px] h-[18px] shrink-0", active ? "text-brand-600 dark:text-brand-300" : "text-sidebar-muted")} />
              <span className={cn("truncate", collapsed && "lg:hidden")}>{label}</span>
              {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0 lg:block hidden" />}
            </Link>
          )
        })}

        {/* ── Group 3: กิจกรรม & เครื่องมือ ── */}
        <div className={cn(collapsed ? "lg:block hidden pt-3 pb-1" : "hidden")}>
          <div className="border-t border-sidebar-border" />
        </div>
        <div className={cn(collapsed ? "lg:hidden pt-4 pb-1" : "pt-4 pb-1")}>
          <p className="px-3 text-xs font-medium text-sidebar-muted uppercase tracking-wider">
            กิจกรรม & เครื่องมือ
          </p>
        </div>
        {activityItems.map(({ key, href, icon: Icon, label }) => {
          const active = isActive(href)
          const displayLabel = label ?? t(key as any)
          return (
            <Link
              key={key}
              href={href}
              title={collapsed ? displayLabel : undefined}
              className={cn(
                "sidebar-item",
                active && "active",
                collapsed && "lg:justify-center lg:px-0"
              )}
            >
              <Icon className={cn("w-[18px] h-[18px] shrink-0", active ? "text-brand-600 dark:text-brand-300" : "text-sidebar-muted")} />
              <span className={cn("truncate", collapsed && "lg:hidden")}>{displayLabel}</span>
              {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0 lg:block hidden" />}
            </Link>
          )
        })}

        {/* ── Personal Space (Phase 2 — hidden in Phase 1) ── */}
        {SHOW_PERSONAL_SPACE && (<>
          <div className={cn(collapsed ? "lg:block hidden pt-3 pb-1" : "hidden")}>
            <div className="border-t border-sidebar-border" />
          </div>
          <div className={cn(collapsed ? "lg:hidden pt-4 pb-1" : "pt-4 pb-1")}>
            <p className="px-3 text-xs font-medium text-sidebar-muted uppercase tracking-wider flex items-center gap-1.5">
              <Icons.Leaf size={11} className="text-emerald-500" />
              พื้นที่ส่วนตัว
            </p>
          </div>
          {personalItems.map(({ key, href, icon: Icon }) => {
            const active = isActive(href)
            return (
              <Link key={key} href={href} title={collapsed ? key : undefined}
                className={cn("sidebar-item", active && "active", collapsed && "lg:justify-center lg:px-0")}>
                <Icon className={cn("w-[18px] h-[18px] shrink-0", active ? "text-emerald-600 dark:text-emerald-400" : "text-sidebar-muted")} />
                <span className={cn("truncate", collapsed && "lg:hidden")}>{t(key as any)}</span>
                {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0 lg:block hidden" />}
              </Link>
            )
          })}
        </>)}

        {/* ── Vita Social (Phase 2 — hidden in Phase 1) ── */}
        {SHOW_SOCIAL_SPACE && (<>
          <div className={cn(collapsed ? "lg:block hidden pt-3 pb-1" : "hidden")}>
            <div className="border-t border-sidebar-border" />
          </div>
          <div className={cn(collapsed ? "lg:hidden pt-5 pb-1.5 px-3" : "pt-5 pb-1.5 px-3")}>
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-gradient-to-r from-violet-500/30 via-pink-500/20 to-transparent" />
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                bg-gradient-to-r from-violet-500/10 to-pink-500/10
                border border-violet-500/15 dark:border-violet-500/20">
                <div className="flex -space-x-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  <div className="w-1.5 h-1.5 rounded-full bg-pink-500" />
                </div>
                <span className="text-[10px] font-semibold tracking-wider uppercase
                  text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-pink-600
                  dark:from-violet-400 dark:to-pink-400">
                  Vita Social
                </span>
              </div>
              <div className="h-px flex-1 bg-gradient-to-l from-pink-500/30 via-violet-500/20 to-transparent" />
            </div>
          </div>
          <div className={cn(collapsed ? "lg:flex hidden justify-center py-2" : "hidden")}>
            <div className="flex gap-0.5">
              <div className="w-1 h-1 rounded-full bg-violet-500/60" />
              <div className="w-1 h-1 rounded-full bg-pink-500/60" />
            </div>
          </div>
          <div className="space-y-0.5 px-2">
            {socialItems.map(({ key, href, icon: Icon, color }) => {
              const active = isActive(href)
              return (
                <Link key={key} href={href} title={collapsed ? t(key as any) : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium transition-all duration-150",
                    active
                      ? "bg-gradient-to-r from-violet-500/12 to-pink-500/8 dark:from-violet-500/20 dark:to-pink-500/12 text-sidebar-fg shadow-sm border border-violet-500/15 dark:border-violet-500/25"
                      : "text-sidebar-muted hover:text-sidebar-fg hover:bg-sidebar-muted/8",
                    collapsed && "lg:justify-center lg:px-0 lg:w-10 lg:h-10 lg:mx-auto"
                  )}>
                  <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all",
                    active ? "bg-gradient-to-br from-violet-500/20 to-pink-500/15 dark:from-violet-500/30 dark:to-pink-500/20" : "group-hover:bg-sidebar-muted/10")}>
                    <Icon className={cn("w-[15px] h-[15px] transition-colors", active ? color : "text-sidebar-muted group-hover:text-sidebar-fg")} />
                  </span>
                  <span className={cn("truncate flex-1", collapsed && "lg:hidden")}>{t(key as any)}</span>
                  {active && !collapsed && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0 lg:block hidden bg-gradient-to-b from-violet-500 to-pink-500" />
                  )}
                </Link>
              )
            })}
          </div>
        </>)}

        {/* ── Settings section ── */}
        <div className={cn(collapsed ? "lg:block hidden pt-3 pb-1" : "hidden")}>
          <div className="border-t border-sidebar-border" />
        </div>
        <div className={cn(collapsed ? "lg:hidden pt-4 pb-1" : "pt-4 pb-1")}>
          <p className="px-3 text-xs font-medium text-sidebar-muted uppercase tracking-wider">
            {t("settings")}
          </p>
        </div>

        {bottomItems.map(({ key, href, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={key}
              href={href}
              title={collapsed ? t(key as any) : undefined}
              className={cn(
                "sidebar-item",
                active && "active",
                collapsed && "lg:justify-center lg:px-0"
              )}
            >
              <Icon className={cn("w-[18px] h-[18px] shrink-0", active ? "text-brand-600 dark:text-brand-300" : "text-sidebar-muted")} />
              <span className={cn("truncate", collapsed && "lg:hidden")}>{t(key as any)}</span>
              {active && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0 lg:block hidden" />}
            </Link>
          )
        })}

        {/* Admin Console — superadmin only */}
        {isSuperadmin && (
          <Link
            href="/admin/plans"
            title={collapsed ? "Admin Console" : undefined}
            className={cn(
              "sidebar-item mt-1",
              pathname.startsWith("/admin") && "active",
              collapsed && "lg:justify-center lg:px-0",
              "text-amber-500/80 hover:text-amber-400"
            )}
          >
            <Icons.Settings className="w-[18px] h-[18px] shrink-0" />
            <span className={cn("truncate", collapsed && "lg:hidden")}>Admin Console</span>
          </Link>
        )}
      </nav>

      {/* ── User footer ── */}
      <div className={cn(
        "border-t border-sidebar-border py-4",
        collapsed ? "lg:px-2 px-3" : "px-3"
      )}>
        <div className={cn("flex-col items-center gap-2", collapsed ? "lg:flex hidden" : "hidden")}>
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar_url}
              alt={user.full_name ?? user.email}
              title={user.full_name ?? user.email}
              className="w-8 h-8 rounded-full object-cover bg-muted"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center
                text-brand-500 font-semibold text-sm"
              title={user.full_name ?? user.email}
            >
              {avatar}
            </div>
          )}
          <button
            onClick={handleLogout}
            title={t("logout")}
            className="p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-fg
              hover:bg-sidebar-muted/10 transition-colors"
          >
            <Icons.LogOut size={16} />
          </button>
        </div>
        <div className={cn("flex items-center gap-3 px-3 py-2 rounded-lg", collapsed && "lg:hidden")}>
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar_url}
              alt={user.full_name ?? user.email}
              className="w-8 h-8 rounded-full object-cover bg-muted shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center
              text-brand-500 font-semibold text-sm shrink-0">
              {avatar}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sidebar-fg text-sm font-medium truncate">
              {user.full_name ?? user.email}
            </p>
            <p className="text-sidebar-muted text-xs truncate">{user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            title={t("logout")}
            className="p-1.5 rounded-md text-sidebar-muted hover:text-sidebar-fg
              hover:bg-sidebar-muted/10 transition-colors shrink-0"
          >
            <Icons.LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
