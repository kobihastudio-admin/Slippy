# Design System

Status: **derived from code** (`web/tailwind.config.ts`, `web/src/app/globals.css`, `web/src/app/layout.tsx`, `ios/Slippy/Utils/SlippyColors.swift`, `ios/Slippy/Views/Trips/JourneyPrototypeView.swift`, `android/.../ui/theme/*`, `mobile/src/constants/colors.ts`). Where this document and the code disagree, the code is right. The product-level brief is `design/DESIGN_BRIEF.md`; this file records what the four clients actually implement.

There is **no shared token package**. The web defines tokens once as CSS variables; iOS, Android and Expo each hand-copy a subset. Colours therefore agree for the brand and status colours and drift for dark surfaces (see *Drift*).

## Brand and status colours (the same on every client)

| Token | Value |
|---|---|
| `brand-50 … 900` (indigo) | `#eef2ff #e0e7ff #c7d2fe #a5b4fc #818cf8 #6366f1 #4f46e5 #4338ca #3730a3 #312e81` (web has all ten; iOS/Android keep 50, 100, (300), 400, 500, 600, 700, 900) |
| Primary | `brand-500` `#6366f1` (`hsl(239 84% 67%)` on the web) |
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

- `SlippyColors.swift` mirrors the brand and status colours and defines **adaptive** surfaces: `surface` white / `#1e2030`, `surfaceMuted` `#f4f4f6` / `#14161f`, `inputBg` `#f9fafb` / `#1a1d2e`, `border` `#e5e7eb` / `#2d3150`, `textPrimary` `#111827` / white, `textSecondary` `#6b7280` / `#9ca3af`, `background` `#f8f9fc` / `#0a0d1a` (commented as matching web `--background`).
- Appearance follows the user's choice in `AppSettings` (`preferredColorScheme`), so adaptive colours resolve per screen.
- Type is set per view with `.system(size:weight:)`; there is no type scale or custom font.
- **The trip ("Journey") pages use a fixed navy theme that is not part of the adaptive set** and is hard-coded as hex in `JourneyPrototypeView.swift`: page `#080C1A`, header/cards `#0E1527`, inner fields `#151D32`, muted text `#9CA9C4`, strokes `brand-300` at 12–30% opacity, 14–22pt radii. Those pages force a dark colour scheme on their own content so adaptive colours and default text resolve dark. Forms (`FormTheme`, `FormCard`, `FormField`, `FormChip`) and the shared viewers (`ProfileImageViewer`, `ZoomableImage`) follow the same sizes: titles 14–16 bold, captions 11 semibold muted, inputs 14, chips 12 semibold.
- Item types have one icon/tint map (`journeyItemStyle`): hotel `bed.double.fill`, meal `fork.knife`, transport/shinkansen `tram.fill`, car `car.fill`, flight `airplane`, shopping `bag.fill`, booking `ticket.fill`, else `sparkles`.
- Bottom clearance for the floating tab bar is a shared constant (`FloatingTabBar.clearance` 100pt, `compactClearance` 30pt).

## Android (Compose) and Expo

- Android `Color.kt`: brand, status, light surfaces (`#ffffff`, `#f4f4f6`, border `#e5e7eb`, text `#111827`/`#6b7280`, background `#f8f9fc`) and two dark shades (`DarkBg #080C1A`, `DarkCard #0E1527`). `Theme.kt` defines **only a light colour scheme**. `Type.kt` is a Material 3 scale on the default font (display 34 black … label 10 medium).
- Expo `colors.ts`: the same brand/status set with `StatusBg` tints, `Light` and `Dark` palettes (dark background `#080c1a`, card `#0e1527`, muted `#141d30`, border `#1e2d45`, foreground `#f8fafc`).

## Drift to be aware of
- Dark background is `hsl(224 71% 4%)` on the web, `#0a0d1a` as iOS adaptive, `#080C1A` in Android, Expo and the iOS trip pages; dark card is `hsl(217 33% 8%)` on the web, `#1e2030` on iOS adaptive and `#0E1527` elsewhere.
- Android has no dark scheme although it defines dark shades; Expo has both.
- The iOS trip navy and Android/Expo dark are the closest match to each other; the web dark is darker and bluer-black.
- Nothing generates native tokens from the web ones, so a brand change needs four manual edits.

## Suggested next step (not done)
Move the token values to one JSON file and generate the CSS variables, `SlippyColors.swift`, `Color.kt` and `colors.ts` from it, and promote the iOS trip navy to named tokens (`journeyPage`, `journeyCard`, `journeyField`, `journeyMuted`) instead of repeated hex.
