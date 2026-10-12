export const CLAIM_REVIEWER_ROLES = new Set(["owner", "admin", "accountant", "manager"])

export function canListOrganizationClaims(role: string | null | undefined): boolean {
  return CLAIM_REVIEWER_ROLES.has(role ?? "")
}

/**
 * Whether a caller may read one claim. Same rule as the list: reviewers see
 * every claim in the organization, anyone else only the claims they submitted.
 * (RLS alone lets any organization member read any claim.)
 */
export function canViewClaim(
  role: string | null | undefined,
  submitterId: string | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (canListOrganizationClaims(role)) return true
  return !!userId && !!submitterId && submitterId === userId
}

