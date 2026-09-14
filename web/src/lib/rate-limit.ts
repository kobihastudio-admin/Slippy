/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * This software is proprietary and confidential.
 * Unauthorized copying, modification, distribution, or use of this software,
 * in whole or in part, is strictly prohibited without prior written permission.
 */

import { Redis } from "ioredis"

// Same Redis instance the api/ container and BullMQ queues use (see
// synology-container-stack/docker-compose.yml). Lazily connected — module
// is only imported from middleware.ts, which runs on every request, so this
// stays a singleton for the life of the container.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
})

let connectAttempted = false

function ensureConnected() {
  if (!connectAttempted) {
    connectAttempted = true
    redis.connect().catch(() => { /* logged via 'error' listener below */ })
    redis.on("error", (err) => console.error("[rate-limit] redis error:", err.message))
  }
}

/**
 * checkRateLimit — fixed-window counter keyed by bucket+identifier (an IP,
 * an email, etc. — caller decides what to key on).
 * Returns { allowed, remaining, retryAfterSeconds }.
 *
 * Fails OPEN (allowed: true) if Redis is unreachable — a rate limiter must
 * never become the reason the whole site goes down.
 */
export async function checkRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  ensureConnected()

  const key = `ratelimit:${bucket}:${identifier}`
  try {
    const count = await redis.incr(key)
    if (count === 1) {
      await redis.expire(key, windowSeconds)
    }
    const ttl = await redis.ttl(key)
    const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds,
    }
  } catch (err) {
    console.error("[rate-limit] check failed, allowing request:", (err as Error).message)
    return { allowed: true, remaining: limit, retryAfterSeconds: windowSeconds }
  }
}

/**
 * resetRateLimit — clears a bucket+identifier's counter early (e.g. after a
 * successful login, so a legitimate user who mistyped their password a few
 * times isn't penalized on their next visit).
 */
export async function resetRateLimit(bucket: string, identifier: string): Promise<void> {
  ensureConnected()
  try {
    await redis.del(`ratelimit:${bucket}:${identifier}`)
  } catch (err) {
    console.error("[rate-limit] reset failed:", (err as Error).message)
  }
}
