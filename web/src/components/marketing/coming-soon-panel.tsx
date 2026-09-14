/** Honest placeholder for pages with no real content yet (Careers, Press,
 * Blog, Customers) — a fake page of testimonials/postings would be worse
 * than admitting there's nothing here yet. */
export function ComingSoonPanel({
  emoji,
  message,
  contactEmail = "hello@slippy.app",
  contactLabel = "ทักมาคุยได้เลย",
}: {
  emoji: string
  message: string
  contactEmail?: string
  contactLabel?: string
}) {
  return (
    <div className="text-center py-16 px-6 bg-gray-50 rounded-2xl border border-gray-100">
      <div className="text-4xl mb-4">{emoji}</div>
      <p className="text-gray-600 text-sm leading-relaxed max-w-md mx-auto">{message}</p>
      <a
        href={`mailto:${contactEmail}`}
        className="inline-block mt-6 px-5 py-2.5 text-sm font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl hover:bg-indigo-100 transition-colors"
      >
        ✉️ {contactLabel} — {contactEmail}
      </a>
    </div>
  )
}
