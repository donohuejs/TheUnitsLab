# Phase 6 Completion Report — Analytics and Leaderboards

Date: 2026-09-13  
Gate recommendation: **PASS**

## Gate conclusion

Phase 6 is complete. Personal analytics and private-group leaderboards derive from one canonical read-only projection of authoritative simulated straight tickets and current external-wager rows. Exact fixed-precision calculations support simulated, IRL, and combined sources; wager-time periods; personal breakdowns; all required group categories; deterministic ties; and minimum-sample eligibility.

The mixed-source reconciliation fixture and direct PostgreSQL fixture both match independent expected counts and economics. An IRL win corrected to a loss appears once with its current `-2.00` result while both audit events remain. Group RPCs deny nonmembers and anonymous callers, personal analytics accepts no target user ID, no email field is exposed, prior screenshot policies pass, and analytics reads leave the virtual bankroll unchanged. Phase 7 has not begun.

## Work completed

- Added a canonical relational projection over one-leg simulated straight tickets and current external wagers without changing either system of record.
- Derived simulated profit/loss only from immutable ticket economics and authoritative status; used database-calculated current external profit/loss.
- Added a caller-derived personal RPC and membership-gated private-group wager/member RPCs with explicit least-privilege execute grants.
- Added integer-based shared metric, filter, breakdown, and leaderboard calculations with no binary floating-point financial accumulation.
- Added source filters for simulated, IRL, and combined results.
- Added week, month, season, and all-time date semantics using the viewer profile time zone and canonical wager timestamps.
- Added sport, competition, market, and sportsbook personal breakdowns.
- Added the authenticated Performance page with units won/lost and ROI as the primary metrics.
- Added the private Group Leaderboards page with Units Won as default, prominent ROI, all seven required categories, source/time filters, deterministic ties, and explicit sample-size ineligibility.
- Added exact independent reconciliation, precision, boundary, correction, ranking, and authorization coverage.
- Updated architecture, ERD, migration, testing, cost, product-baseline, setup/status, and phase documentation.

## Files created

- `docs/PHASE_6_PLAN.md`
- `supabase/migrations/20260917000000_phase_6_analytics_leaderboards.sql`
- `supabase/tests/phase_6_analytics_leaderboards.sql`
- `src/lib/analytics/calculations.ts`
- `src/app/performance/page.tsx`
- `src/app/leaderboards/page.tsx`
- `test/analytics-reconciliation.test.ts`
- `PHASE_6_COMPLETION_REPORT.md`

