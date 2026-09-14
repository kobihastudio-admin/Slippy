export const profileTabs = [
  { key: "info", label: "ข้อมูลส่วนตัว" },
  { key: "security", label: "ความปลอดภัย" },
] as const

export type ProfileTab = (typeof profileTabs)[number]["key"]

export function profilePlanLabel(plan: string): string {
  const labels: Record<string, string> = {
    free: "Free",
    starter: "Starter",
    pro: "Pro",
    enterprise: "Enterprise",
  }

  return labels[plan] ?? plan
}
