/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { getTranslations }       from "next-intl/server"
import { getMembership }          from "@/lib/get-membership"
import { createClient }           from "@/lib/supabase/server"
import { DocumentList }           from "@/components/documents/document-list"
import { DashboardUploadZone }    from "@/components/documents/dashboard-upload-zone"

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; status?: string; type?: string; category?: string }>
}) {
  const t = await getTranslations("documents")
  const { organization_id: orgId, role } = await getMembership()
  const supabase = await createClient()
  const {
    vendor:   vendorFilter,
    status:   statusFilter,
    type:     typeFilter,
    category: categoryFilter,
  } = await searchParams

  const [{ data: documents, error: docsErr }, { data: org }] = await Promise.all([
    supabase
      .from("documents")
      .select(`
        id, vendor_name, total_amount, vat_amount, status, doc_date, doc_type,
        doc_category, expense_category, overall_confidence, is_duplicate, source,
        created_at, doc_number
      `)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("organizations")
      .select("slug")
      .eq("id", orgId)
      .single(),
  ])

  if (docsErr) console.error("[documents] query error:", docsErr.message)

  const canUpload = ["owner", "admin", "accountant"].includes(role)
  const vendorDecoded = vendorFilter ? decodeURIComponent(vendorFilter) : undefined

  return (
    <div className="page-wide space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[20px] font-bold">{t("title")}</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            {vendorDecoded
              ? <span>เอกสารของ <strong>{vendorDecoded}</strong></span>
              : "เอกสารทั้งหมดที่เข้ามาในระบบ"}
          </p>
        </div>
      </div>

      {canUpload && !vendorDecoded && (
        <DashboardUploadZone orgId={orgId} orgSlug={org?.slug ?? ""} compact />
      )}

      <DocumentList
        documents={documents ?? []}
        orgId={orgId}
        initialVendorFilter={vendorDecoded}
        initialStatus={statusFilter}
        initialType={typeFilter}
        initialCategory={categoryFilter ? decodeURIComponent(categoryFilter) : undefined}
      />
    </div>
  )
}
