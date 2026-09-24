# Version 0.15.1 Completion Report

Date: 2026-09-24
Previous repository version: **0.15.0**
Target and completed version: **0.15.1**
Release recommendation: **CONDITIONAL PASS for implementation and local validation**; authenticated responsive QA and DOCX visual rendering remain pending.

## Objective

Version 0.15.1 is a corrective Browse Odds patch for production QA findings. It fixes
timezone-drifting date/kickoff presentation, prevents an event from opening implicitly,
and makes the desktop Browse layout match the approved three-region master/detail design.

## Version transition

Repository inspection confirmed the current release was v0.15.0 before this patch. The
version now agrees across the application metadata and release documentation:

- `package.json`: `0.15.1`.
- `package-lock.json`: root package records `0.15.1`.
- `src/config/version.ts`: continues to derive the displayed version from `package.json`.
- `src/config/version-history.ts`: adds v0.15.1 while retaining the v0.15.0 history.
- README, architecture, product, migration, testing, and this report identify v0.15.1.

The initial v0.15.0 source-preservation commit was `5ca2a32d16670ab7c14b696b3980b537618371f6`.
The corrective preview commit is `ddeb96bf41ea4484f4bd98bbe5eae4d24737ffd7`
(`fix: correct browse market board prop contract`).
The desktop remediation commit is `486923315a59fb0be4b34ec6798b9d305fc0b6f6`
(`fix: refine v0.15.1 desktop browse layout`). All are on `release/v0.15.1`; `main` remains
unchanged. No Git tag, GitHub Release, merge to main, or production deployment was created. The
historical v0.15.0 report was not rewritten.

## Vercel Preview correction

The first Preview for `5ca2a32d16670ab7c14b696b3980b537618371f6` failed during TypeScript
validation at `src/components/browse-market-board.tsx:88`. `BrowseMarketBoard` passed the intended
optional `watchlistAvailable` flag into `OddsSelectionGrid`, but the committed `OddsSelectionGrid`
prop contract accepted only `odds`. The current dirty worktree contained the corresponding
Watchlist-aware prop contract and forwarding logic, which is why validation run from that dirty
checkout passed while the clean Vercel artifact failed. The v0.15.1 commit did not depend on the
other dirty Watchlist/cache/Postgres changes.

The minimum fix adds `watchlistAvailable?: boolean` with a backward-compatible `true` default to
`OddsSelectionGrid`, forwards it to desktop/mobile `OddChoice` renderings, and suppresses Watchlist
controls only when the Browse page reports that Watchlist reads are unavailable. No `any` cast,
TypeScript suppression, or unrelated Watchlist/cache/Postgres file was included.

The clean corrective worktree at `ddeb96bf41ea4484f4bd98bbe5eae4d24737ffd7` ran `npm ci`, lint, typecheck, `npm test` (46 files / 277
tests), production build, and secret scan successfully. The clean Windows checkout initially
reported repository-wide LF/CRLF formatting differences and three LF-sensitive source-contract
test failures; normalizing only that disposable verification worktree removed those environment
artifacts without changing the committed source, after which all required gates passed.

Vercel Preview for `ddeb96bf41ea4484f4bd98bbe5eae4d24737ffd7` completed successfully (`success` / `Deployment has completed`). The
Preview URL is:
<https://theunitslab-git-release-v0151-donohuejs-1066s-projects.vercel.app>

The desktop remediation commit `486923315a59fb0be4b34ec6798b9d305fc0b6f6` also completed
successfully in Vercel (`success` / `Deployment has completed`). Its Vercel deployment dashboard
is:
<https://vercel.com/donohuejs-1066s-projects/theunitslab/8Vzek1tK7siVWCuq9xB93UwL6wdo>
The branch Preview URL remains protected by Vercel Login from this environment.

The deployment is protected by Vercel Login from this environment, so Preview environment-variable
configuration cannot be independently confirmed. No Vercel environment variables were changed.

## Implementation summary

### Timezone and date grouping

- Added `normalizeBrowseTimeZone` and `filterEventsForBrowseDate` to the shared pure Browse
  schedule module.
- One normalized timezone now drives selected-date filtering, date labels, kickoff groups,
  chronological ordering, Jump to Game labels, compact event cards, and selected-game detail.
- The established Eastern Time Browse fallback treats the profile database's historical `UTC`
  default as a legacy sentinel; explicit valid profile timezones remain respected. Invalid or
  missing values also fall back safely to Eastern Time.
- Conversion uses `Intl.DateTimeFormat` and therefore handles DST without UTC slicing, manual
  offsets, or `getUTCHours`-style arithmetic.
