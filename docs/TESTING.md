# Testing Strategy

## Test layers

- Pure unit tests: typed configuration now; American odds, payouts, supported straight-market grading, and exact parlay combination/effective-payout calculations.
- Database integration tests: constraints, transactions, RLS, direct unauthorized reads and writes, ledger idempotency, and duplicate-credit prevention against local Supabase.
- Provider contract tests: checked-in, redacted fixtures for normalization, quota headers, missing bookmakers, and unavailable markets. Default tests never call The Odds API.
- End-to-end tests: one vertical gate per product phase after a UI and database workflow exists.
- Reconciliation tests: Phase 6 analytics and leaderboards must equal underlying settled wagers.

## Phase ownership

- Phase 0 proves Vitest, environment parsing, and sports/provider validation.
- Phase 1 adds a pgTAP database/RLS suite using synthetic User A, User B, a separate group owner, and Group A. It changes JWT claims and roles directly to test own-profile access, cross-user denial, member and nonmember reads, direct membership denial, self-promotion denial, authorized owner actions, invite redemption, single-use enforcement, and anonymous denial.
- Phase 2 adds provider fixtures, cache coalescing, quota capture, and conservation-state tests.
- Phase 2's cache acceptance test concurrently represents User A and User B through separate callers against one shared store. It proves one initial upstream call and ledger row, zero additional calls while fresh, and exactly one additional call after expiry. The database suite separately proves both authenticated identities read the same cache row while neither can mutate cache, ledger, or lease state.
- Phase 3 adds odds conversion, payout, immutable straight-ticket reconstruction, and bankroll debit tests.
- Phase 3 also adds direct pgTAP coverage for supported and invalid markets, stale prices, invalid stakes, insufficient funds, group authorization, failed-operation atomicity, ledger reconciliation, forced RLS, immutable records, and reconstruction after cache mutation. A separate local integration test sends two simultaneous 7,500-unit RPC requests against one 10,000-unit bankroll and requires exactly one ticket and debit.
- Phase 4 adds moneyline, soccer draw, spread, total, push, void, correction-policy, and settlement-idempotency tests for straight wagers.
- Phase 4 provider fixtures also cover normalized live/final state, team-oriented scores, timestamps, missing-final-score rejection, canonical requests, shared refresh coalescing, state-sensitive TTLs, and quota priority. pgTAP covers stored-return credits, loss, push, documented void, durable audits, association mismatch, forced RLS, immutable finals, and retry safety. A separate two-client integration test proves concurrent settlement creates one economic credit.
- Phase 5 adds exact IRL result and summary tests plus direct pgTAP coverage for valid and invalid creation, owner-only result entry, group/private visibility, calculated profit/loss, append-only correction evidence, private screenshot upload/read/attachment policies, source filtering, and zero virtual-bankroll side effects across creation, win, loss, push, void, and correction.
- Phase 6 adds exact integer-based analytics/ranking tests and an independently expected mixed-source fixture covering open/win/loss/push/void results, corrected IRL results, all dimensions, source/time filters, timezone boundaries, precision, ties, and five-wager eligibility. pgTAP independently reconciles canonical RPC rows to authoritative records and proves caller-derived personal access, member-only group access, anonymous/nonmember denial, no email fields, no unrestricted projection access, correction audit preservation, and zero bankroll mutation.
- Phase 7 adds server-authoritative two-to-twelve-leg placement tests (freshness, supported market coverage, same-event/cross-book rejection, immutable snapshots, one debit, manipulated-price rejection), deterministic win/loss/push/void combinations, adjusted payouts, deferred open legs, external parlay creation/correction, mixed-sport analytics, and direct anonymous/nonmember authorization assertions. Parlays are tested as one wager in aggregate analytics and leaderboard sample thresholds.
- Phase 8 adds focused presentation-contract tests for the shared navigation order and explicit source, ticket-type, result, and market labels. Manual review covers desktop/mobile layout, keyboard focus, semantic form labels, non-color status text, deliberate empty/error/loading states, and admin-link visibility; database and provider tests remain the authoritative regression gates.

## Commands and fixtures

`npm run validate` runs formatting, linting, type checking, unit tests, and a production build without requiring Docker. `npm run test:coverage` is available for focused coverage review.

`npm run security:scan` performs a dependency-free repository scan for private-key material,
JWT-like values, and populated server-secret assignments. `.env.example` is intentionally excluded;
real local environment files are scanned and must never be committed.

Phase 1 database validation requires the local Supabase stack:

```powershell
npm run supabase:start
npm run db:reset
npm run db:lint
npm run test:db
npm run test:db:concurrency
npm run test:db:settlement-concurrency
npm run test:db:parlay-placement-concurrency
npm run test:db:parlay-settlement-concurrency
```

`test:db` executes all phase SQL suites through `supabase test db`. These tests exercise PostgreSQL roles, JWT claims, grants, policies, functions, exact ledger values, and immutable snapshots rather than UI visibility. `test:db:concurrency` uses an isolated synthetic local user and cache row, sends concurrent authenticated placement requests, asserts one success and one insufficient-bankroll failure, verifies reconciliation, and removes its test records.

`test:db:settlement-concurrency` creates an isolated synthetic ticket and final score, invokes settlement twice concurrently through the local service boundary, and requires one success, one `already_settled` response, one stored-return credit, and an exact ledger balance. Its append-only audit fixture remains isolated until the next local database reset.

`test:db:parlay-placement-concurrency` sends two concurrent two-leg parlay requests for 7,500 units and requires exactly one accepted parent, two immutable legs, one stake debit, and a 2,500-unit balance. `test:db:parlay-settlement-concurrency` creates a two-leg final parlay and invokes the service settlement function twice concurrently; it requires one success, one `already_settled` response, two won leg results, one 50-unit return credit, and a 10,040-unit balance. Both suites delete their synthetic users (and placement cache rows) on completion.

Fixtures must be synthetic or redacted, deterministic, small, and source-controlled. They must not contain API keys, service-role credentials, private screenshots, email addresses, or live network dependencies.
