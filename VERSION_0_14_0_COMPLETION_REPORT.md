# Version 0.14.0 Completion Report

Date: 2026-09-22
Previous repository version: **0.13.0**
New version: **0.14.0**
Release recommendation: **PASS for implementation and local validation**; production deployment
was not performed. The DOCX was structurally verified but could not be visually rendered in this
workspace.

## Objective

Version 0.14.0 adds a pregame Odds Watchlist with shared market movement history and makes My Bets
the management surface for both simulated and imported wagers. Track Bet remains the external
wager creation/import workflow. Closing Line Value (CLV) is deferred to the canonical backlog.

## Work completed

### Odds Watchlist and history

- Added authenticated Watchlist navigation, page, stop-watching control, and responsive movement
  history. Supported pregame base-market selections offer **☆ Watch Odds** and show **★ Watching**
  after creation. Alternate ladders are excluded because their multiple simultaneous lines do not
  represent successive observations of one normalized outcome.
- Added user-owned `odds_watches`, shared `odds_market_state`, and shared change-point
  `odds_price_history`. A watch identity is provider event + bookmaker + market + normalized
  selection; the changing spread/total line is not part of the permanent identity.
- History is captured by the existing trusted odds-cache write path in the same database
  transaction as the cache snapshot. It does not add an Odds API request, polling path, cache, lease,
  refresh, or quota-ledger entry. First observations and line/price changes create history points;
  unchanged prices update `last_seen_at` instead of creating rows. Concurrent writes serialize on
  the normalized market identity.
- The Watchlist displays the originally watched line/price separately from current line/price,
  line movement separately from price movement, observation time, event details, and only history
  points actually captured by the application. History can predate the watch. It is shared across
  users and is not deleted when a user clears a watch.
- **Add Current Odds to Bet Slip** returns to the normal sportsbook selection path without using
  the watched line. The existing server-side ticket validation and stale-price rejection remain
  authoritative; ticket terms become immutable only upon wager submission.
- Terminal score processing clears every active watch for an event and retains shared price
  history. Full competition odds snapshots also clear a market or pregame event that disappears.
  An authenticated Watchlist read clears that caller's watches at scheduled kickoff as a bounded
  fallback if score refresh is delayed. Cleanup is idempotent and uses no high-frequency scheduler.

### Unified My Bets management

- My Bets now shows simulated tickets and imported/IRL wagers together with explicit source and
  ticket-type badges. Source data remains in its existing separate systems of record.
- Imported cards retain available sportsbook, competition, event, selection, market, line, odds,
  stake, wager date, status, settlement economics, notes, and authorized private screenshot access.
  Parlay leg details and settlement controls use progressive disclosure. Open, All, Settled,
  Simulated, Imported, and Cancelled/Void filters are available.
- Owner-authorized imported straight results are entered or corrected on the card with the existing
  manual reason and audit boundary. Imported parlays retain the existing per-leg and ticket result
  workflow. Canonical Won/Lost/Push/Void calculations and correction audits are unchanged.
- The duplicate manual settlement interface and historical listing were removed from the Track
  Bet page; imported wager history is available in My Bets. Track Bet remains focused on reviewed
  import, detail entry, screenshot upload, and a link to imported wagers in My Bets. Screenshot
  viewing remains on its existing owner-protected route.
- Imported settlement does not create, debit, or credit a simulated bankroll ledger row. The
  existing owner RPC authorization, forced RLS, append-only correction audit, and analytics
  projection remain authoritative.

## Database, migrations, and security

Two forward-only migrations were added; no previously applied migration was changed:

- `supabase/migrations/20261008000000_v0_14_terminal_score_states.sql` commits the terminal score
  enum values needed by the Watchlist lifecycle.
- `supabase/migrations/20261008010000_v0_14_odds_watchlist.sql` adds the three odds/watch tables,
  uniqueness and lookup indexes, forced RLS policies, trusted snapshot-write RPC, authenticated
  owner-scoped watch/clear RPCs, and terminal-score cleanup trigger.

Authenticated users can read shared market state/history and only their own watch rows. Clients
cannot directly insert/update shared history or change watch lifecycle columns. The trusted
service-role cache boundary writes the shared snapshot/history. The `watch_odds` RPC validates the
current pregame market and submitted expected price before creating an owner watch; a unique
partial index prevents duplicate active watches without making line part of identity.

Imported settlement UI calls the existing authorized settlement RPCs; settlement access was not
broadened. New pgTAP tests verify direct table/API authorization, User A/User B isolation, anonymous
denial, screenshot route preservation, audit corrections, and no simulated ledger effects.

## Storage and API quota implications

