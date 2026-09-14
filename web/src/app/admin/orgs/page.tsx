"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { useState } from "react"
import Link from "next/link"

type OrgRow = {
  id: string; name: string; slug: string; plan: string
  doc_used: number; doc_quota: number; subscription_status: string | null; created_at: string
}

export default function AdminOrgsPage() {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(false)

  const search = async (value: string) => {
    setQ(value)
    if (value.trim().length < 2) { setResults([]); return }
    setLoading(true)
    const res = await fetch(`/api/admin/orgs?q=${encodeURIComponent(value)}`)
    const json = await res.json()
    setResults(json.orgs ?? [])
    setLoading(false)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">ค้นหาองค์กร</h1>
        <p className="mt-1 text-sm text-zinc-400">ค้นหาด้วยชื่อหรือ slug — อย่างน้อย 2 ตัวอักษร</p>
      </div>

      <input
        value={q}
        onChange={e => search(e.target.value)}
        placeholder="พิมพ์ชื่อองค์กรหรือ slug..."
        className="w-full max-w-md h-10 px-3 rounded-md bg-zinc-900 border border-zinc-800 text-sm text-white
          placeholder:text-zinc-500 outline-none focus:border-amber-500"
      />

      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">องค์กร</th>
              <th className="px-4 py-3 text-left">Plan</th>
              <th className="px-4 py-3 text-left">โควต้า</th>
              <th className="px-4 py-3 text-left">Subscription</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {results.map(o => (
              <tr key={o.id} className="hover:bg-zinc-900/50">
                <td className="px-4 py-3">
                  <Link href={`/admin/orgs/${o.id}`} className="text-amber-400 hover:underline">{o.name}</Link>
                  <span className="ml-2 text-zinc-500 text-xs">{o.slug}</span>
                </td>
                <td className="px-4 py-3 text-zinc-300">{o.plan}</td>
                <td className="px-4 py-3 text-zinc-300">{o.doc_used}/{o.doc_quota}</td>
                <td className="px-4 py-3 text-zinc-300">{o.subscription_status ?? "—"}</td>
              </tr>
            ))}
            {!loading && results.length === 0 && q.trim().length >= 2 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-500">ไม่พบองค์กร</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
