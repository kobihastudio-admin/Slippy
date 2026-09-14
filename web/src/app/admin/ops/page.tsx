/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { getOpsStats } from "@/lib/ops-stats"

export const dynamic = "force-dynamic"

function StatCard({ label, value, tone = "default", href }: {
  label: string; value: string | number; tone?: "default" | "warn" | "danger"; href?: string
}) {
  const toneClass = tone === "danger" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-white"
  const content = (
    <>
      <p className="text-xs text-zinc-400 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
    </>
  )
  const className = "rounded-lg border border-zinc-800 bg-zinc-900 p-4 block"
  return href
    ? <a href={href} className={`${className} hover:border-amber-500/50 transition-colors`}>{content}</a>
    : <div className={className}>{content}</div>
}

export default async function AdminOpsPage() {
  const stats = await getOpsStats()
  const totalFailedJobs = stats.queues.reduce((sum, q) => sum + q.failed, 0)

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white">Ops Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          ภาพรวมระบบ — org/user count, เอกสารที่ประมวลผล 24 ชม. ล่าสุด, คิวงานค้าง, error ที่ยังไม่แก้
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">ภาพรวม</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
          <StatCard label="Organizations" value={stats.orgCount} href="/admin/orgs" />
          <StatCard label="Users" value={stats.userCount} href="/admin/users" />
          <StatCard
            label="Error ที่ยังไม่แก้"
            value={stats.unresolvedErrorCount}
            tone={stats.unresolvedErrorCount > 0 ? "warn" : "default"}
            href="/admin/errors"
          />
          <StatCard
            label="Stripe webhook fail"
            value={stats.unresolvedStripeWebhookFailures}
            tone={stats.unresolvedStripeWebhookFailures > 0 ? "danger" : "default"}
            href="/admin/errors?source=server&type=stripe_webhook"
          />
          <StatCard
            label="เอกสารค้างประมวลผล"
            value={stats.stuckDocumentCount}
            tone={stats.stuckDocumentCount > 0 ? "warn" : "default"}
            href="/admin/documents"
          />
          <StatCard
            label="Job ที่ fail ค้างอยู่"
            value={totalFailedJobs}
            tone={totalFailedJobs > 0 ? "danger" : "default"}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">เอกสารที่ประมวลผล (24 ชม. ล่าสุด)</h2>
        {stats.docsLast24h.length === 0 ? (
          <p className="text-sm text-zinc-500">ไม่มีเอกสารใหม่ในช่วง 24 ชม. ที่ผ่านมา</p>
        ) : (
          <div className="flex gap-3">
            {stats.docsLast24h.map((d) => (
              <div key={d.status} className="rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2">
                <span className="text-xs text-zinc-400">{d.status}</span>
                <span className="ml-2 font-bold text-white">{d.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">คิวงาน (BullMQ)</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">คิว</th>
                <th className="px-4 py-3 text-left">รอ (waiting)</th>
                <th className="px-4 py-3 text-left">กำลังทำ (active)</th>
                <th className="px-4 py-3 text-left">เสร็จแล้ว</th>
                <th className="px-4 py-3 text-left">Fail ค้าง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {stats.queues.map((q) => (
                <tr key={q.name} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-mono text-zinc-200">{q.name}</td>
                  <td className="px-4 py-3 text-zinc-300">{q.waiting}</td>
                  <td className="px-4 py-3 text-zinc-300">{q.active}</td>
                  <td className="px-4 py-3 text-zinc-300">{q.completed}</td>
                  <td className={`px-4 py-3 font-semibold ${q.failed > 0 ? "text-red-400" : "text-zinc-300"}`}>
                    {q.error ? <span className="text-amber-400" title={q.error}>n/a</span> : q.failed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">Error ล่าสุด (server + browser)</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">เวลา</th>
                <th className="px-4 py-3 text-left">ที่มา</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {stats.recentErrors.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-300">
                    {new Date(e.created_at).toLocaleString("th-TH")}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{e.source}</td>
                  <td className="px-4 py-3 font-mono text-amber-400">{e.error_type}</td>
                  <td className="px-4 py-3 max-w-lg truncate text-zinc-300" title={e.error_message ?? ""}>
                    {e.error_message ?? "—"}
                  </td>
                </tr>
              ))}
              {stats.recentErrors.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">ไม่มี error ล่าสุด 🎉</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
