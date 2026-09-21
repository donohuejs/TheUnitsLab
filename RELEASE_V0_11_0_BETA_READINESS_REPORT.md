# v0.11.0 Private Beta Readiness Report

Date: 2026-09-20  
Application version: **v0.11.0**  
Scope: private beta for approximately 2–3 friends  
Production reset performed: **No**

## Summary

v0.11.0 adds the small set of product and operations surfaces needed for a friends-only beta:

- a welcoming authenticated Home beta announcement with a Settings feedback link;
- database-backed Feedback & Version submission with automatic release/page/browser context;
- an administrator-only feedback review queue using the existing admin allowlist;
- canonical version display and source-controlled version history;
- corrected multi-stage Import Betslip tutorial copy, captions, and recording workflow;
- a durable product backlog;
- Supabase/Vercel backup and recovery guidance;
- a read-only pre-beta reset preview helper and clean-start runbook; and
- version synchronization from 0.10.1 to 0.11.0.

No Odds API provider, quota, sportsbook provider, market-fetch, props, wagering, settlement,
bankroll, or real-money architecture was changed. No commit, tag, push, production backup, or
production account/data reset was performed.

## Files changed

Application and versioning:

- `package.json`, `package-lock.json`
- `src/config/version.ts`, `src/config/version-history.ts`
- `src/app/page.tsx`, `src/app/account/page.tsx`, `src/app/actions.ts`
- `src/app/admin/feedback/page.tsx`, `src/app/admin/feedback/actions.ts`
- `src/app/admin/settlement-tests/page.tsx`
- `src/app/globals.css`
- `src/components/import-tutorial.tsx`
- `scripts/record-import-demo.mjs`
- `public/help/import-betslip-demo.vtt`

Database and tests:

- `supabase/migrations/20261003000000_private_beta_feedback.sql`
- `supabase/tests/private_beta_feedback.sql`
- `test/private-beta-release.test.ts`

Documentation and operations:

- `PRODUCT_BACKLOG.md`
- `docs/PRODUCTION_BACKUP_AND_RECOVERY.md`
- `docs/PRE_BETA_RESET_RUNBOOK.md`
- `docs/decisions/0003-private-beta-readiness.md`
- `docs/ARCHITECTURE.md`, `docs/MIGRATIONS.md`, `docs/TESTING.md`, `README.md`
- `scripts/pre-beta-reset-preview.mjs`

## Migration and feedback architecture

The forward-only migration creates `public.beta_feedback` with category and status enums, title and
description constraints, optional reproduction steps, route/version/browser context, non-sensitive
environment JSON, timestamps, and a per-user submission key.

Authenticated users submit through `public.submit_beta_feedback`. The function derives `user_id`
from `auth.uid()`, defaults status to `new`, and returns the existing row for a repeated
`(user_id, submission_key)` delivery. The Settings form uses one generated UUID per rendered form,
while `SubmitButton` disables the form during the server action.

The ordinary role can select only its own reports. It has no direct insert, update, or delete grant;
there is no browser path to change status. The UI does not collect screenshot uploads or unnecessary
personal information.

## RLS and security behavior

`beta_feedback` has both enabled and forced RLS. Direct database tests prove:

- authenticated submission is caller-owned even when the client cannot supply a `user_id`;
- User A cannot read User B's report;
- direct spoofed insert is denied;
- ordinary users cannot change administrative status or delete reports;
- repeated delivery with the same submission key does not duplicate a row; and
- the server-only service-role boundary can read all rows and update status for the existing admin
  review page.

Admin authorization remains the existing `APP_ADMIN_USER_IDS` server-side allowlist. The feedback
page does not introduce a second admin system and does not show submitter email addresses.

## Beta Home message

Authenticated Home now includes a compact, responsive, accessible beta announcement with the
requested simulation/import disclosure and a direct `/account#feedback` link. It is styled as a
welcoming product callout, not an error or blocking warning.

## Version and history

`package.json` is the canonical version source and `package-lock.json` is synchronized at 0.11.0.
`src/config/version.ts` exposes the value, Settings displays `The Units Lab` and `v0.11.0`, and
`src/config/version-history.ts` contains v0.11.0 and v0.10.1 entries for future extension.

## Tutorial correction

