# The Units Lab — Release Candidate Fix Patch 8 Report

Date: 2026-09-18  
Scope: Patch 8 hardening on top of the Patch 7 working tree  
Recommendation: **FAIL release gate pending the remaining authenticated external gates**

## Executive summary

Patch 8 implements the final current release-blocking hardening pass for screenshot import, deterministic event matching, Luna telemetry, odds browsing, NCAA logos, and mobile/responsive release UX.

The Wake Forest regression fixture now parses and preserves:

- football / NCAA football when a unique canonical provider candidate exists;
- `(5) Miami (FL) @ Wake Forest` with Miami/Wake Forest aliases;
- spread selection `Wake Forest` and signed line `+21.5`;
- odds `-129`, stake `$15.00`, and potential payout `$26.70`;
- source wager time `Sep 18 2026 6:35 PM` separately from provider kickoff;
- provider event linkage and automatic-settlement eligibility after a confident match.

The odds browser omits locked/live-only inventory, the four requested NCAA logo regressions resolve through canonical aliases, and the responsive contracts cover sticky navigation, filter overflow, mobile heading scale, and vision-budget metrics.

Automated validation passes. The release recommendation remains FAIL because authenticated mobile smoke testing could not complete in this environment and the Patch 7 authenticated tutorial-video gate remains unavailable. No commit, push, or deployment was performed.

## Implemented scope

### A. Screenshot import and deterministic event matching

- Added deterministic spread-line normalization for forms such as `Point Spread: Wake Forest +21.5`, including positive and negative signs.
- Kept Luna as the first extraction path. Deterministic normalization runs after the single extraction call; no second AI call was added.
- Preserved source ticket time as `wager_date` and stopped using upload/current time as a silent fallback for screenshot/paste imports.
- Kept event kickoff separate: it is populated from the matched canonical provider event only.
- Added canonical team aliases and fuzzy-safe matching for Miami (FL)/Miami Hurricanes and Wake Forest/Wake Forest Demon Deacons, plus the related NCAA logo aliases.
- Added bounded candidate matching with date-window checks, supported competition inference, and explicit matched/ambiguous/unmatched states.
- Added authenticated `/api/import-betslip/match` resolution for the import flow.
- Added shared cached event-catalog discovery through The Odds API event-list endpoint when the existing event catalog does not contain a unique candidate. This path is independent of whether the user recently opened or refreshed the odds page.
- Preserved the safe manual-settlement fallback for unmatched or ambiguous imports.
- Made imported wager timestamps nullable in the application and database path so unknown source time remains unknown and is explained in the review UI.

The provider event catalog uses `/v4/sports/{sport}/events`, which returns event metadata without requiring an odds refresh. The implementation keeps this request behind the existing shared cache/lease architecture and does not turn it into per-user polling. Provider reference: https://the-odds-api.com/liveapi/guides/v4/

### B. Luna telemetry, accounting, and diagnostics

- Connected every Luna attempt to the vision ledger/diagnostics path, including failed attempts.
- Recorded model, attempt/completion timestamps, success/failure, provider status/error category, extraction path, fallback usage, latency, token usage, usage availability, and calculated cost where usage metadata is available.
- Centralized model pricing constants and derived cost from provider usage metadata.
- Represented unavailable usage/cost as unavailable rather than fabricating a zero-cost successful call.
- Made the admin screen distinguish attempts, successful calls, failed calls, last attempt, last success, configured model, monthly spend, average cost, remaining budget, and fallback rate.
- Exposed the configured vision model rather than displaying an empty configured-model value.
- Updated stale fallback wording to describe Luna as the configured first extraction path.
- Kept telemetry completion best-effort: telemetry failure does not block or duplicate wager import.
- Kept unknown-cost reservations budget-safe by retaining the reserved amount until usage is known.

### C. Odds correctness and NCAA logos

- Added display filtering that removes locked selections and live-only games from the bet-selection surface.
- Partially available games retain only selectable markets.
- Games with no selectable markets are omitted.
- Added the requested empty state: `No bets available right now.`
- Kept settlement/scoring data separate from the odds browsing filter.
- Extended canonical NCAA logo resolution for Miami Hurricanes, Wake Forest Demon Deacons, Houston Cougars, and Texas Tech Red Raiders.
- Preserved existing NFL, NHL, EPL, UCL, Europa League, La Liga, and initials-fallback behavior.

### D. Responsive/mobile release UX

- Reduced mobile header vertical whitespace while retaining the existing logo scale.
- Made the top navigation sticky with iPhone safe-area handling and content offset protection.
- Added a narrow-screen heading scale for long competition headings.
- Made bookmaker and market filter rows intentionally horizontally scrollable with scroll padding and no accidental clipping.
- Rebuilt the vision-budget metrics as responsive label/value cards so long currency values do not collide or create page overflow.

## Files changed

Documentation and product records:

- `docs/ARCHITECTURE.md`
- `docs/MIGRATIONS.md`
- `docs/PRODUCT_SPEC.md`
- `RELEASE_CANDIDATE_FIX_PATCH_8_REPORT.md`

Import, matching, and telemetry:

