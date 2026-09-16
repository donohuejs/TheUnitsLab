# The Units Lab — Release Candidate UX Patch 3 Completion Report

Date: 2026-09-16  
Gate: Release Candidate UX Patch 3  
Recommendation: **PASS**  
Phase 9: **Not started**

## Outcome

Patch 3 is implemented as a forward-only release-candidate UX and data-boundary patch. The product now presents the requested The Units Lab brand, uses Vials in user-facing simulated values, treats imported bets as first-class records in My Bets, preserves source-dollar values, and keeps imported wagers outside the simulated bankroll.

The requested source clarification is recorded in `docs/PRODUCT_SPEC.md` and bounded in `docs/ARCHITECTURE.md`. Existing database column and function names containing `units` remain internal compatibility names; the user-facing alias is Vials.

## Work completed

### Brand and navigation

- Added reusable full and compact inline SVG brand lockups in `src/components/brand.tsx` and a static `src/app/icon.svg`.
- Applied the name **The Units Lab** and subtitle **Experiment | Analyze | Improve** across the shell and landing experience.
- Removed the former Bet Smarter language and the primary simulated-sportsbook framing.
- Added `Welcome back, {first/display name}` with `Scientist` fallback. Email addresses are not used in the greeting, and the greeting has no Member label.
- Renamed the navigation action and route to **Import Betslip** while retaining a compatibility `/track-bet` entry point.

### Vials and normalized display

- Added the exact disclosure: `1 Vial = $1 USD`.
- Normalized Vial display through fixed two-decimal minor-unit helpers in `src/lib/vials.ts`.
- Kept source stake and return/payout as raw two-decimal dollar fields on imported records.
- Updated home, bet slip, My Bets, performance, leaderboards, account, sports, and admin-facing copy to use Vials where values are shown to users.

### Unified My Bets ledger

- Reworked `src/app/my-bets/page.tsx` into a single owner-scoped ledger for simulated and imported records.
- Added All, Open, Settled, Simulated, and Imported filters.
- Added source badges such as `Simulated` and `Imported · FanDuel`.
- Imported cards retain source-dollar stake/return separately from normalized Vials and display match state, match reason, settlement method, and imported parlay legs.
- Existing group/privacy boundaries remain enforced by database authorization; other users' raw source-dollar values are not exposed through the owner ledger.

### Import Betslip

- Added Upload Screenshot, Paste Bet Text, and Enter Manually paths.
- Every path follows input → editable draft → review → explicit confirm/save → My Bets.
- Straight and parlay imports normalize sportsbook, sport/competition, event/matchup, selection, market, line, odds, stake, payout, ticket type, legs, wager date, and sportsbook bet ID.
- Screenshot files are validated, stored in the existing private bucket, and never made public.
- The safe behavior when OCR is unavailable is intentionally preserved: no fabricated extraction is performed. The uploaded image remains private and the user enters or corrects the editable normalized draft.
- Duplicate preflight checks use sportsbook bet ID, content hash, sportsbook/time/stake/odds, event text, and parlay-leg context. Warnings provide View existing, Cancel, and Import anyway actions.

### Matching, settlement, and auditability

- Added match states: matched, partially matched, unmatched, and needs review, with durable reasons.
- Added deterministic imported straight settlement for supported moneyline, spread, total, and soccer three-way selections when canonical final scores and grading keys are available.
- Added imported-parlay persistence with per-leg event IDs, grading sides, match state, and deterministic automatic settlement when every leg is matchable and final.
- Added explicit manual settlement with a required reason for unsupported markets, ambiguous matches, missing grading detail, or unavailable final scores.
- Imported settlement writes result audits and never writes to the simulated bankroll ledger.
- Settlement functions lock the owned wager, return harmlessly when already settled, and preserve raw source-dollar return values.

### Analytics and settings

- Performance and leaderboard source filters now present All, Simulated, and Imported labels while continuing to use normalized values for calculations.
- Imported raw dollar details are kept out of shared ranking detail.
- Added the exact Settings simulation disclosure and removed the primary simulated-sportsbook label from the sports experience.

## Files changed

### Product and release documentation

