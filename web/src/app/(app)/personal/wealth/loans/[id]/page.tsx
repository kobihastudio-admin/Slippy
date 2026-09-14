/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { LoanDetailClient } from "@/components/personal/loan-detail-client"

export const metadata = { title: "รายละเอียดสินเชื่อ — Slippy" }

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <LoanDetailClient loanId={id} />
}
