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

The current checked-in asset is WebM because the existing Playwright recording pipeline emits WebM;
no paid media dependency was added. MP4/H.264 conversion remains an optional follow-up if the beta
device matrix requires it.

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
