# Domain-Driven Design — context map

Status: **derived from code**: the 126 public tables of the production database (2026-10-12), `web/src/app/api/*`, `web/src/lib/*`, `api/src/{routes,services}`, and the module list in `SYSTEM_ARCHITECTURE.md`. The code has **no formal bounded-context boundaries** (no per-context packages or schemas); the grouping below is how tables and routes cluster in practice, so treat it as a map of what is there, not a statement of how the code is enforced. Where this document and the code disagree, the code is right.

The old stub named five contexts (Wealth, Social, Journey, Business, Lifestyle). The code supports those and adds Health, Intelligence, Platform and Commerce.

## Contexts

| Context | Core model (tables) | Entry points |
|---|---|---|
| **Identity & Organization** (shared kernel) | `users`, `organizations`, `organization_members` (owner\|admin\|accountant\|viewer), `invitations`, `line_connections`, `line_connection_tokens`, `plans`, `pricing_plans`, `billing_invoices`, `stripe_events`, `user_consents`, `user_security_prefs`, `user_sessions`, `system_config` | `/api/auth/*`, `/api/org`, `/api/onboarding`, `/api/stripe`, `/api/privacy`, LIFF auth (`lib/liff-auth.ts`) |
| **Documents & Accounting** (Wealth) | `documents`, `document_line_items`, `document_categories`, `document_tags`/`_tag_links`, `document_shares`, `document_audit_logs`, `document_push_logs`, `document_ground_truth`, `vendors`, `merchant_directory`, `account_mappings`, `integrations*`, `exchange_rates`, `receipt_corrections`, `ocr_feedback`, `ocr_error_patterns`, `image_quality_logs`, `scan_uploads`, `recurring_expense_templates`, `detected_subscriptions` | `/api/documents`, `/api/ocr-feedback`, `/api/tax`, `/api/integrations`; `api/` OCR pipeline, workers |
| **Business Suite** | `expense_claims`, `approval_events`, `business_projects`; budgets live in `organizations.metadata` | `/api/claims`, `/api/budget` |
| **Personal finance** (Wealth) | `financial_goals`, `personal_loans`, `personal_loan_payments`, `personal_profiles`, `personal_tasks`, `vita_cards` | `/api/personal` |
| **Social** | `friendships`, `friend_invite_links`, `social_follows`, `posts` + `post_*`, `conversations`, `conversation_members`, `messages`, `community_groups`, `community_members`, `notifications` | `/api/friends`, `/api/social`, `/api/conversations`, `/api/chat`, `/api/notifications`, LIFF community |
| **Bill splitting** | `split_bills`, `split_participants`, `split_item_claims`, `payment_requests`, `preorder_sessions`, `preorder_items` | `/api/split`, `/api/payment-requests`, LINE `/split` commands |
| **Journey (trips)** | `life_journeys` (the trip row, `journey_type = 'trip'`), `trip_participants`, `trip_itinerary_days/_items`, `trip_expenses`, `trip_expense_items`, `expense_splits`, `trip_payments`, `trip_settlements`, `trip_photos`, `trip_documents`, `trip_notes`, `trip_checklist_items`, `trip_identity_tags`, `trip_place_candidates`, `trip_place_votes`, `trip_location_sessions`, `trip_member_locations`, `trip_call_sessions`, `saved_places`, `place_cache`, `location_searches` | `/api/trips`, `/api/places`, LIFF trips; iOS trip pages |
| **Activities** (Activity Graph) | `activities`, `activity_occurrences`, `activity_participants`, `activity_interests`, `activity_resources`, `activity_registration_links` | `/api/activities`, `/join/[token]`; mirrors itinerary items through `trip_itinerary_items.activity_id` |
| **Lifestyle / Sport** | `sport_groups`, `sport_play_sessions`, `sport_play_shots`, `sport_play_ai_insights`, `session_court_slots`, `session_expenses`, `sport_venue_favorites` | `api/` `/v1/sport-play`, LINE `/sport*` commands |
| **Health** | `health_entries`, `medications`, `medication_schedules`, `medication_dose_slots`, `medication_logs`, `medication_inventory`, `medication_courses`, `medication_course_events`, `medical_providers` | `/api/medications`, `lib/medication*.ts` |
| **Intelligence** | `life_events`, `life_insights`, `life_memories`, `life_merchants`, `life_score_snapshots`, `score_snapshots`, `ai_usage_log` | `/api/life`, `/api/chat`, `api/` Life Graph + AI Memory services |
| **Commerce / Creator** | `products`, `campaigns`, `affiliate_links`, `creator_profiles`, `referral_conversions` | `/api/shop`, `/api/affiliate` (mostly schema; see CREATOR_ECONOMY_SPEC.md) |
| **Platform / Ops** | `admin_audit_logs`, `client_error_logs`, `user_activity_logs` | `/api/admin`, `/api/errors` |

## How the contexts talk to each other (as built)

- **Documents → Intelligence**: an approved or pushed document populates the Life Graph (`populateLifeGraph`, called by the API and by the web review screen). Corrections feed the OCR learning loop.
- **Identity → everything**: `users` and `organization_members` are the shared kernel; finance contexts scope by organization, trip/activity/chat contexts scope by participation (`is_trip_participant()` and its siblings).
- **LINE** is a channel, not a context: `line_connections` maps a LINE user to a Slippy user and organization; the bot and LIFF pages reach Documents, Bill splitting, Journey, Lifestyle and Health through it.
- **Journey ↔ Social**: a trip has a conversation (`ensure_trip_conversation` RPC); friends are added to trips from the Social context.
- **Journey ↔ Activities**: itinerary items are mirrored one-to-one into `activities` (a backfill migration plus best-effort updates from the apps); there is no database trigger, so the mirror can drift (`activity_trip_reconciliation` view).
- **Journey ↔ Bill splitting**: two separate models for the same idea (`trip_expenses`/`expense_splits`/`trip_settlements` and `split_bills`/`split_participants`); they share no tables.
- **Clients bypass an application layer**: web server routes, the iOS app and the Expo/Android apps read and write Supabase tables directly under RLS (service-role only where a route needs it), so RLS policies, not a domain service, are the invariant enforcers.

## Smells worth knowing
- The trip aggregate root is `life_journeys`, a table named for the Intelligence/Life Graph context; non-trip journeys share it and RLS branches on `journey_type`.
- `organizations.metadata` holds budgets (Business Suite) and other loosely typed settings; `life_journeys.metadata` holds trip UI settings (cover, reminders, budget plan) — JSON as an escape hatch in two contexts.
- Two implementations of life score exist (see LIFE_GRAPH_SPEC.md); Journey has two parallel settlement models (above).
- Enforcement of invariants is spread across RLS, route code and, for some money rules, client code; no context owns its invariants end to end.

## If contexts were to be made real
Start with the seams that already behave like boundaries: Documents (own pipeline in `api/`), Health, and Lifestyle/Sport; keep Identity as a shared kernel; give Journey and Activities one owner for the itinerary → activity mirror; and decide which of the two splitting models survives.
