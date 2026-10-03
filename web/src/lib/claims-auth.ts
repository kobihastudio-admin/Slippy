export const CLAIM_REVIEWER_ROLES = new Set(["owner", "admin", "accountant", "manager"])

export function canListOrganizationClaims(role: string | null | undefined): boolean {
  return CLAIM_REVIEWER_ROLES.has(role ?? "")
}
