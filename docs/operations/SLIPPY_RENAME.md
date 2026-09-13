# Slippy — Rename and Environment Status

Updated: 2026-09-12

## Naming

- Product and GitHub repository: **Slippy**.
- Local repository and npm root: `slippy`.
- Web/API package names: `@slippy/web`, `@slippy/api`.
- Mobile package: `slippy-mobile`; native application identifiers already contain `slippy`.
- Workspace and repository: `/Users/chainimitsakhorn/Documents/Project/Slippy`.

Application directories remain `web/`, `api/`, `mobile/`, `ios/`, and `android/` so their framework and Docker build paths stay consistent. Shared code is under `packages/`, integration workers under `workers/`, deployment under `synology-container-stack/`, and standalone tools under `tools/`. Design documentation is under `docs/design/`, operational guidance under `docs/operations/`, and the HTML prototype under `prototypes/`.

## GitHub

`Chainimit/Slippy` was renamed successfully and `fork-origin` points to it. The organization repository `solutionxteam/doc-hub` is still named as before because the connected account has read-only access there. `origin` intentionally retains the verified existing URL. An organization administrator must rename that repository before its remote can be updated.

The branch for this work is `chore/slippy-project-organization`.

## Existing data and services

This change updates source configuration; it does not redeploy the NAS, restart databases, modify LINE channels, rotate passwords, or change cloud project IDs.

- The connected Supabase cloud project is already named `slippy`; its existing reference stays unchanged.
- Local Supabase configuration now uses `slippy`. The local identifier distinguishes local instances ([Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config)). Before restarting an existing local instance under the new name, back up its data and migrate the original volumes. Docker was not running during this change, so existing local volumes could not be inspected.
- The local auth redirect now uses the application's existing `https://slippy.ai` domain. Cloud auth settings have not been changed.
- NAS configuration, image/container/network names and example deployment paths now use `slippy`. Before deploying over an existing stack, record its actual `COMPOSE_PROJECT_NAME`, back up its data, stop it deliberately, move the deployment directory, and migrate or explicitly attach its existing volumes. Renaming a Compose project alone can select empty volumes. Do not run a volume deletion command during this migration.
- Use `compose.existing-storage.yml` only after setting its three required existing volume names. This override attaches existing volumes with `external: true` instead of creating replacements. Confirm the old stack has stopped before attaching them.
- Existing demo passwords containing the former product name remain credentials, not branding, and have not been rotated. Their examples/tests remain consistent with the existing seed behavior.

## Local compatibility and app settings

The repository was moved to `/Users/chainimitsakhorn/Documents/Project/Slippy` on 2026-09-13. All linked worktrees were repaired and remain accessible. `/Users/chainimitsakhorn/Documents/Projects/Accounting/doc-hub` is now a compatibility symlink to the new repository, so saved tasks and old local settings continue to resolve while new work uses the Slippy path.

Codex includes an existing Slippy project entry and a duplicate Accounting entry. The available project tools cannot rename or change those saved paths, and computer control of Codex is blocked. Reopen/add the Slippy workspace in Codex and remove or rename the duplicate entry through the app when convenient. The compatibility path remains usable in the meantime.

## Verification

Web TypeScript checks and API compilation pass. All 60 existing web unit tests pass. Package and lockfile names agree, workspace links resolve, shell syntax and Compose configuration (including the existing-storage override) validate, and current documentation links resolve. The prototype content and existing asset register are preserved byte-for-byte. Native apps and production deployment were not built or deployed.
