"use client"

/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { useEffect, useState, useCallback } from "react"
import {
  Bell, CheckCircle2, AlertCircle, FileText, Zap,
  RefreshCw, CheckCheck, Inbox, CreditCard, XCircle,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────
interface Notification {
  id:              string
  type:            string
  title:           string
  body:            string | null
  metadata:        Record<string, unknown>
  read_at:         string | null
  created_at:      string
  organization_id: string | null
  user_id:         string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function typeIcon(type: string) {
  switch (type) {
    case "document_approved":   return { Icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" }
    case "document_failed":     return { Icon: AlertCircle,  color: "text-rose-500",    bg: "bg-rose-500/10"    }
    case "document_rejected":   return { Icon: XCircle,      color: "text-rose-500",    bg: "bg-rose-500/10"    }
    case "document_duplicate":  return { Icon: AlertCircle,  color: "text-amber-500",   bg: "bg-amber-500/10"   }
    case "quota_warning":       return { Icon: AlertCircle,  color: "text-amber-500",   bg: "bg-amber-500/10"   }
    case "quota_exceeded":      return { Icon: AlertCircle,  color: "text-rose-500",    bg: "bg-rose-500/10"    }
    case "payment_due":         return { Icon: CreditCard,   color: "text-amber-500",   bg: "bg-amber-500/10"   }
    case "payment_failed":      return { Icon: CreditCard,   color: "text-rose-500",    bg: "bg-rose-500/10"    }
    case "payment_success":     return { Icon: CreditCard,   color: "text-emerald-500", bg: "bg-emerald-500/10" }
    case "integration_sync":    return { Icon: Zap,          color: "text-purple-500",  bg: "bg-purple-500/10"  }
    case "line_received":
    case "email_received":      return { Icon: FileText,     color: "text-brand-500",   bg: "bg-brand-500/10"   }
    case "upload_error":        return { Icon: AlertCircle,  color: "text-rose-500",    bg: "bg-rose-500/10"    }
    default:                    return { Icon: Bell,         color: "text-muted-foreground", bg: "bg-muted"      }
  }
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)  return "เมื่อกี้"
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)   return `${hours} ชม.ที่แล้ว`
  const days = Math.floor(hours / 24)
  if (days === 1)   return "เมื่อวาน"
  if (days < 7)     return `${days} วันที่แล้ว`
  return new Date(dateStr).toLocaleDateString("th-TH", { day: "numeric", month: "short" })
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const [items,       setItems]       = useState<Notification[]>([])
  const [loading,     setLoading]     = useState(true)
  const [marking,     setMarking]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const unreadCount = items.filter(n => !n.read_at).length

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/notifications?limit=50")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setItems(json.notifications ?? [])
    } catch (e) {
      setError("โหลดการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  // ── Mark one as read ─────────────────────────────────────────────────────
  const markOne = useCallback(async (id: string) => {
    // Optimistic update
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
    } catch { /* ignore — already updated UI */ }
  }, [])

  // ── Mark all as read ─────────────────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    if (unreadCount === 0 || marking) return
    setMarking(true)
    // Optimistic update
    const now = new Date().toISOString()
    setItems(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }))
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    } catch { /* ignore */ } finally {
      setMarking(false)
    }
  }, [unreadCount, marking])

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="page-narrow animate-fade-in">
      {/* Header row */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">การแจ้งเตือน</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            {loading
              ? "กำลังโหลด…"
              : unreadCount > 0
                ? `${unreadCount} รายการยังไม่ได้อ่าน`
                : "อ่านทั้งหมดแล้ว"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchNotifications}
            disabled={loading}
            title="รีเฟรช"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted
              transition-colors disabled:opacity-40"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={marking}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-600
                hover:text-brand-700 hover:underline disabled:opacity-40 transition-colors"
            >
              <CheckCheck size={13} />
              อ่านทั้งหมด
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-900/10
          dark:border-rose-800 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <Inbox size={40} strokeWidth={1.2} />
          <p className="text-sm">ยังไม่มีการแจ้งเตือน</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="rounded-xl border bg-card overflow-hidden divide-y">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex gap-4 px-5 py-4 animate-pulse">
              <div className="w-9 h-9 rounded-[10px] bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-muted rounded w-40" />
                <div className="h-3 bg-muted rounded w-64" />
                <div className="h-2.5 bg-muted rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {!loading && items.length > 0 && (
        <div className="rounded-xl border bg-card overflow-hidden divide-y">
          {items.map((n) => {
            const { Icon, color, bg } = typeIcon(n.type)
            const isUnread = !n.read_at
            return (
              <div
                key={n.id}
                onClick={() => isUnread && markOne(n.id)}
                className={`flex gap-4 px-5 py-4 transition-colors
                  ${isUnread ? "bg-brand-50/50 dark:bg-brand-900/10 cursor-pointer hover:bg-brand-100/50 dark:hover:bg-brand-900/20" : "hover:bg-muted/50"}`}
              >
                <div className={`w-9 h-9 rounded-[10px] ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{n.title}</p>
                    {isUnread && <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0 mt-1" />}
                  </div>
                  {n.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {relativeTime(n.created_at)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
