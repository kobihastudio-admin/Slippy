/**
 * The origin a browser actually used to reach this server.
 *
 * In the Docker image (Next.js `output: "standalone"`), `new URL(req.url).origin`
 * reports the container's own hostname and port — e.g. `https://bf6801baa76d:3000`
 * — because Docker sets `HOSTNAME` to the container id and the standalone server
 * builds request URLs from it. A redirect built from that origin sends the
 * browser to a host it cannot resolve (seen after Google login: the user landed
 * on `https://<container-id>:3000/dashboard`).
 *
 * The reverse proxy (Cloudflare Tunnel) forwards the public host in
 * `x-forwarded-host` / `host`, and the scheme in `x-forwarded-proto`, so those
 * are the source of truth. If neither header yields a usable host, fall back to
 * the configured app URL rather than to the unreliable `req.url`.
 */
import { getAppUrl } from "./app-url.ts"

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i

function first(value: string | null): string | null {
  const v = value?.split(",")[0]?.trim()
  return v ? v : null
}

function isLocalHost(host: string): boolean {
  const name = host.split(":")[0].toLowerCase()
  return name === "localhost" || name === "127.0.0.1" || name.endsWith(".localhost")
}

export function getPublicOrigin(headers: Pick<Headers, "get">): string {
  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host"))
  if (!host || !HOST_RE.test(host)) return getAppUrl()

  const forwardedProto = first(headers.get("x-forwarded-proto"))?.toLowerCase()
  const proto =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : isLocalHost(host) ? "http" : "https"

  return `${proto}://${host}`
}
