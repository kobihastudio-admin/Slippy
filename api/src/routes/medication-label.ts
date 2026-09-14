/**
 * medication-label.ts — read a pharmacy label into a proposed medication.
 *
 * Called by the web app (web/src/app/api/medications/scan/route.ts).
 * Protected by x-internal-key, enforced by the parent plugin in src/index.ts —
 * this route does NOT re-check it.
 *
 * Reads only. Nothing here writes to the database — see pipeline/medication-label.ts.
 */
import type { FastifyInstance } from "fastify"
import { readMedicationLabel } from "../pipeline/medication-label"

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
const MAX_BYTES = 12 * 1024 * 1024

export async function medicationLabelRoutes(app: FastifyInstance) {
  /**
   * POST /medication-label/read
   * Body: { fileBase64: string, mimeType: string, fileName?: string }
   */
  app.post<{ Body: { fileBase64?: string; mimeType?: string; fileName?: string } }>(
    "/medication-label/read",
    async (req, reply) => {
      const { fileBase64, mimeType, fileName } = req.body ?? {}

      if (!fileBase64 || !mimeType) {
        return reply.code(400).send({ error: "fileBase64 และ mimeType จำเป็นต้องมี" })
      }
      if (!ACCEPTED.has(mimeType)) {
        return reply.code(415).send({
          error: `ไฟล์ชนิด ${mimeType} อ่านไม่ได้ — รองรับ JPEG, PNG, WebP และ GIF`,
        })
      }

      let buffer: Buffer
      try {
        buffer = Buffer.from(fileBase64, "base64")
      } catch {
        return reply.code(400).send({ error: "fileBase64 ไม่ใช่ base64 ที่ถูกต้อง" })
      }
      if (!buffer.length) {
        return reply.code(400).send({ error: "ไฟล์ว่าง" })
      }
      if (buffer.length > MAX_BYTES) {
        return reply.code(413).send({
          error: `ไฟล์ใหญ่เกินไป (${(buffer.length / 1024 / 1024).toFixed(1)} MB) — จำกัดที่ 12 MB`,
        })
      }

      const started = Date.now()
      try {
        const result = await readMedicationLabel(buffer)
        app.log.info({
          fileName, mimeType, bytes: buffer.length,
          items: result.items.length, ms: Date.now() - started,
        }, "medication-label read")
        return reply.send(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : "อ่านฉลากยาไม่สำเร็จ"
        // Logged with the file's shape but never its contents — a label carries
        // a drug name and dosage, which is health information.
        app.log.error({ fileName, mimeType, bytes: buffer.length, message }, "medication-label failed")
        return reply.code(502).send({ error: message })
      }
    },
  )
}
