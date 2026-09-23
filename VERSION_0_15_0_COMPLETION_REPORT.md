# Version 0.15.0 Completion Report

Date: 2026-09-23
Previous repository version: **0.14.0**
Target and completed version: **0.15.0**
Release recommendation: **CONDITIONAL PASS for implementation and local non-database validation**; authenticated responsive QA, local PostgreSQL replay, and production release gates remain pending because this host has no `.env.local`, Supabase public configuration, Docker, or LibreOffice.

## Objective

Version 0.15.0 changes Browse Odds from an all-markets event list into a schedule-first
experience. Users can select a display-timezone date, scan chronological kickoff groups, silently
benefit from deterministic sport-aware matchup ordering, jump to a canonical event, and open one
event's market board at a time. Existing simulated wagering, Watch Odds, alternate-line, stale-price,
straight/parlay, bankroll, settlement, analytics, authorization, and shared-cache boundaries remain
unchanged.

## Version transition

Repository inspection before implementation confirmed the current application/package version was
0.14.0 in `package.json`, the two root package records in `package-lock.json`, the version history,
and the v0.14.0 completion report. The current authorities now agree on 0.15.0:

- `package.json`: `0.15.0`.
- `package-lock.json`: root package version records `0.15.0`.
- `src/config/version.ts`: still derives the displayed version from `package.json`.
- `src/config/version-history.ts`: adds the v0.15.0 entry while preserving v0.14.0 history.
- `README.md`, architecture, product, migration, and testing documents identify v0.15.0 as the
  current feature release.
- `VERSION_0_15_0_COMPLETION_REPORT.md`: records the v0.14.0 -> v0.15.0 transition.

No Git tag or GitHub Release was created. The approved v0.15.0 source-preservation commit is being
prepared on `main`; final release approval remains conditional on the blocked validation gates below.

## Implementation summary

### Schedule-first Browse Odds

- Added `src/lib/browse-schedule.ts` as deterministic, testable pure browse logic.
- Added a display-timezone date key using `Intl.DateTimeFormat`; UTC timestamp slicing is not used.
- Default date selection uses today when it has live/upcoming games, otherwise the nearest upcoming
  date, and only falls back to a completed date when no future date exists.
- Added previous/next date controls and a native date input. Dates with cached event data are
  suggested without making a new provider request.
- Added kickoff-minute grouping with chronological group order and explicit canonical-event-ID tie
  breaking.
- Added `BrowseScheduleControls` with date and Jump to Game controls. Query state carries the date
  and canonical event ID; slip contents and price objects are not serialized.
- Added `BrowseGameCard` compact rows with team marks, rankings, reliable records when available,
  kickoff, status, and an explicit markets-open/view-markets affordance.
- Only the selected event renders `OddsSelectionGrid`; other events remain compact rows. Selecting
  another event preserves existing straight/parlay slip state because the slip remains in its
  existing client persistence boundary.
- Existing bookmaker filters, market filters, Watch Odds, provider-priced alternate lines, stale
  validation, and simulated alternate-line pricing remain on the active event path.
- Cached events remain visible even when a selected bookmaker or market has no price, so schedule
  navigation does not make the slate disappear. The active default prefers an event with supported
  odds and safely shows an empty/locked board when none is available.

### Sport-aware priority and metadata

- Added `src/config/sport-context.ts` with stable college aliases, conference membership, Power Four
  classification, explicit rivalry pairs, ranking snapshots, and standings adapter types.
- NCAAF ordering within one identical local kickoff bucket is:
  1. ranked versus ranked;
  2. ranked versus unranked;
  3. unranked same-conference game, excluding independent teams;
  4. unranked non-conference game.
- Ranked-versus-ranked games use combined rank, best rank, second rank, then deterministic secondary
  signals. Ranked-versus-unranked games use the ranked team's number. Rivalry, Power Four, winning
  records, and combined winning percentage are secondary only and cannot cross the major levels.
- EPL and La Liga have a separate standings adapter. When a reliable snapshot exists, same-kickoff
  top-six matchups rank above top-six-versus-lower-table and remaining games. At most one qualifying
  event receives the subtle `Marquee Matchup` label. Tournament competitions and other sports do
  not receive fabricated NCAAF logic; missing context falls back to stable event-ID ordering.
