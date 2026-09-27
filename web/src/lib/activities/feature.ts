/**
 * Kill switch for the Activity Graph (`/activities`, `/api/activities*`,
 * `/join/[token]`).
 *
 * Unlike the trip feature flags (which are opt-in and default to off), this one
 * defaults to ON so existing behaviour is unchanged. It is switched off only by
 * the exact value "0", so a typo or an empty variable cannot disable the feature.
 *
 *   ACTIVITIES_ENABLED              server, read at runtime — set to "0" and
 *                                   restart to make the pages and APIs return 404.
 *   NEXT_PUBLIC_ACTIVITIES_ENABLED  build time — also hides the sidebar entry.
 *                                   It is inlined by Next.js, so changing it needs a rebuild.
 *
 * Pass the variable explicitly (`process.env.NEXT_PUBLIC_…` must appear
 * literally for Next.js to inline it in client code).
 */
export function isActivitiesEnabled(value: string | undefined): boolean {
  return value !== "0"
}

/** 404-shaped result: a disabled feature should look like it does not exist. */
export const activitiesDisabledBody = { error: "Not found" } as const
