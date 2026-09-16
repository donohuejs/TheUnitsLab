# Phase 3 Completion Report

Date: 2026-09-13  
Gate recommendation: **Passed**

## Gate conclusion

Phase 3 completes the simulated straight-wager vertical flow. An authenticated caller selects a supported current cached outcome, the server-authoritative database function validates the caller, optional group, event, market, outcome, displayed line and price, start time, stake, and available ledger balance, then atomically creates one ticket, one immutable leg snapshot, and one exact stake debit.

The Phase 3 gate is **passed**. Direct database tests persist supported moneyline, soccer draw, spread, and total wagers; verify exact ticket and ledger values; mutate and expire the current odds cache; and reconstruct the original accepted odds and line from the durable leg. A separate real concurrent test submits two simultaneous 7,500-unit wagers against a 10,000-unit balance and produces one success, one insufficient-bankroll failure, one ticket, one debit, and a 2,500-unit balance.

No Phase 4 or later behavior was introduced.

## Work completed

- Added a one-selection simulated bet slip to the existing Phase 2 competition pages with sport, competition, event, teams, start, bookmaker, market, selection, line, American and decimal odds, virtual-unit stake, potential profit, and potential return.
- Added exact client display calculations and server/database authoritative calculation and validation. The browser supplies identifiers, requested stake, and displayed terms; it cannot supply an authoritative user, payout, bankroll, or persisted snapshot.
- Added explicit odds-changed and expired-cache failures. Placement never silently accepts changed terms and never refreshes the provider.
- Added immutable normalized `bets` and `bet_legs` records. Phase 3 creates one leg, while the one-to-many structure remains compatible with Phase 7 without enabling parlays.
- Added the authoritative append-only virtual-bankroll ledger, a 10,000.00-unit initial allocation, idempotent existing-user backfill, and future-profile allocation trigger.
- Added one PostgreSQL transaction for ticket, leg, and stake creation. A transaction-scoped advisory lock serializes bankroll-changing requests per user before the ledger sum is checked.
- Added nullable group association with a locked current-membership check during placement.
- Added the authenticated My Bets open/history page. Every ticket renders from persisted snapshots, never current provider cache data.
- Added forced Row Level Security, read-only own-record policies, no direct client mutations, immutable snapshot triggers, and append-only ledger protection.

## Files created or modified

Created:

- `docs/PHASE_3_PLAN.md`
- `supabase/migrations/20260914000000_phase_3_simulated_straight_bets.sql`
- `supabase/tests/phase_3_wagers_authorization.sql`
- `src/lib/wagers/calculations.ts`
- `src/lib/wagers/selection.ts`
- `src/components/bet-slip.tsx`
- `src/app/sports/bet-actions.ts`
- `src/app/my-bets/page.tsx`
- `test/wager-calculations.test.ts`
- `test/wager-selection.test.ts`
- `test/phase3-concurrency.mjs`
- `PHASE_3_COMPLETION_REPORT.md`

Modified:

- `PHASE_2_COMPLETION_REPORT.md`
- `README.md`, `package.json`, `vitest.config.ts`
- `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_ERD.md`
- `docs/MIGRATIONS.md`, `docs/TESTING.md`, `docs/COST_AND_QUOTA.md`
- `src/lib/odds/normalize.ts`
- `src/app/page.tsx`, `src/app/account/page.tsx`, `src/app/globals.css`
- `src/app/sports/page.tsx`, `src/app/sports/[competition]/page.tsx`
- `test/migration-foundation.test.ts`

## Database changes and migration

Migration `20260914000000_phase_3_simulated_straight_bets.sql` adds:

- Enums for wager source, ticket type, ticket status, supported Phase 3 market and selection values, and bankroll transaction concepts.
- `public.bets`: ticket-level accepted economics, source, straight type, optional group, status, and timestamps.
- `public.bet_legs`: immutable accepted event, bookmaker, market, selection, line, odds, and timing snapshot.
- `public.bankroll_ledger`: append-only exact movements with unique idempotency keys.
- A partial unique index allowing one initial allocation per user and a unique bet/transaction-type index allowing one stake debit per ticket.
- Existing-profile backfill and a profile-insert trigger for future allocations. Both call the same conflict-safe allocation function.
- Snapshot and ledger mutation triggers, forced RLS, own-record select policies, read-only grants, and narrowly granted authenticated functions.
- `public.place_simulated_straight_bet`, which derives `auth.uid()`, validates trusted fresh cache data and group membership, locks per user, calculates the ledger balance and payout, and performs all three inserts atomically.

