import Foundation

enum Config {
    // MARK: – Supabase
    static let supabaseURL  = URL(string: "https://ntzztcnkedcxfjvfxjrf.supabase.co")!
    static let supabaseAnon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50enp0Y25rZWRjeGZqdmZ4anJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzNTEwOTIsImV4cCI6MjA2NTkyNzA5Mn0.QSGtQhIlrzssH8wzpE25OT3ZanZJLa10tV-eETIOOrA"

    // MARK: – Web app (Next.js) — used for endpoints that must run server-side
    // (e.g. LINE OAuth, AI chat with Claude + Life Graph, Stripe checkout/portal)
    // since they need secrets that can't live in the client app.
    // Both DEBUG and Release point at the NAS staging environment (via
    // Cloudflare Tunnel) — this replaces the old per-developer ngrok URL,
    // which changed every time ngrok restarted.
    static let webAppURL    = URL(string: "https://dev.slippyai.app")!

    // MARK: – Social Sign-In
    static let googleClientID    = "940654280425-19pvlqjqssgv3oe8sd7im9nm1an62jp9.apps.googleusercontent.com"
    // Web client ID — Supabase validates Google ID tokens against this audience
    static let googleWebClientID = "940654280425-peqemnihmunpf8k4n65ermmcnvbjhkv8.apps.googleusercontent.com"
    static let facebookAppID   = "998800032696110"
    static let lineChannelID   = "2010169378"
    /// Public LIFF app identifier already used by the production web/LINE flows.
    /// This is not a channel secret; Native iOS uses it only to build the same
    /// `/liff/trips/{shareToken}` invitation URL as the web app.
    static let liffID          = "2010169378-VU8LThIy"

    static func tripLiffURL(shareToken: String) -> URL? {
        URL(string: "https://liff.line.me/\(liffID)/liff/trips/\(shareToken)")
    }

    // MARK: – App
    static let appName      = "Slippy"
    static let appVersion   = "1.0.0"
    static let demoOrgId    = "53d094c2-1d58-4f87-aee6-09aab0816692"
    static let storageBucket = "documents"

    // MARK: – LiveKit (trip voice calls + live broadcast)
    // See docs/superpowers/specs/2026-08-31-trip-location-and-calling-design.md.
    // The websocket URL is not a secret (same trust level as `supabaseURL`
    // above) — the API key/secret that mint join tokens live server-side only,
    // in the web app's env, and never belong in this file or in the app
    // bundle. Fill in once a LiveKit Cloud project exists (cloud.livekit.io →
    // create project → Settings → Keys shows the Project URL).
    static let liveKitURL: URL? = nil // e.g. URL(string: "wss://slippy-xxxxx.livekit.cloud")

    // MARK: – Tax
    /// Thailand's standard VAT rate — single source of truth so it's never
    /// hardcoded per-call-site. Used as a fallback when a receipt's actual
    /// VAT wasn't extracted by OCR (e.g. manually-added split-bill items),
    /// see CreateSplitView's per-line-item VAT allocation.
    static let defaultVatRatePct: Double = 7.0
}
