/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { fileTypeFromBuffer } from "file-type"

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

export interface ValidatedUpload {
  mime: string
  ext: string
}

/**
 * validateImageUpload — sniffs the actual file content (magic bytes) instead
 * of trusting the client-supplied `File.type`, which is fully attacker-
 * controlled. Returns the REAL detected mime/extension to use for storage
 * upload, or null if the content isn't one of the allowed image types
 * (including the case where it isn't a recognizable file type at all —
 * fileTypeFromBuffer returns undefined for plain text, scripts, etc.).
 *
 * Use this everywhere a route accepts an "image" upload from an
 * unauthenticated-by-Supabase-session source (LIFF routes, mobile direct
 * uploads) — previously several routes (liff/scan, sport-groups proof,
 * split-groups receipt) used the declared file.type directly for both the
 * storage extension AND the Content-Type header, which lets a client upload
 * arbitrary content (e.g. an HTML file with a script payload) labeled and
 * served back as "image/jpeg".
 */
export async function validateImageUpload(buffer: Buffer): Promise<ValidatedUpload | null> {
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || !ALLOWED_IMAGE_MIMES.has(detected.mime)) return null
  return { mime: detected.mime, ext: detected.ext }
}
