# Database Schema

Status: **derived from the live database and the repository**. Read on 2026-09-27 (read-only): the linked Supabase project `slippy` (Postgres 17, `public` schema) and `supabase/migrations/`. Where this document and the database disagree, the database is right; regenerate the parts below.

This is an **inventory and map**, not a column dictionary. Column-level truth lives in `supabase/migrations/*.sql` and in the database itself (see *Regenerating*). Only the three tables everything hangs off are described column by column.

## Overview

| Item | Value |
|---|---|
| Application tables (`public`) | 123 (of which 1 is a PostGIS system table) |
| Views (`public`) | 8 (of which 2 are PostGIS) |
| Foreign keys (`public`) | 227 |
| RLS enabled | 122 of 123 tables; the exception is PostGIS `spatial_ref_sys` |
| RLS policies (`public`) | 208 |
| Triggers (`public`, non-internal) | 13 |
| Application functions (`public`, excluding extension-owned) | 44 |
| Extensions | `postgis`, `vector`, `pg_trgm`, `pgcrypto`, `uuid-ossp`, `pg_cron`, `pg_graphql`, `pg_stat_statements`, `supabase_vault`, `wrappers`, `plpgsql` |

The database is **shared**: besides Slippy's `public` schema it also holds the schemas `focus_accounting`, `brother_reservation`, `solutionx` and `drizzle`, and the migration ledger (`supabase_migrations.schema_migrations`) contains migrations for those projects too (for example `focus_accounting_0001`…`0008`). Slippy migrations must not touch those schemas.

## Tenancy and access model

- **Two owner keys.** 36 tables carry `organization_id` (business tenancy) and 41 carry `user_id` (personal ownership). Some carry both. Business data (documents, vendors, quotas) is organisation-scoped; personal data (health, tasks, trips, social) is user-scoped.
- **Identity.** `users` mirrors the Supabase Auth user (the `on_auth_user_created` trigger on `auth.users` calls `handle_new_user`); `organization_members` links users to organisations with a role. `users` is the most referenced table (72 foreign keys), then `organizations` (38), `documents` (19) and `life_journeys` (16).
- **RLS is the default.** Every application table has RLS. Of the 208 policies, 143 use `auth.uid()` directly and 16 use the `get_my_org_ids()` helper. Membership checks that would otherwise recurse use `SECURITY DEFINER` helpers with a fixed search path: `get_my_org_ids`, `get_my_role`, `is_trip_participant`, `is_conversation_member`, `can_view_activity`, `can_manage_activity`.
- **Service role** is used only on servers (web route handlers with the admin client, and the Fastify API); clients use the authenticated role and RLS.

## Core tables

**`users`** (10 columns): `id`, `email`, `full_name`, `avatar_url`, `created_at`, `is_superadmin`, `account_mode`, `phone`, `bio`, `date_of_birth`.

**`organizations`** (25 columns): `id`, `name`, `slug`, `tax_id`, `address`, `plan`, `doc_quota`, `doc_used`, `fiscal_year_end`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `subscription_ends_at`, `created_at`, `updated_at`, `line_connect_code`, `line_connect_expires_at`, `is_demo`, `demo_reset_at`, `data_retention_years`, `retention_last_run_at`, `account_type`, `settings`, `next_quota_reset_at`, `last_quota_reset_at`.

**`documents`** (62 columns), in groups:
- identity and source: `id`, `organization_id`, `uploaded_by`, `file_path`, `file_type`, `source`, `source_meta`, `qr_payload`, `display_rotation`;
- issuer: `vendor_name`, `vendor_tax_id`, `vendor_address`, `vendor_phone`, `company_name`, `company_address`;
- document: `doc_type`, `doc_category`, `doc_number`, `doc_date`, `due_date`, `currency`, `payment_method`, `platform_name`, `platform_ref`, `customer_name`, `staff_name`, `notes`;
- amounts: `subtotal`, `discount_amount`, `delivery_fee`, `vat_amount`, `wht_rate`, `wht_amount`, `total_amount`;
- classification: `vat_claimable`, `expense_claimable`, `business_use_note`, `expense_category`, `health_category`, `is_personal`;
- extraction and validation: `confidence`, `overall_confidence`, `ai_raw_response`, `extracted_at`, `processing_stage`, `processing_percent`, `validation_issues`, `validation_warnings`, `machine_verification_status`, `reconciliation_status`, `reconciliation_details`, `is_duplicate`, `duplicate_of`, `duplicate_doc_id`;
- lifecycle: `status`, `reviewed_by`, `reviewed_at`, `review_note`, `archived_at`, `created_at`, `updated_at`;
- search: `embedding` (pgvector, used by `search_documents_semantic`).

## Table inventory by domain

Tables unless marked `(view)`.

### Tenancy, identity and access

Who a tenant is and who may act for it.