The tutorial now describes the real reviewed workflow: screenshot upload, Luna processing, extracted
field review/correction, canonical event review, multiple Continue stages, Study choice, economics
confirmation, Review draft, final confirmation, and My Bets verification. The existing
private-safe `public/help/import-betslip-demo.webm` asset remains included with captions; the
Playwright recorder now explicitly follows the current multi-stage route and uses deterministic
synthetic data. The player retains controls, captions, `playsInline`, no autoplay, and keyboard/
mobile close behavior.

At the time of v0.11.0, the checked-in asset was WebM because the existing Playwright recording
pipeline emits WebM; no paid media dependency was added. The v0.11.1 hotfix below supersedes that
asset and keeps MP4/H.264 conversion as an optional follow-up if the beta device matrix requires it.

## Backlog and operational documentation

`PRODUCT_BACKLOG.md` separates Beta Blocker, High Priority, Planned, Research, and Nice to Have
work across data/odds architecture, markets, sports, imports, analytics, UX, operations, and long
term research. It intentionally does not turn provider architecture or new markets into v0.11.0
implementation.

`docs/PRODUCTION_BACKUP_AND_RECOVERY.md` defines durable relational data, disposable screenshots and
regenerable provider cache boundaries, backup timing, safe Supabase dump commands, restore order,
Vercel configuration separation, and recovery validation. `docs/PRE_BETA_RESET_RUNBOOK.md` requires
a backup and dry-run review, preserves the admin identity and privileges, uses the canonical
`ensure_initial_bankroll()` behavior, requires supported Auth Admin deletion for the known test
user, and documents the exact final sequence. The new preview helper is read-only and has no execute
or delete mode.

## Automated tests

- Focused private-beta contract tests: **PASS**, including canonical version, Home/settings copy,
  tutorial stages, and media/caption asset existence.
- `npm.cmd test`: **PASS**, 33 files and 230 tests.
- `npm.cmd run test:db`: **PASS**, 21 SQL files and 537/537 pgTAP assertions.
- Existing wager, settlement, analytics, parlay, screenshot, and authorization suites remained
  green.

## Full validation results

- `npm.cmd run validate`: **PASS** — format, lint, typecheck, unit tests, secret scan, and build.
- `npm.cmd audit --audit-level=high`: **PASS** — 0 vulnerabilities. The first sandbox attempt was
  network-blocked; the read-only network retry passed.
- `npm.cmd run db:reset`: **PASS** — clean local replay through the new feedback migration.
- `npm.cmd run db:lint`: **PASS** — existing settlement-harness shadow/unused-variable warnings
  were reported, with no schema error and exit code 0.
- `git diff --check`: **PASS**.
- Production build: **PASS** on Next.js 16.3.5.
- Secret scan: **PASS**.
- No live provider calls, paid dependency, or production data operation was used.

## API-cost implications

The release adds no provider calls, polling, paid dependency, or change to quota strategy. The
feedback table and source-controlled release history use the existing Supabase/Vercel baseline.
Tutorial recording is local Playwright work and uses synthetic data; it does not require a paid Luna
call when run without the optional server-side vision credential.

## Remaining manual pre-beta tasks

These must be completed immediately before inviting friends and are intentionally not automated in
this implementation task:

1. Create a production backup.
2. Perform the admin clean-start reset.
3. Remove test user `jadaxi4311@meonvr.com` through the supported Auth Admin route.
4. Verify the admin account clean state.
5. Run the final production smoke test.
6. Invite only 2–3 beta friends initially.

The backup/reset runbooks require dry-run row review, explicit ownership checks, audit/integrity
preservation, and no direct mutation of Supabase Auth internals.

## Already-confirmed production gates

- Normal user registration: **PASS**
- Cross-user wager privacy: **PASS**

## Security and deviations

The only new user-generated data is feedback and small diagnostic context needed to triage it. No
admin notes or screenshot upload was added. The only release-format deviation is that the checked-in
tutorial asset is WebM from the existing Playwright pipeline; the player and captions remain
mobile-friendly, and MP4/H.264 conversion is documented as a follow-up if required by device testing.

## Gate recommendation

**V0.11.0 PRIVATE BETA GATE RECOMMENDATION: PASS**

The implementation, migration, RLS tests, application validation, documentation, and release
surfaces are complete. The gate assumes the six manual pre-beta tasks above are completed and
verified before any invitation is sent.

