/**
 * Friend-invite helpers shared by the join page, middleware and the LINE share
 * button. Pure functions, no imports, so `node --test` can load this file.
 *
 * Invite tokens come from `friend_invite_links.token`:
 * `substr(replace(gen_random_uuid()::text,'-',''),1,12)` → 12 lowercase hex.
 */

const TOKEN_PATTERN = /^[0-9a-f]{12}$/

/** True only for a well-formed invite token. Nothing else may reach an href, the database or the app. */
export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value)
}

/** The iOS app's deep link for a token, or `null` when the token is malformed. */
export function inviteDeepLink(token: string): string | null {
  return isInviteToken(token) ? `slippy://friends/join/${token}` : null
}

/** Links shared from LINE carry `?src=line`. Exact match only. */
export function isLineInviteSource(src: string | string[] | null | undefined): boolean {
  return src === "line"
}

/** Adds `src=line` to an invite URL (replacing an existing `src`), keeping path and other query. */
export function withLineSource(inviteUrl: string): string {
  try {
    const url = new URL(inviteUrl)
    url.searchParams.set("src", "line")
    return url.toString()
  } catch {
    return inviteUrl
  }
}

/**
 * The one URL shape that may be opened without a session: the static LINE
 * landing page. Used by middleware. The plain `/friends/join/<token>` stays
 * behind login because it creates a friendship.
 */
export function isPublicInviteLanding(pathname: string, search: URLSearchParams): boolean {
  const match = /^\/friends\/join\/([^/]+)\/?$/.exec(pathname)
  // `getAll`, not `get`: with a repeated `src` the page receives an array, takes the normal
  // (database) path, and an anonymous caller could tell valid tokens from invalid ones.
  const sources = search.getAll("src")
  return match !== null && isInviteToken(match[1]) && sources.length === 1 && sources[0] === "line"
}
