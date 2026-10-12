# Landing Page

Status: **derived from code** (`web/src/app/page.tsx`, `web/src/components/landing/landing-page.tsx`, `web/src/lib/plans.ts`, the marketing pages under `web/src/app/*` and `components/marketing/static-page-shell.tsx`). Where this document and the code disagree, the code is right.

The old stub called this a "story-driven AI Life Assistant website". What is built is an **accounting-automation pitch**: the hero reads "Books out. Automatically." and sells reading slips and receipts with AI and pushing them into the books. The life-assistant, trips, split-bill and health features are not on the landing page.

## Routing (`/`)
`RootPage` runs on the server and decides what `/` is, in this order:
1. **LIFF endpoint redirect** — LINE opens the bare app origin with `?liff.state=…`; when present it is passed through `safeRedirectPath` and the visitor is redirected to that path (so the LIFF login gate at `/liff/home` is reached, not the marketing page).
2. **Signed-in user** → redirect to `/dashboard`.
3. Everyone else → `<LandingPage />`.
`/` is also in the middleware's public list.

## The page (`LandingPage`, one client component, ~970 lines)
- **Splash**: a 2-second branded loading screen with a progress bar before anything renders (`ready` state; the callback is memoised on purpose, otherwise a parent re-render restarts the timer and the splash never ends).
- **Language and theme**: Thai (default) / English toggle held in component state (not persisted, not in the URL) and a light/dark toggle. Every string is an inline `isTH ? th : en` pair.
- **Sections in order**: sticky nav (Home, Features, How it works, Pricing, FAQ; *Log in* → `/login`, *Start free* → `/register`) → hero (headline, subcopy, primary CTA "Start free · No card needed", secondary "Watch the 90s demo", three reassurance chips, a mock receipt card) → stats strip (four counters) → **Features** (`#features`: six cards — AI extraction "95%" accuracy, automatic push to the accounting system, receive slips through the LINE bot, VAT and WHT reports, several organizations in one account, bank-grade security/PDPA) → **How it works** (`#how`, three steps: receive from every channel → AI reads and validates → send to the books) → channels (Web upload, LINE bot, email inbox, …) → **Pricing** (`#pricing`) → **FAQ** (`#faq`, accordion, first item open) → final CTA (*Start free*, `mailto:hello@slippy.app`) → footer (links to the marketing pages below; social icons are `href="#"`).
- **Pricing block**: monthly/yearly toggle (yearly shows the monthly equivalent with `ANNUAL_DISCOUNT_PCT = 20`% off); consumer plans (Free, Pro, Premium) and business plans (Team, Business, Enterprise) rendered from `lib/plans.ts` (`PLANS`). Paid cards link to `/register?plan=<id>[&yearly=1]`; Enterprise is a `mailto:` link.

## Plans shown (from `lib/plans.ts`)
| Plan | Category | Price (THB/month) | Documents/month |
|---|---|---|---|
| Free | consumer | 0 | 15 |
| Pro (highlighted) | consumer | 199 | unlimited (fair use) |
| Premium | consumer | 499 | unlimited |
| Team | business | 999 | unlimited |
| Business | business | 2,990 | unlimited |
| Enterprise | business | contact sales | unlimited |
Paid add-ons are defined beside the plans (e.g. ภ.ง.ด. 3/53 ฿49, ภ.พ. 30 ฿99). The file says its source is `docs/BUSINESS_MODEL.md`; the enforcement point for quotas is the `pricing_plans` table, so the page and the database can disagree.

## Other marketing and legal pages (separate routes, mostly static)
`/about`, `/customers`, `/blog`, `/press`, `/careers`, `/changelog` (month-by-month Thai release notes), `/status`, `/mobile-app`, `/help-center`, `/privacy-policy`, `/cookie-policy`, `/terms`, `/dpa`, `/api-docs`. The small ones use `StaticPageShell` (a light nav with a back link and a centred column) and are 23–60 lines each; they are public in the middleware.

## Known gaps and inconsistencies
- **Free quota is stated two ways**: the hero chip says "50 free docs/month forever" while `plans.ts` gives Free **15** documents/month. One of them is wrong; check `pricing_plans.doc_quota` and fix the copy.
- "Watch the 90s demo" only scrolls to `#how`; there is no video. The "95%" extraction accuracy and the "cuts bookkeeping time by 90%" subcopy are marketing claims; nothing in the code measures them (see OCR_ENGINE_SPEC.md for what the validator does check).
- The hero mock shows `slippy.ai/dashboard` while the running hosts are `dev.slippyai.app` / `api.slippyai.app`.
- Language is not persisted or addressable, so a shared link always opens in Thai, and search engines see one language.
- Footer social links point to `#`.
- `landing-page.backup.tsx` sits beside the live file and is unused.
- The page tells none of the "life assistant" story the stub described; if that positioning is intended, the page and the stub disagree.
