/**
 * LiveKit configuration for trip voice calls and the live-broadcast feature —
 * see docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md.
 *
 * `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` mint room-join tokens and must never
 * reach a client bundle — import this module only from API route handlers,
 * the same boundary `trip-conversation.ts` already draws around service-role
 * Supabase access. `NEXT_PUBLIC_LIVEKIT_URL` is not a secret (a websocket
 * host, same trust level as `NEXT_PUBLIC_SUPABASE_URL`) so the client SDK
 * reads it directly once a route hands it a join token.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set — see the "LiveKit" section of web/.env.local for setup steps.`
    )
  }
  return value
}

/** Throws if any LiveKit env var is missing — call this at the top of a route
 * handler so a half-configured environment fails loudly at the call site,
 * not with a confusing error from inside the LiveKit SDK. */
export function getLiveKitServerConfig() {
  return {
    url: required("NEXT_PUBLIC_LIVEKIT_URL"),
    apiKey: required("LIVEKIT_API_KEY"),
    apiSecret: required("LIVEKIT_API_SECRET"),
  }
}

/** The websocket URL only — safe to hand to a client component once it also
 * has a join token from the server. */
export const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? ""
