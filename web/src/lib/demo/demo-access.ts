/**
 * Demo data is a local development aid only.  Production accounts must never
 * expose an endpoint that can populate realistic-looking, but fabricated data.
 */
export function canSeedDemoData(nodeEnv: string | undefined): boolean {
  return nodeEnv === "development"
}
