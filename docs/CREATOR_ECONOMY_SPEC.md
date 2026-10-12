# Creator Economy

Status: **derived from code** (`web/src/app/api/shop/products/route.ts`, `web/src/app/api/affiliate/route.ts`, `web/src/app/(app)/shop/page.tsx`, `web/src/components/shop/shop-client.tsx`, migrations `017_social_space.sql` and `029_business_model_plans.sql`) and a read-only count of the production tables on 2026-10-12. Where this document and the code disagree, the code is right.

The old one-line stub described a "referral, community, AI coach marketplace". Only a small slice of that exists. This document separates what runs from what is only a table.

## What runs: product catalogue and affiliate links

**Products** (`products`)
- `GET /api/shop/products?q=&category=&page=` — any signed-in user; active products only, newest first, 24 per page, optional `ilike` name search and category filter.
- `POST /api/shop/products` — requires the caller to be `owner` or `admin` of at least one organization. The product's `merchant_id` is the body's `merchant_id` or, by default, the caller's organization. `commission_rate` defaults to `5.0` (percent). `health_tags` is a text array.
- RLS: select is `is_active = true OR auth.role() = 'authenticated'`, which for any signed-in user is always true — so a direct query sees **inactive** products too (the route filters them out, the policy does not). Insert requires `merchant_id IS NULL` or `owner`/`admin` of that organization; update requires `owner`/`admin` of the merchant organization.

**Affiliate links** (`affiliate_links`)
- `GET /api/affiliate` — the caller's own links with their product and `clicks`, `conversions`, `earnings`.
- `POST /api/affiliate` `{ productId }` — one link per (creator, product); a repeat call returns the existing link with `alreadyExists: true`. The product must exist and be active. The code is 8 characters from an unambiguous alphabet (no `0`, `1`, `I`, `O`, `i`, `l`, `o`), retried up to 5 times on collision.
- RLS: a creator can only read and write their own links (`auth.uid() = creator_id`).

**UI** — `/shop` lists up to 50 active products and the caller's links; "รับ affiliate link" creates one and shows `https://<origin>/go/<code>` with a copy button. The sidebar entry sits behind `SHOW_SOCIAL_SPACE = false` (see SOCIAL_GRAPH_SPEC.md), so the page is reachable by URL only.

## What does not run (schema only)

| Piece | State |
|---|---|
| `/go/<code>` redirect | **No such route exists** in `web/src/app`, so every link the shop UI produces leads nowhere (an unauthenticated visitor is sent to `/login` by the middleware). Nothing counts a click. |
| `affiliate_links.clicks / conversions / earnings` | Never written by any code; always 0. |
| `creator_profiles` (`level` 1–4, `referral_code`, `total_referrals`, `total_earnings`, `community_name`, `community_price` default 99, `is_verified`) | No code reads or writes it. |
| `referral_conversions` (`pending → confirmed → paid`, `amount_thb`, `commission_thb`) | No code reads or writes it; no payout flow. |
| `posts`, `post_product_links`, `post_receipt_links`, `post_interactions` | The feed reads `posts`; nothing links a post to a product or receipt yet. |
| Community, AI coach marketplace | Not present in code. |

Row counts in production on 2026-10-12: `products`, `affiliate_links`, `creator_profiles`, `referral_conversions`, `posts`, `post_product_links`, `post_receipt_links` are all **0**.

## Known gaps
- The affiliate link is dead until a `/go/[code]` handler exists: it would look the code up, increment `clicks` (with some abuse control), remember the code for attribution (cookie), and redirect to the product or merchant page.
- Attribution and money are undefined: where a "conversion" is recorded, who confirms it, how `commission_rate` becomes `earnings`, and how a creator is paid. `commission_rate` is stored per product, but `referral_conversions.commission_thb` and `creator_profiles.total_earnings` have no writer.
- `POST /api/shop/products` lets the caller name any `merchant_id`; the RLS insert policy rejects an organization the caller is not `owner`/`admin` of, but also allows `merchant_id IS NULL`, i.e. a product with no merchant.
- The select policy's `OR auth.role() = 'authenticated'` makes `is_active` ineffective at the database level; tighten it to `is_active = true OR <merchant admin>` if inactive products must stay private.
- Because the feature is hidden and empty, decide whether to build it or remove the tables and routes before more code depends on them.