- Regression fixtures cover Northwestern/Indiana (Sep 25, 8:00 PM ET), Clemson/California
  (Sep 25, 10:30 PM ET), Texas/Tennessee (Sep 26, 12:00 PM ET), and the spring DST boundary.

### Neutral selection and navigation

- Browse now starts with `activeEvent = null` unless a valid event ID is explicitly present in
  the query.
- The Jump to Game control starts at `Select a matchup...`; selecting its placeholder clears the
  active event safely.
- Date/competition navigation clears incompatible event, market, alternate, and selection query
  state. Canonical event IDs remain the only event identity in navigation.
- A valid explicit event query selects the event, exposes its board, and requests the existing
  scroll-into-view behavior. Invalid event queries recover to the neutral state.

### Desktop and mobile presentation

- Desktop Browse now uses an expanded shell and a deliberate three-region layout: a 320–350px
  Games navigator, a center selected-game market detail region with a 500px minimum, and a
  330–360px coordinated right Bet Slip rail. The layout switches to a two-column/tablet form
  before those minimums can squeeze the page.
- Desktop bookmaker and market filters are compact native selects; the existing horizontal mobile
  filter chips remain mobile-only.
- Desktop game cards use vertical compact navigation rows, word-boundary team wrapping, accessible
  logos/rankings/names/kickoff/status text, and a subtle selected-state chevron without redundant
  visible “View markets” text. The mobile label remains available below the mobile breakpoint.
- The full market board is rendered only for the selected event in the desktop detail region;
  mobile retains an inline selected-game expansion for the compact single-column flow.
- The filter bar places Date, Jump to Game, Bookmakers, Market, and Refresh Odds together.
- The existing coordinated sticky Bet Slip rail remains one sticky parent with controlled internal
  scrolling; mobile does not inherit desktop right-rail stickiness.
- The new structure preserves bookmaker filters, Watch Odds, alternate-line behavior, straight and
  parlay slip persistence, stale-price validation, and server-authoritative placement.

## Sorting, rankings, and metadata

The v0.15.0 deterministic sport-aware priority engine remains unchanged. Kickoff date and time
remain the primary dimensions; priority only operates inside identical kickoff-time buckets.
NCAAF hierarchy remains ranked-vs-ranked, ranked-vs-unranked, unranked conference, then unranked
non-conference, with rivalry, Power Four, record, and deterministic ID tie-breakers at the intended
depth. Domestic soccer standings and marquee adapters remain separate from college-football logic.

- Ranking source: source-controlled AP Top 25 snapshot in `src/config/sport-context.ts`; CFP is a
  dated adapter that becomes active only when a valid CFP snapshot is supplied.
- Ranking refresh/update mechanism: manual reviewed snapshot maintenance; rankings are not fetched
  or refreshed with odds and are not polled per page view.
- Standings source: existing centralized source-controlled adapter/snapshot structure in
  `src/config/sport-context.ts`; no new paid or brittle external source was introduced.
- Conference, Power Four, rivalry, records, and team IDs come from centralized configuration and
  degrade to neutral deterministic ordering when absent or stale.
- Unranked teams show no `NR` marker; known rankings appear immediately before the team name.

## Database, migrations, and security

No database migration was created. v0.15.1 changes only shared Browse presentation and pure
client/server selection logic. The linked Supabase project was verified as The Units Lab
(`owqlxdzvgbjzwcalwfjq`, `ACTIVE_HEALTHY`), and the read-only linked migration list showed local
and remote parity through `20261008010000`. No migration was pending, so `supabase db push` was
intentionally not run.

No RLS policy, authorization rule, provider-secret boundary, wager mathematics, immutable ticket
snapshot, bankroll, settlement, analytics, quota, or cache semantics changed.

## API-cost implications

Changing date, grouping, sorting, Jump to Game, selecting/collapsing a game, or changing ranking
presentation performs no independent provider request. The existing shared odds service and cache
remain the data boundary. Explicit alternate-line loading remains the existing selected-event flow;
rankings and standings do not trigger odds refreshes. No paid dependency or uncontrolled polling was
added.

## Files changed for v0.15.1

Created:

- `src/components/browse-market-board.tsx`
- `test/v0-15-1-browse-corrections.test.ts`
- `VERSION_0_15_1_COMPLETION_REPORT.md`

Modified for this patch:

- `package.json`, `package-lock.json`, `src/config/version-history.ts`
- `src/app/globals.css`, `src/app/sports/[competition]/page.tsx`
- `src/components/browse-filter-select.tsx`, `src/components/browse-game-card.tsx`,
  `src/components/browse-schedule-controls.tsx`,
  `src/components/kickoff-time.tsx`