Watch creation and Watchlist reads generate **zero provider calls** and no per-user history copies.
Fresh odds responses already fetched by the application now incur database change detection and
`last_seen_at` maintenance. Shared history stores one row for each first observation and meaningful
price/line change, rather than every refresh. Watch rows are retained with a clear reason for
lifecycle/audit purposes; shared history is retained after game completion and watch cleanup. No
history retention or compaction policy was added, so storage grows with captured market changes and
remains a future operations consideration. No live provider quota was consumed during validation.

## Specification, backlog, and version changes

- Updated `docs/Virtual Sportsbook - Governing Specification V1.docx` with **30. Post-V1 Product
  Amendments**, covering Odds Watchlist/Market Movement, Unified My Bets Management, and deferred
  CLV. All 720 original document paragraphs remain in their original order; the document now has
  739 paragraphs and all four amendment headings were structurally verified. The Markdown mirror
  `docs/PRODUCT_SPEC.md` was synchronized. Visual page rendering could not be run because Word,
  LibreOffice, and `soffice` are not installed in the workspace.
- Added CLV to `PRODUCT_BACKLOG.md`, including the need to define closing observations, line versus
  price methodology for spreads/totals/moneylines, bookmaker and possible consensus comparisons,
  user-level analysis, performance relationship, missing-close behavior, and methodology testing
  before showing values. No CLV calculation or placeholder was added to production.
- Updated `package.json`, `package-lock.json`, and `src/config/version-history.ts` to v0.14.0.
  `src/config/version.ts` continues to derive the application version from package metadata.
  README and repository architecture, migration, and testing documentation now describe v0.14.0.
  No tag or published release was created.

## Files created

- `VERSION_0_14_0_COMPLETION_REPORT.md`
- `src/app/watchlist/actions.ts`, `src/app/watchlist/loading.tsx`, `src/app/watchlist/page.tsx`
- `src/lib/watchlist/observations.ts`, `src/lib/watchlist/presentation.ts`,
  `src/lib/watchlist/server.ts`, `src/lib/watchlist/types.ts`
- `supabase/migrations/20261008000000_v0_14_terminal_score_states.sql`
- `supabase/migrations/20261008010000_v0_14_odds_watchlist.sql`
- `supabase/tests/v0_14_my_bets_settlement.sql`
- `supabase/tests/v0_14_odds_watchlist.sql`
- `test/v0-14-release-stress.mjs`
- `test/v0-14-my-bets-management.test.ts`, `test/v0-14-odds-history-concurrency.mjs`,
  `test/v0-14-watchlist-ui.test.ts`, `test/watchlist-observations.test.ts`,
  `test/watchlist-presentation.test.ts`

## Files modified

- `PRODUCT_BACKLOG.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/MIGRATIONS.md`,
  `docs/PRODUCT_SPEC.md`, `docs/TESTING.md`,
  `docs/Virtual Sportsbook - Governing Specification V1.docx`
- `package.json`, `package-lock.json`
- `src/app/globals.css`, `src/app/my-bets/actions.ts`, `src/app/my-bets/page.tsx`,
  `src/app/sports/[competition]/page.tsx`, `src/app/track-bet/actions.ts`,
  `src/app/track-bet/page.tsx`
- `src/components/external-parlay-result-form.tsx`, `src/components/odds-selection-grid.tsx`,
  `src/config/version-history.ts`, `src/lib/navigation.ts`, `src/lib/odds/postgres-store.ts`
- `test/auth-lifecycle-concurrency.mjs`, `test/phase4-settlement-concurrency.mjs`,
  `test/phase7-parlay-settlement-concurrency.mjs`, `test/private-beta-release.test.ts`,
  `test/release-candidate-fix-patch-2.test.ts`, `test/ui-polish.test.ts`

The existing settlement concurrency harnesses were aligned with the repository's current deferred
bankroll initialization lifecycle: their synthetic users now call the authenticated canonical
bootstrap before synthetic stakes are added. Settlement behavior and assertions were not changed.
The auth lifecycle harness also reports RPC error details on a failed assertion.

## Tests and validation results

All final local validation gates passed:

- `npm run validate`: **PASS** — Prettier, ESLint with zero warnings, TypeScript, Vitest (**44 test
  files, 263 tests**), secret scan, and optimized Next.js production build. Build includes
  `/watchlist`, `/my-bets`, and `/track-bet` routes.
- `npm run db:reset`: **PASS** — clean local replay of all **31 migrations**, including both new
  v0.14.0 migrations.
- `npm run test:db`: **PASS** — **28 SQL test files, 700 pgTAP assertions**, including new Watchlist
  lifecycle/RLS/history and imported settlement/correction coverage.