## v0.11.1 Tutorial Video Hotfix

Date: 2026-09-20
Application version: **v0.11.1**
Scope: tutorial media and release metadata only

### Root cause and asset correction

The v0.11.0 player served the generic `public/help/import-betslip-demo.webm` file. That checked-in
recording was stale relative to the current Import Betslip implementation, and the companion
caption file used the same non-versioned path. The recorder also did not pause between review
stages, so a quick replacement could be technically valid while being too short to teach the
workflow. The stale files were removed and are no longer reachable from the UI.

The player and tests now use these versioned assets:

- `public/help/import-betslip-demo-v0.11.1.webm`
- `public/help/import-betslip-demo-v0.11.1.vtt`

The WebM is the primary format because Playwright's existing local recording pipeline emits WebM
and no paid media dependency or conversion tool was added. The new recording is 27.40 seconds,
with controls, `playsInline`, metadata preload, captions, and no autoplay.

### Recording and workflow verification

The repaired `scripts/record-import-demo.mjs` records the real authenticated `/track-bet` route,
which is the current Import Betslip UI. It uses a fresh local Supabase test account, a deterministic
synthetic PNG, and browser-level synthetic responses for the Luna extraction and canonical-match
boundaries. This keeps the recording private-safe and free of paid Luna/provider calls while still
exercising the production components and review actions.

The captured workflow is: open Import Betslip; upload the screenshot; complete the Luna extraction
state; review the extracted fields; correct the American odds; continue through event/canonical,
market, and economics review; choose `No Study — Personal`; confirm stake, odds, and return; review
the final editable draft; confirm/save; and verify the imported wager in My Bets. The written
walkthrough and versioned VTT captions describe the same sequence.

### Browser and release validation

- Playwright browser validation loaded the production-served WebM and measured a finite 27.40-second
  duration.
- The player retained native controls, `preload="metadata"`, `playsInline`, no autoplay, captions,
  and a working close button.
- No horizontal overflow was observed at 375px, 390px, 430px, or 1280px viewports; the dialog
  remained inside the viewport at each size.
- `package.json` and `package-lock.json` are synchronized at 0.11.1, while the UI continues to
  derive its displayed version from the package manifest through `src/config/version.ts`.
- `src/config/version-history.ts` now lists v0.11.1 first and preserves v0.11.0 and v0.10.1.
- No database migration, RLS policy, feedback surface, betting logic, provider call, analytics,
  reset tooling, backup tooling, or navigation behavior changed.

### Hotfix test results

- Focused tutorial/version tests: **PASS**.
- `npm.cmd run validate`: **PASS** — format, lint, typecheck, unit tests, secret scan, and build.
- `npm.cmd audit --audit-level=high`: **PASS** — 0 high-severity vulnerabilities.
- `git diff --check`: **PASS**.
- The existing v0.11.0 validation surfaces remain covered; no commit or push was performed.

V0.11.1 TUTORIAL HOTFIX GATE: PASS

## v0.11.2 Tutorial Caption Layout Hotfix

Date: 2026-09-20
Application version: **v0.11.2**
Scope: tutorial caption presentation only

### Root cause and implementation

Production smoke testing confirmed that the v0.11.1 video and workflow were correct, but browser-
native WebVTT captions were drawn over active content and controls, especially on mobile. The
caption overlay could cover Continue buttons, review fields, canonical-event confirmation, Study /
Personal selection, final confirmation, and success content.

The hotfix keeps the existing recording unchanged and adds a dedicated caption-safe band directly
below the video. The `kind="captions"` VTT track remains loaded for browser caption semantics and
the video is linked to the safe-band region with `aria-describedby`. The component synchronizes the
current cue into an `aria-live="polite"` region with readable responsive text, then sets the native
track to hidden so Safari and other browsers cannot reintroduce an overlapping visual overlay.
Native video controls remain on the video itself, while the custom caption region is outside the
control surface and never obscures the recording.

The underlying 27-second recording was not re-recorded. Its bytes were preserved at the new
versioned media path:

