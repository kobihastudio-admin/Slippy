"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { useEffect, useState, useCallback } from "react"
import { toast } from "sonner"

type StuckDoc = {
  id: string; organization_id: string; vendor_name: string | null
  status: string; source: string; created_at: string; updated_at: string
  organizations: { name: string } | null
}

function minutesAgo(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000)
}

export default function AdminDocumentsPage() {
  const [docs, setDocs] = useState<StuckDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [minutes, setMinutes] = useState(15)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/documents/stuck?minutes=${minutes}`)
    const json = await res.json()
    setDocs(json.documents ?? [])
    setLoading(false)
  }, [minutes])

  useEffect(() => { load() }, [load])

  const retry = async (id: string) => {
    setBusyId(id)
    const res = await fetch(`/api/admin/documents/${id}/retry`, { method: "POST" })
    setBusyId(null)
    if (!res.ok) { toast.error("retry ไม่สำเร็จ"); return }
    toast.success("สั่งประมวลผลใหม่แล้ว")
    load()
  }

  const markFailed = async (id: string) => {
    if (!confirm("ยืนยันว่าจะ mark เอกสารนี้เป็น failed?")) return
    setBusyId(id)
    const res = await fetch(`/api/admin/documents/${id}/mark-failed`, { method: "POST" })
    setBusyId(null)
    if (!res.ok) { toast.error("เกิดข้อผิดพลาด"); return }
    toast.success("Mark failed แล้ว")
    load()
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">เอกสารที่ค้างประมวลผล</h1>
        <p className="mt-1 text-sm text-zinc-400">
          เอกสารที่ status เป็น pending/processing นานเกินกำหนด — pipeline รันแบบ fire-and-forget
          ในโปรเซสเดียว ไม่มี queue/worker คอย retry ถ้า process ล้มกลางทางเอกสารจะค้างแบบนี้แหละ
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-zinc-400">ค้างนานกว่า</label>
        <select
          value={minutes} onChange={e => setMinutes(Number(e.target.value))}
          className="h-9 px-2 rounded-md bg-zinc-900 border border-zinc-800 text-sm text-white"
        >
          <option value={5}>5 นาที</option>
          <option value={15}>15 นาที</option>
          <option value={60}>1 ชั่วโมง</option>
          <option value={1440}>1 วัน</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">องค์กร</th>
              <th className="px-4 py-3 text-left">ผู้ขาย</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
              <th className="px-4 py-3 text-left">ที่มา</th>
              <th className="px-4 py-3 text-left">ค้างมา</th>
              <th className="px-4 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {docs.map(d => (
              <tr key={d.id} className="hover:bg-zinc-900/50">
                <td className="px-4 py-3">
                  <a href={`/admin/orgs/${d.organization_id}`} className="text-amber-400 hover:underline">
                    {d.organizations?.name ?? d.organization_id}
                  </a>
                </td>
                <td className="px-4 py-3 text-zinc-300">{d.vendor_name ?? "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{d.status}</td>
                <td className="px-4 py-3 text-zinc-300">{d.source}</td>
                <td className="px-4 py-3 text-amber-400">{minutesAgo(d.updated_at)} นาที</td>
                <td className="px-4 py-3 flex gap-3">
                  <button onClick={() => retry(d.id)} disabled={busyId === d.id}
                    className="text-xs text-emerald-400 hover:underline disabled:opacity-50">
                    Retry
                  </button>
                  <button onClick={() => markFailed(d.id)} disabled={busyId === d.id}
                    className="text-xs text-red-400 hover:underline disabled:opacity-50">
                    Mark failed
                  </button>
                </td>
              </tr>
            ))}
            {!loading && docs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">ไม่มีเอกสารค้าง 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