## Files modified

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/COST_AND_QUOTA.md`
- `docs/DATABASE_ERD.md`
- `docs/MIGRATIONS.md`
- `docs/PRODUCT_SPEC.md`
- `docs/TESTING.md`
- `src/app/account/page.tsx`
- `src/app/globals.css`
- `src/app/my-bets/page.tsx`
- `src/app/sports/page.tsx`
- `src/app/sports/[competition]/page.tsx`
- `src/app/track-bet/page.tsx`
- `test/migration-foundation.test.ts`
- `vitest.config.ts`

No dependency or lockfile change was required.

## Database changes

Migration `20260917000000_phase_6_analytics_leaderboards.sql` adds:

- `app_private.analytics_wager_rows()`, the single canonical `union all` projection. It emits accepted fixed-precision economics, authoritative current status, source, ticket type, canonical wager time, and breakdown dimensions. It intentionally excludes settlement and correction audits.
- `public.get_personal_analytics_wagers()`, with identity derived solely from `auth.uid()` and no user parameter.
- `public.get_group_analytics_wagers(uuid)`, which checks current group membership before returning only wagers explicitly associated with that group.
- `public.get_group_leaderboard_members(uuid)`, with the same membership gate, profile-visibility-aware names, and no authentication/email data.
- Explicit revocation from `PUBLIC`, `anon`, `authenticated`, and `service_role` before granting the three narrow public RPCs only to `authenticated`. The private canonical function remains unavailable to browser roles.
- User/time covering indexes for simulated and external analytics reads.

No table, mutable counter, materialized aggregate, trigger-maintained statistic, bankroll write, wager mutation, audit mutation, or screenshot-policy change was added.

## Metric definitions

- Total bets: every submitted record inside filters, including open, push, and void.
- Wins/losses/pushes/voids: current authoritative statuses; open contributes to none.
- Units wagered: stake on won, lost, and push records; open and void are excluded.
- Units won/lost: authoritative profit/loss sum. Simulated win uses stored potential profit, loss uses negative stored stake, and push/void/open use zero. External uses current database-calculated profit/loss.
- ROI: net units divided by settled non-void stake, multiplied by 100 and rounded half away from zero to two places; zero denominator displays `0.00%` and is rate-ineligible.
- Win percentage: wins divided by wins plus losses, rounded half away from zero to two places; push/void/open are excluded.
- Average odds: arithmetic mean of accepted decimal odds on won/lost/push records, rounded half away from zero to four places; open and void are excluded.
- Current streak: latest consecutive decisive result run, displayed `Wn` or `Ln`. Best streak is the longest winning run. Push, void, and open records are neutral. Equal timestamps use source and wager ID for deterministic ordering.

Every financial-style sum and leaderboard comparison uses integer minor units or decimal ten-thousandths.

## Date and time filters

- Simulated canonical time: immutable `bets.created_at`.
- IRL canonical time: authoritative `external_wagers.wager_date`.
- Settlement time is never substituted.
- Viewer profile IANA time zone controls boundaries; an invalid legacy value safely falls back to UTC.
- Week starts Monday 00:00 local; month starts local calendar day 1; season starts August 1 local (or the preceding August before that date); all-time has no lower bound.
- Starts are inclusive and the request instant is exclusive. Tests include New York daylight-saving boundaries.

## Minimum sample and tie behavior

ROI and win-percentage leaderboards require five settled non-void wagers after all source, time, and category filters. The single exported `RATE_LEADERBOARD_MINIMUM_WAGERS` constant controls the default. Ineligible members remain visible with the exact additional count required and receive no rank.

Units Won, total wagers, and sport-category units rankings have no minimum. Equal primary values share a dense rank. Case-insensitive display name and then user UUID provide stable presentation order only; they do not imply economic superiority.

## Reconciliation evidence

The independent TypeScript fixture contains eight records: three simulated settled decisions (100-unit win at 2.0000, 50-unit loss at 1.9100, 25-unit push at 1.9500), one simulated 30-unit void, two settled IRL decisions (20-unit win for +30.00 at 2.5000 and a corrected current 10-unit loss at 1.8000), one open IRL wager, and one earlier 5-unit simulated win. It spans soccer, college football, college basketball, EPL/UCL/NCAAF/NCAAB, all supported markets, four books, source and time boundaries.

Expected and actual all-time output matched exactly:

| Metric                                |          Expected |            Actual |
| ------------------------------------- | ----------------: | ----------------: |
| Total bets                            |                 8 |                 8 |
| Wins / losses / pushes / voids / open | 3 / 2 / 1 / 1 / 1 | 3 / 2 / 1 / 1 / 1 |
| Units wagered                         |            210.00 |            210.00 |
| Units won/lost                        |            +75.00 |            +75.00 |
| ROI                                   |            35.71% |            35.71% |
| Win percentage                        |            60.00% |            60.00% |
| Average decimal odds                  |            2.0267 |            2.0267 |
| Current / best streak                 |           L1 / W2 |           L1 / W2 |

The same fixture independently verifies this-week output of seven bets, 205.00 units wagered, and +70.00 units; simulated-only +55.00; IRL-only +20.00; football -60.00; NCAAF -60.00; spread -50.00; DraftKings -60.00; and UCL +30.00. Ranking tests verify strict order, shared ties, rate eligibility at exactly five, and ineligibility at four.

The PostgreSQL fixture independently contains four group wagers. RPC output equals one win, two losses, one push, 20.00 eligible units wagered, and +3.00 net units. The corrected IRL record occurs once at `-2.00`; its two correction audit entries remain. Personal User A output equals three wagers, 15.00 eligible units, and +8.00 net units. No audit row is counted as a wager.

## Tests and exact results

- `npm.cmd run validate`: **PASS**.
  - Prettier: PASS.
  - ESLint: PASS, zero warnings/errors.
  - TypeScript: PASS.
  - Vitest: PASS, 11 files and **61 tests**.
  - Next.js 16.3.5 production build: PASS; `/performance` and `/leaderboards` are present.
- `npm.cmd run test:coverage`: **PASS**, 11 files and 61 tests.
  - Overall configured scope: 92.05% statements, 82.18% branches, 95.38% functions, and 95.02% lines.
  - Analytics calculations: 96.12% statements, 88.88% branches, 95.83% functions, and 100% lines.
- `npm.cmd run db:reset`: **PASS**. All ordered Phase 0–6 migrations and seed replayed cleanly multiple times.
- `npm.cmd run db:lint`: **PASS**. No schema errors in `app_private`, `extensions`, or `public` after a clean replay.
- `npm.cmd run test:db`: **PASS**, 6 files and **215 assertions**. All prior 185 assertions remain; Phase 6 adds 30.
- `npm.cmd run test:db:concurrency`: **PASS**. One ticket, one debit, and a 2,500-unit balance remain under concurrent overspend pressure.
- `npm.cmd run test:db:settlement-concurrency`: **PASS**. One 25.00-unit settlement return and a 10,015.00-unit balance remain under concurrent settlement.
- `npm.cmd audit --audit-level=high`: **PASS**, 0 vulnerabilities.
- Secret scan: **PASS**, 0 JWT-like files, 0 non-example provider/service/cron secret assignments, and 0 non-example environment files.
- HTTP smoke against the existing local development server: `/` 200, `/auth` 200, and unauthenticated `/sports`, `/performance`, `/leaderboards`, and `/track-bet` each return 307 to `/auth`.

## Security implications

- The new surfaces are read-only and accept no aggregate, profit, result, odds, or user-controlled owner value.
- A user can retrieve personal rows only for `auth.uid()`; changing a user ID is impossible because no parameter exists.
- Group functions perform explicit current-membership checks before their security-definer read. A nonmember and anonymous role are denied at the database function boundary.
- Supabase's explicit default `anon` function grant was detected by the first test run and corrected by explicit per-role revocation. Final authorization tests pass.
- Group output contains display names according to existing profile privacy and opaque IDs, but no email or auth metadata.
- Existing forced-RLS wager and screenshot tests remain passing. The unrestricted projection is in the unexposed private schema and has no browser execute grant.
- IRL corrections retain append-only audits while only the current wager row contributes to analytics.
- Simulated-ticket immutability, settlement auditing, and external-wager persistence are unchanged.
- Analytics reads create no virtual-bankroll rows and cannot alter the ledger.

## API and cost implications

Phase 6 uses only persisted application data. It makes zero Odds API calls and adds no polling, background job, analytics service, paid cache, data warehouse, scheduler, package, or paid dependency. The operating target remains $0/month under the existing free-tier assumptions.

## Remaining issues and carried-forward items

1. Live Odds API odds and score validation remains pending because required production provider/service credentials have not been available. Phase 6 made zero provider calls and claims no live validation.
2. A zero-cost production score/settlement scheduling strategy remains pending. No paid scheduler or dependency was introduced.
3. Screenshot retention/deletion/moderation and simulated final-score correction remain the prior operational/product decisions; Phase 6 does not expand them.
4. The cross-sport August 1 season boundary is an explicit Phase 6 convention because no competition-season data model exists. A future approved competition-specific season model may supersede it.

## Deviations and phase boundary

No conflict with the governing specification was introduced. The source did not specify formula denominators, period boundaries, a season representation, minimum sample, or tie behavior; the explicit conservative decisions are documented in the Phase 6 plan and above.

All current analytics records are represented as straight wagers. No multi-leg slip, parlay odds, parlay settlement, per-leg result combination, parlay analytics behavior, activity feed, comments, share card, redesign, OCR/import, public group, recommendation, referral, or real-money feature was added.

## Phase 6 gate evidence

1. Personal analytics derive from authoritative wagers: PASS.
2. Simulated, IRL, and combined source filtering: PASS.
3. Time and dimension breakdown filters: PASS.
4. Corrected IRL results counted once at current economics with audit retained: PASS.
5. Private-group membership authorization at RPC/database boundary: PASS.
6. Central five-wager rate eligibility and boundary behavior: PASS.
7. Exact underlying-wager reconciliation and deterministic ranking/ties: PASS.
8. Phase 0–5 unit/database/storage/concurrency behavior remains passing: PASS.
9. No paid dependency, upstream analytics call, or real-money behavior: PASS.

**The Phase 6 gate is satisfied. Recommendation: PASS. Stop here; do not begin Phase 7.**
