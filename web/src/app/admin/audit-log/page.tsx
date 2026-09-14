/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export default async function AdminAuditLogPage() {
  const admin = createAdminClient()
  const { data: logs, error } = await admin
    .from("admin_audit_logs")
    .select("id, actor_id, action, target_type, target_id, before, after, ip_address, created_at, users(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) {
    return (
      <div className="rounded-lg bg-red-950/40 border border-red-800 p-6 text-red-300">
        <p className="font-semibold">ดึงข้อมูล audit log ไม่ได้</p>
        <p className="text-sm mt-1 font-mono">{error.message}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Admin Audit Log</h1>
        <p className="mt-1 text-sm text-zinc-400">
          ใครเปลี่ยนอะไรใน System Config / Pricing Plans เมื่อไหร่ — แสดง 200 รายการล่าสุด
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">เวลา</th>
              <th className="px-4 py-3 text-left">ผู้ทำรายการ</th>
              <th className="px-4 py-3 text-left">Action</th>
              <th className="px-4 py-3 text-left">Target</th>
              <th className="px-4 py-3 text-left">ก่อน → หลัง</th>
              <th className="px-4 py-3 text-left">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {(logs ?? []).map((log) => {
              const actor = (log as unknown as { users: { full_name: string | null; email: string } | null }).users
              return (
                <tr key={log.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-300">
                    {new Date(log.created_at).toLocaleString("th-TH")}
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{actor?.full_name ?? actor?.email ?? log.actor_id ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-amber-400">{log.action}</td>
                  <td className="px-4 py-3 text-zinc-300">
                    {log.target_type}
                    {log.target_id ? <span className="text-zinc-500">:{log.target_id}</span> : null}
                  </td>
                  <td className="px-4 py-3 max-w-md">
                    <code className="block truncate text-xs text-red-300" title={JSON.stringify(log.before)}>
                      {JSON.stringify(log.before)}
                    </code>
                    <code className="block truncate text-xs text-emerald-300" title={JSON.stringify(log.after)}>
                      {JSON.stringify(log.after)}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{log.ip_address ?? "—"}</td>
                </tr>
              )
            })}
            {(logs ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">ยังไม่มี audit log</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
