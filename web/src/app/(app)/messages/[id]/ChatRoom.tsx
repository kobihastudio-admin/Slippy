"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import {
  ArrowLeft, Send, Image as ImageIcon, Paperclip, DollarSign,
  FileText, X, Loader2, ChevronDown, Receipt
} from "lucide-react"

// Must match the "chat-attachments" bucket's file_size_limit (migration
// 077) — checking client-side first avoids wasting a slow upload attempt
// (and the user waiting on it) only to have Storage reject it at the end.
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

// Session-aware client (reads the logged-in user's cookies via @supabase/ssr).
// Previously this used the plain @supabase/supabase-js client with only the
// anon key — no session at all, so `auth.uid()` was null for every request
// from here. That silently broke two things: the realtime subscription below
// (messages_member_read RLS requires is_conversation_member(), which needs
// auth.uid()) and file uploads (storage's authenticated_insert policy on the
// documents bucket only applies to the `authenticated` role, which requires
// a valid session — a plain anon-key client runs as `anon` instead).
const sb = createClient()

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Message {
  id: string
  body: string | null
  msg_type: string
  created_at: string
  attachment_url: string | null
  meta: Record<string, any>
  sender: { id: string; full_name: string; avatar_url: string | null } | null
}

interface Props {
  convId: string
  convName?: string
  convAvatarUrl?: string | null
  currentUserId: string
  embedded?: boolean
  onBack?: () => void
  onNewMessage?: () => void
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function Avatar({ name, avatarUrl, size = 32 }: { name: string; avatarUrl?: string | null; size?: number }) {
  // Fixed pixel sizing via inline style, not a dynamically-built `w-${size}`
  // Tailwind class — Tailwind's JIT scanner only picks up class names that
  // appear literally in source, so an interpolated class like that silently
  // produces no CSS at all unless the exact string happens to exist
  // elsewhere in the bundle.
  const style = { width: size, height: size }
  const [broken, setBroken] = useState(false)
  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        style={style}
        onError={() => setBroken(true)}
        alt={name}
        className="rounded-full object-cover shrink-0 ring-2 ring-background shadow-sm"
      />
    )
  }
  return (
    <div
      style={style}
      className="rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center
        text-white font-semibold text-sm shrink-0 ring-2 ring-background shadow-sm overflow-hidden"
    >
      {name?.[0]?.toUpperCase() ?? "?"}
    </div>
  )
}

function timeFmt(iso: string) {
  return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
}

function dateSeparator(iso: string) {
  const d = new Date(iso), now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days === 0) return "วันนี้"
  if (days === 1) return "เมื่อวาน"
  return d.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" })
}

function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

// ─── Bubble components ─────────────────────────────────────────────────────────

const IMAGE_LOAD_RETRY_DELAYS_MS = [600, 1500, 3000]

function ImageBubble({ url, isMe }: { url: string; isMe: boolean }) {
  const [open, setOpen]       = useState(false)
  const [broken, setBroken]   = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  // Right after upload, the message row (and its realtime push to every
  // open chat) lands before the object is always reliably fetchable from
  // Supabase Storage's public URL yet — the first load can 404 briefly.
  // Without a retry, that one failed attempt stuck the bubble in "failed"
  // state forever, and only a full page reload (fresh <img> mount) would
  // try again — which is exactly what looked like "images only show after
  // reload." Retry a few times with backoff before actually giving up.
  function handleError() {
    if (retryCount < IMAGE_LOAD_RETRY_DELAYS_MS.length) {
      setTimeout(() => setRetryCount(c => c + 1), IMAGE_LOAD_RETRY_DELAYS_MS[retryCount])
    } else {
      setBroken(true)
    }
  }

  if (broken) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-muted rounded-2xl max-w-[240px] text-sm text-muted-foreground">
        <ImageIcon className="w-5 h-5 shrink-0" />
        โหลดรูปภาพไม่สำเร็จ
      </div>
    )
  }

  return (
    <>
      <img
        // Cache-bust each retry so the browser re-requests instead of
        // replaying a cached 404.
        src={retryCount === 0 ? url : `${url}?retry=${retryCount}`}
        alt="image" onClick={() => setOpen(true)} onError={handleError}
        className="max-w-[240px] max-h-[240px] rounded-2xl object-cover cursor-zoom-in border border-border"
      />
      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <img src={url} alt="image" className="max-w-full max-h-full rounded-xl object-contain" />
          <button className="absolute top-4 right-4 text-white" onClick={() => setOpen(false)}><X /></button>
        </div>
      )}
    </>
  )
}

