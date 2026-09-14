import sharp from "sharp"
import { createClient } from "../lib/supabase"

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "documents"

// ── Image quality targets ────────────────────────────────────────────────────
// Thai receipts typically use 7-8pt fonts. At 1024px the text is ~4-5px tall
// which causes Claude to misread numerals (e.g. 1↔7, 3↔8).
// 1800px puts a typical 8pt font at ~11px — consistently readable.
// Normalisation must not throw away pixels the model would have used, so this
// tracks MODEL_LONG_EDGE rather than sitting under an unrelated payload budget.
// At 2576 a q95 JPEG page is roughly 1.3 MB and five slices ~6.5 MB, well inside
// the 5 MB-per-image / 32 MB-per-request limits.
const TARGET_PX      = 2576
const JPEG_QUALITY   = 95      // higher quality → less artifact on fine numbers

/**
 * The vision API rescales every image so its LONGEST edge is at most this.
 * Everything about Thai legibility follows from it, so it is a named constant
 * rather than a number buried in a comment.
 *
 * 1568 was the ceiling for Sonnet 4.5 and Haiku 4.5. Sonnet 5 accepts 2576 —
 * 64% more pixels across exactly the axis where Thai was dying. The whole
 * slicing apparatus below exists to work around the old ceiling, so raising
 * this is not a tuning change: several receipts that had to be cut into pieces
 * now arrive whole.
 *
 * Measured, not assumed: on two receipts whose text was read by eye first,
 * Sonnet 4.5 scored CER 0.307 (1 of 6 line items exactly right) and Sonnet 5
 * scored 0.000 (6 of 6), reproducing across three runs. Sonnet 4.5 also swung
 * between 0.906 and 0.300 on the SAME image across runs, while Sonnet 5 was
 * 0.000 every time — the stability is the stronger signal.
 */
export const MODEL_LONG_EDGE = 2576

/**
 * The floor, in real pixels across the page, below which Thai stops surviving.
 *
 * Measured on production documents rather than guessed. In one batch: Lotus's
 * arrived at 1205px and came back very nearly right; CMD at 1378px and 7-Eleven
 * at 1493px were correct; Café Amazon arrived at 942px and returned
 * "บริษัท เอิ่นดีมเบลลู 88 จำกัด". Digits survive far lower — which is exactly
 * why this is invisible without looking: the totals stay perfect while the
 * words turn into non-words.
 */
export const MIN_EFFECTIVE_WIDTH = 1300

/**
 * Cap on slices per page. Raised from 3 because 3 was not a judgement about
 * receipts, it was a mirror of the extractor's page cap: a 1:6 supermarket
 * receipt cut into 3 still hands the model pieces twice as tall as they are
 * wide, i.e. 784px of usable width. The extractor allows more images when it
 * knows they are slices of one document (MAX_SLICE_IMAGES).
 */
const MAX_SLICES     = 5

// HEIC/HEIF extensions from iOS/macOS cameras
const HEIC_EXTS = new Set(["heic", "heif", "hif"])

export async function downloadFile(filePath: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const supabase = createClient()
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(filePath)
  if (error || !data) throw new Error(`Download failed: ${error?.message}`)

  const buffer = Buffer.from(await data.arrayBuffer())
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "jpg"
  const mimeType = ext === "pdf" ? "application/pdf" : `image/${ext}`
  return { buffer, mimeType }
}

/**
 * Convert HEIC/HEIF → JPEG buffer using heic-convert (WASM-based, no native codec needed).
 * heic-convert handles both single images and multi-image HEIC containers.
 */
async function heicToJpeg(buffer: Buffer): Promise<Buffer> {
  const heicConvert = (await import("heic-convert")).default
  const output = await heicConvert({
    buffer: new Uint8Array(buffer) as unknown as ArrayBuffer,
    format: "JPEG",
    quality: 0.92,
  })
  return Buffer.from(output)
}

/**
 * Resize to TARGET_PX on longest side, output JPEG.
 * Handles HEIC input transparently by pre-converting with heic-convert.
 */