- Old media path: `public/help/import-betslip-demo-v0.11.1.webm`
- New media path: `public/help/import-betslip-demo-v0.11.2.webm`
- Old caption path: `public/help/import-betslip-demo-v0.11.1.vtt` (removed from the served assets)
- New caption path: `public/help/import-betslip-demo-v0.11.2.vtt`

The corrected multi-stage Import Betslip walkthrough and written steps remain unchanged.

### Responsive and accessibility validation

- Browser validation confirmed the new media and caption assets load successfully.
- At 375px, 390px, and 430px, the caption band stayed inside the modal, wrapped without clipping,
  remained readable, and did not cover video controls or recorded UI. No horizontal overflow was
  observed.
- At 1280px desktop, the caption band remained within the dialog and below the video without
  obscuring content.
- Native controls, `playsInline`, metadata preload, no autoplay, keyboard close, and mobile close
  behavior remained available.
- The VTT track remains present and browser-loadable; the synchronized safe-band text is exposed
  through an accessible labelled live region for consistent mobile Safari behavior.

### Version and validation results

- `package.json` and `package-lock.json` are synchronized at 0.11.2; the UI still derives the
  displayed version from the canonical package source.
- `src/config/version-history.ts` now lists v0.11.2 first and preserves v0.11.1, v0.11.0, and
  v0.10.1.
- Focused tutorial/version tests: **PASS**.
- `npm.cmd run validate`: **PASS** — format, lint, typecheck, unit tests, secret scan, and build.
- `npm.cmd audit --audit-level=high`: **PASS** — 0 high-severity vulnerabilities.
- `git diff --check`: **PASS**.
- No database, RLS, feedback, betting, provider, analytics, navigation, backup, or reset changes
  were made. No commit or push was performed.

V0.11.2 TUTORIAL CAPTION HOTFIX GATE: PASS

## Pre-Beta Permission / My Bets Maintenance Hotfix

Date: 2026-09-20
Application version: **v0.11.2**
Scope: forward-only read-permission repair and My Bets read-path diagnostics

### Findings and root causes

The pre-beta preview is a read-only service-role Supabase client. Its complete direct database
dependency set is `bets`, `external_wagers`, `bankroll_ledger`, `group_members`, `groups`,
`beta_feedback`, `bet_legs`, `external_wager_legs`, `settlement_audits`,
`external_wager_result_audits`, and `wager_study_assignment_audits`. Auth Admin `listUsers` is an
Auth API dependency, not a database table grant. The preview does not call an RPC or view, and its
row lookups do not introduce an additional database object dependency.

`wager_study_assignment_audits` was created by `20260927000000_release_candidate_fix_patch_5.sql`
after the older blanket service-role grant migration. That migration forced RLS and revoked ordinary
role access, but did not add the required service-role `SELECT` grant. The reported `permission
denied for table wager_study_assignment_audits` is therefore a table privilege omission; FORCE RLS
was not weakened and no preview mutation occurred.

The production My Bets page is a separate authenticated server-component path in
`src/app/my-bets/page.tsx`. It uses the ordinary authenticated Supabase client and directly reads:

- `bets` with embedded `bet_legs`, filtered to the signed-in owner and non-synthetic tickets;
- `external_wagers` with embedded `external_wager_legs`, filtered to the signed-in owner;
- `bankroll_ledger`, filtered to the signed-in owner; and
- `groups` for the Study selector.

It then optionally reads `event_scores` for the returned simulated ticket events. It does not read
`wager_study_assignment_audits`, call an analytics projection, or call an RPC for the list. Existing
RLS policies are the row-authorization boundary, and the current migration graph already declares
the intended authenticated `SELECT` grants for these tables. The repository did not contain a
production log or request trace preserving which of the page's parallel reads produced the reported
message, so an exact live object/error cannot be claimed from source inspection alone. The page now
records a server-only diagnostic with the failed operation label and database error code/message;
ordinary users still receive the same non-sensitive error notice. The two failures are therefore
different: the preview has a proven missing service-role grant, while the My Bets incident had no
reproducible missing grant in the checked-in migration graph and required production retest
observability. The hotfix also reasserts only the exact authenticated table `SELECT` prerequisites
used by My Bets.

### Migration and grant audit

Added the forward-only migration
`supabase/migrations/20261004000000_pre_beta_permissions_my_bets.sql`.

