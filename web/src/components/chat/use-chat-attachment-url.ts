"use client"

// Opens a chat file: the bucket is private, so a file is never reached by a permanent link. The client asks Storage for
// a short-lived signed URL with the signed-in user's own session; Storage only signs for members of the conversation in
// the object path (see supabase/migrations/20261114100000_chat_attachments_private.sql).

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { CHAT_BUCKET, SIGNED_URL_TTL_SECONDS, SignedUrlCache, chatAttachmentPath } from "@/lib/chat-attachment"

const cache = new SignedUrlCache()
const pending = new Map<string, Promise<string>>()

/** A signed URL for what a message stored in `attachment_url` (a path, or an old public URL). Rejects if it is not a chat file or Storage refuses. */
export function signChatAttachment(stored: string): Promise<string> {
  const path = chatAttachmentPath(stored)
  if (!path) return Promise.reject(new Error("not a chat file"))
  const hit = cache.get(path, Date.now())
  if (hit) return Promise.resolve(hit)
  let request = pending.get(path)
  if (!request) {
    request = (async () => {
      const { data, error } = await createClient().storage.from(CHAT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      if (error || !data?.signedUrl) throw error ?? new Error("no signed url")
      cache.set(path, data.signedUrl, Date.now())
      return data.signedUrl
    })().finally(() => { pending.delete(path) })
    pending.set(path, request)
  }
  return request
}

/** The signed URL for a stored attachment value: `url` once ready, `failed` if it cannot be opened. */
export function useChatAttachmentUrl(stored: string | null | undefined): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ stored: string | null | undefined; url: string | null; failed: boolean }>({ stored, url: null, failed: false })

  useEffect(() => {
    let cancelled = false
    if (!stored) { setState({ stored, url: null, failed: true }); return }
    setState({ stored, url: null, failed: false })
    signChatAttachment(stored)
      .then(url => { if (!cancelled) setState({ stored, url, failed: false }) })
      .catch(() => { if (!cancelled) setState({ stored, url: null, failed: true }) })
    return () => { cancelled = true }
  }, [stored])

  // Never hand out the URL of the previous value while the new one is being signed.
  return state.stored === stored ? { url: state.url, failed: state.failed } : { url: null, failed: false }
}
