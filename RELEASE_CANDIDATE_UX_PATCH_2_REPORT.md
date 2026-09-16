# Release Candidate UX Patch 2 Report

Date: 2026-09-16  
Scope: Release Candidate UX Patch 2 only; Phase 9 was not started.

## 1. Summary

Patch 2 improves NCAA football team-mark coverage, separates matchup and kickoff presentation,
adds shared grouped competition navigation, keeps the active parlay slip across Browse Odds
navigation, and adds UEFA Europa League and La Liga through the existing provider-backed path. No
real-money behavior, RLS boundary, bankroll rule, cache architecture, quota policy, settlement
logic, or provider-authoritative placement rule was removed or weakened.

The official [The Odds API sports catalog](https://the-odds-api.com/sports-odds-data/sports-apis.html)
lists `soccer_spain_la_liga` and `soccer_uefa_europa_league`; both were verified before the
configuration and migration changes.

## 2. College-logo improvements

`src/lib/teams/logos.ts` remains the centralized resolver. Normalization now handles Unicode
diacritics, punctuation, ampersands, whitespace, and common provider naming differences. NCAA
aliases cover Syracuse Orange, Pittsburgh/Pitt Panthers, Miami Hurricanes, Clemson Tigers, South
Carolina Gamecocks, Georgia Bulldogs, Alabama Crimson Tide, Ohio State Buckeyes, Notre Dame
Fighting Irish, and Michigan Wolverines using the existing public ESPN CDN convention.

`TeamMark` now renders a real image element with an error handler. A broken or unavailable image
hides only the image and leaves the initials fallback visible; matchup rendering cannot fail on
logo availability.

## 3. Matchup/date-time redesign

`KickoffTime` and `formatKickoff` provide one shared format: `Thu, Sep 17 · 7:30 PM`. Seconds are
never shown. The server and hydration fallback is deterministic UTC; after hydration the client
updates the same time element to the user's local timezone. This avoids server/client timezone
hydration mismatch while keeping local display behavior.

Event headers now use a primary matchup row, a separate secondary kickoff row, aligned marks, and
mobile wrapping rules. The persistent slip also shows kickoff metadata for each leg.

## 4. Competition navigation

`CompetitionSwitcher` is generated from shared `src/config/sports.ts` definitions. It groups core
competitions under Football, Hockey, Soccer, and Basketball, highlights the active competition,
and uses direct `/sports/[competition]` links. The release-candidate target set is available in one
Browse Odds experience: NCAA Football, NFL, NHL, EPL, UEFA Champions League, UEFA Europa League,
and La Liga. Existing NCAAB remains available as a configured core competition.

Switch links and landing cards disable route prefetching so configured competitions do not create
provider calls merely by being present or visible. Normal Link history behavior remains intact.

## 5. Bet-slip persistence architecture

`src/lib/wagers/slip.ts` is a small browser external store backed by local storage. It persists only
the already displayed selection snapshot: event/competition identity, sport, teams, bookmaker,
market, selection, line, American and decimal odds, and kickoff. It contains no credentials,
authentication state, bankroll, or other sensitive data.

The slip is rendered even when the current competition has no active price selection, so the user
can switch competitions without losing visibility of the unfinished parlay. Same-tab updates,
rerenders, refreshes when storage is available, and cross-tab storage events use the same store.
Explicit remove and clear actions update persistent state.

Server placement remains authoritative. The parlay form submits the stored snapshot terms for server
revalidation; successful placement returns only the submitted selection keys to My Bets, where the
client removes those keys. Failed or stale-price-rejected placement does not clear anything.
Straight placement does not consume parlay selections.

## 6. Mixed-sport parlay behavior

The existing Phase 7 server rules remain unchanged: simulated parlays may use distinct provider
events and one bookmaker, with two through twelve legs. No single-sport or single-competition rule
was added. Mixed-sport legs therefore remain intact in the slip and are classified by the existing
analytics projection as `mixed`. Same-game parlays and fabricated correlated prices remain
unsupported and continue to be explained/rejected.

## 7. La Liga implementation

Added shared configuration entry `laliga` with provider key `soccer_spain_la_liga`, core
availability, the existing soccer h2h/spreads/totals markets, shared cache settings, and soccer
three-way moneyline support including draw. It is exposed through Browse Odds, selection/slip
serialization, provider normalization, server placement, and existing settlement structures.

The new database catalog row is added only by the new Patch 2 migration.

## 8. Europa League implementation

Added shared configuration entry `uel` with provider key `soccer_uefa_europa_league`, core
availability, the existing soccer h2h/spreads/totals markets, shared cache settings, and soccer
three-way moneyline support including draw. It uses the same odds request, normalized dataset,
PostgreSQL cache, refresh lease, quota ledger, placement, parlay, and settlement paths as EPL/UCL.

## 9. Quota impact

No automatic provider call is created by either configuration entry. Browse links disable Next.js
prefetching, and only an actual requested competition page or an existing bounded refresh/settlement
workflow can enter `getCompetitionOdds`. Cache hits, leases, cooldowns, quota modes, and ledger
recording remain shared. Expected impact is zero until requested, then one shared provider request
per cache miss under the current provider cost rules.

## 10. Migration changes

Created the forward-only migration:

- `supabase/migrations/20260921000000_release_candidate_ux_patch_2.sql`

It inserts enabled `uel` and `laliga` rows into `public.competitions_catalog` after Patch 1. The
deployed Patch 1 migration was not edited. Added `supabase/tests/release_candidate_ux_patch_2.sql`
for catalog assertions and updated the existing Phase 5 catalog count assertion from six to eight
to reflect the approved catalog expansion.

## 11. Security/integrity review

- No provider key or Supabase service-role credential enters client code.
- The client slip is presentation/preview state only; server RPC validation remains authoritative
  for price, line, event, bookmaker, stake, bankroll, and ticket terms.
- Local storage contains no sensitive data and is never used as an authorization or settlement
  source.
- Immutable ticket/leg snapshots, RLS, bankroll ledger, cache leases, quota ledger, stale-price
  rejection, same-game rejection, and settlement idempotency are unchanged.
- No paid dependency, provider polling loop, SGP pricing, real-money flow, or external-wager path
  was added.

## 12. Test results/counts

- `npm.cmd run validate`: PASS after the final report/documentation update.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run lint`: PASS, zero warnings/errors.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd test`: PASS, 16 files and 104 tests.
- `npm.cmd run security:scan`: PASS.
- `npm.cmd run build`: PASS, Next.js 16.3.5 production build.
- `npm.cmd audit --offline --audit-level=high`: PASS, 0 vulnerabilities. The online advisory
  endpoint was network-blocked in the environment; an elevated retry was rejected because it would
  transmit dependency metadata to the public registry.
- `git diff --check`: PASS.

## 13. Database validation results

- Clean `npm.cmd run db:reset`: PASS. Ordered replay applied Phase 0 through Phase 7, Patch 1,
  Patch 2, then the synthetic seed.
- `npm.cmd run db:lint`: PASS. It reports two existing Patch 1 synthetic-harness PL/pgSQL warnings
  about shadowed/unused loop variables; Patch 2 adds no lint warning.
- `npm.cmd run test:db`: PASS, 9 SQL files and 304/304 pgTAP assertions.
- Straight placement concurrency: PASS — one accepted 7,500-unit request, one debit, 2,500-unit
  remaining balance.
- Straight settlement concurrency: PASS — one 25.00-unit return credit and exact 10,015.00-unit
  balance.
- Parlay placement concurrency: PASS — one two-leg ticket, one debit, 2,500-unit remaining
  balance.
- Parlay settlement concurrency: PASS — one 50.00-unit return credit, two won legs, and exact
  10,040.00-unit balance.
- A final clean local reset was run after concurrency checks and completed successfully.

## 14. Remaining limitations

1. No live Odds API credential was available, so live La Liga/Europa odds and logo CDN production
   availability were not claimed.
2. The local browser environment had no `.env.local` public Supabase configuration. The public auth
   layout was observed at `/auth`; an authenticated Browse Odds/mobile visual review was not
   performed because this task did not authorize automating login or fabricating credentials.
3. Screenshot retention/deletion/moderation, final-score correction policy, and zero-cost
   production scheduling remain the previously documented operational limitations.
4. The current db-lint warnings are inherited from the Patch 1 synthetic settlement harness.

## 15. Deployment handoff

Before hosted deployment, apply and verify:

1. `supabase/migrations/20260921000000_release_candidate_ux_patch_2.sql` through the normal linked
   Supabase migration workflow. Do not edit or re-run Patch 1 by hand.
2. Commit all changed tracked files and all new files shown by `git status`, including the new
   migration, pgTAP test, shared slip/time/switcher components, tests, and this report.
3. Confirm hosted Supabase catalog rows and hosted build behavior after deployment. Production
   verification is pending and is not claimed by this report.

Recommended commit message:

`feat: ship release candidate UX patch 2`

## 16. PASS/FAIL recommendation

**PASS for the local release-candidate patch gate, with hosted/provider and authenticated browser
UAT follow-up required.** The requested code, migration, unit, static, build, security, database,
and concurrency gates pass; no production verification is declared successful.
