"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { useEffect, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"

type ErrorLog = {
  id: string; source: string; error_type: string; error_name: string | null
  error_message: string | null; resolved: boolean; resolved_note: string | null; created_at: string
}

export default function AdminErrorsPage() {
  const initial = useSearchParams()
  const [errors, setErrors] = useState<ErrorLog[]>([])
  const [loading, setLoading] = useState(true)
  // Deep-linkable from /admin/ops (e.g. ?source=server&type=stripe_webhook)
  // — pre-fill from the URL once, then these become normal local filter state.
  const [source, setSource] = useState(initial.get("source") ?? "")
  const [type, setType] = useState(initial.get("type") ?? "")
  const [resolved, setResolved] = useState(initial.get("resolved") ?? "false")

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (source) params.set("source", source)
    if (type) params.set("type", type)
    if (resolved) params.set("resolved", resolved)
    const res = await fetch(`/api/admin/errors?${params.toString()}`)
    const json = await res.json()
    setErrors(json.errors ?? [])
    setLoading(false)
  }, [source, type, resolved])

  useEffect(() => { load() }, [load])

  const markResolved = async (id: string) => {
    const res = await fetch(`/api/admin/errors/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true }),
    })
    if (!res.ok) { toast.error("เกิดข้อผิดพลาด"); return }
    toast.success("แก้ไขแล้ว")
    load()
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Error Logs</h1>
        <p className="mt-1 text-sm text-zinc-400">
          รวม error ฝั่ง server (api/, workers/, edge functions) และ browser ในตารางเดียว
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={source} onChange={e => setSource(e.target.value)}
          className="h-9 px-2 rounded-md bg-zinc-900 border border-zinc-800 text-sm text-white">
          <option value="">ทุกที่มา</option>
          <option value="server">server</option>
          <option value="browser">browser</option>
        </select>
        <input
          value={type} onChange={e => setType(e.target.value)}
          placeholder="กรอง error_type..."
          className="h-9 px-2 rounded-md bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500"
        />
        <select value={resolved} onChange={e => setResolved(e.target.value)}
          className="h-9 px-2 rounded-md bg-zinc-900 border border-zinc-800 text-sm text-white">
          <option value="false">ยังไม่แก้</option>
          <option value="true">แก้แล้ว</option>
          <option value="">ทั้งหมด</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">เวลา</th>
              <th className="px-4 py-3 text-left">ที่มา</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Message</th>
              <th className="px-4 py-3 text-left">สถานะ</th>
              <th className="px-4 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {errors.map(e => (
              <tr key={e.id} className="hover:bg-zinc-900/50">
                <td className="px-4 py-3 whitespace-nowrap text-zinc-300">{new Date(e.created_at).toLocaleString("th-TH")}</td>
                <td className="px-4 py-3 text-zinc-300">{e.source}</td>
                <td className="px-4 py-3 font-mono text-amber-400">{e.error_type}</td>
                <td className="px-4 py-3 max-w-lg truncate text-zinc-300" title={e.error_message ?? ""}>{e.error_message ?? "—"}</td>
                <td className="px-4 py-3">
                  {e.resolved ? <span className="text-emerald-400">แก้แล้ว</span> : <span className="text-amber-400">ยังไม่แก้</span>}
                </td>
                <td className="px-4 py-3">
                  {!e.resolved && (
                    <button onClick={() => markResolved(e.id)} className="text-xs text-amber-400 hover:underline">
                      mark resolved
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && errors.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">ไม่มี error ตามเงื่อนไขนี้ 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
