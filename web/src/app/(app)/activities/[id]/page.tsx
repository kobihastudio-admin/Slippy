import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: activity } = await supabase.from("activities")
    .select("id, title, summary, category, visibility, status, location_name, starts_at, ends_at, source_type, source_url")
    .eq("id", id).maybeSingle()
  if (!activity) notFound()
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/activities" className="text-sm font-medium text-brand-600 hover:underline">← กลับไปกิจกรรม</Link>
      <article className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-brand-500/10 px-3 py-1 text-brand-700 dark:text-brand-300">{activity.category}</span>
          <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">{activity.visibility}</span>
          <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">{activity.status}</span>
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">{activity.title}</h1>
        {activity.summary && <p className="mt-4 whitespace-pre-wrap leading-7 text-muted-foreground">{activity.summary}</p>}
        <dl className="mt-8 grid gap-4 border-t border-border pt-6 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">เวลาเริ่ม</dt><dd className="mt-1 font-medium">{activity.starts_at ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.starts_at)) : "ยังไม่กำหนด"}</dd></div>
          <div><dt className="text-muted-foreground">สถานที่</dt><dd className="mt-1 font-medium">{activity.location_name ?? "ยังไม่กำหนด"}</dd></div>
        </dl>
        {activity.source_url && <a className="mt-7 inline-flex rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700" href={activity.source_url} target="_blank" rel="noreferrer">เปิดแหล่งข้อมูล</a>}
      </article>
    </main>
  )
}
