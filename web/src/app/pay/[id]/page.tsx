"use client"
import { useEffect, useState } from "react"
import { useParams }           from "next/navigation"

interface PayRequest {
  id: string
  amount: number
  description: string | null
  qr_payload: string | null
  status: string
  requester: { full_name: string; avatar_url: string | null }
}

export default function PayPage() {
  const { id }     = useParams<{ id: string }>()
  const [req, setReq]     = useState<PayRequest | null>(null)
  const [qrUrl, setQrUrl] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/payment-requests/${id}`)
      .then(r => r.json())
      .then(async j => {
        setReq(j.request)
        if (j.request?.qr_payload) {
          // Use qrserver.com — no canvas needed, works in all environments
          setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(j.request.qr_payload)}&size=240x240&format=png`)
        }
        setLoading(false)
      })
  }, [id])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-gray-400">กำลังโหลด...</div>
    </div>
  )

  if (!req) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-red-500">ไม่พบรายการ</div>
    </div>
  )

  return (
    <div className="max-w-sm mx-auto py-10 px-4 text-center space-y-6">
      <div>
        <p className="text-gray-500 text-sm">ขอเงินจาก</p>
        <p className="font-semibold text-lg text-gray-900">{req.requester?.full_name ?? "—"}</p>
      </div>

      <div className="bg-green-50 rounded-2xl py-6 px-8">
        <p className="text-4xl font-bold text-green-700">
          ฿{Number(req.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </p>
        {req.description && <p className="text-sm text-gray-500 mt-2">{req.description}</p>}
      </div>

      {qrUrl && (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="PromptPay QR" className="rounded-xl shadow w-60 h-60" />
          <p className="text-xs text-gray-400">สแกน QR ด้วยแอปธนาคาร</p>
        </div>
      )}

      {!qrUrl && req.status !== "paid" && (
        <div className="text-sm text-gray-400">ผู้รับยังไม่ได้ตั้งค่า PromptPay</div>
      )}

      {req.status === "paid" && (
        <div className="bg-green-100 text-green-700 rounded-xl py-3 font-semibold">
          ✅ ชำระเงินแล้ว
        </div>
      )}
    </div>
  )
}
