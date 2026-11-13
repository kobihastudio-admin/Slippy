/**
 * Keeps a friend-invite link alive across sign-in (docs/superpowers/specs/2026-11-13-open-direct-conversation-design.md).
 *
 * A friend who taps `/friends/join/<token>` without a session used to be sent to `/login` and the token was lost: the
 * middleware redirected to a bare `/login` and neither the login nor the register form knew about a `next` target, so after
 * signing in or signing up the person landed on the dashboard and never became a friend. The middleware now sends
 * `/login?next=/friends/join/<token>`, and the forms carry that value through every way of signing in.
 *
 * Only this ONE path shape is ever honoured, not an arbitrary `next`: it is exact (12 lower-case hex characters, no extra
 * segment) and it is rebuilt from the matched token, so nothing the visitor typed is echoed into a redirect.
 */

const INVITE_PATH = /^\/friends\/join\/([0-9a-f]{12})\/?$/
const MAX_LENGTH = 200
const DUMMY_ORIGIN = "http://internal.invalid"

/** `/friends/join/<token>` for a well-formed invite path, else `null`. The query and fragment are dropped. */
export function inviteNextPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return null
  try {
    // Let the URL parser decide whether it stays on this origin (it catches `//host`, `/\host`, `https://host`).
    const resolved = new URL(raw, DUMMY_ORIGIN)
    if (resolved.origin !== DUMMY_ORIGIN) return null
    const match = INVITE_PATH.exec(resolved.pathname)
    return match ? `/friends/join/${match[1]}` : null
  } catch {
    return null
  }
}

/** Where the middleware sends a visitor without a session: `/login`, with the invite path as `next` when it is one. */
export function loginPathFor(pathname: string): string {
  const next = inviteNextPath(pathname)
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login"
}

/** `href` with `?next=<invite path>` appended, or `href` unchanged when there is none. */
export function withNext(href: string, next: string | null): string {
  return next ? `${href}?next=${encodeURIComponent(next)}` : href
}
