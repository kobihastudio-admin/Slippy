"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { useState } from "react"
import Link from "next/link"

type UserRow = { id: string; email: string; full_name: string | null; is_superadmin: boolean; created_at: string }

export default function AdminUsersPage() {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)

  const search = async (value: string) => {
    setQ(value)
    if (value.trim().length < 2) { setResults([]); return }
    setLoading(true)
    const res = await fetch(`/api/admin/users?q=${encodeURIComponent(value)}`)
    const json = await res.json()
    setResults(json.users ?? [])
    setLoading(false)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">ค้นหาผู้ใช้</h1>
        <p className="mt-1 text-sm text-zinc-400">ค้นหาด้วยอีเมลหรือชื่อ — อย่างน้อย 2 ตัวอักษร</p>
      </div>

      <input
        value={q}
        onChange={e => search(e.target.value)}
        placeholder="พิมพ์อีเมลหรือชื่อ..."
        className="w-full max-w-md h-10 px-3 rounded-md bg-zinc-900 border border-zinc-800 text-sm text-white
          placeholder:text-zinc-500 outline-none focus:border-amber-500"
      />

      <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">อีเมล</th>
              <th className="px-4 py-3 text-left">ชื่อ</th>
              <th className="px-4 py-3 text-left">สมัครเมื่อ</th>
              <th className="px-4 py-3 text-left">Superadmin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {results.map(u => (
              <tr key={u.id} className="hover:bg-zinc-900/50">
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${u.id}`} className="text-amber-400 hover:underline">{u.email}</Link>
                </td>
                <td className="px-4 py-3 text-zinc-300">{u.full_name ?? "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{new Date(u.created_at).toLocaleDateString("th-TH")}</td>
                <td className="px-4 py-3">{u.is_superadmin ? "✓" : ""}</td>
              </tr>
            ))}
            {!loading && results.length === 0 && q.trim().length >= 2 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-500">ไม่พบผู้ใช้</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