- `src/lib/betslip/extraction.ts`
- `src/lib/betslip/event-matching.ts`
- `src/lib/betslip/canonical-event-discovery.ts`
- `src/lib/betslip/vision.ts`
- `src/lib/betslip/vision-accounting.ts`
- `src/app/api/import-betslip/match/route.ts`
- `src/app/api/import-betslip/vision/route.ts`
- `src/components/import-betslip-form.tsx`
- `src/app/track-bet/actions.ts`
- `src/components/local-date-time.tsx`
- nullable timestamp consumers in `src/app/track-bet/page.tsx`, `src/app/my-bets/page.tsx`, `src/app/page.tsx`, `src/app/leaderboards/page.tsx`, `src/app/performance/page.tsx`, and `src/lib/analytics/calculations.ts`

Provider/cache and odds browsing:

- `src/lib/odds/request.ts`
- `src/lib/odds/provider.ts`
- `src/lib/odds/service.ts`
- `src/lib/odds/server.ts`
- `src/lib/odds/postgres-store.ts`
- `src/lib/odds/normalize.ts`
- `src/lib/odds/display.ts`
- `src/app/sports/[competition]/page.tsx`
- `src/lib/teams/logos.ts`

Admin and responsive UI:

- `src/app/admin/api-usage/page.tsx`
- `src/app/globals.css`

Database and regression coverage:

- `supabase/migrations/20260930000000_release_candidate_fix_patch_8.sql`
- `supabase/tests/release_candidate_fix_patch_8.sql`
- `test/release-candidate-fix-patch-8.test.ts`

## Database changes

Added the forward-only migration `20260930000000_release_candidate_fix_patch_8.sql`.

It:

- permits nullable imported wager timestamps while preserving required manual external-wager timestamps;
- makes timestamp immutability triggers null-safe;
- adds the event-discovery API purpose;
- adds Luna attempt/completion/provider/error/path/fallback/usage/latency telemetry fields;
- makes vision cost nullable when provider usage is unavailable;
- keeps vision budget reservation safe for unknown final cost;
- preserves service-role-only telemetry and settlement operations.

Historical migrations were not rewritten. Clean Phase 0 through Patch 8 replay succeeded.

## Tests added

`test/release-candidate-fix-patch-8.test.ts` covers:

- the Wake Forest ticket fixture;
- positive and negative signed spread lines;
- source ticket timestamp versus event kickoff;
- NCAA sport/competition inference from a unique candidate;
- Miami and Wake Forest aliases;
- ambiguous/unmatched safety behavior;
- event matching without a prior odds-page refresh;
- locked, partially available, and zero-selectable odds behavior;
- the empty odds state contract;
- all four NCAA logo regressions;
- event-catalog quota exemption/shared service contract;
- successful and failed Luna accounting;
- configured model, usage tokens, nonzero derived cost, monthly totals, budget remaining, and unavailable usage;
- sticky header, filter-row overflow, and responsive metric contracts.

`supabase/tests/release_candidate_fix_patch_8.sql` covers the database-side nullable wager timestamp, telemetry columns, event-discovery purpose, forced RLS, ordinary-role privilege boundaries, and service-only function grants.

## Validation results

The complete repository validation run passed:

- `npm run validate`: PASS
- Unit/static tests: **29 files, 176 tests passed**
- TypeScript: PASS
- ESLint: PASS
- Formatting check: PASS
- Production build: PASS; Next.js generated the import matching route and all expected application routes
- Secret/security scan: PASS; no private-key, JWT-like, or populated server-secret assignments found
- Dependency audit: PASS; **0 vulnerabilities** at the configured high-severity threshold
- Clean database migration replay: PASS
- Database lint: PASS, with only the two pre-existing `leg_number` shadow/unused warnings in settlement-test helper functions
- Database authorization/integrity suite: **18 files, 470 tests passed**
- Concurrency suites: PASS for placement, settlement, parlay placement, parlay settlement, and vision-budget admission
- `git diff --check`: PASS

The local mobile smoke command reached the auth page but could not proceed because the signup action was disabled in the available unauthenticated/local environment. This is an environment limitation, not a successful mobile acceptance run.

## Provider and quota implications

Event discovery uses the existing provider abstraction, shared cache, and concurrency lease. The event-list endpoint is represented as a separate `events` request purpose and is quota-exempt from the priced odds-refresh budget according to the provider semantics verified for this implementation. Normal odds refreshes remain quota-controlled. No paid dependency, scheduler, or infrastructure was added.

The matching path is:

`Luna extraction → deterministic normalization → canonical aliases → bounded candidate inference → shared cached event catalog → event-list discovery when needed → canonical provider event attachment → provider-linked settlement`

Any provider failure, ambiguous candidate set, or insufficient confidence remains unmatched/manual rather than forcing a dangerous linkage.

## Known limitations and remaining release gates

1. Authenticated mobile smoke testing still requires a functioning auth environment. The available local run could not create/sign in a test user because the signup control remained disabled.
2. Authenticated tutorial video capture from Patch 7 remains unavailable in this Codex environment.
3. The real production-like Wake Forest screenshot was not exercised end-to-end against authenticated production data here. Its deterministic fixture and database/provider contracts pass, but external provider availability, account configuration, and final mobile rendering still require manual UAT.

These gates must not be marked complete based on the automated results above.

## Gate recommendation

**FAIL for final release at this time.**

Patch 8’s code, database, regression, security, quota, concurrency, and build gates pass. The release remains blocked only by the explicitly carried external gates: authenticated mobile smoke testing and authenticated tutorial video capture, plus the final production-like Wake Forest import observation. No commit, push, or deployment was performed; Patch 7 and Patch 8 remain together in the working tree for review.
