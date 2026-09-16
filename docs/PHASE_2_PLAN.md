# Phase 2 Sports and Odds Data Plan

## Outcome and boundary

Phase 2 delivers authenticated browsing of normalized pregame events and supported odds for EPL, UCL, NCAAF, and NCAAB through The Odds API v4. It stops at the odds-data gate and adds no ticket, bankroll, settlement, score-polling, external-wager, or Phase 3+ behavior.

## Decisions and assumptions

- Pregame odds use the governing recommendation's upper bound: a 15-minute shared-cache TTL. Event schedule configuration remains six hours for later schedule-only requests.
- PostgreSQL is the shared cache and coordination layer. Canonical keys include provider, endpoint, competition/provider sport key, sorted market set, sorted bookmaker set, region, and response format.
- A short database-backed refresh lease coalesces concurrent misses across serverless instances. Lease losers briefly re-read the shared cache instead of calling the provider.
- Manual refresh cannot bypass a fresh cache less than five minutes old. The cooldown is global per canonical request, so multiple users cannot force duplicate calls.
- The governing quota bands are explicitly approved by the Phase 2 instruction. Normal permits standard behavior; Conserve lengthens automatic freshness to 30 minutes; High serves stale data and denies nonessential refresh; Critical permits only an explicit stale manual refresh and otherwise serves stale/unavailable data.
- The monthly allowance defaults to the documented free allowance of 500 credits and is configurable server-side.
- FanDuel, DraftKings, and BetMGM are enabled. Caesars remains centrally configured but disabled because the documented Odds API free plan does not include it.
- Application-administrator identity was unresolved after Phase 1. Phase 2 introduces a server-only comma-separated `APP_ADMIN_USER_IDS` allowlist. The quota dashboard requires both authentication and allowlist membership.
- Provider timestamps are retained. Event status is `scheduled` because the Phase 2 pregame odds endpoint does not provide a richer event state.
- Stale cached data is returned on provider failure when available, visibly marked stale. Secrets are never returned or logged.

## Implementation sequence

1. Add the Phase 2 migration for shared normalized cache payloads, refresh leases, usage ledger, RLS, and narrow service-only database functions.
2. Add typed internal event/odds models, canonical request construction, provider response validation and normalization, quota parsing, and quota-state logic.
3. Add the server-only provider/cache orchestration and authenticated UI routes for competition odds, bookmaker filtering, refresh, and admin quota reporting.
4. Add deterministic provider fixtures and tests for normalization, mapping, cache hit/miss/expiry/coalescing, ledger accounting, quota headers/states, manual-refresh controls, and server-only secret boundaries.
5. Extend database authorization tests for intentional shared read access and denied client writes, then replay migrations and run all repository validation.
6. Update architecture, ERD, testing, cost/quota, setup documentation, and produce the Phase 2 Completion Report. Stop at the Phase 2 gate.

## Acceptance evidence

The gate requires a reproducible test in which two authenticated user identities make equivalent requests during one cache window and cause exactly one provider call and ledger row; expiry causes exactly one additional refresh. UI rendering alone is insufficient.
