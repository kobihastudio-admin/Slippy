/**
 * medication-price.ts — live web-search-backed market price lookup.
 *
 * Called by the web app (web/src/app/api/medications/[id]/price/route.ts).
 * Protected by x-internal-key, enforced by the parent plugin in src/index.ts.
 *
 * Never writes to the database — see pipeline/medication-price.ts for why a
 * price is looked up fresh on every call rather than cached on the row.
 */
import type { FastifyInstance } from "fastify"
import { lookupMedicationPrice } from "../pipeline/medication-price"

export async function medicationPriceRoutes(app: FastifyInstance) {
  /**
   * POST /medication-price/lookup
   * Body: { name: string, genericName?: string, strength?: string }
   */
  app.post<{ Body: { name?: string; genericName?: string; strength?: string } }>(
    "/medication-price/lookup",
    async (req, reply) => {
      const { name, genericName, strength } = req.body ?? {}
      if (!name?.trim()) {
        return reply.code(400).send({ error: "name จำเป็นต้องมี" })
      }

      const started = Date.now()
      try {
        const result = await lookupMedicationPrice(name.trim(), genericName?.trim() || null, strength?.trim() || null)
        app.log.info({ name, ms: Date.now() - started, sources: result.sources.length }, "medication-price lookup")
        return reply.send(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : "ค้นหาราคาไม่สำเร็จ"
        app.log.error({ name, message }, "medication-price failed")
        return reply.code(502).send({ error: message })
      }
    },
  )
}
