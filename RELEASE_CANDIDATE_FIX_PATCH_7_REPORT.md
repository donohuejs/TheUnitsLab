# The Units Lab — Release Candidate Fix Patch 7 Report

Date: 2026-09-18  
Phase: Phase 8 / pre-UAT  
Recommendation: CONDITIONAL PASS for the implementation gate; HOLD the final UAT gate for one authenticated tutorial capture and a successful mobile smoke run. Phase 9 has not started.

Patch 7 is a forward-only release-candidate correction. It preserves immutable submitted ticket
terms, forced RLS, private screenshot storage, imported/virtual-bankroll separation, deterministic
and idempotent settlement, provider/cache quota controls, Study authorization, and all non-real-
money boundaries.

## 1. Luna-first screenshot import

`src/components/import-betslip-form.tsx` now attempts the server-side Luna route for every uploaded
screenshot before using browser-local OCR. A missing key, exhausted internal budget, timeout,
provider error, malformed result, or ledger-completion error returns the same editable draft path
and then allows bounded local OCR/manual completion. Successful local OCR no longer silently skips
the configured Luna attempt.

The route remains server-only: `OPENAI_API_KEY` is read only by
`src/app/api/import-betslip/vision/route.ts` and the server adapter. No live paid Luna request was
made during validation.

## 2. Direct diagnostics and budget visibility

The new `vision_diagnostics` table records correlation ID, provider status/category, extraction
result, budget availability, and ledger-write status. It is forced RLS with ordinary-role table
grants revoked and stores no screenshot bytes, API key, or extracted private ticket text.

The Admin API-usage page now shows the last attempt, last success, model, provider status, error
category, budget state, and ledger status. Existing locked monthly reservation and token-cost
completion remain authoritative; diagnostics are operational evidence only.

## 3. Currency and acceptance handling

Currency parsing now accepts display forms such as `$1,234.50` and stores exact minor-unit values.
The FanDuel-style acceptance fixture covers Boston College, `-2.5`, `-170`, `$8.00`, `$12.71`,
and the `Rutgers at Boston College` event without fabricating a sport or competition.

Parlay legs remain atomic objects. Missing stake is an editable review state, not a silently
invented value, and malformed parlay input cannot be persisted as a valid ticket.

## 4. Canonical matching and reconciliation

`match_imported_wager` now rechecks straight tickets against unique non-synthetic candidates from
retained `event_scores` and `odds_cache`, updates readiness fields, and invokes imported settlement
only after canonical matching and supported grading metadata are present.

The new bounded authenticated `reconcile_imported_wagers()` RPC re-evaluates open imported records
from the history page. Straight tickets and each parlay leg use the retained canonical sources;
parlay parent readiness is recomputed only after all legs are reviewed. No background polling or
new paid provider lookup was introduced.

Imported persistence and settlement errors are now surfaced through the existing review redirect
instead of being silently discarded. Imported records never write the simulated bankroll ledger.

## 5. Duplicate review

The duplicate endpoint now uses `find_import_duplicates_v2`, which compares sportsbook identity,
time window, stake, odds, event, market, selection, line, and atomic parlay-leg composition. The
warning is advisory: users can view the existing wager, cancel, or import intentionally repeated
external wagers.

## 6. Study and Lab Notes behavior

The server action validates the required Study choice against the user’s current membership or
`No Study — Personal`; client-side visibility is not the authorization boundary. Existing
simulated/imported analytics and All/Simulated/Imported source filters remain the single Lab Notes
projection, with imported records outside virtual bankroll calculations.

## 7. Responsive navigation and tutorial

Desktop navigation spacing and the approved brand lockup sizing were adjusted for 1440px and 1280px
layouts, with the compact icon-only mobile menu preserved. The recorder in
`scripts/record-import-demo.mjs` now drives the real `/track-bet` and `/my-bets` routes at 390x844
using an in-memory synthetic PNG upload and optional authenticated Playwright storage state. It no
longer uses `page.setContent()` or a fake tutorial-only DOM.

The recorder was not completed in this environment because it requires an authenticated storage
state. The existing WebM asset therefore remains the previous artifact and must be regenerated from
the new real-route script before final UAT.

## 8. Database changes

Added the append-only migration
`supabase/migrations/20260929000000_release_candidate_fix_patch_7.sql`:

- forced-RLS `vision_diagnostics` with no ordinary table grants;
- stronger straight/parlay duplicate lookup;
- canonical straight matching with readiness updates;
- bounded straight and parlay reconciliation;
- least-privilege authenticated RPC grants.

Added `supabase/tests/release_candidate_fix_patch_7.sql` for table shape, forced RLS, ordinary-role
grant denial, and RPC grant assertions. `docs/ARCHITECTURE.md` and `docs/MIGRATIONS.md` record the
forward-only decision and Phase 8 boundary.

## 9. Validation

- `npm.cmd run validate`: PASS — 28 Vitest files, 163 tests; format, lint, typecheck, secret scan,
  and production build all pass.
- `npm.cmd audit --audit-level=high`: PASS — 0 vulnerabilities.
- Clean `npm.cmd run db:reset`: PASS — all migrations through Patch 7 replayed and seeded.
- `npm.cmd run db:lint`: PASS — two pre-existing warnings in settlement-test helper functions
  (`leg_number` shadow/unused); no Patch 7 warning or error.
- `npm.cmd run test:db`: PASS — 17 files, 454 pgTAP tests.
- Straight placement concurrency: PASS — one ticket and one debit.
- Straight settlement concurrency: PASS — one return and one economic mutation.
- Parlay placement concurrency: PASS — one two-leg ticket and one debit.
- Parlay settlement concurrency: PASS — one return and two settled legs.
- Vision budget concurrency: PASS — 100 of 120 reservations admitted without exceeding `$5.00`.
- `npm.cmd run check:mobile`: BLOCKED before layout assertions — the local sign-up submit button
  remained disabled. This is an environment/test-harness limitation, not a reported overflow result.

## 10. Security and cost review

- No client bundle contains `OPENAI_API_KEY` or Supabase service-role credentials.
- Diagnostics and budget records are forced RLS; ordinary users cannot read them directly.
- Server-side provider calls are authenticated, budget-reserved, metered, and correlation-tracked.
- Canonical IDs and settlement readiness are rechecked server-side; client event choices cannot
  manufacture authoritative event identity.
- No real-money wagering, deposits, withdrawals, prizes, referral functionality, provider polling,
  purchasable credits, or user-to-user bankroll transfer was added.
- No paid dependency was added and no live paid provider call was made.

## 11. Final gate recommendation

The Patch 7 implementation gate is conditionally ready: code validation, migration replay, direct
database authorization tests, concurrency tests, security scan, audit, and build all pass. Before
calling the release candidate fully ready for UAT, run the real recorder with an authenticated
storage state and regenerate `public/help/import-betslip-demo.webm`, then rerun the mobile smoke
against a functioning local or deployed auth environment at 390x844 and 375x812. Do not begin
Phase 9 from this patch.