- `service_role`: `SELECT` on `wager_study_assignment_audits` only for the maintenance preview.
- `authenticated`: `SELECT` reasserted only on `bets`, `bet_legs`, `bankroll_ledger`, `groups`,
  `external_wagers`, `external_wager_legs`, and `event_scores`, which are the direct My Bets path.
- `anon` and `public`: no grants added.
- `wager_study_assignment_audits`: no authenticated grant was added; forced RLS remains unchanged.
- `simulated_placement_idempotency`: remains service-role denied by design and is not a preview or
  My Bets read dependency; its SECURITY DEFINER placement boundary remains unchanged.
- Recent Luna server-only tables already receive their reviewed service-role grants in patch 9;
  `beta_feedback` already has its explicit service-role grant. No broad regrant was added.

The page now adds explicit owner predicates to simulated-ticket and ledger reads as defense in depth
around the existing RLS policies. No wager, Study, bankroll, or user data was modified.

### Regression coverage and validation

Added `supabase/tests/pre_beta_permissions_my_bets.sql` and
`test/pre-beta-permissions-my-bets.test.ts`. The database test covers the complete preview privilege
set, service-role access, anon/authenticated denial for the Study audit table, authenticated-only
My Bets table prerequisites, forced RLS, and executable ordinary-role reads. Existing phase tests
continue to cover User A/User B ownership, imported and simulated wager isolation, Study assignment
authorization, and unchanged admin/service behavior.

- Focused hotfix unit test: **PASS** — 2 tests.
- `npm.cmd run validate`: **PASS** — 34 files, 232 tests, security scan, and production build.
- Local migration application: **PASS** — applied only the new forward migration; no reset run.
- `npx.cmd supabase db lint --local`: **PASS** — only the repository's existing settlement-harness
  warnings were reported.
- `npm.cmd run test:db`: **PASS** — 22 files, 553 tests.
- `npm.cmd audit --audit-level=high`: **PASS** — 0 vulnerabilities.
- `git diff --check`: **PASS**.
- No production browser session, production reset, production data operation, commit, or push was
  performed. A live My Bets browser retest remains an operator step below because production
  credentials/log access were not provided to this task.

### Production retest steps

1. Verify the existing backup and the linked Supabase project, then apply the migration with
   `npx supabase db push --linked` (or run the exact migration SQL through the protected production
   migration workflow). Do not run `supabase db reset`, delete users, or run the admin clean-start.
2. Deploy the application code containing the explicit My Bets owner predicates and safe diagnostics.
3. In the server-only operator environment, rerun
   `npm.cmd run prebeta:reset:preview`. Confirm the preview completes and includes the
   `studyAssignmentAudits` count without any mutation step.
4. Sign in as an ordinary beta user and open My Bets. Verify the user's simulated wagers, imported
   wagers, Vial balance, Study selector, and event-score display load; verify another user's wagers
   remain absent. Check server logs for the labeled `My Bets read failed` diagnostic and confirm no
   failure is emitted.
5. Compare the read-only preview counts with the pre-migration backup/operator snapshot and confirm
   there were no inserts, updates, deletes, ownership changes, bankroll changes, or Study changes.

PRE-BETA PERMISSION / MY BETS HOTFIX GATE: PASS

## Pre-Beta Clean-Start Maintenance

Date: 2026-09-20
Application version: **v0.11.2**
Scope: safe production clean-start maintenance tooling and validation only

### Root cause and maintenance architecture

The repository had a read-only preview helper, but no reviewed execution path. Direct production
deletes would be unsafe because wager legs and audit/ledger rows use restrictive foreign keys and
settlement, imported-result, and bankroll tables are append-only under database triggers. The
maintenance implementation therefore adds a forward-only, service-role-only
`public.pre_beta_clean_start(admin_uuid, test_uuid)` `SECURITY DEFINER` RPC plus a server-only Node
operator wrapper. The wrapper defaults to dry-run, requires the exact
`PRE_BETA_ADMIN_USER_ID`, resolves exactly `jadaxi4311@meonvr.com`, and permits mutation only with
`--execute`, `PRE_BETA_MAINTENANCE_ENV=production`, and
`--confirm RESET_PRIVATE_BETA_TEST_DATA`.

