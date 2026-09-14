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
 * LifeRadarCard — "เป้าหมายชีวิต" spider/radar chart + profile header
 *
 * Visualizes the 4 Life Score domains (Wealth · Lifestyle · Journey · Social
 * — see supabase/migrations/028_life_score_complete.sql) as a spider chart so
 * the dashboard reflects Slippy's actual North-Star goal: turning receipts,
 * journeys, relationships and habits into one balanced "Life Graph" view.
 * Pairs it with the user's profile picture/name to make the dashboard feel
 * personal rather than like a generic accounting tool.
 */

import { useState } from "react"
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from "recharts"
import { Wallet, Leaf, Compass, Users } from "lucide-react"
import { cn } from "@/lib/utils"

export interface LifeRadarCardProps {
  displayName:  string
  orgName:      string | null
  avatarUrl:    string | null
  wealth:       number
  lifestyle:    number
  journey:      number
  social:       number
  overall:      number
}

const DOMAIN_META = [
  { key: "wealth",    label: "ความมั่งคั่ง", short: "Wealth",    icon: Wallet,  color: "#8b5cf6" },
  { key: "lifestyle", label: "ไลฟ์สไตล์",   short: "Lifestyle", icon: Leaf,    color: "#ec4899" },
  { key: "journey",   label: "การเดินทาง",  short: "Journey",   icon: Compass, color: "#6366f1" },
  { key: "social",    label: "สังคม",       short: "Social",    icon: Users,   color: "#06b6d4" },
] as const

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "S"
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase()
}

function scoreTone(score: number): { ring: string; text: string } {
  if (score >= 75) return { ring: "#10b981", text: "text-emerald-500" }
  if (score >= 50) return { ring: "#8b5cf6", text: "text-violet-500" }
  if (score >= 25) return { ring: "#f59e0b", text: "text-amber-500" }
  return { ring: "#ef4444", text: "text-rose-500" }
}

export function LifeRadarCard({
  displayName, orgName, avatarUrl, wealth, lifestyle, journey, social, overall,
}: LifeRadarCardProps) {
  const data = DOMAIN_META.map(d => ({
    domain: d.short,
    label:  d.label,
    score:  Math.round({ wealth, lifestyle, journey, social }[d.key]),
    fullMark: 100,
  }))

  const tone = scoreTone(overall)
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <div className="rounded-[14px] border bg-card overflow-hidden">
      {/* ── Profile header ─────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-3.5 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1,#ec4899)" }} />

        <div className="relative shrink-0">
          <div className="w-14 h-14 rounded-2xl p-[2px]"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1,#ec4899)" }}>
            <div className="w-full h-full rounded-[14px] overflow-hidden bg-card flex items-center justify-center">
              {avatarUrl && !imgFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                />
              ) : (
                <span className="text-base font-bold text-violet-500">{initials(displayName)}</span>
              )}
            </div>
          </div>
          <span className="absolute -bottom-1 -right-1 text-[13px] leading-none">🫧</span>
        </div>

        <div className="min-w-0 flex-1 relative">
          <p className="text-[15px] font-semibold truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {orgName ? `${orgName} · ` : ""}เป้าหมายชีวิตของคุณ
          </p>
        </div>

        <div className="text-right shrink-0 relative">
          <p className={cn("text-2xl font-bold tabular-nums", tone.text)}>{Math.round(overall)}</p>
          <p className="text-[10px] text-muted-foreground -mt-0.5">Life Score</p>
        </div>
      </div>

      <div className="border-t" />

      {/* ── Spider / Radar chart ───────────────────────────────────────── */}
      <div className="px-2 pt-3">
        <div className="h-[230px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke="currentColor" className="text-black/10 dark:text-white/10" />
              <PolarAngleAxis
                dataKey="domain"
                tick={{ fill: "currentColor", fontSize: 11.5 }}
                className="text-foreground"
              />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                name="Life Score"
                dataKey="score"
                stroke="#8b5cf6"
                fill="url(#lifeRadarFill)"
                fillOpacity={0.55}
                strokeWidth={2}
                dot={{ r: 3, fill: "#8b5cf6", strokeWidth: 0 }}
              />
              <defs>
                <linearGradient id="lifeRadarFill" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%"  stopColor="#8b5cf6" stopOpacity={0.45} />
                  <stop offset="50%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#ec4899" stopOpacity={0.30} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={false}
                contentStyle={{
                  borderRadius: 10, border: "1px solid var(--border)",
                  background: "var(--card)", fontSize: 12, padding: "6px 10px",
                }}
                formatter={(value: number, _n, item: any) => [`${value} / 100`, item?.payload?.label]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Domain breakdown legend ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 px-5 pb-5 pt-1">
        {DOMAIN_META.map(d => {
          const score = Math.round({ wealth, lifestyle, journey, social }[d.key])
          const Icon = d.icon
          return (
            <div key={d.key} className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2">
              <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${d.color}1a` }}>
                <Icon className="w-3.5 h-3.5" style={{ color: d.color }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium truncate">{d.label}</p>
                <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
                  <div className="h-1 rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: d.color }} />
                </div>
              </div>
              <span className="text-[12px] font-semibold tabular-nums shrink-0" style={{ color: d.color }}>{score}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