- `npm run db:lint`: **PASS** (exit 0). It reports two pre-existing warnings in
  `public.admin_settle_settlement_test` and `public.admin_create_settlement_test` for the existing
  `leg_number` variable being shadowed/unused. The v0.14.0 migrations add no lint warnings.
- `npm run test:db:watchlist-history-concurrency`: **PASS** — simultaneous trusted writes create
  one row per meaningful observation. The stress run issued **448 writes in 14 concurrent
  refresh bursts** and produced exactly **13 change points** in **1,446 ms**.
- `npm run test:db:v0-14-stress`: **PASS** — **124 watch requests across 24 users**, **100 racing
  clears**, and terminal cleanup of the remaining **23 watches** completed in **561 ms**. One
  shared history point remained. The final rerun created and settled **24 imported wagers concurrently**
  in **178 ms**; all result/return values and **24 audit rows** matched, cross-user settlement was
  denied, and no virtual-bankroll or simulated-wager rows were created. No live provider was called.
- Existing local concurrency gates: **PASS** — authenticated bankroll lifecycle; straight wager
  placement; straight settlement (one 25-unit return and 10,015-unit balance); parlay placement;
  parlay settlement (one 50-unit return, two won legs, and 10,040-unit balance); invite redemption;
  vision budget (100 of 120 concurrent reservations admitted within the $5 budget); and Watchlist
  history.
- `npm audit --audit-level=high`: **PASS**, zero vulnerabilities.
- `npm run security:scan`: **PASS**, no private-key, JWT-like, or populated server-secret assignment
  found.
- Local production-server HTTP smoke: **PASS** — GET `/`, `/watchlist`, `/my-bets`, and `/track-bet`
  returned HTTP 200. This was a route-response smoke, not an authenticated browser workflow.
- `git diff --check`: **PASS**, no whitespace errors.

Unit/source tests cover the watch navigation and eligible sportsbook control, current-odds Bet Slip
path, alternate-market exclusion, movement presentation, imported source badges/cards, manual
settlement and correction entry points, Track Bet settlement-control removal, and preserved
screenshot access. Database tests cover duplicate watches, independent users sharing one history,
pre-watch history, first/unchanged/price-only/line-change observations, market/event disappearance,
terminal cleanup for multiple users, cleanup idempotence, RLS, analytics/bankroll exclusion, and
imported settlement authorization/audits.

## Remaining validation limitations and assumptions

- No authenticated desktop/mobile browser walkthrough was performed. No hosted database migration
  or deployment was attempted. Local direct-database, unit, source-contract, concurrency, build, and
  anonymous HTTP route checks passed.
- No live provider call was made, so provider credentials, live response behavior, and quota headers
  were not exercised. The current score normalizer consumes the existing provider `completed`
  signal for final events; the trusted score-processing/database lifecycle also supports explicit
  `cancelled`, `abandoned`, and `void` states, covered by direct database tests. No cancellation state
  is inferred when the existing provider response does not identify one.
- DOCX contents and historical paragraph order were checked structurally, but rendered layout could
  not be visually reviewed because a DOCX renderer is unavailable on this host.
- Odds history has no retention/compaction policy in this release. Only observed change points are
  stored and shared; CLV methodology and calculations remain deferred.

## Explicit release checks

1. Does watching a market generate additional per-user provider polling? **No.**
2. Do multiple users share one underlying odds-history dataset? **Yes.**
3. Are redundant unchanged price snapshots avoided? **Yes; unchanged observations update the
   existing point's `last_seen_at`.**
4. Do completed games automatically disappear from active Watchlists? **Yes. Terminal score
   processing clears watches; kickoff cleanup keeps active views pregame if scoring is delayed.**
5. Is shared historical market data retained after watches clear? **Yes.**
6. Do watches remain excluded from bankroll, analytics, and leaderboards? **Yes.**
7. Does adding a watched market to the bet slip use current odds? **Yes; it uses the normal current
   sportsbook state and existing stale-price validation.**
8. Are imported wagers now manually settled from My Bets? **Yes.**
9. Has redundant settlement UI been removed from Track Bet? **Yes.**
10. Does manual imported settlement remain isolated from simulated bankroll? **Yes; no simulated
    bankroll ledger mutation is used.**
11. Was the governing `.docx` updated? **Yes; content and historical paragraph order were
    structurally verified. Visual rendering remains unverified on this host.**
12. Was CLV added to backlog without implementation? **Yes.**
13. Is the application version now v0.14.0? **Yes.**

## Recommendation

**PASS for the v0.14.0 implementation and local validation gates.** The requested application,
database, documentation, backlog, and version changes are complete. Production deployment remains
outside this task. Before a production rollout, perform authenticated desktop/mobile browser review
and visually render the governing DOCX on a host with Word or LibreOffice.