export async function normalizeImage(buffer: Buffer, ext?: string): Promise<Buffer> {
  let src = buffer

  // HEIC/HEIF: sharp's bundled libvips lacks the HEVC codec — convert first
  if (ext && HEIC_EXTS.has(ext)) {
    try {
      src = await heicToJpeg(buffer)
    } catch (e) {
      throw new Error(`HEIC conversion failed: ${(e as Error).message}`)
    }
  }

  // ── Step 1: Auto-rotate via EXIF (handles phone camera orientation) ────────
  // LINE sometimes strips EXIF, but we try first. rotate() without args = EXIF.
  let rotated = await sharp(src).rotate().toBuffer()

  // ── Step 2: Detect landscape images and correct orientation ─────────────
  // Most Thai receipts/invoices are taller than wide (portrait).
  // If image is landscape (width > height), the phone was held sideways →
  // rotate 90° so text is upright for OCR.
  const imgMeta = await sharp(rotated).metadata()
  const w = imgMeta.width ?? 1
  const h = imgMeta.height ?? 1
  if (w > h * 1.1) {
    // Landscape → rotate 90° clockwise (Thai docs held phone landscape = rotated CW)
    rotated = await sharp(rotated).rotate(90).toBuffer()
    console.log(`[preprocess] Landscape detected (${w}×${h}) → rotated 90°`)
  }

  // ── Step 3: Detect thermal receipt vs color document ─────────────────────
  const stats = await sharp(rotated).stats()
  const isGrayscale = stats.channels.length >= 3 && (() => {
    const [r, g, b] = stats.channels
    return Math.abs(r.mean - g.mean) < 10 && Math.abs(g.mean - b.mean) < 10
  })()

  // ── Step 4: Enhancement pipeline ──────────────────────────────────────────
  let pipeline = sharp(rotated)

  if (isGrayscale) {
    // Thermal receipt (B&W paper): aggressive contrast + deblur
    pipeline = pipeline
      .grayscale()
      .normalize()
      .linear(1.4, -25)                                              // strong contrast
      .sharpen({ sigma: 2.0, m1: 1.5, m2: 5.0 })                   // unsharp mask
  } else {
    // Color document / photo: moderate enhancement
    pipeline = pipeline
      .normalize()
      .modulate({ saturation: 0.75 })                                // reduce noise
      .sharpen({ sigma: 1.5, m1: 0.8, m2: 4.0 })
  }

  return pipeline
    // Never enlarge. Upscaling invents no detail, and it used to erase the one
    // fact that mattered: two 7-Eleven receipts arrived 762px and 908px wide,
    // were blown up to 2000px here, and from that point on every downstream
    // check — including the image-quality gate, which runs after this — saw a
    // 2000px page and had nothing to complain about. The capture was
    // unreadable and the pipeline had already destroyed the evidence.
    .resize(TARGET_PX, TARGET_PX * 2, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, progressive: true })
    .toBuffer()
}

/**
 * Convert PDF pages to JPEG buffers at a moderate density.
 * 120 DPI at 1200px is sufficient for Claude's vision — much faster than 200 DPI.
 */
export async function pdfToImages(buffer: Buffer): Promise<Buffer[]> {
  try {
    const { fromBuffer } = await import("pdf2pic")
    const convert = fromBuffer(buffer, {
      density: 180,    // was 120 — 180 DPI is minimum for reliable Thai text OCR on A4/A5
      format:  "jpeg",
      width:   1800,
      height:  2600,
    })
    const pages = await convert.bulk(-1, { responseType: "buffer" })
    return pages
      .filter(p => p.buffer)
      .map(p => p.buffer as Buffer)
  } catch {
    return [buffer]
  }
}

export interface PreparedPages {
  pages: Buffer[]
  /** True when `pages` are overlapping slices of ONE physical page, not separate
   *  pages/documents — the extractor must be told, or it reports N receipts. */
  sliced: boolean
  /**
   * Dimensions of the file exactly as the user uploaded it, before any
   * normalisation. The quality gate needs these and not the processed page's:
   * asking the processed page how big the capture was is asking the wrong
   * witness, since this module is what changed the size.
   */
  source: { width: number; height: number }
}

export async function prepareImages(filePath: string): Promise<PreparedPages> {
  const { buffer, mimeType } = await downloadFile(filePath)
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""

  if (mimeType === "application/pdf") {
    const pdfPages = await pdfToImages(buffer)
    // PDF pages come out as JPEG from pdf2pic — no ext needed
    const pages = await Promise.all(pdfPages.map(p => normalizeImage(p)))
    // A PDF has no "capture resolution" of its own; what matters is the density
    // we rasterised it at, which is what these pages are.
    return { pages, sliced: false, source: await sizeOf(pages[0]) }
  }

  const source = await sizeOf(buffer)
  const slices = await sliceTallReceipt(await normalizeImage(buffer, ext))
  return { pages: slices, sliced: slices.length > 1, source }
}

async function sizeOf(buffer: Buffer | undefined): Promise<{ width: number; height: number }> {
  if (!buffer) return { width: 0, height: 0 }
  try {
    const meta = await sharp(buffer).metadata()
    // EXIF orientation can mean the stored pixels are the transposed image;
    // report what the picture actually looks like.
    const swap = (meta.orientation ?? 1) >= 5
    const w = meta.width ?? 0, h = meta.height ?? 0
    return swap ? { width: h, height: w } : { width: w, height: h }
  } catch {
    return { width: 0, height: 0 }
  }
}

