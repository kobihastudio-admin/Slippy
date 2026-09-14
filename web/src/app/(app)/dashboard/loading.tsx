/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors the section order in components/dashboard/dashboard-view.tsx. */
export default function DashboardLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-5 max-w-[1500px]">

      {/* Greeting */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28 ml-auto" />
          <Skeleton className="h-3 w-12 ml-auto" />
        </div>
      </div>

      {/* ทำรายการด่วน */}
      <div className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-3 xl:grid-cols-6 gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border p-3.5 min-h-[108px] flex flex-col items-center justify-center gap-2.5">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* เข้าถึงเอกสารได้อย่างรวดเร็ว */}
      <div className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4">
        <Skeleton className="h-5 w-52" />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border p-3.5 space-y-2.5">
              <Skeleton className="h-9 w-9 rounded-[10px]" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-14" />
            </div>
          ))}
        </div>
      </div>

      {/* เอกสารล่าสุด */}
      <div className="rounded-2xl border bg-card">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex gap-2 px-5 pb-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="divide-y border-t">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <Skeleton className="w-9 h-9 rounded-[9px] shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-20 rounded-md hidden sm:block" />
              <div className="text-right space-y-1.5">
                <Skeleton className="h-4 w-24 ml-auto" />
                <Skeleton className="h-4 w-16 rounded-full ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ภาพรวมการใช้จ่าย · สิ่งที่ต้องจัดการ */}
      <div className="grid lg:grid-cols-2 gap-5">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border bg-card p-5 space-y-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-8 w-56" />
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
