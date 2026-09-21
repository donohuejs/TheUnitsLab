# Phase 3 Simulated Straight Bets Plan

## Outcome and boundary

Phase 3 delivers the first complete simulated-wager workflow: an authenticated user selects one supported cached outcome, enters a virtual-unit stake, submits a straight ticket, receives an atomic bankroll debit, and can reconstruct the accepted ticket from durable snapshot data. Work stops at the Phase 3 gate.

Phase 3 does not add parlays, live wagering, scores, polling, grading, settlement, winnings or push credits, external wagers, uploads, analytics, leaderboards, or social behavior.

## Phase 2 gate closure status

On 2026-09-12, the process, user, and machine environments contained neither `THE_ODDS_API_KEY` nor `SUPABASE_SERVICE_ROLE_KEY`, and the repository contained no populated local environment file. A live provider request therefore remains unavailable and will not be fabricated. Phase 3 will use the already validated Phase 2 normalized-cache boundary without redesigning provider ingestion.

## Decisions and assumptions

- The governing recommendation is adopted for Phase 3: every user receives exactly 10,000.00 virtual units. The UI uses the term **units** and explicitly labels all wagers as simulated.
- Unit values use PostgreSQL `numeric(14,2)`. Stakes must be positive, use no more than two fractional digits, and fit the column range. Potential profit and return round to two decimals with PostgreSQL/decimal half-away-from-zero behavior for positive values.
- Accepted decimal odds are stored to four decimal places. American odds must be integral and at least `+100` or at most `-100`.
- Bet placement requires a non-expired Phase 2 shared-cache row and a scheduled start later than the database transaction time. It does not refresh the provider. This keeps placement deterministic and adds no Odds API consumption.
- The browser submits only selection identifiers, requested stake, optional group ID, and the line/price the user saw. A security-definer database function derives the caller from `auth.uid()`, resolves trusted event and market data from the current cache, and rejects changed terms explicitly.
- Phase 3 persists one `bets` row and one `bet_legs` row. The one-to-many relationship is retained so Phase 7 can add multiple legs without destructive schema changes, but the Phase 3 function always creates exactly one leg and `ticket_type = straight`.
- The ledger is authoritative. A transaction-scoped PostgreSQL advisory lock serializes bankroll-changing operations per user, balance is calculated from ledger entries while that lock is held, and a unique bet-linked stake transaction prevents duplicate debits.
- An idempotent initial-allocation function and migration backfill give existing profiles one
  allocation only. The original profile-insert trigger was later superseded by the v0.12.1 auth
  onboarding lifecycle migration so unconfirmed Auth users do not receive permanent bankroll state;
  authenticated application bootstrap now invokes the same canonical function. A partial unique index
  enforces the rule during retries and races.
- `group_id` is nullable. When supplied, the placement function verifies current membership and stores the association on the ticket.
- Ordinary users receive read-only access to their own ticket, leg, and ledger records. They receive no direct insert, update, or delete grants. All new exposed tables enable and force Row Level Security.

## Implementation sequence

1. Add the ordered Phase 3 migration with exact numeric types, ticket and leg snapshots, the bankroll ledger, allocation/backfill, immutability protections, forced RLS, least-privilege grants, and the atomic placement function.
2. Add deterministic exact-arithmetic utilities and tests for American/decimal conversion, payout calculation, validation, and rounding.
3. Add a server action that reauthenticates, validates untrusted form data, calls the atomic database function through the authenticated client, and returns explicit stale-price or validation feedback.
4. Integrate selectable outcomes and a one-selection bet slip into the competition odds page without adding refreshes or polling.
5. Add the authenticated My Bets page showing available bankroll, open tickets, and history reconstructed only from persisted ticket and leg snapshots.
6. Add provider-independent wager-selection tests plus pgTAP authorization, allocation, atomicity, immutability, group, stale-price, and cache-independence tests. Add a real concurrent-submission validation against the local database.
7. Update architecture, ERD, migration, testing, cost/quota, setup, and phase-status documentation.
8. Run formatting, lint, TypeScript, unit/integration tests, database tests, clean migration replay, database lint, production build, dependency audit, secret scan, and HTTP smoke tests. Produce `PHASE_3_COMPLETION_REPORT.md` and stop.

## Gate evidence

The gate passes only if validation proves that a supported straight wager is built from trusted fresh cache data, persists immutable accepted terms, debits the stake exactly once, reconciles to the ledger, cannot overspend under concurrent requests, rejects unauthorized direct access and invalid groups, and reconstructs unchanged after current cache mutation or expiry. Any failed condition produces a **NOT PASSED** recommendation.