function VideoBubble({ url }: { url: string }) {
  const [broken, setBroken]         = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  // Same Storage-propagation-delay issue as ImageBubble — the message can
  // arrive via realtime slightly before the uploaded object is fetchable.
  function handleError() {
    if (retryCount < IMAGE_LOAD_RETRY_DELAYS_MS.length) {
      setTimeout(() => setRetryCount(c => c + 1), IMAGE_LOAD_RETRY_DELAYS_MS[retryCount])
    } else {
      setBroken(true)
    }
  }

  if (broken) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-muted rounded-2xl max-w-[240px] text-sm text-muted-foreground">
        <FileText className="w-5 h-5 shrink-0" />
        โหลดวิดีโอไม่สำเร็จ
      </div>
    )
  }

  return (
    <video
      key={retryCount}
      src={retryCount === 0 ? url : `${url}?retry=${retryCount}`}
      controls
      preload="metadata"
      onError={handleError}
      className="max-w-[280px] max-h-[320px] rounded-2xl border border-border bg-black"
    />
  )
}

function FileBubble({ url, name }: { url: string; name?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 bg-muted rounded-2xl max-w-[240px] hover:bg-muted/80 transition-colors">
      <FileText className="w-8 h-8 text-brand-500 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{name ?? "ไฟล์แนบ"}</p>
        <p className="text-xs text-muted-foreground">แตะเพื่อเปิด</p>
      </div>
    </a>
  )
}

function PaymentRequestBubble({ body, meta, isMe }: { body: string | null; meta: Record<string, any>; isMe: boolean }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl px-4 py-3 max-w-[260px]">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
        <DollarSign className="w-4 h-4 shrink-0" />
        <span className="font-semibold text-sm">{body}</span>
      </div>
      {!isMe && meta?.payment_request_id && (
        <a href={`/pay/${meta.payment_request_id}`}
          className="block text-center text-xs bg-amber-500 text-white rounded-xl py-2 font-semibold hover:bg-amber-600 transition-colors">
          💳 ชำระเงิน / ดู QR
        </a>
      )}
      {isMe && <p className="text-xs text-amber-600/70 dark:text-amber-500/70 text-center mt-1">รอการชำระเงิน</p>}
    </div>
  )
}

