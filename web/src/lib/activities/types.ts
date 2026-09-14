export type ActivityVisibility = "private" | "group" | "public"

export type ActivityStatus = "draft" | "published" | "cancelled" | "completed"

export type ActivityPolicy = {
  ownerId: string
  visibility: ActivityVisibility
  status: ActivityStatus
  participantIds?: string[]
  groupMemberIds?: string[]
}

export type ActivityViewer = {
  userId: string | null
}

export type RegistrationLink = {
  expiresAt: string | null
  revokedAt: string | null
  maxUses: number | null
  useCount: number
}

export type CreateActivityInput = {
  title: string
  summary: string
  category: string
  visibility: ActivityVisibility
  status: ActivityStatus
}
