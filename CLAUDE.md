# Slippy Enterprise Blueprint

Role: AI Life Assistant Platform

Vision:
Transform receipts, documents, journeys, relationships, and business activities into a Life Graph powering AI insights.

Architecture:
LINE OA -> Services -> Life Graph -> AI Memory -> AI Assistant

## Project Governance (Slippy)

Governance control (external, read-only during normal work): `/Users/chainimitsakhorn/AI-Workspace/projects/slippy` · Global Standard: `/Users/chainimitsakhorn/AI-Workspace/governance/AI-PROJECT-GOVERNANCE-STANDARD.md`

Before substantial work:
1. Read `PROJECT.md`, `SCOPE.md`, `CURRENT.md` and the relevant `DECISIONS.md` entries in the governance directory (minimum context; not old chats).
2. Follow `CURRENT.md` as the active execution boundary and the approved Source of Truth. Chat history never outranks it.
3. Classify work: 🟢 IN_SCOPE · 🟡 SCOPE_EXPANSION · 🟠 NEW_WORKSTREAM / SESSION_BOUNDARY · 🔴 SCOPE_CONFLICT. Never silently expand scope.
4. Stop and ask before scope, architecture, security-model, major-infrastructure changes or conflicts with approved decisions.
5. At session start, validate the `CURRENT.md` checkpoint against the repo; report `CHECKPOINT_DRIFT` if materially different. Do not overwrite existing work.
6. Never modify the governance control repository as a side effect of implementation work.