function SlipBubble({ meta }: { meta: Record<string, any> }) {
  const doc = meta?.document ?? {}
  return (
    <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-2xl px-4 py-3 max-w-[260px]">
      <div className="flex items-center gap-2 mb-2">
        <Receipt className="w-4 h-4 text-brand-500 shrink-0" />
        <span className="text-sm font-semibold text-foreground">สลิป / ใบเสร็จ</span>
      </div>
      {doc.vendor_name && <p className="text-sm text-foreground font-medium">{doc.vendor_name}</p>}
      {doc.total_amount != null && (
        <p className="text-lg font-bold text-brand-600 dark:text-brand-400 mt-1">
          ฿{Number(doc.total_amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </p>
      )}
      {doc.doc_date && <p className="text-xs text-muted-foreground mt-0.5">{doc.doc_date}</p>}
      {meta?.document_id && (
        <a href={`/documents/${meta.document_id}/review`}
          className="mt-2 block text-center text-xs bg-brand-500 text-white rounded-xl py-1.5 font-semibold hover:bg-brand-600 transition-colors">
          ดูรายละเอียด →
        </a>
      )}
    </div>
  )
}

// ─── Main ChatRoom ──────────────────────────────────────────────────────────────
export default function ChatRoom({ convId, convName, convAvatarUrl, currentUserId, embedded, onBack, onNewMessage }: Props) {
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState("")
  const [sending, setSending]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const [hasMore, setHasMore]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const bottomRef  = useRef<HTMLDivElement>(null)
  const listRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const fileRef    = useRef<HTMLInputElement>(null)
  const isAtBottom = useRef(true)

  // ── Load initial messages ─────────────────────────────────────────────────────
  const loadMessages = useCallback(async (before?: string) => {
    const url = `/api/conversations/${convId}/messages?limit=40${before ? `&before=${before}` : ""}`
    const res = await fetch(url)
    const j   = await res.json()
    const msgs: Message[] = j.messages ?? []
    if (before) {
      setMessages(prev => [...msgs, ...prev])
      setLoadingMore(false)
    } else {
      setMessages(msgs)
      setTimeout(() => bottomRef.current?.scrollIntoView(), 0)
    }
    setHasMore(msgs.length === 40)
  }, [convId])

  useEffect(() => {
    loadMessages()
    inputRef.current?.focus()

    // Supabase realtime subscription
    const channel = sb
      .channel(`conv:${convId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
        payload => {
          const msg = payload.new as Message
          setMessages(prev => {
            if (prev.some(m => m.id === msg.id)) return prev
            return [...prev, msg]
          })
          if (isAtBottom.current) {
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
          } else {
            setShowScrollBtn(true)
          }
          onNewMessage?.()
        }
      ).subscribe()

    return () => { sb.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])

  // Track scroll position to show "scroll to bottom" button
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isAtBottom.current = distFromBottom < 80
    setShowScrollBtn(distFromBottom > 200)
  }

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    setShowScrollBtn(false)
  }

  function loadMore() {
    if (!hasMore || loadingMore || messages.length === 0) return
    setLoadingMore(true)
    loadMessages(messages[0].created_at)
  }

  // ── Send text ─────────────────────────────────────────────────────────────────
  async function send() {
    if (!input.trim() || sending) return
    setSending(true)
    const body = input.trim()
    setInput("")
    await fetch(`/api/conversations/${convId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    })
    setSending(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // ── Upload image / file ──────────────────────────────────────────────────────
  // Previously had zero error handling — any failure (storage upload error,
  // a network hiccup on the POST after a slow large-file upload, etc.)
  // silently swallowed the whole flow: no message row, no toast, `uploading`
  // sometimes left stuck true forever. A 31MB .MOV reproduced this exactly —
  // the file reached Storage fine but the message-insert POST never even
  // hit the server, and the user just saw... nothing. try/catch/finally +
  // toast now surfaces failures instead of failing invisibly.
  async function uploadFile(file: File) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(`ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB)`)
      return
    }

    setUploading(true)
    try {
      const isImage = file.type.startsWith("image/")
      const isVideo = file.type.startsWith("video/")
      const ext     = file.name.split(".").pop() ?? "bin"
      const path    = `chat/${convId}/${Date.now()}.${ext}`

      // "chat-attachments" — a dedicated PUBLIC bucket (see migration 076).
      // Chat used to upload into the shared "documents" bucket, but that one
      // is private (holds sensitive receipts/invoices), so getPublicUrl() on
      // it returned a URL a plain <img> tag couldn't actually load — broken
      // image icon in every chat. This bucket is public specifically so chat
      // attachments render without needing a signed URL.
      const { error: upErr } = await sb.storage.from("chat-attachments").upload(path, file, { contentType: file.type })
      if (upErr) throw upErr

      const { data: { publicUrl } } = sb.storage.from("chat-attachments").getPublicUrl(path)

      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: file.name,
          msgType: isImage ? "image" : isVideo ? "video" : "file",
          attachmentUrl: publicUrl,
          meta: { fileName: file.name, fileSize: file.size },
        }),
      })
      if (!res.ok) throw new Error(`send failed: ${res.status}`)
    } catch (err) {
      console.error("[ChatRoom] uploadFile failed:", err)
      toast.error("ส่งไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง")
    } finally {
      setUploading(false)
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    e.target.value = ""
  }

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
        {(embedded || onBack) && (
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        {convName && (
          <>
            <Avatar name={convName} avatarUrl={convAvatarUrl} size={36} />
            <div>
              <p className="font-semibold text-foreground text-sm leading-tight">{convName}</p>
              <p className="text-xs text-muted-foreground leading-tight">ออนไลน์</p>
            </div>
          </>
        )}
        {!convName && <p className="font-semibold text-foreground">การสนทนา</p>}
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-muted/30"
      >
        {/* Load more */}
        {hasMore && (
          <div className="flex justify-center pb-2">
            <button onClick={loadMore} disabled={loadingMore}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-3 py-1.5 rounded-full bg-background border border-border transition-colors">
              {loadingMore ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronDown className="w-3 h-3 rotate-180" />}
              {loadingMore ? "กำลังโหลด..." : "โหลดข้อความเก่า"}
            </button>
          </div>
        )}

        {messages.map((m, i) => {
          const isMe    = m.sender?.id === currentUserId
          const prev    = messages[i - 1]
          const showDay = !prev || !isSameDay(prev.created_at, m.created_at)
          const showAvatar = !isMe && (!messages[i + 1] || messages[i + 1].sender?.id !== m.sender?.id)
          const isFirst = !prev || prev.sender?.id !== m.sender?.id || showDay

          return (
            <div key={m.id}>
              {/* Date separator */}
              {showDay && (
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground px-2 bg-muted/30 rounded-full py-0.5 shrink-0">
                    {dateSeparator(m.created_at)}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}

              <div className={`flex gap-2 mb-0.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                {/* Avatar placeholder for alignment */}
                <div className="w-8 shrink-0">
                  {!isMe && showAvatar && (
                    <Avatar name={m.sender?.full_name ?? "?"} avatarUrl={m.sender?.avatar_url} size={32} />
                  )}
                </div>

                <div className={`flex flex-col gap-0.5 max-w-[72%] ${isMe ? "items-end" : "items-start"}`}>
                  {/* Sender name */}
                  {!isMe && isFirst && m.sender?.full_name && (
                    <p className="text-xs font-medium text-muted-foreground ml-1 mb-0.5">{m.sender.full_name}</p>
                  )}

                  {/* Bubble */}
                  {m.msg_type === "image" && m.attachment_url
                    ? <ImageBubble url={m.attachment_url} isMe={isMe} />
                    : m.msg_type === "video" && m.attachment_url
                    ? <VideoBubble url={m.attachment_url} />
                    : m.msg_type === "file" && m.attachment_url
                    ? <FileBubble url={m.attachment_url} name={m.meta?.fileName} />
                    : m.msg_type === "payment_request"
                    ? <PaymentRequestBubble body={m.body} meta={m.meta} isMe={isMe} />
                    : m.msg_type === "slip"
                    ? <SlipBubble meta={m.meta} />
                    : (
                      <div className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words
                        ${isMe
                          ? "bg-brand-500 text-white rounded-br-sm"
                          : "bg-background border border-border text-foreground rounded-bl-sm shadow-sm"
                        }`}>
                        {m.body}
                      </div>
                    )
                  }

                  {/* Timestamp */}
                  <p className={`text-[10px] text-muted-foreground px-1 ${isMe ? "text-right" : "text-left"}`}>
                    {timeFmt(m.created_at)}
                  </p>
                </div>
              </div>
            </div>
          )
        })}

        {/* Uploading indicator */}
        {uploading && (
          <div className="flex flex-row-reverse gap-2">
            <div className="w-8 shrink-0" />
            <div className="flex items-center gap-2 px-4 py-2.5 bg-brand-500/80 text-white rounded-2xl rounded-br-sm text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              กำลังอัปโหลด...
            </div>
          </div>
        )}

        <div ref={bottomRef} className="h-1" />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <div className="absolute bottom-20 right-6">
          <button onClick={scrollToBottom}
            className="w-10 h-10 bg-background border border-border rounded-full shadow-lg flex items-center justify-center hover:bg-muted transition-colors">
            <ChevronDown className="w-5 h-5 text-foreground" />
          </button>
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-center gap-2 px-3 py-3 border-t border-border bg-background shrink-0">
        {/* File / image upload */}
        <input ref={fileRef} type="file" accept="image/*,video/*,application/pdf" onChange={onFileChange} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40">
          <Paperclip className="w-5 h-5" />
        </button>
        <button onClick={() => { if (fileRef.current) { fileRef.current.accept = "image/*"; fileRef.current.click() } }} disabled={uploading}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40">
          <ImageIcon className="w-5 h-5" />
        </button>

        {/* Text input */}
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="พิมพ์ข้อความ..."
          className="flex-1 px-4 py-2.5 bg-muted border border-transparent rounded-full text-sm focus:outline-none focus:border-brand-500/50 focus:bg-background transition-all placeholder:text-muted-foreground"
          disabled={sending}
        />

        {/* Send */}
        <button onClick={send} disabled={sending || !input.trim()}
          className="w-10 h-10 bg-brand-500 text-white rounded-full flex items-center justify-center hover:bg-brand-600 transition-colors disabled:opacity-40 shrink-0">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}
