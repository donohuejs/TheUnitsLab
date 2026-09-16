# Phase 7 Completion Report — Parlays

Date: 2026-09-15

## Gate recommendation

**Phase 7 gate: PASS.** The simulated and IRL parlay paths use the existing wager, leg, settlement, bankroll, analytics, authorization, screenshot, and audit boundaries. All applicable Phase 0–7 checks passed, no paid dependency or real-money capability was introduced, and Phase 8 work was not started.

## Work completed

- Added server-authoritative two-to-twelve-leg simulated parlay placement using the existing `bets` and `bet_legs` tables.
- Added a persistent multi-selection simulated bet slip with clear same-event, cross-book, supported-market, and leg-count rules.
- Preserved immutable accepted parent and leg terms while allowing only settlement result evidence to change.
- Added deterministic combined-odds, potential-return, effective-settlement, and exact fixed-precision calculations.
- Added per-leg open/won/lost/push/void state, durable final-score evidence, and deterministic parlay settlement.
- Added service-only documented leg voiding and idempotent/concurrency-safe parlay settlement.
- Added normalized external/IRL parlay legs, repeatable Track Bet entry, ticket-level result plus complete leg-result corrections, append-only correction evidence, and existing private screenshot handling.
- Added parlay detail to My Bets and external history, including each leg, original/effective odds, status, and final economics.
- Extended the canonical Phase 6 analytics projection and Performance breakdown with straight versus parlay and deterministic mixed dimensions.
- Added direct authorization/integrity assertions, pure calculation tests, migration-structure tests, and dedicated placement/settlement concurrency suites.
- Updated the architecture, ERD, migration, testing, cost/quota, product-spec, README, and Phase 7 plan documentation.

## Files created or modified

- Database: `supabase/migrations/20260917100000_phase_7_parlay_market_type.sql`, `supabase/migrations/20260918000000_phase_7_parlays.sql`.
- Database tests: `supabase/tests/phase_7_parlays.sql`.
- Application: simulated parlay actions/slip, My Bets, score settlement dispatch, Track Bet actions/page, external parlay form/result form, Performance breakdown, parlay calculation helpers, styles, and Vitest configuration.
- Tests: `test/parlay-calculations.test.ts`, `test/migration-foundation.test.ts`, `test/phase7-parlay-placement-concurrency.mjs`, `test/phase7-parlay-settlement-concurrency.mjs`.
- Documentation: `docs/PHASE_7_PLAN.md`, updated architecture/ERD/migration/testing/cost/product/README documents, and this report.
- `package.json` now exposes the two Phase 7 concurrency commands.

## Database changes

- Added the `parlay` market enum value before the parlay schema migration.
- Extended simulated and external parents with ticket type, constrained leg count, and original/effective settlement economics.
- Extended simulated legs with immutable accepted terms plus mutable result time and final-score evidence.
- Added `public.external_wager_legs` with forced RLS, normalized immutable terms, current result, and parent ownership through a foreign key.
- Added atomic `place_simulated_parlay_bet`, service-only `settle_simulated_parlay_bet`, service-only `void_simulated_parlay_leg`, `create_external_parlay`, and `set_external_parlay_result` functions.
- Replaced the canonical analytics function with one current row per parent ticket across simulated and external straight/parlay sources.
- Preserved historical straight data with non-destructive backfills (`leg_count = 1` and existing economics/results).
- Retained least-privilege grants, forced RLS, append-only ledger/audit constraints, and private screenshot policies.

## Domain rules chosen

- Simulated parlays contain 2–12 legs, one bookmaker, and distinct provider events. Same-event combinations are rejected because the current provider model cannot reliably price correlation; cross-book combinations are rejected because they are not one sportsbook ticket. Only the existing moneyline (including soccer draw), spread, and total markets are accepted.
- Every leg is revalidated against fresh cached odds at submission. Client combined odds, payout, and profit are ignored. Accepted odds, line, bookmaker, event, and market terms are snapshotted exactly.
- Placement creates one parent, all immutable legs, one stake debit, and one ledger transaction atomically under the existing per-user advisory lock.
- Settlement waits for every non-void leg to have a durable final score. A known loss does not finalize early; this keeps per-leg evidence complete and provider-safe.
- Any lost leg makes the completed parlay lost. All active legs must win for a win. Losing parlays receive no return credit.
- Push and void legs use the neutral effective multiplier `1.0000` and are excluded from effective odds. A void leg is service-confirmed rather than inferred from uncertain provider data.
- If every leg is void, the ticket is `void`. If no active leg remains and at least one leg pushed, the ticket is `push`. Both return the original stake exactly once and produce zero profit.
- Effective odds and final profit/return are persisted separately from original submitted potential economics.
- External parlays use one parent and normalized legs, are manually settled with a complete leg-result payload, and corrections update current state while appending before/after audit JSON. This is ticket-level manual correction with internally consistent leg states; external records never touch the virtual bankroll.
- Uniform sport/competition dimensions retain their value. Mixed values are classified as `mixed` / `Mixed competitions`; mixed parlays remain in overall analytics and are not assigned arbitrarily to a single sport or competition leaderboard.