No mutable balance column was added. Current balance remains the exact ledger sum.

## Precision and rounding

- Stakes and all unit amounts use `numeric(14,2)` and must be positive for placement.
- Accepted decimal odds use `numeric(12,4)`; accepted American odds are integral and at least `+100` or at most `-100`.
- Potential profit is `round(stake × (decimal odds - 1), 2)` using exact decimal arithmetic; potential return is stake plus rounded potential profit.
- Browser display utilities use integer minor units and scaled decimal odds rather than binary floating-point payout calculations.
- `+150` at 10 units yields 15.00 profit and 25.00 return. `-200` at 10 units yields 5.00 profit and 15.00 return.
- Potential winnings are not credited in Phase 3.

## Tests added

Vitest adds coverage for:

- Positive and negative American-to-decimal conversion.
- Decimal-to-American conversion.
- Exact potential profit and return.
- Fractional hundredth-unit stakes and half-up rounding.
- Invalid odds and zero, negative, or over-precise stakes.
- Valid moneyline, soccer draw, spread, and total selection shapes.
- Invalid selection/line shapes and exact outcome lookup.

The Phase 3 pgTAP suite covers:

- Forced RLS on all three tables.
- Initial allocation exactly once under repeated initialization.
- Valid moneyline, soccer draw, spread, and total placement.
- Correct ticket/leg/debit counts, fractional stake totals, balance reconciliation, profit, and return.
- Unsupported markets, invalid selections/outcomes, changed odds, changed lines, zero/negative stake, insufficient bankroll, and invalid groups.
- Failed wager means no ticket and no debit.
- No fabricated credits, no direct ticket creation for another user, no own or cross-user ticket/ledger mutation, and private read isolation.
- Reconstruction of original odds and line after current cache mutation and expiry.
- Rejection of a new wager against expired cache data.

The concurrency integration test creates an isolated synthetic user and cache row, sends two simultaneous authenticated RPC requests, checks the durable result through the privileged local test client, and removes its records.

## Exact validation commands and results

- `npm.cmd run validate`: passed the complete formatting, lint, TypeScript, unit-test, and production-build chain.
- `npm.cmd run format:check`: passed; all files matched Prettier.
- `npm.cmd run lint`: passed with zero warnings or errors.
- `npm.cmd run typecheck`: passed with no TypeScript errors.
- `npm.cmd run test`: passed, 6 files and 33 tests.
- `npm.cmd run test:coverage`: passed, 6 files and 33 tests; configured scope reported 91.86% statements, 83.33% branches, 90.47% functions, and 96% lines.
- `npm.cmd run build`: passed; Next.js 16.3.5 production compilation, TypeScript, page-data collection, and all eight routes completed.
- `npm.cmd run db:reset`: passed clean replay of all four ordered migrations and the seed file.
- `npm.cmd run db:lint`: passed with no errors in `app_private`, `extensions`, or `public`.
- `npm.cmd run test:db`: passed 79 assertions across Phase 1, Phase 2, and Phase 3.
- `npm.cmd run test:db:concurrency`: passed; two concurrent 7,500-unit requests produced one ticket, one debit, and a 2,500-unit balance.
- `npm.cmd audit --audit-level=high`: passed with 0 vulnerabilities.
- Credential scan: 0 JWT-like files, 0 public-prefixed provider/service-secret aliases, and 0 populated environment files. Provider and service-role references remain confined to server environment readers and server-only modules.
- HTTP smoke against the existing local development server: `/` returned 200, `/auth` returned 200, and unauthenticated `/sports` and `/my-bets` returned 307 to `/auth`.

The local Supabase commands required their normal user-level configuration and Docker access. The first sandboxed attempts failed only because telemetry configuration was outside the workspace; the approved reruns completed successfully.

## Authorization results

