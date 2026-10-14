# v0.16.0 Completion Report

## Scope

v0.16.0 optimizes the odds-data architecture within the completed Phase 8 boundary. It does not
start Phase 9 and does not add real-money wagering, paid infrastructure, uncontrolled polling,
player props, same-game parlays, live odds, or a second provider.

## Work completed

- Added configuration-driven adaptive pregame freshness and hard stale limits based on the nearest
  upcoming event.
- Added stale-while-revalidate through Next.js `after()`, an in-process callback guard, and the
  existing cross-instance PostgreSQL refresh lease.
- Made the default request pack FanDuel, DraftKings, and BetRivers. BetMGM remains configured but is
  not requested by default. Caesars remains configured as core coverage but is excluded from free
  defaults because its current provider key is paid-only.
- Added a provider interface and capability declaration while keeping The Odds API v4 as the only
  implementation. Normalized odds now reserve provider keys, participant IDs, scope, period, and
  variant fields for future dimensions.
- Added successful and failed provider-attempt telemetry, request-dimension capture, latency,
  attempts, safe error metadata, and dashboard reconciliation between provider headline usage and
  current-month ledger cost.
- Restricted shared odds movement history to scheduled pregame events and core bookmakers, and
  marked retained post-start history rows as non-pregame.
- Added score-target filtering so settlement and open-wager refreshes skip unrelated future events
  while preserving competition-level shared score caching.

## Files changed

Application code, configuration, tests, documentation, the governing DOCX, and the additive
`supabase/migrations/20261009000000_v0_16_odds_data_architecture.sql` migration were updated. The
new database contract suite is `supabase/tests/v0_16_odds_data_architecture.sql`.

## Database changes

The migration adds `odds_cache.stale_until`, `odds_price_history.is_pregame`, and provider request,
cache, lease, latency, outcome, and safe-error fields to `api_usage_ledger`, plus lookup indexes and
nonnegative/positive telemetry checks. Existing exposed tables remain forced-RLS. No new browser
grant or exposed table was added. The migration is repository-local and has not been applied to a
remote production project in this workflow.

## Validation

- Targeted odds/cache/provider/score/config tests: passed, 36 tests.
- Full application validation: passed (`format:check`, lint, typecheck, 56 Vitest files / 334 tests,
  secret scan, and production build).
- Local Supabase migration lint: passed with two pre-existing warnings in settlement-test functions
  about an unused/shadowed loop variable; the v0.16 migration produced no warning.
- Local database reset and pgTAP: passed, 29 files and 723 tests, including the v0.16 contract suite.
- Existing concurrent odds-history regression: passed, 448 trusted snapshot writes produced the
  expected 13 change points across 14 refresh bursts.
- Live-provider smoke and linked-project migration parity were not run in this host session.
- Governing DOCX edit completed. Visual render verification was attempted with the bundled renderer
  but is unverified because LibreOffice/`soffice.exe` is not installed on this host.

## Cost and quota implications

No paid dependency or scheduler was added. Adaptive freshness lowers distant-event refresh pressure
and tightens the window near kickoff without creating a polling schedule. The 500-credit ceiling,
shared cache, lease, quota bands, and no-overage rule remain in force. The default free-tier-safe
request pack is FanDuel, DraftKings, and BetRivers. Caesars remains a documented paid-plan
deviation and must not be added to default requests without owner approval and cost verification.

## Security implications

Provider and service-role secrets remain server-only. Provider errors store only bounded safe metadata;
API keys and raw provider payloads are not placed in telemetry. Cache/history writes remain trusted
server operations, lease functions remain service-only, and existing forced-RLS policies are
unchanged. Ticket snapshots, settlement idempotency, bankroll isolation, and external-wager
separation are unchanged.

## Deviations and remaining issues

- The provider's cumulative usage headline and a current-month ledger breakdown may differ. The
  dashboard now shows both values and their delta; a production explanation requires the actual
  ledger rows and provider response history and was not fabricated here.
- A live-provider smoke is still required before production release because credentials and exact
  provider credit behavior are environment-owned.
- The v0.16 migration must pass the production release workflow's linked-project verification,
  dry-run, safety review, backup-policy review, and parity check before application release.
- DOCX visual QA remains pending until a host with the bundled LibreOffice renderer is available.

## Gate recommendation

Recommend a conditional v0.16.0 gate pass for repository implementation and automated application
tests. Hold production release until the database migration gate, live provider smoke, and DOCX
visual verification are completed in an appropriately provisioned environment.
