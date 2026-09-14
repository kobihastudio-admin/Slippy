/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved. Proprietary and confidential.
 */

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

/** Admin layout — guards every page under /admin with superadmin check. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("users")
    .select("is_superadmin, full_name, email")
    .eq("id", user.id)
    .single()

  if (!profile?.is_superadmin) redirect("/dashboard")

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Admin top bar */}
      <header className="border-b border-zinc-800 bg-zinc-900 px-6 py-3 flex items-center gap-4">
        <span className="text-xs font-bold tracking-widest text-amber-400 uppercase">
          ⚙ Admin Console
        </span>
        <nav className="flex gap-1 ml-4">
          {[
            { href: "/admin/ops",       label: "Ops Dashboard"   },
            { href: "/admin/documents", label: "Stuck Documents" },
            { href: "/admin/errors",    label: "Error Logs"      },
            { href: "/admin/users",     label: "Users"           },
            { href: "/admin/orgs",      label: "Organizations"   },
            { href: "/admin/plans",     label: "Plans & Pricing" },
            { href: "/admin/config",    label: "System Config"   },
            { href: "/admin/audit-log", label: "Audit Log"       },
          ].map(({ href, label }) => (
            <a key={href} href={href}
              className="px-3 py-1.5 rounded-md text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">
              {label}
            </a>
          ))}
        </nav>
        <span className="ml-auto text-xs text-zinc-500">
          {profile.full_name ?? profile.email}
        </span>
        <a href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
          ← Back to app
        </a>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {children}
      </main>
    </div>
  )
}
