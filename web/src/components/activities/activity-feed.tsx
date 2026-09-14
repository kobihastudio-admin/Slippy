"use client"

import Link from "next/link"
import { useState } from "react"
import { feedHref } from "@/lib/activities/routes"

export type ActivitySummary = {
  id: string
  title: string
  summary: string
  category: string
  visibility: "private" | "group" | "public"
  status: "draft" | "published" | "cancelled" | "completed"
  location_name: string | null
  starts_at: string | null
  source_type: string
}

type Scope = "mine" | "group" | "explore"

const scopeLabels: Record<Scope, string> = {
  mine: "ของฉัน",
  group: "กลุ่มของฉัน",
  explore: "ค้นหากิจกรรม",
}

function formatSchedule(value: string | null) {
  if (!value) return "ยังไม่กำหนดเวลา"
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

export function ActivityFeed({ initialActivities }: { initialActivities: ActivitySummary[] }) {
  const [scope, setScope] = useState<Scope>("mine")
  const [activities, setActivities] = useState(initialActivities)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function selectScope(nextScope: Scope) {
    setScope(nextScope)
    if (nextScope === "mine") { setActivities(initialActivities); setError(null); return }
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/activities?scope=${nextScope}`)
      const body = await response.json() as { activities?: ActivitySummary[]; error?: string }
      if (!response.ok) throw new Error(body.error ?? "ไม่สามารถโหลดกิจกรรมได้")
      setActivities(body.activities ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ไม่สามารถโหลดกิจกรรมได้")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-2">
        {(Object.keys(scopeLabels) as Scope[]).map((item) => (
          <button key={item} type="button" onClick={() => selectScope(item)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${scope === item ? "bg-brand-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            {scopeLabels[item]}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">กำลังโหลดกิจกรรม…</p>}
      {!loading && activities.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <h2 className="font-semibold">ยังไม่มีกิจกรรมในมุมมองนี้</h2>
          <p className="mt-2 text-sm text-muted-foreground">สร้างกิจกรรมจากทริป หรือเชื่อมลิงก์กิจกรรมภายนอกเพื่อเริ่มวางแผนร่วมกัน</p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {activities.map((activity) => (
          <Link key={activity.id} href={feedHref(activity.id)} className="group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-brand-500/50 hover:shadow-lg">
            <div className="flex items-center justify-between gap-3 text-xs font-medium">
              <span className="rounded-full bg-brand-500/10 px-2.5 py-1 capitalize text-brand-700 dark:text-brand-300">{activity.category}</span>
              <span className="text-muted-foreground">{activity.visibility === "public" ? "สาธารณะ" : activity.visibility === "group" ? "เฉพาะกลุ่ม" : "ส่วนตัว"}</span>
            </div>
            <h2 className="mt-4 text-lg font-bold group-hover:text-brand-600">{activity.title}</h2>
            {activity.summary && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{activity.summary}</p>}
            <dl className="mt-5 space-y-1 text-sm text-muted-foreground">
              <div><dt className="sr-only">เวลา</dt><dd>{formatSchedule(activity.starts_at)}</dd></div>
              {activity.location_name && <div><dt className="sr-only">สถานที่</dt><dd>{activity.location_name}</dd></div>}
            </dl>
          </Link>
        ))}
      </div>
    </section>
  )
}