`users`, `organizations`, `organization_members`, `invitations`, `personal_profiles`, `user_sessions`, `user_security_prefs`, `user_consents`, `user_activity_logs`, `line_connections`, `line_connection_tokens`

### Plans, billing and configuration

What an organisation pays for, and admin-controlled settings.

`plans`, `pricing_plans`, `org_plan_details` (view), `billing_invoices`, `doc_addons`, `stripe_events`, `system_config`, `admin_audit_logs`, `referral_conversions`, `affiliate_links`

### Documents and OCR

Uploaded documents, extracted data, and the learning loop. See OCR_ENGINE_SPEC.md.

`documents`, `document_line_items`, `document_audit_logs`, `document_categories`, `document_ground_truth`, `document_push_logs`, `document_shares`, `document_tags`, `document_tag_links`, `scan_uploads`, `image_quality_logs`, `ai_usage_log`, `ocr_error_patterns`, `ocr_feedback`, `receipt_corrections`, `vendors`, `vendor_correction_map` (view), `merchant_directory`, `account_mappings`, `client_error_logs`

### Life Graph and insights

Merchants, events, memories and scores derived from documents.

`life_events`, `life_insights`, `life_memories`, `life_merchants`, `life_score_snapshots`, `score_snapshots`, `vita_cards`, `financial_goals`, `detected_subscriptions`, `location_searches`, `place_cache`, `saved_places`, `exchange_rates`

### Journeys and trips

`life_journeys` is the parent record for trips (and other journey types); `trip_*` tables hang off it.

`life_journeys`, `trip_participants`, `trip_itinerary_days`, `trip_itinerary_items`, `trip_expenses`, `trip_expense_items`, `trip_payments`, `trip_settlements`, `trip_checklist_items`, `trip_documents`, `trip_notes`, `trip_photos`, `trip_location_sessions`, `trip_member_locations`, `trip_call_sessions`, `preorder_sessions`, `preorder_items`, `recurring_expense_templates`

### Activity Graph

Activities, participants, visibility and registration links. See operations/activity-graph-rollout.md.

`activities`, `activity_occurrences`, `activity_participants`, `activity_resources`, `activity_interests`, `activity_registration_links`, `activity_trip_reconciliation` (view)

### Split bills, payments and claims

Shared expenses, payment requests, loans and expense claims.

`split_bills`, `split_participants`, `split_item_claims`, `expense_splits`, `payment_requests`, `personal_loans`, `personal_loan_payments`, `expense_claims`, `expense_claim_stats` (view), `monthly_expense_summary` (view), `approval_events`

### Health and medication

Medications, courses, dose slots and logs.

`health_entries`, `medications`, `medication_schedules`, `medication_inventory`, `medication_logs`, `medication_courses`, `medication_dose_slots`, `medication_course_events`, `medical_providers`, `medication_adherence` (view)

### Social, messaging and community

Friends, chat, groups, posts and notifications.

`friendships`, `friend_invite_links`, `social_follows`, `conversations`, `conversation_members`, `messages`, `community_groups`, `community_members`, `posts`, `post_interactions`, `post_product_links`, `post_receipt_links`, `creator_profiles`, `notifications`, `campaigns`, `products`

### Sport groups

Sport groups and play sessions.

`sport_groups`, `sport_play_sessions`, `sport_play_shots`, `sport_play_ai_insights`, `sport_venue_favorites`, `session_court_slots`, `session_expenses`

### Integrations and work

External accounts, business projects and personal tasks.

`integrations`, `integration_accounts`, `integration_contacts`, `business_projects`, `personal_tasks`

### PostGIS system objects

Installed by the PostGIS extension; not application tables.

`spatial_ref_sys`, `geography_columns` (view), `geometry_columns` (view)

## Notable relationships

- **`documents`** is referenced by: `document_line_items`, `document_audit_logs`, `document_ground_truth`, `document_push_logs`, `document_shares`, `document_tag_links`, `ai_usage_log`, `image_quality_logs`, `ocr_feedback`, `receipt_corrections`, `scan_uploads`, `expense_claims`, `payment_requests`, `split_bills`, `trip_expenses`, `post_receipt_links`, `medications`, and itself (`duplicate_of`). `document_line_items` also seeds `trip_expense_items`.
- **`life_journeys`** is the parent of the trip tables: `trip_participants`, `trip_itinerary_days`, `trip_expenses`, `trip_payments`, `trip_checklist_items`, `trip_documents`, `trip_notes`, `trip_photos`, `trip_location_sessions`, `trip_member_locations`, `trip_call_sessions`, plus `activities`, `conversations`, `life_events`, `preorder_sessions` and `recurring_expense_templates`. `trip_itinerary_items` link to activities both ways (`activities.trip_itinerary_item_id`, `trip_itinerary_items.activity_id`); the view `activity_trip_reconciliation` reports itinerary items with no linked activity.
- **`activities`** is referenced by `activity_interests`, `activity_occurrences`, `activity_participants`, `activity_registration_links`, `activity_resources` and `trip_itinerary_items`.
- **`medication_courses`** is referenced by `medication_dose_slots`, `medication_course_events`, `medication_schedules` and `medication_logs`; logs also reference a dose slot (`slot_id`).
- **`split_bills`** is referenced by `split_participants`, `split_item_claims`, `payment_requests`, `trip_settlements`, `trip_itinerary_days`, `session_court_slots`, `session_expenses` and `sport_play_sessions`.

