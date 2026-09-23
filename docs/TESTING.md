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
- Release-candidate UX patch 3 adds fixed-precision USD-to-Vial normalization tests, Scientist fallback and branding-contract tests, no-primary-simulated-sportsbook checks, unified My Bets/source-badge/filter checks, reviewed three-path Import Betslip checks, duplicate-warning checks, Settings disclosure checks, and 33 pgTAP assertions for imported provenance, matching/settlement/manual-reason functions, grants, forced RLS, duplicate lookup, raw-value preservation, and zero extra bankroll mutation. Imported settlement uses the existing straight grading helper and is covered by the database boundary; imported records are never accepted as bankroll-ledger inputs.
- Release-candidate fix patch 1 adds local-time formatting tests with no seconds, current-event LIVE normalization, market-grouping and locked-pregame contracts, independent persistent straight-slip coverage, visible screenshot-review/canonical-event contracts, owner-only cancellation source checks, and 14 pgTAP assertions for exact pre-kickoff refund, audit evidence, post-kickoff rejection, and no double refund. The existing concurrency suites remain required because straight placement and settlement continue to use the same authoritative RPC boundaries.
- Release-candidate fix patch 3 adds direct asset-path and tagline contracts, browser-local OCR adapter/parser coverage with editable review, uncertainty flags, guided fallback, and probable parlay-leg extraction, cached-event search and `Can't find my event` contracts, exact imported economics coverage, and reusable invite UI/source checks. Its pgTAP suite verifies default reusable invites, optional caps, repeated authenticated redemption, expiry/revocation rejection, usage counts, owner/admin listing, token non-disclosure, grants, and anonymous denial. Narrow in-app mobile smoke review covers Home and authentication rendering; authenticated import and leaderboard behavior remains covered by server-action/source contracts and database authorization tests.
- v0.13.0 adds code-format normalization/unit coverage, migration/source contracts for cryptographic generation, hash-only storage, uniqueness retries, shared redemption, and authenticated attempt throttling, plus pgTAP suites for code creation, lowercase/hyphenated and unhyphenated redemption, already-member behavior, invalid/expired/revoked/consumed/legacy/limited-use states, direct authorization denial, the code rate limit, and a deterministic collision/retry path.
- v0.14.0 verifies owner-scoped watch creation, duplicate-active-watch prevention, cross-user
  isolation, anonymous denial, and shared history with trusted writes only. Fresh cache writes
  must add first and changed line/price observations while avoiding redundant unchanged rows and
  concurrent duplicates. Watchlist Bet Slip selections must use current odds and preserve
  server-authoritative stale-price rejection. Watch creation and clearing must leave bankroll,
  canonical analytics, and leaderboards unchanged. Existing score/settlement processing must
  clear all active watches for terminal events idempotently while retaining shared history.
  My Bets tests cover existing imported wagers, authorized Won/Lost/Push/Void entry and
  correction audits, direct cross-user/API denial, private screenshot access, zero simulated
  ledger effects, preserved simulated cards, and removal of duplicate Track Bet controls.
  `supabase/tests/v0_14_odds_watchlist.sql` and `supabase/tests/v0_14_my_bets_settlement.sql`
  exercise the direct PostgreSQL authorization and lifecycle boundaries. The
  `npm run test:db:watchlist-history-concurrency` integration test races simultaneous service-role
  cache writes for first, unchanged, and changed observations without calling a live provider.
  `npm run test:db:v0-14-stress` runs local-only Watchlist races across 24 users and 124 watch
  requests, idempotent clear races, terminal-event cleanup/history retention, and 24 concurrent
  imported-wager creations and owner settlements. It verifies cross-user settlement denial,
  expected economics, settlement audits, and zero simulated-bankroll impact.
