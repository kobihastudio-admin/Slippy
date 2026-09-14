import sharp from "sharp"
import { createClient } from "../lib/supabase"

/**
 * Image Quality Checker
 *
 * ตรวจสอบคุณภาพรูปก่อนส่งให้ AI:
 *   1. Blur detection  — วัดความคมชัดด้วย Laplacian variance
 *   2. Size check      — รูปเล็กเกินไปอ่านไม่ออก
 *   3. Contrast check  — รูปมืดหรือสว่างเกินไป
 *
 * ผลลัพธ์ใช้สองอย่าง:
 *   a) เพิ่ม warning ใน extraction prompt ("image is blurry — be extra careful")
 *   b) log ลง image_quality_logs สำหรับ analytics
 */

export interface ImageQuality {
  blurScore:   number   // Laplacian variance — higher = sharper (>100 = clear, <30 = blurry)
  isBlurry:    boolean
  isTooDark:   boolean
  isTooBright: boolean
  isTooSmall:  boolean
  width:       number
  height:      number
  warnings:    string[] // human-readable warnings to inject into prompt
}

/**
 * Shortest side, in real pixels, below which Thai stops being readable.
 *
 * Kept equal to `ImageQuality.minShortSide` in the iOS app
 * (ios/Slippy/Views/Documents/DocumentScannerView.swift) so a capture the phone
 * accepts is one the server also accepts. Both were 700 until two 7-Eleven
 * receipts came in at 762×800 and 908×778, passed every gate on both sides, and
 * returned line items reading "ก๋วยสลอมหมอง" and "หนี้านริมลงตีแฟลร์".
 */
export const MIN_SHORT_SIDE = 1200

/**
 * Pure so the floor is testable and so both ends of the pipeline can agree on
 * it. Zero means "unknown", which is not the same as "too small".
 */
export function isResolutionTooLow(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false
  return Math.min(width, height) < MIN_SHORT_SIDE
}

const BLUR_THRESHOLD       = 35    // ต่ำกว่านี้ = ภาพเบลอ (thermal receipt อาจได้ ~40-80)
const DARK_THRESHOLD       = 40    // mean brightness ต่ำกว่านี้ = มืดเกินไป
// Overexposure = burnt highlights, not a high average. White paper legitimately
// averages 200–240, so a mean-based test fired on nearly every receipt.
// ต่ำกว่านี้ = ระยะห่างระหว่างกระดาษกับหมึกน้อยจนอ่านไม่ออก (ดู isTooBright)
const MIN_INK_CONTRAST     = 25