- Priority levels, scores, and ranking-vs-unranked categories are not exposed in the UI.

### College rankings

- The current ranking source is a manually maintained, source-controlled AP Top 25 snapshot in
  `src/config/sport-context.ts`, updated 2026-09-20 from the published AP poll:
  <https://apnews.com/article/college-football-rankings-top-25-24005ba778fee95626d65d5deb5a18f8>.
- The UI shows `Rankings: AP Top 25` and the snapshot update date. Ranked numbers appear immediately
  before team names; unranked teams have no `NR` marker.
- A CFP snapshot adapter is present. CFP becomes active only when a dated, non-empty CFP snapshot
  is supplied and has reached its effective date; otherwise AP remains primary.
- Rankings are not refreshed with odds, are not polled on page view, and are not persisted in the
  database.

### Standings, conference, rivalry, and record sources

- Conference, Power Four, rivalry, and stable team mappings are centralized in
  `src/config/sport-context.ts`, using explicit maintainable configuration rather than render-time
  fuzzy matching.
- Only the Florida 3-0 record from the current AP context is included as reliable source-controlled
  record metadata in this release. Unknown or stale records are omitted rather than invented.
- No reliable zero-cost standings source was already integrated. EPL and La Liga standings therefore
  remain empty adapters in production v0.15.0; soccer priority and marquee behavior are implemented
  and fixture-tested, but no live marquee label is forced. Supplying a maintained standings snapshot
  is a future manual operation.

## Sticky-sidebar correction and responsive behavior

- Replaced independently sticky Bet Slip children with one coordinated desktop sticky right rail.
- The rail accounts for the persistent header, uses viewport-relative max height, and scrolls
  internally when its contents exceed a short laptop viewport.
- Child slip sections remain in normal flow, preventing selected-event and alternate-line content
  from colliding with the slip.
- Mobile retains the existing mobile tray/sheet and does not inherit desktop rail stickiness.
- Compact schedule controls and rows stack on narrow screens; active state is communicated by text,
  structure, and styling rather than color alone.

## Database, migrations, and security

No database migration was created. The release uses existing normalized event/cache data and
source-controlled application metadata. No table, RPC, RLS policy, quota-ledger purpose, wager
field, settlement function, bankroll path, storage boundary, or provider-secret boundary changed.

The linked Supabase project was verified as `owqlxdzvgbjzwcalwfjq` (`The Units Lab`,
`ACTIVE_HEALTHY`). `supabase migration list --linked` showed every local migration through
`20261008010000` matching remote, with no pending migration. This release therefore has no
production migration to apply; `supabase db push` was intentionally not run.

Date, event, bookmaker, and market query values are validated or safely ignored by the page. Refresh
return paths are restricted to the current competition path. Provider and Supabase service-role
secrets remain server-only. The existing RLS and server-authoritative wager validation are untouched.

The governing `docs/Virtual Sportsbook - Governing Specification V1.docx` was amended with the same
30.4 v0.15.0 product section, and `docs/PRODUCT_SPEC.md` remains its synchronized Markdown
transcription. Structural paragraph verification passed; visual DOCX rendering could not run because
LibreOffice is not installed on this host.

## API, cache, and quota implications

- Date changes, previous/next navigation, Jump to Game, sorting, expansion, and ranking display do
  not have client-side provider fetch paths.
- A page navigation still reads through the existing shared odds service, so valid cached data is
  reused, refresh leases/coalescing remain authoritative, and no upstream Odds API call is caused
  solely by a browse-state change while the cache is valid.
- Alternate provider pricing remains the existing explicit on-demand action for the active event.
- Rankings and standings are static/adapter data and are not tied to odds refresh or polling.
- No paid dependency or new provider was added.

## Tests and validation

Passed:

