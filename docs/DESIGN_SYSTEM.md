# Design System

Status: **derived from code** (`web/tailwind.config.ts`, `web/src/app/globals.css`, `web/src/app/layout.tsx`, `ios/Slippy/Utils/SlippyColors.swift`, `ios/Slippy/Views/Trips/JourneyPrototypeView.swift`, `android/.../ui/theme/*`, `mobile/src/constants/colors.ts`). Where this document and the code disagree, the code is right. The product-level brief is `design/DESIGN_BRIEF.md`; this file records what the four clients actually implement.

There is **no shared token package**. The web defines tokens once as CSS variables; iOS, Android and Expo each hand-copy a subset. Colours therefore agree for the brand and status colours and drift for dark surfaces (see *Drift*).

## Brand and status colours

| Token | Value |
|---|---|
| `brand-50 … 900` (indigo) | `#eef2ff #e0e7ff #c7d2fe #a5b4fc #818cf8 #6366f1 #4f46e5 #4338ca #3730a3 #312e81` (web has all ten; iOS/Android keep 50, 100, (300), 400, 500, 600, 700, 900) |
| Primary | Web/Android/Expo `brand-500` `#6366f1`; iOS `#5b5ee5` for white action-label contrast. The hue family remains indigo. |
| Status (documents) | pending `#94a3b8` · processing `#3b82f6` · reviewing `#f59e0b` · approved `#10b981` · pushed `#8b5cf6` · failed `#ef4444` · (Expo also `rejected #64748b`) |

## Web

- **Tokens** — shadcn-style semantic variables in `:root` and `.dark`, consumed as Tailwind colours (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`) plus a `sidebar` group (`bg`, `fg`, `muted`, `active`, `border`). `darkMode: ["class"]`.
- **Light**: background `0 0% 100%`, foreground `224 71% 4%`, border `220 13% 91%`, muted `220 14% 96%`. **Dark** ("deep slate with indigo accents"): background `224 71% 4%`, card `217 33% 8%`, muted/secondary `217 33% 14%`, border `217 33% 17%`, muted-foreground `215 20% 55%`.
- **Radius** `--radius: 0.625rem` (`lg`), `md` = −2px, `sm` = −4px; cards on app pages are mostly `rounded-[12px]`/`rounded-[14px]`.
- **Type** — `Noto Sans Thai` then `Inter` then system (`--font-noto`, `--font-inter`, loaded with `next/font`), mono `Geist Mono`. Thai text gets `line-height: 1.8` and `word-break: break-word`.
- **Page widths** — three containers, chosen by content, all centred with padding 24/28px: `.page-wide` 1600px (tables, grids), `.page` 1400px (default), `.page-narrow` 820px (prose and forms, deliberately capped).
- **Utilities** — `.glass`, `.sidebar-item(.active)`, `.glow-radial`, `.glow-dotgrid`, fade/slide/pulse keyframes. `.dashboard-violet*` is a **scoped** violet treatment of the dashboard (its comment says no other page or native app should inherit it). `ld-*` and `hero-float` keyframes belong to the landing page. Native `date`/`time` inputs are normalised for iOS Safari and the LINE webview.
- **Components** — `src/components/ui` holds only app-level pieces (`cookie-banner`, `icons`, `lang-theme-toggle`, `logo`, `security-icon`, `skeleton`, `slippy-loader`, `support-chat`); feature components live in per-feature folders. `icons.tsx` is the single icon source.

## iOS (SwiftUI)

- `SlippyColors.swift` defines the shared **adaptive** palette (light / dark): `background` `#f7f8fa` / `#101217`, `surface` white / `#1b1e25`, `surfaceMuted` `#eef0f4` / `#242831`, `inputBg` `#f2f4f7` / `#22262e`, `border` `#d8dde5` / `#3b414d`, `textPrimary` `#18212e` / `#f3f5f8`, `textSecondary` `#596475` / `#b2bac8`, and `textTertiary` `#667085` / `#a1aabb`. `accent`, status text/tint surfaces, and `brand50/100` also adapt. Solid action labels use fixed white `textOnBrand`.
- Appearance follows the persisted `AppSettings` choice (`preferredColorScheme`): Light, System, or Dark. The profile page exposes the shared ThemePicker; screens and sheets inherit the choice instead of forcing Dark. Root tint uses the adaptive accent.
- Type is set per view with `.system(size:weight:)`; there is no type scale or custom font.
- Trip pages and forms now use the same adaptive palette as dashboard, documents, chat, profile, sport and split views. Existing layouts and typography are retained. Photo covers/solid brand actions keep white labels, and full-screen image viewers keep black backdrops in both modes.
- Debug-only `SLIPPY_APPEARANCE_PREVIEW` fixtures (`login`, `profile`, `documents`, `more`, `trip`, or dashboard) render representative real components without user credentials. They validate 18 resolved UIColor text/background contrast pairs across Light/Dark against 4.5:1. Fixtures do not exist in Release builds.
- Item types have one icon/tint map (`journeyItemStyle`): hotel `bed.double.fill`, meal `fork.knife`, transport/shinkansen `tram.fill`, car `car.fill`, flight `airplane`, shopping `bag.fill`, booking `ticket.fill`, else `sparkles`.
- Bottom clearance for the floating tab bar is a shared constant (`FloatingTabBar.clearance` 100pt, `compactClearance` 30pt).

## Android (Compose) and Expo

- Android `Color.kt`: brand, status, light surfaces (`#ffffff`, `#f4f4f6`, border `#e5e7eb`, text `#111827`/`#6b7280`, background `#f8f9fc`) and two dark shades (`DarkBg #080C1A`, `DarkCard #0E1527`). `Theme.kt` defines **only a light colour scheme**. `Type.kt` is a Material 3 scale on the default font (display 34 black … label 10 medium).
- Expo `colors.ts`: the same brand/status set with `StatusBg` tints, `Light` and `Dark` palettes (dark background `#080c1a`, card `#0e1527`, muted `#141d30`, border `#1e2d45`, foreground `#f8fafc`).

## Drift to be aware of
- Dark background is `hsl(224 71% 4%)` on the web, `#101217` on iOS, and `#080C1A` in Android/Expo; dark card is `hsl(217 33% 8%)` on the web, `#1b1e25` on iOS and `#0E1527` elsewhere.
- Android has no dark scheme although it defines dark shades; Expo has both.
- iOS trip screens now match the iOS shared palette; the other clients' palettes remain separate.
- Nothing generates native tokens from the web ones, so a brand change needs four manual edits.

## Suggested next step (not done)
Move token values to one JSON file and generate client palettes from it (future architectural work, not part of the iOS appearance update). The iOS trip pages already use the shared semantic colors.