## Fixed precision and rounding

- Canonical accepted leg and parent decimal odds are PostgreSQL `numeric(12,4)` / four-place TypeScript strings.
- Odds are multiplied without intermediate rounding and rounded once to four places using PostgreSQL numeric half-away-from-zero behavior (the TypeScript preview uses exact BigInt half-up for positive values, which is equivalent here).
- Stake profit and return are rounded once to `numeric(14,2)` after the canonical four-place effective price is known.
- American odds are derived from the canonical four-place decimal value using the existing integer half-away-from-zero conversion. No JavaScript binary floating point is persisted or used as the source of truth.

## Validation results

- `npm.cmd run validate`: PASS — formatting, ESLint, TypeScript, production build, and **73/73 Vitest tests**.
- `npm.cmd run test:coverage`: PASS — **73/73 tests**, 92.08% statements, 82.65% branches, 97.36% functions, 94.89% lines.
- `npm.cmd run test:db`: PASS — **7 SQL files, 284/284 pgTAP assertions** (215 existing Phase 0–6 assertions plus 69 Phase 7 assertions).
- `npm.cmd run db:reset`: PASS — clean replay of all ordered Phase 0–7 migrations from an empty local database.
- `npm.cmd run db:lint`: PASS — no schema errors or warnings.
- Existing straight placement concurrency: PASS — one 7,500-unit request succeeds, one fails, one debit, 2,500-unit balance.
- Existing straight settlement concurrency: PASS — one success, one `already_settled`, one 25-unit return credit, 10,015-unit balance.
- Phase 7 placement concurrency: PASS — one two-leg ticket, one debit, 2,500-unit balance from two concurrent 7,500-unit requests.
- Phase 7 settlement concurrency: PASS — one success, one `already_settled`, two won legs, one 50-unit return credit, 10,040-unit balance.
- HTTP smoke: PASS — root, auth, sports, Track Bet, Performance, My Bets, and Leaderboards rendered successfully (protected pages redirected to auth as expected).
- Dependency audit: PASS — `npm audit --audit-level=high` found 0 vulnerabilities.
- Secret scan: PASS — only documented `.env.example` placeholders were present.

## Security and authorization

New parent/leg reads and mutation paths derive identity from `auth.uid()`, enforce current group membership, use fixed search paths, and retain forced RLS. Browser roles cannot directly insert/update/delete tickets, accepted leg terms, effective economics, ledger entries, settlement audits, or external legs. Settlement and simulated leg voiding are service-role-only. Anonymous and nonmember denial, private group visibility, immutable terms, and screenshot access controls passed direct database assertions.

## API cost and real-money boundary

No live provider calls or quota were consumed for Phase 7. Placement reads the existing odds cache; score settlement reuses the existing bounded score path. No paid queue, scheduler, analytics service, storage service, odds service, or other paid dependency was introduced. The product remains virtual-unit and statistics-only: external parlays are records of wagers made elsewhere and cannot fund or change the virtual bankroll.

## Deviations and clarifications

The governing specification does not define correlation pricing for same-event combinations, all-neutral result precedence, or whether a known loss settles before other legs. Phase 7 records the explicit clarifications above: reject same-event/cross-book simulated parlays, wait for all non-void finals, use all-void `void` and push/void-only `push`, and treat void as a neutral price. External parent legacy sport/competition columns retain the first leg for foreign-key compatibility; normalized legs are authoritative and analytics derives the documented mixed classification. No governing requirement was silently removed.

## Remaining issues

1. Successful live-provider validation with real provider credentials remains pending, unchanged from Phase 6.
2. A zero-cost production score/settlement scheduling strategy remains unresolved, unchanged from Phase 6. Phase 7 does not add paid scheduling or claim production automation beyond the existing bounded endpoint.

These are documented nonblocking issues and do not change the Phase 7 gate recommendation.

## Stop condition

Phase 7 is complete and validated. Work stops here; Phase 8 product-polish work has not begun.
