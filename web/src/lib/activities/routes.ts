export function feedHref(activityId: string): string {
  return `/activities/${encodeURIComponent(activityId)}`
}