/** Overlap between slices, as a share of slice height — no line may fall in a gap. */
const TILE_OVERLAP = 0.12

/**
 * A middle slice carries overlap on BOTH sides, so it is taller than its
 * stride by this factor. Sizing slices by stride alone quietly broke the
 * guarantee they exist for: on a 1205×3866 receipt the middle slice came out
 * 1596px tall, tipped just over the model's long-edge cap, and was rescaled
 * back down to 1184px — most of the benefit, but not the "arrives at its true
 * width" this is supposed to deliver.
 */
const OVERLAP_FACTOR = 1 + 2 * TILE_OVERLAP

/**
 * How wide the page will be by the time the model sees it.
 *
 * The vision API rescales the longest edge down to MODEL_LONG_EDGE, so for a
 * portrait page this is simply 1568 ÷ aspect ratio. Pure, so the slicing rule
 * built on top of it can be tested without touching an image.
 */
export function effectiveWidth(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0
  const long  = Math.max(width, height)
  const scale = long > MODEL_LONG_EDGE ? MODEL_LONG_EDGE / long : 1
  return Math.round(width * scale)
}

/**
 * How many overlapping slices a page needs so its text survives the rescale.
 *
 * The old rule was "slice anything taller than 2.2× its width", which is a
 * proxy for the thing that actually matters and a bad one: it left the whole
 * 1.3–2.2 band unsliced, and that band arrives between roughly 700px and
 * 1200px wide. Café Amazon (1387×2309, ratio 1.66) sat right in it, reached
 * the model at 942px, and came back with invented Thai — while Lotus's, at
 * ratio 3.21, was sliced, arrived at full width, and read correctly.
 *
 * So the question is asked directly: will this page arrive wide enough to read?
 */
export function planSliceCount(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  // Already under the cap — it arrives untouched and slicing buys nothing.
  // (A capture too small to read is a different problem with a different
  // remedy: see isResolutionTooLow in image-quality.ts.)
  if (height <= MODEL_LONG_EDGE) return 1
  if (effectiveWidth(width, height) >= MIN_EFFECTIVE_WIDTH) return 1
  // Enough pieces that each one's long edge — overlap included — fits under the
  // cap, so every slice arrives at its true width. Beyond MAX_SLICES we stop
  // and accept a rescale: past that point the extra images cost more than the
  // remaining pixels are worth.
  const maxStride = Math.floor(MODEL_LONG_EDGE / OVERLAP_FACTOR)
  return Math.min(MAX_SLICES, Math.max(2, Math.ceil(height / maxStride)))
}

/**
 * Splits a tall receipt into overlapping horizontal slices.
 *
 * This is the single biggest lever on Thai accuracy, and it is pure geometry.
 * The model's vision API rescales every image so its LONG edge is at most
 * 1568px. A 1378×4158 receipt (1:3) therefore arrives just 520px wide, which
 * leaves Thai characters about 7px tall — small enough that "เซตข้าวหน้าเนื้อ
 * วากิว" degrades into "เชชข่าว หนึ่งเนื้อวาทัก" no matter how good the model or
 * the prompt is. Numbers survive because digits are larger and simpler, which
 * is exactly the pattern we kept seeing: totals perfect, names mangled.
 *
 * Cut the same receipt into overlapping slices and each one arrives at its
 * full width instead. The overlap guarantees no line is lost on a seam, and
 * the extractor is told these are pieces of ONE document so it doesn't report
 * several separate receipts.
 *
 * See `planSliceCount` for how many, and why it is no longer an aspect ratio.
 */
export async function sliceTallReceipt(page: Buffer): Promise<Buffer[]> {
  try {
    const meta = await sharp(page).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    const count = planSliceCount(w, h)
    if (count <= 1) return [page]

    const stride = Math.floor(h / count)
    const extra  = Math.floor(stride * TILE_OVERLAP)

    const slices: Buffer[] = []
    for (let i = 0; i < count; i++) {
      const top    = Math.max(0, i * stride - (i > 0 ? extra : 0))
      const bottom = Math.min(h, (i + 1) * stride + (i < count - 1 ? extra : 0))
      slices.push(
        await sharp(page)
          .extract({ left: 0, top, width: w, height: bottom - top })
          .jpeg({ quality: JPEG_QUALITY, progressive: true })
          .toBuffer(),
      )
    }
    console.log(`[preprocess] tall receipt ${w}×${h} → ${count} overlapping slices`)
    return slices
  } catch (err) {
    console.warn("[preprocess] slicing failed, using the whole page:", (err as Error).message)
    return [page]
  }
}
