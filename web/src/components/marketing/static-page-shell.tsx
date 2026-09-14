import Link from "next/link"
import { LogoMark } from "@/components/ui/logo"

/** Shared nav/footer wrapper for simple marketing/legal pages — mirrors the
 * layout privacy-policy/cookie-policy already use, so new footer links land
 * on something visually consistent instead of a bare page. */
export function StaticPageShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 h-16 flex items-center justify-between max-w-4xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={28} />
          <span className="font-black text-lg text-gray-900">Slippy</span>
        </Link>
        <Link href="/" className="text-sm text-gray-500 hover:text-indigo-600 transition-colors">← กลับหน้าหลัก</Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-black text-gray-900 mb-2">{title}</h1>
        {subtitle && (
          <p className="text-gray-500 text-sm mb-10 leading-relaxed">{subtitle}</p>
        )}
        <div className={subtitle ? "" : "mt-6"}>{children}</div>
      </main>
    </div>
  )
}
