import { ActivityFeed, type ActivitySummary } from "@/components/activities/activity-feed"
import { createClient } from "@/lib/supabase/server"

const ACTIVITY_FIELDS = "id, title, summary, category, visibility, status, location_name, starts_at, source_type"

export default async function ActivitiesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data } = user
    ? await supabase.from("activities").select(ACTIVITY_FIELDS).eq("owner_id", user.id).order("starts_at", { ascending: true, nullsFirst: false })
    : { data: [] }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-3xl border border-brand-500/20 bg-gradient-to-br from-brand-600 via-violet-600 to-indigo-700 p-6 text-white shadow-xl sm:p-8">
        <p className="text-sm font-semibold tracking-[0.2em] text-white/70">SLIPPY ACTIVITY GRAPH</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">กิจกรรมที่เชื่อมชีวิตกับโลกภายนอก</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">วางแผนทริป กิจกรรมกลุ่ม และกิจกรรมที่สนใจไว้ในจุดเดียว พร้อมเชื่อมเอกสาร ปฏิทิน และลิงก์ลงทะเบียนอย่างเป็นระเบียบ</p>
      </header>
      <ActivityFeed initialActivities={(data ?? []) as ActivitySummary[]} />
    </main>
  )
}
