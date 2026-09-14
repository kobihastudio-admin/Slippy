import type {
  ActivityPolicy,
  ActivityViewer,
  CreateActivityInput,
  RegistrationLink,
} from "./types"

export function canDiscoverActivity(activity: ActivityPolicy, viewer: ActivityViewer): boolean {
  const userId = viewer.userId
  if (userId === activity.ownerId || activity.participantIds?.includes(userId ?? "")) return true
  if (activity.status !== "published") return false
  if (activity.visibility === "public") return true
  return activity.visibility === "group" && activity.groupMemberIds?.includes(userId ?? "") === true
}

export function canJoinRegistration(link: RegistrationLink, now: Date): boolean {
  if (link.revokedAt) return false
  if (link.expiresAt && new Date(link.expiresAt) <= now) return false
  return link.maxUses == null || link.useCount < link.maxUses
}

export function normalizeCreateActivityInput(input: Pick<CreateActivityInput, "title"> & Partial<CreateActivityInput>): CreateActivityInput {
  return {
    title: input.title.trim(),
    summary: input.summary?.trim() ?? "",
    category: input.category?.trim() || "general",
    visibility: input.visibility ?? "private",
    status: input.status ?? "draft",
  }
}
