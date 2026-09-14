"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"

type Detail = {
  profile: { id: string; email: string; full_name: string | null; is_superadmin: boolean; created_at: string }
  memberships: { role: string; joined_at: string; organizations: { id: string; name: string; slug: string; plan: string; doc_used: number; doc_quota: number } }[]
  sessions: { id: string; device_name: string | null; os: string | null; browser: string | null; ip_address: string | null; last_active: string }[]
  activity: { id: string; action: string; detail: string | null; ip_address: string | null; created_at: string }[]
  mfaEnabled: boolean
}

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/users/${id}`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const runAction = async (path: string, confirmMsg: string, successMsg: string) => {
    if (!confirm(confirmMsg)) return
    setBusy(true)
    const res = await fetch(`/api/admin/users/${id}/${path}`, { method: path === "mfa" ? "DELETE" : "POST" })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { toast.error(json.error ?? "เกิดข้อผิดพลาด"); return }
    toast.success(successMsg)
    load()
  }

  if (loading) return <p className="text-zinc-500">กำลังโหลด...</p>
  if (!data) return <p className="text-red-400">ไม่พบผู้ใช้</p>

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">{data.profile.full_name ?? data.profile.email}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {data.profile.email} · สมัครเมื่อ {new Date(data.profile.created_at).toLocaleDateString("th-TH")}
          {data.profile.is_superadmin && <span className="ml-2 text-amber-400">★ Superadmin</span>}
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">การดำเนินการของ Support</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => runAction("reset-password", "ส่งลิงก์รีเซ็ตรหัสผ่านให้ผู้ใช้นี้?", "ส่งลิงก์แล้ว")}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm text-white disabled:opacity-50"
          >
            ส่งลิงก์รีเซ็ตรหัสผ่าน
          </button>
          <button
            onClick={() => runAction("sign-out", "ลบ session ที่บันทึกไว้ทั้งหมดของผู้ใช้นี้? (ไม่ได้ยกเลิก access token ที่ใช้งานอยู่ทันที)", "ลบ session แล้ว")}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm text-white disabled:opacity-50"
          >
            ลบ session ที่บันทึกไว้
          </button>
          {data.mfaEnabled && (
            <button
              onClick={() => runAction("mfa", "ปิด 2FA ของผู้ใช้นี้? ใช้เมื่อผู้ใช้ทำอุปกรณ์ authenticator หายและเข้าระบบไม่ได้", "ปิด 2FA แล้ว")}
              disabled={busy}
              className="px-4 py-2 rounded-md bg-rose-900/40 hover:bg-rose-900/60 text-sm text-rose-300 disabled:opacity-50"
            >
              รีเซ็ต 2FA (ลืม authenticator)
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          หมายเหตุ: ไม่มีวิธี revoke access token ที่ใช้งานอยู่ของผู้ใช้อื่นได้ทันทีผ่าน Supabase API — token จะหมดอายุเองภายใน ~1 ชม.
          การรีเซ็ตรหัสผ่าน/2FA คือวิธีที่บังคับให้ login ใหม่ได้จริง
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">องค์กรที่เป็นสมาชิก</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">องค์กร</th>
                <th className="px-4 py-3 text-left">บทบาท</th>
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-left">โควต้า</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {data.memberships.map((m, i) => (
                <tr key={i} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <a href={`/admin/orgs/${m.organizations.id}`} className="text-amber-400 hover:underline">{m.organizations.name}</a>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{m.role}</td>
                  <td className="px-4 py-3 text-zinc-300">{m.organizations.plan}</td>
                  <td className="px-4 py-3 text-zinc-300">{m.organizations.doc_used}/{m.organizations.doc_quota}</td>
                </tr>
              ))}
              {data.memberships.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-zinc-500">ไม่มีองค์กร</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">Session ที่บันทึกไว้</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">อุปกรณ์</th>
                <th className="px-4 py-3 text-left">IP</th>
                <th className="px-4 py-3 text-left">ใช้งานล่าสุด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {data.sessions.map(s => (
                <tr key={s.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 text-zinc-300">{s.device_name ?? "—"} ({s.browser ?? "?"}/{s.os ?? "?"})</td>
                  <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{s.ip_address ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-300">{new Date(s.last_active).toLocaleString("th-TH")}</td>
                </tr>
              ))}
              {data.sessions.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">ไม่มี session ที่บันทึกไว้</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">กิจกรรมล่าสุด</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">เวลา</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">รายละเอียด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {data.activity.map(a => (
                <tr key={a.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 whitespace-nowrap text-zinc-300">{new Date(a.created_at).toLocaleString("th-TH")}</td>
                  <td className="px-4 py-3 font-mono text-amber-400">{a.action}</td>
                  <td className="px-4 py-3 text-zinc-300">{a.detail ?? "—"}</td>
                </tr>
              ))}
              {data.activity.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">ไม่มีกิจกรรม</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