- `README.md`
- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/MIGRATIONS.md`
- `docs/TESTING.md`
- `RELEASE_CANDIDATE_UX_PATCH_3_REPORT.md`

### Application and UI

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/account/page.tsx`
- `src/app/admin/settlement-tests/page.tsx`
- `src/app/globals.css`
- `src/app/icon.svg`
- `src/app/leaderboards/page.tsx`
- `src/app/my-bets/page.tsx`
- `src/app/performance/page.tsx`
- `src/app/sports/page.tsx`
- `src/app/sports/bet-actions.ts`
- `src/app/track-bet/actions.ts`
- `src/app/track-bet/loading.tsx`
- `src/app/track-bet/page.tsx`
- `src/app/api/import-betslip/duplicates/route.ts`
- `src/app/import-betslip/page.tsx`
- `src/app/import-betslip/loading.tsx`
- `src/components/app-nav.tsx`
- `src/components/bet-slip.tsx`
- `src/components/brand.tsx`
- `src/components/external-parlay-form.tsx`
- `src/components/import-betslip-form.tsx`
- `src/components/status-badge.tsx`
- `src/lib/navigation.ts`
- `src/lib/ui.ts`
- `src/lib/vials.ts`

### Database and tests

- `supabase/migrations/20260922000000_release_candidate_ux_patch_3.sql`
- `supabase/tests/release_candidate_ux_patch_3.sql`
- `test/release-candidate-ux-patch-3.test.ts`
- `test/ui-polish.test.ts`

## Database changes

The Patch 3 migration adds raw-dollar provenance, import method, sportsbook bet ID, content hash, provider event IDs, normalized selection keys, match state/reason, settlement method, manual reason, and per-leg matching fields. It adds owner-scoped duplicate lookup, reviewed import-save functions, imported matching, imported straight/parlay settlement, and manual-result functions. RLS remains enabled and forced for exposed external-wager tables; new RPCs are granted to authenticated users only.

The migration is forward-only and replayed successfully from a clean local database. No paid dependency, provider secret, service-role credential, real-money wagering path, bankroll transfer, or Phase 9 work was added.

## Validation results

| Check                                   | Result                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run validate`                  | PASS — format, lint, typecheck, 17 Vitest files / 108 tests, secret scan, production build                           |
| `npm.cmd audit --audit-level=high`      | PASS — 0 vulnerabilities                                                                                             |
| Clean `npm.cmd run db:reset`            | PASS — all migrations through Patch 3 replayed                                                                       |
| `npm.cmd run db:lint`                   | PASS exit code; only Supabase extension-helper diagnostics and two known pre-existing admin-function warnings remain |
| `npm.cmd run test:db`                   | PASS — 10 files / 337 assertions                                                                                     |
| Simulated placement concurrency         | PASS — one accepted 7,500-unit request, one debit, 2,500-unit balance                                                |
| Straight settlement concurrency         | PASS — one 25.00-unit return credit, 10,015.00-unit balance                                                          |
| Simulated parlay placement concurrency  | PASS — one accepted two-leg ticket, one debit, 2,500-unit balance                                                    |
| Simulated parlay settlement concurrency | PASS — one 50.00-unit return credit, two won legs, 10,040.00-unit balance                                            |

## Remaining issues and intentional limitations

- Screenshot OCR is not enabled because a safe, dependency-free OCR path is not available within the free-tier constraint. The product does not pretend to parse an image; users receive an editable draft workflow and can enter normalized values manually.
- Production provider smoke testing remains dependent on configured provider credentials and live event availability. Local deterministic score fixtures cover matching and settlement behavior.
- Database lint still reports existing Supabase extension-helper diagnostics and the two pre-existing `leg_number` warnings in admin test functions. Patch 3 introduces no new lint warning.
- Screenshot retention/deletion policy and production moderation/abuse controls remain operational follow-ups; the current bucket is private and owner-scoped.

## Gate recommendation

**PASS.** The requested release-candidate UX, terminology, imported-ledger behavior, raw-dollar preservation, duplicate workflow, matching/settlement boundaries, privacy protections, and regression coverage are implemented. The documented OCR and live-provider limitations are intentional and do not fabricate behavior or alter the product's simulated-only safety boundary.