## Functions and triggers

Application functions (all in `public`), grouped by purpose. `[DEFINER]` marks `SECURITY DEFINER`.

- **Authorization helpers:** `get_my_org_ids` [DEFINER], `get_my_role` [DEFINER], `is_trip_participant` [DEFINER], `is_conversation_member` [DEFINER], `can_view_activity` [DEFINER], `can_manage_activity` [DEFINER], `org_has_feature` [DEFINER].
- **Quota and billing:** `increment_doc_used` [DEFINER], `decrement_doc_used` [DEFINER], `add_doc_quota` [DEFINER], `reset_due_org_quotas` [DEFINER], `sync_subscription` [DEFINER].
- **Documents and search:** `search_documents_semantic`, `search_memories`, `get_vat_report` [DEFINER], `get_wht_report` [DEFINER], `get_top_vendors` [DEFINER], `upsert_vendor` [DEFINER], `seed_default_document_categories`, `cleanup_expired_documents` [DEFINER], `hard_delete_archived_documents` [DEFINER].
- **Life Graph:** `upsert_life_merchant`, `compute_life_score`, `compute_vita_scores` [DEFINER], `find_nearby_merchants`, `find_nearby_cached`.
- **Trips and social:** `create_trip_full` [DEFINER], `ensure_trip_conversation` [DEFINER], `ensure_trip_share_token` [DEFINER], `add_friend_to_trip` [DEFINER], `accept_friend_invite` [DEFINER], `calculate_trip_settlement`, `cleanup_expired_trip_locations` [DEFINER].
- **Activities:** `join_activity_registration` [DEFINER] (token is hashed; a repeat join returns `joined = false`).
- **Medication:** `transition_medication_course` [DEFINER], `decrement_medication_qty`, `get_pending_medication_reminders`.
- **Housekeeping:** `handle_new_user` [DEFINER], `cleanup_stale_sessions` [DEFINER], `reset_demo_org` [DEFINER], `update_updated_at` and other `updated_at` helpers.

Triggers (13) are `updated_at` maintenance on `documents`, `document_categories`, `integrations`, `medical_providers`, `medication_courses`, `medication_dose_slots`, `organizations`, `pricing_plans`, `recurring_expense_templates`, `system_config`, `vendors`, plus `sport_play_sessions` (timestamp) and `organizations_seed_doc_categories` (seeds default categories).

## Migrations

- `supabase/migrations/` holds 128 files in two naming styles: 99 with a 3-digit numeric prefix (`001_core_schema.sql` … including `055_recent_features_security.sql`) and 29 with a 14-digit timestamp (`YYYYMMDDHHMMSS_name.sql`).
- Five files named `*_historical_remote_ledger.sql` are **no-op placeholders**: their original SQL could not be recovered; they exist only so the repository ledger matches the remote (see operations/activity-graph-rollout.md).
- Filenames must match the version recorded in the remote ledger. `20260904033038_journey_type_trip_type_constraint.sql` and `20260926151821_medication_course_lifecycle.sql` were renamed to the versions the database recorded.
- `npm run db:migrate` (`supabase db push`) applies pending migrations; `npm run db:types` is meant to write `packages/types/database.ts` from a local database, but that directory does not exist in the repository. Follow the production gate in operations/activity-graph-rollout.md before pushing to the linked project.

## Known gaps and cautions

- `ocr_feedback` stores user corrections but nothing reads it back into the pipeline (its own table comment says so); the learning loop uses `receipt_corrections`, `ocr_error_patterns` and `document_ground_truth`.
- `spatial_ref_sys` has RLS off because it is a PostGIS system table; it should not hold application data.
- The medication migration backfilled one course per active medication when it was applied to production on 2026-09-26 (14 courses, 25 dose slots); new medications get a course from `POST /api/medications`.

## Regenerating

Read-only queries against the linked project (Supabase SQL editor or MCP `execute_sql`):

```sql
-- tables and views with RLS flag and column count
select c.relname, c.relkind, c.relrowsecurity,
       (select count(*) from information_schema.columns i
         where i.table_schema = 'public' and i.table_name = c.relname) as cols
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v') order by 2, 1;

-- foreign keys pointing at each table
select cl.relname, count(*) from pg_constraint c
join pg_class cl on cl.oid = c.confrelid join pg_namespace n on n.oid = cl.relnamespace
where c.contype = 'f' and n.nspname = 'public' group by 1 order by 2 desc;

-- application functions (excluding extension-owned)
select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
```