- `npm.cmd run format:check`.
- `npm.cmd run lint` with zero warnings.
- `npm.cmd run typecheck`.
- `npm.cmd test`: **46 test files, 279 tests passed**.
- `test/v0-15-browse-schedule.test.ts`: **10 tests passed** within the full suite, covering date
  filtering/timezone boundaries, nearest-upcoming default, kickoff groups, NCAAF ordering and
  secondary context, deterministic ties, soccer priority/marquee limits, AP-to-CFP transition,
  rank display, active-board structure, and sticky-rail contracts.
- `npm.cmd run security:scan`.
- `npm.cmd audit --audit-level=high`: **0 vulnerabilities**.
- `npm.cmd run build`: production Next.js build passed and generated the dynamic
  `/sports/[competition]` route.
- `git diff --check`.
- Linked Supabase project verification and migration parity check passed; no v0.15.0 migration
  was pending.
- Anonymous local HTTP smoke: `/`, `/auth`, `/sports`, and `/sports/ncaaf` returned HTTP 200; the
  browser route safely recovered to sign-in when public Supabase configuration was absent.

Not run or blocked:

- `npm.cmd run db:lint`, `npm.cmd run test:db`, and the existing v0.14/concurrency stress entry
  points (`test:db:v0-14-stress`, cache, settlement, parlay placement, parlay settlement,
  watchlist-history, auth-lifecycle, and vision-budget concurrency) all stop before exercising
  data because local Supabase status is unavailable. Docker is not installed on this host; the
  Supabase CLI also hit the restricted profile while trying to write telemetry. These suites were
  not redirected at production because they create disposable users/events and are not safe as a
  production substitute.
- Authenticated desktop/mobile responsive walkthrough at 375px, 430px, tablet, 1366px, 1440px,
  and short-height laptop dimensions could not run because no `.env.local` or Supabase public
  configuration is present and no test account/session is available.
- The DOCX render-and-PNG inspection could not run because bundled/system `soffice.exe` is absent.

## Files changed for v0.15.0

Created:

- `src/components/browse-game-card.tsx`
- `src/components/browse-schedule-controls.tsx`
- `src/config/sport-context.ts`
- `src/lib/browse-schedule.ts`
- `test/v0-15-browse-schedule.test.ts`
- `VERSION_0_15_0_COMPLETION_REPORT.md`

Modified for this release:

- `package.json`, `package-lock.json`, `src/config/version-history.ts`
- `src/app/sports/[competition]/page.tsx`, `src/app/sports/actions.ts`, `src/app/globals.css`
- `src/lib/odds/display.ts`, `src/lib/odds/server.ts`, `src/lib/odds/types.ts`
- `test/mobile-bet-slip-ux.test.ts`, `test/private-beta-release.test.ts`
- `README.md`, `docs/ARCHITECTURE.md`, `docs/MIGRATIONS.md`, `docs/PRODUCT_SPEC.md`,
  `docs/TESTING.md`, `docs/Virtual Sportsbook - Governing Specification V1.docx`

Pre-existing dirty worktree changes in Watchlist/cache/postgres-store files were preserved and not
rewritten as part of this release. No historical v0.14.0 report was changed.

## Remaining manual maintenance and issues

- Update the AP snapshot manually when a new poll is published, or add a reviewed zero-cost source
  adapter later. Add a dated CFP snapshot when CFP rankings become available.
- Add reviewed EPL/La Liga standings snapshots if live table-aware soccer ordering and Marquee
  Matchup presentation are desired.
- Run the authenticated responsive smoke scripts and local PostgreSQL replay on a development host
  with Docker, Supabase configuration, and a disposable test account before production release.
- Render and visually inspect the governing DOCX on a host with Word or LibreOffice.

## Release recommendation

**CONDITIONAL PASS for v0.15.0 implementation.** The requested schedule-first browsing, date state,
deterministic sport-aware priority infrastructure, AP/CFP ranking adapter, safe metadata fallback,
active-game market rendering, slip-preserving navigation, and coordinated sticky rail are implemented
and covered by local code/build/test gates. Production migration parity is verified and is a no-op.
Source-control preservation is approved, but final v0.15.0 release approval remains pending until
the blocked database stress, authenticated responsive, and DOCX visual gates are run in an
appropriately configured environment.
