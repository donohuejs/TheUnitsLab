# Phase 2 Completion Report

Date: 2026-09-12  
Gate recommendation: **Passed, with live-provider credential validation pending**

## Gate conclusion

Phase 2 implements the vertical sports-and-odds data path and demonstrates the critical shared-cache acceptance condition without consuming provider quota. A deterministic concurrent integration test represents two users requesting equivalent EPL data against one shared store: the initial pair causes exactly one upstream call and one ledger entry, a fresh follow-up causes neither, and a concurrent pair after expiry causes exactly one additional upstream call and ledger entry.

**Explicit required result:** Multiple authenticated users requesting equivalent odds data within the active cache window result in one shared upstream Odds API request rather than one request per user: **Passed.** The service integration test proves request coalescing; the pgTAP suite separately proves User A and User B can read the same intentionally shared cache row while neither can mutate it.

No `THE_ODDS_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` was present in the execution environment during Phase 2. The bounded gate-closure check was repeated on 2026-09-12 before Phase 3: neither credential was present at process, user, or machine scope, and no populated local environment file existed. Per instruction, no live provider request was attempted or fabricated. Live data requires server-only `THE_ODDS_API_KEY`; deployed persistence additionally requires `SUPABASE_SERVICE_ROLE_KEY`.

## Work completed

- Added the server-only Odds API v4 client, provider-independent events/markets, centralized mappings, and quota-header parsing.
- Added canonical shared cache keys, a 15-minute pregame TTL, five-minute manual-refresh floor, stale-on-error behavior, and cross-instance database refresh leases.
- Added upstream-only usage accounting and Normal, Conserve, High, and Critical controls. Conserve extends automatic freshness to 30 minutes; High blocks nonessential refresh; Critical allows only explicit stale manual refresh.
- Added authenticated competition/event/odds pages, bookmaker filtering, freshness display, controlled refresh, and a server-allowlisted administrative quota dashboard.
- Added no polling, scores, betting, bankroll, settlement, or Phase 3+ behavior.

## Files created or modified

Created the Phase 2 plan/report; ordered migration and pgTAP suite; odds type, request, normalization, quota, provider, service, PostgreSQL adapter, and composition modules; admin database client; sports and quota routes; fixture and cache/normalization tests. Modified environment/setup, styles, architecture, ERD, migrations, testing, README, and migration tests.

## Database changes

- `public.odds_cache`: canonical request, normalized payload, fetch/expiry/cooldown timestamps. Authenticated shared read only; forced RLS.
- `public.api_usage_ledger`: timestamp, endpoint, sport, competition, purpose, key, HTTP status, request cost, used, and remaining. No browser access; forced RLS.
- `app_private.odds_refresh_leases`: cross-instance expiring refresh ownership.
- Service-role-only security-definer lease functions; anonymous/authenticated execution is revoked.

Migration replay from a clean local database and database lint both passed.

## Tests and results

- `npm run validate`: passed formatting, lint, TypeScript, 20 Vitest tests in four files, and production build.
- `npm run test:coverage`: passed; configured scope reports 88.46% statements and 87.5% lines.
- `npm run db:reset`: passed clean replay through Phase 2.
- `npm run db:lint`: no schema errors.
- `npm run test:db`: 38 assertions across Phase 1 and Phase 2 passed; Phase 1 authorization remains intact.
- `npm audit --audit-level=high`: 0 vulnerabilities.

Tests cover normalization, all mappings/markets, odds conversion, quota metadata/states, miss/hit/expiry/coalescing, ledger non-duplication, manual cooldown, High-state behavior, server-only secrets, forced RLS, common authenticated reads, and denied cache/ledger/lease writes.

## Cache proof

| Step            |                      Callers | Provider calls total | Ledger rows total | Result                      |
| --------------- | ---------------------------: | -------------------: | ----------------: | --------------------------- |
| Empty EPL cache | User A + User B concurrently |                    1 |                 1 | One miss, one coalesced hit |
| EPL fresh       |    Another equivalent caller |                    1 |                 1 | Shared hit                  |
| EPL expired     |     Two callers concurrently |                    2 |                 2 | Exactly one refresh         |

Keys include provider, endpoint, competition/provider sport, sorted markets/bookmakers, region, and formats.

## API usage, cost, and quota

Odds API requests consumed during development/testing: **0**. Tests use a synthetic fixture and mock. Expected operating cost remains $0 on the documented 500-credit free allowance, Supabase free PostgreSQL, and Vercel Hobby. No dependency was added. Caesars remains configured but disabled as paid-only; FanDuel, DraftKings, and BetMGM are enabled.

The quota dashboard shows allowance, used, remaining, percentage, and usage by sport, endpoint, and day. Cache hits never create ledger entries.

## Security implications

Provider and service-role secrets are referenced only by `server-only` modules, have no public aliases, are not returned, and are not logged. New public tables have forced RLS. Shared odds are intentionally common to authenticated users and do not weaken private Phase 1 policies. Administrative data requires authentication plus `APP_ADMIN_USER_IDS` membership.

## Remaining issues and deviations

- Live-provider validation remains pending because both required server-side credentials were unavailable when the gate-closure check was repeated before Phase 3. After the owner supplies them server-side, make one bounded competition request, verify response compatibility and actual credit cost, and prove the immediate second request is cached.
- Application-admin identity was unresolved after Phase 1; Phase 2 uses a documented server-only UUID allowlist.
- The ledger records successful upstream responses. Failed provider fetches do not create misleading quota rows when quota metadata is unavailable.
- No schedule-only endpoint or durable event table was necessary: Phase 2 stores normalized scheduled events embedded in the replaceable odds dataset.

There are no deviations from real-money exclusions, supported scope, shared-cache requirement, or free-cost target.

## Gate recommendation

The Phase 2 gate is **Passed** based on the fixture-backed vertical path, explicit multi-user shared-cache proof, clean migration replay, authorization tests, and production build. Operational live validation remains pending the required server-only secrets. Stop here; do not begin Phase 3.