/** Luma at percentile `p`, from a 256-bin histogram of the frame. */
function lumaPercentile(hist: Uint32Array, total: number, p: number): number {
  const target = Math.max(1, Math.floor(total * p))
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

/**
 * Approximate Laplacian variance using a 3×3 kernel.
 * Sharp supports custom kernel convolution — we convolve then measure std dev.
 * Higher = sharper. Thai thermal receipts: ~40-120. Blurry photos: <30.
 */
export async function measureImageQuality(
  buffer: Buffer,
  /**
   * Dimensions of the file as uploaded. The resolution check MUST use these
   * and not the buffer's: `buffer` is a preprocessed page, and preprocessing
   * is what changed the size — asking it how big the capture was is asking the
   * one witness guaranteed to give the wrong answer. Blur and exposure are
   * measured on the buffer, which is correct, because those survive resizing.
   */
  sourceSize?: { width: number; height: number },
): Promise<ImageQuality> {
  const warnings: string[] = []

  try {
    const meta  = await sharp(buffer).metadata()
    const w     = sourceSize?.width  ?? meta.width  ?? 0
    const h     = sourceSize?.height ?? meta.height ?? 0

    // ── Laplacian edge detection (approximation via Sharp kernel) ─────────────
    // Laplacian kernel detects edges — blurry images have few/soft edges → low variance
    const laplacianKernel = {
      width:  3,
      height: 3,
      kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0] as number[],
    }

    const laplacianBuf = await sharp(buffer)
      .grayscale()
      .resize(512, 512, { fit: "inside" })  // small enough for speed
      .convolve(laplacianKernel)
      .raw()
      .toBuffer()

    // Compute variance of Laplacian output
    const pixels = new Uint8Array(laplacianBuf)
    const mean   = pixels.reduce((s, v) => s + v, 0) / pixels.length
    const variance = pixels.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / pixels.length
    const blurScore = Math.round(variance * 100) / 100

    // ── Brightness check ──────────────────────────────────────────────────────
    const stats       = await sharp(buffer).grayscale().stats()
    const brightness  = stats.channels[0]?.mean ?? 128

    // Overexposure is measured by CLIPPING, not by the mean.
    //
    // A receipt is white paper: a perfectly exposed one still averages ~200–240,
    // so `mean > 240` flagged almost every shot — users turned the lights off and
    // were still told the picture was too bright. Worse, that warning now drives
    // the model escalation and the DocAI fallback, so a false positive made every
    // single document take the expensive path.
    //
    // Clipping alone is no better: on a perfectly readable receipt 66% of pixels
    // already sit at 250+, because that is simply what white paper looks like.
    //
    // Counting pixels darker than a fixed level (150) was the third attempt and
    // failed for the opposite reason. Thermal ink is grey, strokes are 2–3px
    // wide, and the resize below averages each stroke with the paper around it —
    // so a perfectly readable receipt scores 0.0% ink, the identical score to
    // real glare. An absolute cutoff cannot tell the two apart at all, and this
    // flag drives both the model escalation and the DocAI fallback, so it was
    // buying the expensive path on documents that were already fine.
    //
    // What glare actually destroys is the GAP between paper and ink. Measuring
    // that is relative, so it survives any exposure, any resize, and any amount
    // of background in the frame. Simulated captures: solid black text ≈100,
    // grey thermal ink ≈57, faded receipt under bright light ≈46,
    // barely-legible ≈32, genuine glare ≈19.
    const grayBuf = await sharp(buffer).grayscale().resize(512, 512, { fit: "inside" }).raw().toBuffer()
    const gray    = new Uint8Array(grayBuf)
    const hist    = new Uint32Array(256)
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++
    // p05 = darkest strokes, p90 = the paper. Percentiles rather than min/max so
    // one shadow or one blown highlight cannot decide the verdict on its own.
    const inkContrast = gray.length
      ? lumaPercentile(hist, gray.length, 0.90) - lumaPercentile(hist, gray.length, 0.05)
      : 255

    const isBlurry    = blurScore < BLUR_THRESHOLD
    const isTooDark   = brightness < DARK_THRESHOLD
    const isTooBright = inkContrast < MIN_INK_CONTRAST
    const isTooSmall  = isResolutionTooLow(w, h)

    if (isBlurry) {
      warnings.push(
        `⚠️ IMAGE QUALITY WARNING: This image appears blurry (sharpness score: ${blurScore.toFixed(1)}, threshold: ${BLUR_THRESHOLD}). ` +
        `Be extremely careful with digit recognition — when uncertain between similar-looking digits (1/7, 3/8, 0/6), ` +
        `lower your confidence score for that field rather than guessing.`
      )
    }
    if (isTooDark) {
      warnings.push(
        `⚠️ IMAGE QUALITY WARNING: Image is underexposed (brightness: ${brightness.toFixed(0)}). ` +
        `Text may be hard to read — extract what you can and report low confidence for unclear fields.`
      )
    }
    if (isTooBright) {
      warnings.push(
        `⚠️ IMAGE QUALITY WARNING: Glare has washed the page out (paper-to-ink contrast is only ${inkContrast}, needs ${MIN_INK_CONTRAST}). ` +
        `White areas may have washed-out text — check carefully for faded numbers and characters.`
      )
    }
    if (isTooSmall) {
      // Aimed at the specific way this fails. Digits stay legible far below the
      // point where Thai does, so the model reports a confident, complete
      // reading in which only the words are invented — and its own confidence
      // score cannot see that, because each glyph was decided independently and
      // each decision felt fine.
      warnings.push(
        `⚠️ IMAGE QUALITY WARNING: This capture is only ${w}×${h}px (shortest side needs ${MIN_SHORT_SIDE}px). ` +
        `At this resolution Thai characters are a few pixels tall: tone marks and vowels are not resolvable, ` +
        `so any Thai word you "read" may be a plausible invention. Numbers are usually still reliable. ` +
        `Transcribe Thai text only where you can actually see it, leave it null rather than guessing, ` +
        `and give every Thai field a low confidence score.`
      )
    }

    return { blurScore, isBlurry, isTooDark, isTooBright, isTooSmall, width: w, height: h, warnings }

  } catch (err) {
    // Never block the pipeline
    console.warn("[image-quality] check failed:", (err as Error).message)
    return {
      blurScore: 999, isBlurry: false, isTooDark: false, isTooBright: false,
      isTooSmall: false, width: 0, height: 0, warnings: [],
    }
  }
}

/**
 * Log quality metrics to DB (fire-and-forget).
 */
export async function logImageQuality(
  documentId: string,
  quality:    ImageQuality,
  fileSizeKb: number,
): Promise<void> {
  try {
    const supabase = createClient()
    await supabase.from("image_quality_logs").insert({
      document_id:  documentId,
      blur_score:   quality.blurScore,
      is_blurry:    quality.isBlurry,
      width:        quality.width,
      height:       quality.height,
      file_size_kb: fileSizeKb,
    })
  } catch { /* never block */ }
}


/**
 * Should this reading be refused outright as an invention?
 *
 * The case this exists for, in full. A faded Pet Republic receipt for ฿210 —
 * six smoothies at ฿35 — came back as "บริษัท กาโตว์ เฮ้าส์ จำกัด", three
 * cakes, ฿1,765.50. Not one field matched the paper. The vendor came from a
 * learned correction, the tax id from a few-shot example (the model's own notes
 * said so), and the amounts were invented so cleanly that they reconciled
 * perfectly: 1500 + 150 fee = 1650, VAT 7% = 115.50.
 *
 * Every automated check passed it, and they always will: reconciliation,
 * line-item sums and VAT conventions all test INTERNAL CONSISTENCY, and a
 * fabrication is by construction consistent with itself. A person spotted it.
 *
 * The signal that was there all along is the pair: the capture was objectively
 * degraded (ink contrast 21 against a floor of 25) AND the model's own
 * confidence was 0.55. Neither alone is enough — a degraded photo often reads
 * fine, and a cautious score on a clean photo is just honesty. Together they
 * mean the model was working from too little and filled the gap.
 *
 * A refusal costs the user one retake. Accepting costs them a wrong number in
 * their accounts that nothing downstream can detect.
 */
export function isUnreadableCapture(input: {
  /** The image-quality gate raised at least one warning about this capture. */
  degradedCapture: boolean
  /** The model's own confidence in its reading, 0–1. */
  confidence: number
}): boolean {
  return input.degradedCapture && input.confidence < UNREADABLE_CONFIDENCE
}

/**
 * Below this, on an already-degraded capture, the reading is a guess.
 *
 * Set from real documents rather than taste: the fabricated receipt scored
 * 0.55, while genuinely degraded captures that were read correctly on the same
 * days scored 0.78–0.80. 0.6 separates them with room on both sides.
 */
export const UNREADABLE_CONFIDENCE = 0.6