- `src/lib/browse-schedule.ts`
- `test/private-beta-release.test.ts`, `test/release-candidate-fix-patch-1.test.ts`,
  `test/release-candidate-fix-patch-2.test.ts`, `test/v0-15-browse-schedule.test.ts`
- `README.md`, `docs/ARCHITECTURE.md`, `docs/MIGRATIONS.md`, `docs/PRODUCT_SPEC.md`,
  `docs/TESTING.md`, `docs/Virtual Sportsbook - Governing Specification V1.docx`

Unrelated pre-existing Watchlist/cache/Postgres-store worktree changes were preserved and are not
claimed as part of this patch.

## Tests and validation

Passed:

- `npm.cmd run validate`: format check, lint, typecheck, 47 test files / 283 tests, secret scan,
  and production build.
- `npm.cmd audit --audit-level=high`: 0 vulnerabilities.
- `npm.cmd run db:lint`: completed against local Supabase; only the two pre-existing settlement-test
  PL/pgSQL shadow/unused-variable warnings were reported.
- `npm.cmd run test:db`: 28 files / 700 database assertions passed.
- Existing local concurrency suites all passed: invite-code, watchlist-history, v0.14 release
  stress, auth lifecycle, wager placement, settlement, parlay placement, parlay settlement, and
  vision-budget quota.
- Read-only linked Supabase project and migration parity checks passed; no v0.15.1 migration exists
  or is pending.
- `git diff --check` and source-level responsive/master-detail contracts passed.
- Clean corrective-commit validation at `ddeb96bf41ea4484f4bd98bbe5eae4d24737ffd7`: `npm ci`, lint, typecheck, 46 test files / 277
  tests, production build, and secret scan all passed.
- Clean desktop-remediation validation at `486923315a59fb0be4b34ec6798b9d305fc0b6f6`: `npm ci`,
  format check, lint, typecheck, 46 test files / 277 tests, production build, and secret scan all
  passed. The Vercel Preview check also passed.

Blocked or pending:

- Authenticated responsive QA at 375px, 430px, tablet, 1366px, 1440px, and short-height laptop
  dimensions remains blocked because this checkout has no `.env.local`, public Supabase
  configuration, or authenticated browser/session. The available unauthenticated local smoke
  safely redirected `/sports/ncaaf` to `/auth`; it did not prove the authenticated Browse screen.
- The pushed desktop Preview is available and its deployment check passed, but an authenticated
  desktop smoke test at 1920px, 1440px, 1366px, and 1280px, including a short-height laptop,
  remains pending before final release approval.
- DOCX visual rendering and PNG inspection remain blocked because LibreOffice/`soffice.exe` is not
  installed. Structural governing-document editing completed successfully.

## Metadata that degrades gracefully

Missing or invalid profile timezone, rankings, standings, conference, rivalry, record, or team-mark
metadata falls back to a safe normalized timezone, no ranking marker, omitted record/context, stable
event ordering, and readable team initials. Invalid event/date query state does not corrupt the
active slip or select an incompatible event.

## Deviations and assumptions

- Production QA examples establish Eastern Time as the expected Browse display for legacy profiles,
  so historical profile value `UTC` is interpreted as the Browse fallback rather than as an explicit
  user preference. An explicit non-UTC profile timezone is preserved.
- No reliable zero-cost automated rankings or standings feed was available in the existing
  architecture. The maintained AP/CFP and standings adapter/snapshot approach remains the safe
  source of truth; no scraper or paid provider was introduced.
- Authenticated visual QA and DOCX rendering could not be promoted from pending to pass on this
  host because the required environment/session and LibreOffice renderer are absent.

## Remaining manual maintenance and issues

- Maintain AP/CFP ranking snapshots and any future EPL/La Liga standings snapshots through the
  existing centralized configuration process.
- Revisit the Eastern fallback after all legacy UTC profile defaults are intentionally migrated to a
  user-selected timezone.
- Run the authenticated responsive walkthrough and DOCX visual inspection on a configured QA host.
- Existing database lint warnings are outside this Browse patch and remain unchanged.

## Release recommendation

**CONDITIONAL PASS for v0.15.1 implementation.** The timezone/date regressions, neutral event
selection, desktop master/detail structure, mobile behavior, metadata fallbacks, version metadata,
and documentation are implemented and covered by passing code/database validation. Final release
approval should wait for authenticated responsive QA and DOCX visual rendering on an appropriately
configured environment. No database migration needs to be applied.