- v0.15.0 adds pure date-key, timezone-boundary, nearest-upcoming-date, kickoff-grouping, stable
  ordering, NCAAF hierarchy, rivalry/record secondary-signal, rankings-source transition, and
  domestic-soccer standings/marquee tests. Source contracts verify canonical event/date query
  navigation, one active market board, rank formatting without `NR`, and the coordinated desktop
  sticky rail. The existing cache tests remain the provider-call regression boundary: browse filters,
  sorting, expansion, and ranking presentation consume the already loaded dataset and add no
  upstream request. Manual responsive review covers 375px and 430px phones, tablet, 1366px and
  1440px desktop widths, and a short-height laptop.
- Release-candidate fix patch 4 adds universal straight/parlay import contracts, FanDuel-shaped extraction acceptance, local OCR preprocessing/progress/failure behavior, editable parlay-leg review, optional sportsbook persistence, cached-event-first manual import, exact total-return economics, and leaderboard controls/mobile-card source contracts. Its pgTAP suite verifies nullable sportsbook identity, authenticated unknown-sportsbook creation, stable display fallback, no virtual-bankroll mutation, and anonymous execute denial. Narrow-width review targets 390x844 and 375x812; the four existing concurrency suites remain required.
- v0.11.0 adds private-beta release contracts for the authenticated Home announcement, canonical
  version/history display, Feedback & Version settings content, the multi-stage Import Betslip
  tutorial, and the existence of the private-safe media asset. `supabase/tests/private_beta_feedback.sql`
  proves caller-derived submission, idempotent duplicate delivery, forced RLS, cross-user isolation,
  ordinary-role status protection, and service-role review behavior.

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
npm run test:db:auth-lifecycle-concurrency
npm run test:db:concurrency
npm run test:db:settlement-concurrency
npm run test:db:parlay-placement-concurrency
npm run test:db:parlay-settlement-concurrency
```

`test:db` executes all phase SQL suites through `supabase test db`. These tests exercise PostgreSQL roles, JWT claims, grants, policies, functions, exact ledger values, and immutable snapshots rather than UI visibility. `test:db:concurrency` uses an isolated synthetic local user and cache row, sends concurrent authenticated placement requests, asserts one success and one insufficient-bankroll failure, verifies reconciliation, and removes its test records.

`test:db:settlement-concurrency` creates an isolated synthetic ticket and final score, invokes settlement twice concurrently through the local service boundary, and requires one success, one `already_settled` response, one stored-return credit, and an exact ledger balance. Its append-only audit fixture remains isolated until the next local database reset.

`test:db:parlay-placement-concurrency` sends two concurrent two-leg parlay requests for 7,500 units and requires exactly one accepted parent, two immutable legs, one stake debit, and a 2,500-unit balance. `test:db:parlay-settlement-concurrency` creates a two-leg final parlay and invokes the service settlement function twice concurrently; it requires one success, one `already_settled` response, two won leg results, one 50-unit return credit, and a 10,040-unit balance. Both suites delete their synthetic users (and placement cache rows) on completion.

The v0.12.1 lifecycle suite `supabase/tests/auth_onboarding_bankroll_lifecycle.sql` proves that an
unconfirmed Auth fixture creates a profile but no ledger row and can be removed through the supported
Auth cascade, while a confirmed fixture gets exactly one canonical allocation only when the
caller-derived bootstrap runs. It also checks repeated initialization, the per-user advisory-lock
concurrency boundary, existing ledger history preservation, normal wager placement, append-only
protection, and the service-role-only legacy abandoned-user cleanup boundary. The cleanup function is
never a client deletion path.

`test:db:auth-lifecycle-concurrency` creates one unconfirmed synthetic local Auth user, uses two
independent locally signed authenticated test clients to race the database bootstrap RPC, requires two
canonical 10,000-unit responses and one initial-allocation row, then cleans the synthetic user with the
exact local-only abandoned-user maintenance boundary. The SQL lifecycle suite separately proves that
real unconfirmed signup state has no ledger row and is safely deletable. This integration test never
runs against production.

Fixtures must be synthetic or redacted, deterministic, small, and source-controlled. They must not contain API keys, service-role credentials, private screenshots, email addresses, or live network dependencies.
