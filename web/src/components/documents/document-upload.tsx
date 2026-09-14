"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useCallback, useState } from "react"
import { useDropzone } from "react-dropzone"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Upload, Loader2, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { ImageCropStep } from "./image-crop-step"

interface DocumentUploadProps { orgId: string }

export function DocumentUpload({ orgId }: DocumentUploadProps) {
  const t      = useTranslations("documents")
  const router = useRouter()
  const supabase = createClient()

  const [status, setStatus] = useState<"idle"|"uploading"|"processing"|"done">("idle")
  const [progress, setProgress] = useState(0)
  const [fileName, setFileName] = useState("")
  // PDFs skip the crop step entirely — only photos benefit from trimming
  // background clutter before they hit the AI pipeline.
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null)

  const processFile = async (file: File) => {
    setStatus("uploading")
    setFileName(file.name)
    setProgress(10)

    const { data: { user } } = await supabase.auth.getUser()
    const ext  = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
    const path = `${orgId}/${Date.now()}.${ext}`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type })

    if (uploadError) {
      toast.error(uploadError.message)
      setStatus("idle")
      return
    }
    setProgress(30)

    // Create document record
    const { data: doc, error: insertError } = await supabase
      .from("documents")
      .insert({
        organization_id: orgId,
        uploaded_by: user!.id,
        file_path:  path,
        file_type:  ext === "pdf" ? "pdf" : "jpg",
        status:     "pending",
        source:     "web",
      })
      .select("id")
      .single()

    if (insertError || !doc) {
      toast.error("Failed to create document record")
      setStatus("idle")
      return
    }
    setProgress(40)

    // Trigger API extraction
    setStatus("processing")
    await fetch(`/api/documents/${doc.id}/process`, { method: "POST" })

    // Poll for completion via SSE
    const es = new EventSource(`/api/documents/${doc.id}/progress`)

    es.onmessage = (e) => {
      const payload = JSON.parse(e.data)
      if (payload.progress) setProgress(40 + payload.progress * 0.6)
      if (payload.status && ["reviewing","approved","failed"].includes(payload.status)) {
        es.close()
        setStatus("done")
        setProgress(100)
        setTimeout(() => {
          router.push(`/documents/${doc.id}/review`)
        }, 800)
      }
    }
    es.onerror = () => {
      es.close()
      setStatus("done")
      router.push(`/documents/${doc.id}/review`)
    }
  }

  const onDrop = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    if (file.type === "application/pdf") { processFile(file); return }
    setPendingCropFile(file)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [], "image/jpeg": [], "image/png": [] },
    maxFiles: 1,
    disabled: status !== "idle",
  })

  if (pendingCropFile) {
    return (
      <ImageCropStep
        file={pendingCropFile}
        onConfirm={(cropped) => { setPendingCropFile(null); processFile(cropped) }}
        onSkip={() => { const f = pendingCropFile; setPendingCropFile(null); processFile(f) }}
        onCancel={() => setPendingCropFile(null)}
      />
    )
  }

  if (status !== "idle") {
    return (
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-900/20
            flex items-center justify-center shrink-0">
            {status === "done"
              ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              : <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
            }
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium truncate">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              {status === "uploading"   ? t("uploading") ?? "กำลังอัปโหลด..."
             : status === "processing" ? t("processingDesc")
             : "เสร็จสิ้น กำลังเปิดหน้า Review..."}
            </p>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-brand-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        "rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer",
        "flex flex-col items-center justify-center gap-3 py-10 px-6 text-center",
        isDragActive
          ? "border-brand-400 bg-brand-50 dark:bg-brand-900/10"
          : "border-border hover:border-brand-300 hover:bg-muted/30"
      )}
    >
      <input {...getInputProps()} />
      <div className="w-12 h-12 rounded-xl bg-brand-50 dark:bg-brand-900/20
        flex items-center justify-center">
        <Upload className="w-6 h-6 text-brand-500" />
      </div>
      <div>
        <p className="font-medium text-sm">{t("uploadDesc")}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t("supportedFormats")}</p>
      </div>
    </div>
  )
}