- Users may select only their own tickets, legs, and ledger entries through forced RLS.
- Authenticated clients have no direct insert, update, or delete grant on Phase 3 tables.
- The placement function contains no user-ID parameter and derives ownership only from `auth.uid()`.
- User A cannot create a ticket for User B, read User B's private rows, update User B's wager, or update User B's ledger.
- Ordinary users cannot manufacture an initial allocation, administrative adjustment, winnings credit, or stake entry.
- Accepted ticket economics and all leg terms are immutable. The ledger rejects update and delete operations.
- Optional groups are validated against a locked current membership row; arbitrary group IDs fail.

## Bankroll and concurrency validation

- Repeated initialization returns the same 10,000.00 balance and leaves one allocation row.
- Four accepted fractional-stake test tickets create four exact debits and reconcile to 9,975.00 units.
- Validation and insufficient-funds failures create neither a ticket nor a stake entry.
- The placement operation locks on the authenticated user for the transaction, derives balance from ledger rows, rejects a stake above the remaining balance, and inserts the ticket, leg, and debit before commit.
- Two real simultaneous 7,500-unit requests cannot both spend the same 10,000-unit balance.

## API cost implications

Phase 3 adds no provider endpoint, polling, background loop, per-user call, or per-bet refresh. Competition rendering continues through the canonical Phase 2 shared cache. Database placement requires a non-expired cache row and never calls the provider; expired odds require an explicit existing Phase 2 refresh and user review. Expected Odds API consumption and the $0 monthly architecture are unchanged.

## Security implications

- Authentication is rechecked in the Server Action and again by `auth.uid()` inside the database function.
- Economics and snapshot values come from server-side normalized cache data, not browser-supplied payout or bankroll fields.
- The line and price shown to the user are comparison values only; a mismatch fails explicitly.
- Per-user transaction locking prevents time-of-check/time-of-use overspending.
- Provider and service-role credentials remain in `server-only` modules, are not rendered, and are not logged.
- All new exposed tables enable and force RLS. Privileged mutation is limited to narrow security-definer functions with an empty search path.

## Phase 2 live-validation status

Live-provider validation remains **pending and not claimed**. Before Phase 3 implementation, credential presence was checked at process, user, and machine scope. Neither `THE_ODDS_API_KEY` nor `SUPABASE_SERVICE_ROLE_KEY` was available, and the repository had no populated local environment file. No live request was made and no provider quota was consumed. `PHASE_2_COMPLETION_REPORT.md` records the repeated check.

The deterministic Phase 2 normalization, quota parsing, cache write, ledger, cache-hit, and concurrent coalescing tests remain passing. When both server-side credentials become available, the bounded one-request live smoke and immediate cached repeat remain the only unclosed Phase 2 operational validation item.

## Remaining issues

- The Phase 2 live-provider smoke remains pending the two required server-side credentials.
- Phase 4 must define and implement grading, score ingestion, settlement audit, and winning/push credits. None exists in Phase 3.
- Administrative-adjustment authorization and UI remain deferred because application-wide administrator identity is still unresolved. The ledger enum anticipates the concept, but ordinary users have no insertion path.
- Wager cancellation and bankroll reset behavior remain unresolved and unimplemented.

## Deviations from the governing specification

There is no conflict with the governing source. The explicit Phase 3 instruction resolves the previously recommended initial bankroll and previously unspecified placement precision/concurrency subset as follows: 10,000 virtual units, hundredth-unit stakes, four-place decimal odds, two-place payout rounding, fresh-cache-only placement, and per-user transaction locking.

The governing source's broader support for parlays remains deferred to Phase 7 under the approved clarification. The schema is extensible through `bets` and `bet_legs`, but Phase 3 exposes no multi-leg behavior. No real-money, live wagering, scores, settlement, external wagers, uploads, analytics, leaderboards, social feed, or screenshot intelligence was added.

## Phase 3 gate recommendation

**PASS.** The evidence verifies every required gate condition:

1. Accepted odds and line data are immutable ticket snapshots.
2. Each accepted stake is debited exactly once.
3. The authoritative ledger reconciles exactly.
4. Concurrent submissions cannot overspend.
5. Unauthorized direct access and mutation are rejected.
6. Current odds mutation and expiry do not alter historical reconstruction.
7. No Phase 4+ functionality was introduced.

Stop here. Do not begin Phase 4 until this report and gate are reviewed and Phase 4 is explicitly authorized.
