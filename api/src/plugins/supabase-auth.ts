import type { FastifyInstance, FastifyRequest } from "fastify"
import { supabase } from "../lib/supabase"

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in Supabase user, set by `requireSupabaseUser`. */
    userId?: string
  }
}

/**
 * Authenticates a request as a Supabase USER, from a Bearer access token.
 *
 * WHY THIS EXISTS
 * The api had exactly one gate — the shared `x-internal-key` — which answers
 * "is this the web server?" and nothing else. That is right for the routes the
 * web server calls on a user's behalf, and wrong for routes a DEVICE calls
 * directly, because a device cannot hold that key: shipping it inside an app
 * bundle publishes it.
 *
 * `/v1/sport-play/*` is called straight from the iPhone and the Apple Watch. It
 * was registered behind the internal-key gate, so every one of those calls got
 * 401 — and its handlers read `req.userId`, which nothing has ever set, so even
 * past the gate they would have written rows with no owner. Both halves were
 * invisible because the failure is on the device, not in any server log anyone
 * reads.
 *
 * The token is VERIFIED against Supabase rather than merely decoded. A JWT that
 * parses is not a JWT that is valid, and `user_id` here decides whose sessions
 * and shots a caller can read.
 */
export async function requireSupabaseUser(req: FastifyRequest, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) {
  const header = req.headers.authorization
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null

  if (!token) {
    return reply.status(401).send({ error: "ต้องมี Authorization: Bearer <access token>" })
  }

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    return reply.status(401).send({ error: "โทเคนไม่ถูกต้องหรือหมดอายุ" })
  }

  req.userId = data.user.id
}

/**
 * Registers routes that authenticate as a user rather than as the web server.
 *
 * Kept as its own plugin so the two gates cannot be confused: anything inside
 * here is reachable from a device with a user's token, and anything inside the
 * internal-key plugin is not reachable from a device at all.
 */
export function userAuthedScope(register: (app: FastifyInstance) => Promise<void>) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", requireSupabaseUser)
    await register(app)
  }
}
