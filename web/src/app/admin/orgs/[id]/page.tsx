"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"

type Detail = {
  org: {
    id: string; name: string; slug: string; plan: string
    doc_used: number; doc_quota: number; subscription_status: string | null
    stripe_customer_id: string | null; created_at: string
  }
  members: { role: string; joined_at: string; users: { id: string; email: string; full_name: string | null } }[]
  invoices: { id: string; amount_paid: number; currency: string; status: string; created_at: string }[]
  plans: { id: string; name_th: string; doc_quota: number }[]
}

export default function AdminOrgDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState("")

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/orgs/${id}`)
    if (res.ok) {
      const json = await res.json()
      setData(json)
      setSelectedPlan(json.org.plan)
    }
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const changePlan = async () => {
    if (!data || selectedPlan === data.org.plan) return
    if (!confirm(`เปลี่ยน plan เป็น "${selectedPlan}"? โควต้าเอกสารจะถูกตั้งใหม่ตามแผนนี้ทันที`)) return
    setBusy(true)
    const res = await fetch(`/api/admin/orgs/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: selectedPlan }),
    })
    setBusy(false)
    if (!res.ok) { toast.error("เปลี่ยน plan ไม่สำเร็จ"); return }
    toast.success("เปลี่ยน plan แล้ว")
    load()
  }

  const resetQuota = async () => {
    if (!confirm("รีเซ็ตโควต้าเอกสารขององค์กรนี้เป็น 0 ตอนนี้?")) return
    setBusy(true)
    const res = await fetch(`/api/admin/orgs/${id}/reset-quota`, { method: "POST" })
    setBusy(false)
    if (!res.ok) { toast.error("รีเซ็ตไม่สำเร็จ"); return }
    toast.success("รีเซ็ตโควต้าแล้ว")
    load()
  }

  if (loading) return <p className="text-zinc-500">กำลังโหลด...</p>
  if (!data) return <p className="text-red-400">ไม่พบองค์กร</p>

  const usagePct = data.org.doc_quota > 0 ? Math.min(100, (data.org.doc_used / data.org.doc_quota) * 100) : 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">{data.org.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {data.org.slug} · สร้างเมื่อ {new Date(data.org.created_at).toLocaleDateString("th-TH")}
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">Plan &amp; โควต้า</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={selectedPlan}
              onChange={e => setSelectedPlan(e.target.value)}
              className="h-9 px-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-white"
            >
              {data.plans.map(p => <option key={p.id} value={p.id}>{p.name_th} ({p.doc_quota} เอกสาร)</option>)}
            </select>
            <button
              onClick={changePlan}
              disabled={busy || selectedPlan === data.org.plan}
              className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-sm text-white disabled:opacity-50"
            >
              เปลี่ยน Plan
            </button>
            <span className="text-xs text-zinc-500">ปัจจุบัน: {data.org.plan} · subscription: {data.org.subscription_status ?? "—"}</span>
          </div>

          <div>
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span>เอกสารที่ใช้ไป</span>
              <span>{data.org.doc_used} / {data.org.doc_quota}</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full ${usagePct >= 100 ? "bg-red-500" : usagePct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
            <button
              onClick={resetQuota}
              disabled={busy}
              className="mt-3 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm text-white disabled:opacity-50"
            >
              รีเซ็ตโควต้าตอนนี้
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">สมาชิก</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">ผู้ใช้</th>
                <th className="px-4 py-3 text-left">บทบาท</th>
                <th className="px-4 py-3 text-left">เข้าร่วมเมื่อ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {data.members.map((m, i) => (
                <tr key={i} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <a href={`/admin/users/${m.users.id}`} className="text-amber-400 hover:underline">
                      {m.users.full_name ?? m.users.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{m.role}</td>
                  <td className="px-4 py-3 text-zinc-300">{new Date(m.joined_at).toLocaleDateString("th-TH")}</td>
                </tr>
              ))}
              {data.members.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">ไม่มีสมาชิก</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300 uppercase tracking-wide">ประวัติการเรียกเก็บเงิน</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">วันที่</th>
                <th className="px-4 py-3 text-left">จำนวน</th>
                <th className="px-4 py-3 text-left">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {data.invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 text-zinc-300">{new Date(inv.created_at).toLocaleDateString("th-TH")}</td>
                  <td className="px-4 py-3 text-zinc-300">{inv.amount_paid} {inv.currency.toUpperCase()}</td>
                  <td className="px-4 py-3 text-zinc-300">{inv.status}</td>
                </tr>
              ))}
              {data.invoices.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">ไม่มีประวัติการเรียกเก็บเงิน</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
