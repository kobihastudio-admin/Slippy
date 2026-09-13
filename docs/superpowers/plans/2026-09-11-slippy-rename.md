# Slippy Naming and Organization Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current session.

**Goal:** Use Slippy for the product, slippy for technical names, and organize the existing repository without losing local work.

**Architecture:** Keep the working web/api/mobile/native app boundaries and deployment build contexts. Group root design documentation under docs/design, incident guidance under docs/operations, prototypes under prototypes, and standalone LINE tooling under tools.

**Tech Stack:** npm workspaces, Next.js, Fastify, Expo, native apps, Git, Supabase, Docker Compose.

**Spec:** User authorized renaming all parts to Slippy on 2026-09-11.

## Constraints
- Preserve existing uncommitted documentation and every worktree.
- Do not replace credentials, database references, organization names, or existing storage identities as if they were display names.
- Do not deploy runtime changes or rotate existing passwords as part of branding.
- Target local workspace: /Users/chainimitsakhorn/Documents/Projects/Slippy/slippy.

## Tasks
- [x] Rename package metadata, current documentation, local launch settings and development branding; synchronize package-lock.json.
- [x] Move DESIGN_BRIEF.md to docs/design/, INCIDENT_RESPONSE.md to docs/operations/, index.html to prototypes/; repair documentation links and prototype launch configuration.
- [x] Bring standalone LINE rich-menu tools into tools/line-rich-menu/.
- [x] Rename accessible GitHub repositories and update only remotes whose destinations are verified.
- [ ] Rename workspace and repository directories, repair worktree references, and retain compatibility paths for open sessions.
- [x] Check npm workspace resolution, TypeScript, existing tests, JSON and shell syntax, documentation links, and Git diffs; document external blockers.

Directory move paused at preflight: target Slippy directory already contains existing assets; user destination choice is pending.