The RPC revalidates both Auth users and application profiles, aborts on unexpected ownership or
membership graphs, performs the database cleanup in one transaction, reconciles the admin through
the existing `app_private.allocate_initial_bankroll()` mechanism, and verifies the post-cleanup
state before commit. Storage-object removal and Auth Admin deletion necessarily occur after the
database transaction through server-only APIs; errors report the committed stage and exact
screenshot paths for a controlled retry. A retry is idempotent only for the same exact UUID and
only when no test application rows remain. A completed run is also a verified no-op if the test
Auth user is already gone.

### Objects and data behavior

The maintenance transaction removes only target-owned simulator/application rows:

- simulated and imported wagers, wager legs, settlement/result audits, and Study-assignment audits;
- target bankroll ledger rows, then one canonical admin initial-allocation row is restored;
- target beta feedback;
- target vision usage, OCR, diagnostic, and vision-budget audit records;
- user-scoped simulated-placement idempotency rows;
- invitations created by the target users and target memberships;
- the single admin-owned Study, its invitations/membership, and related target wagers; and
- the test user's application profile.

Private screenshot paths are collected from target imported wagers and removed from the
`external-wager-screenshots` bucket after the database transaction. The exact test Auth user is
then deleted through the supported Supabase Auth Admin API. No SQL operation deletes `auth.users`.
Global sports/competition/bookmaker catalogs, odds cache, global vision budget configuration,
unrelated users/Studies/wagers/feedback, and the administrator's Auth/profile/allowlist identity
are preserved.

### Admin reset and Study safety

The admin UUID is never inferred. The RPC allows zero or one admin-owned Study. If one exists, it
must have exactly one member and that member must be the admin; the admin must have no other Study
membership; and no wager in that Study may belong to another user. Otherwise the transaction
aborts before mutation. The test user must own no Study. Test memberships in an unrelated Study
are removed while the unrelated Study and its other members remain. An owned Study with any other
member is covered by a database test and is a hard failure, not an implicit cascade.

Feedback rows are removed only for the exact admin/test user IDs. The feedback feature, policies,
status model, and submission path are unchanged. The existing admin allowlist is configuration,
not a row in the reset scope, and is not modified.

### Bankroll reconciliation

The transaction deletes both targets' ledger rows in dependency-safe order and calls the existing
canonical allocator for the preserved admin. It does not independently set a starting amount.
Post-cleanup checks require exactly one admin `initial_allocation` row, no remaining admin wagers or
test ledger/profile rows, and a balance equal to the sum of the canonical ledger. The SQL fixture
also compares the result with an unrelated fresh profile's allocator-produced balance.

### Runbook, tests, and validation

Updated `docs/PRE_BETA_RESET_RUNBOOK.md` with the exact backup, server-only environment, dry-run,
execution, verify, failure-retry, acceptance, and repository-validation sequence. Added:

- `supabase/migrations/20261005000000_pre_beta_clean_start_maintenance.sql`;
- `scripts/pre-beta-reset-maintenance-lib.mjs`;
- `scripts/pre-beta-reset-maintenance.mjs`;
- `supabase/tests/pre_beta_clean_start_maintenance.sql`; and
- `test/pre-beta-clean-start-maintenance.test.ts`.

The database fixture covers transaction abort safety, append-only trigger preservation, target
wager/leg/audit/feedback/vision/idempotency cleanup, admin profile preservation, canonical
bankroll restoration, exact Study handling, Auth-row preservation until the external Auth step,
and unrelated Study/feedback preservation. The unit contract covers service-role-only execution,
exact confirmation/environment guards, dry-run/verify modes, and Auth deletion ordering.

Validation results:

- `npm.cmd run test:db`: **PASS** — 23 files, 582 tests.
- Local migration application: **PASS** — applied the forward maintenance migration without a
  database reset.
- `npm.cmd run validate`: **PASS** — format, lint, typecheck, 36 test files / 236 tests, secret
  scan, and production build.
- `npm.cmd audit --audit-level=high`: **PASS** — 0 vulnerabilities.
- `npx.cmd supabase db lint --local`: **PASS** — only the repository's two existing
  settlement-harness warnings were reported; the new maintenance function is clean.
- `git diff --check`: **PASS**.
- Production reset, production cleanup, Auth deletion, commit, and push: **NOT PERFORMED**.

PRE-BETA CLEAN-START MAINTENANCE GATE: PASS
