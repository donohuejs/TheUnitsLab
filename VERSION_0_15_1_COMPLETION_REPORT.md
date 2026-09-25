# Version 0.15.1 Completion Report

Date: 2026-09-25
Previous repository version: **0.15.0**
Target and completed version: **0.15.1**
Release recommendation: **CONDITIONAL PASS for implementation, automated validation, and Preview deployment**; authenticated responsive QA and DOCX visual rendering remain pending.

## Objective

Version 0.15.1 is a corrective Browse Odds patch for production QA findings. It fixes
timezone-drifting date/kickoff presentation, prevents an event from opening implicitly,
makes the desktop Browse layout match the approved three-region master/detail design,
fills that workspace to the remaining desktop viewport height, and keeps the Bet Slip
independent from active-event navigation.

## v0.15.1 logo coverage correction

The follow-up logo QA found a systemic NHL failure rather than isolated missing
aliases. The previous NHL registry used stale numeric team IDs as numeric NHL CDN
asset references. Current ESPN NHL assets use abbreviation references, so the
registry now separates canonical provider identity from the asset reference and
uses the correct `/nhl/500/{abbreviation}.png` namespace. The same source-controlled
catalog architecture now covers the current supported EPL, UCL, and NCAAF FBS team
sets.

Canonical coverage hard gates are now 32/32 NFL, 32/32 NHL, 20/20 EPL, 36/36 UCL,
and 138/138 current FBS teams, all with valid namespace-correct references. The
previous UCL `36/36` result was not provider coverage: it only resolved the 36
canonical ESPN catalog display names and never exercised the provider team strings
from retained odds data. The tracked The Odds API UCL cache row contains 18 events
and 36 distinct provider strings. The corrected gate now reports canonical clubs
36/36, provider strings 36/36, unresolved 0, ambiguous 0, and 7 exact aliases
from that real dataset: `Bodø/Glimt`, `LASK`, `Porto`, `RC Lens`, `Slavia Praha`,
`Sporting Lisbon`, and `ŠK Slovan Bratislava`.

The public ESPN team catalog is captured in `src/config/team-catalog.json`; updates
are manual and reviewed, rankings/standings are not involved, and no odds or
provider calls are triggered by logo resolution. `npm run audit:team-logos` is the
deterministic developer audit; `--check-assets` performs a bounded CDN reference
check.
The external CDN check passed for every unique snapshot URL, with no broken logo
references. Runtime CDN failure still degrades to initials without changing identity.

Generic NCAA inputs (`Miami`, `Miami (OH)`, `USC`, `UT`, and `Tigers`) remain
unresolved rather than receiving a guessed identity. Fully qualified catalog names
resolve, including `Miami (OH) RedHawks`. NHL, EPL, UCL, and FBS registry resolution
is exact and competition-scoped, and shared soccer clubs retain one canonical ID
across domestic and European scopes. The complete provider-string-to-canonical
mapping is recorded in `TEAM_LOGO_IDENTITY_AUDIT.md` and regression-tested from
`test/fixtures/odds-ucl-provider-teams.json`. No database migration was required.

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

The Bet Slip/date-navigation remediation commit is `4933d8a`
(`fix: preserve bet slip across game navigation`). It is also on `release/v0.15.1`; `main` remains
unchanged.

The follow-up portal-lifecycle correction is `c19d0f1`
(`fix: rebind bet slip portal across browse navigation`). It is also on `release/v0.15.1`; `main`
remains unchanged.

The final external Preview correction is split into two commits:
`e0847a3` (`fix: prevent alternate line update loop`) and
`polish: refine browse odds navigation and cards`. Both are on
`release/v0.15.1`; `main` remains unchanged.

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

The Bet Slip/date-navigation remediation commit `4933d8a` also completed successfully in Vercel
(`success` / `Deployment has completed`). Its deployment dashboard is:
<https://vercel.com/donohuejs-1066s-projects/theunitslab/HB1bG31H5JAroJBsmun3dZ1CY5j8>
The branch Preview URL remains:
<https://theunitslab-git-release-v0151-donohuejs-1066s-projects.vercel.app>

The portal-lifecycle correction `c19d0f1` completed successfully in Vercel
(`success` / `Deployment has completed`). Its deployment dashboard is:
<https://vercel.com/donohuejs-1066s-projects/theunitslab/CbUgqrkeKdM5zk3aNPcDwdcTssPC>
The Preview remains protected by Vercel Login from this environment, so authenticated behavior
cannot be independently confirmed here.

The final external-correction commits were pushed to `origin/release/v0.15.1` after
local validation. Vercel Preview creation/status was not independently verified in
this session; the prior branch Preview remains protected by Vercel Login.

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

- Desktop Browse now uses a bounded three-region layout beginning at the shared 980px desktop
  workspace breakpoint: responsive 280–320px Games and Bet Slip rails around the selected-game
  market detail region. Below that breakpoint the natural tablet/mobile flow remains in place;
  the three-column layout and viewport-owned pane scrolling cannot enter a hybrid state.
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
- The date control now reserves a 15.5rem desktop track and presents a readable formatted date
  label over the native picker input. This removes the desktop truncation seen at 1366px, 1440px,
  and 1920px without changing the compact mobile controls or introducing horizontal overflow.

### Bet Slip navigation correction

The QA failure was that straight/parlay selection state appeared to reset when navigating from
event A to event B. The durable slip store itself was not cleared by navigation code, but the
`BetSlip` host lived inside the query-driven Browse page. Changing the active event therefore
replaced the Bet Slip boundary and coupled active-event/current-selection rendering to the slip
component lifecycle. That made navigation unsafe for visible and transient slip state, especially
on mobile.

The correction separates these responsibilities: `BrowseBetSlipProvider` owns a stable Bet Slip
host at the competition layout boundary, while `BrowseBetSlipBridge` updates only the current
event selection and bookmaker groups. Straight, parlay, and mobile pending selections remain
owned by the existing durable slip store. No navigation path clears slip contents, and legitimate
user clear/removal behavior is unchanged. The regression test covers event A selection, navigation
to B, adding B, switching back to A, and mobile pending selections.

Authenticated Preview QA then reproduced the failure despite that first correction. The exact
boundary was the portal target itself: the target `<div>` was still owned by the query-driven page,
while `BrowseBetSlipProvider` persisted in the competition layout. `BrowseBetSlipBridge` looked up
that target in an effect that depended only on the persistent context. A soft `router.push` replaced
the page DOM node but reused the bridge, leaving the portal attached to the detached old node. The
store did not intentionally clear the selection; the rendered Bet Slip disappeared with its stale
DOM host.

Commit `c19d0f1` makes the target a client component with a callback ref. Every newly mounted target
node registers itself with the persistent provider, and the bridge also re-resolves the target when
its page props change. This preserves the stable provider/store architecture while making the
portal resilient to real search-parameter navigation. The new Playwright smoke script exercises the
actual Browse page, Games navigator, Jump to Game control, straight-slip A→B→A+B flow, and mobile
A→B flow. The earlier unit test appeared correct because it only exercised the durable store and
static component contracts; it never replaced the portal DOM node through a router transition.

## Final external Preview corrections

The Florida/Gators alternate-line crash was reproduced locally in the development
React build using the development-only Patch 10 harness: select the FanDuel
provider spread at `-3.5`, then choose the existing Simulated Alternate Line
value `-2.5`. The pre-fix console reported React's maximum update depth error and
the development stack identified `BetSlip`'s effect calling
`setStraightSlipSelections`.

The exact cycle was:

1. `activeSelection` derived the simulated `-2.5` selection from the provider
   `-3.5` anchor.
2. The alternate reconciliation effect replaced the provider selection in the
   durable straight slip with the simulated selection.
3. The auto-add effect saw the original provider selection absent and appended it.
4. The reconciliation effect replaced the provider selection again, producing a
   new store snapshot and repeating the cycle until React raised error #185.

The correction removes the competing auto-add effect and uses one idempotent
`reconcileActiveStraightSelection` path. It replaces the provider anchor or the
previous simulated alternate for the same provider identity, retains exact
pricing metadata, and returns the existing array when no change is needed.
Provider-priced alternates remain ordinary provider selections; they are not
converted into simulated alternates. Mobile removal also targets the active
simulated selection and suppresses one re-add during URL cleanup.

Browse polish now provides a keyboard-accessible central date button backed by the
existing native date input and `showPicker`/fallback behavior. Previous and next
date navigation remains intact, and date changes continue to clear incompatible
event state through the existing query architecture. Ordinary scheduled event
badges are omitted while live and completed statuses remain visible. Odds tiles
retain bookmaker, selection, line, odds, and selected-state information while
removing the repeated ordinary `pregame price` label; live/final indicators
remain meaningful.

At the desktop breakpoint, Games, Markets, and Bet Slip are bounded independent
scroll panes. The Games pane uses the existing `scroll={false}` navigation, the
Markets pane resets only its own `scrollTop` when the canonical active event ID
changes, and the Bet Slip pane is no longer an independently sticky child that
can overlap the center content. Mobile remains natural page flow and does not
inherit the desktop pane height or right-rail scrolling.

The final desktop height regression was traced to the height chain itself: the
`.browse-master-detail-layout` grid used a fixed
`min(72rem, calc(100dvh - var(--desktop-header-offset) - 1rem))` value while
`.browse-shell` remained a normal-flow block. The global header-offset token was
not the actual amount of space consumed above the workspace, so the pane bottom
could stop well short of the viewport. At the desktop three-pane breakpoint,
`.browse-shell` is now a bounded `height: 100dvh` / `min-height: 100dvh` flex
column with `overflow: hidden`, the workspace is a `flex: 1 1 auto` /
`min-height: 0` grid item, and each pane stretches into that row and owns its
`overflow-y: auto`. The obsolete fixed workspace height and pane `max-height`
constraint were removed. The mobile and medium-width natural document-flow
layout remains unchanged.

### Measured desktop overflow correction

Authenticated Preview measurements supplied from the broken Saturday NCAAF page showed a
1218×1270 viewport with `documentElement.scrollHeight = 14118`, `body.scrollHeight = 14118`,
and `.browse-shell` computed as a 14118px `display: block` element with `overflow-y: visible`.
The source audit found that the shell height, pane overflow, and three-column grid were all
gated by `@media (min-width: 1240px)`, so they were not active at the measured 1218px CSS
viewport. The correction moves the complete desktop workspace contract to one `@media
(min-width: 980px)` block and uses responsive three-column tracks that fit the measured width.

The local Playwright breakpoint regression covers 979, 980, 1218, 1239, and 1240px with short
and long synthetic slates. At 980px and above, both slate sizes keep the document and body at
1270px, keep the shell at 1270px, and retain the long Games content inside the Games pane
(`scrollHeight = 10543px` in the long fixture). The 979px fallback remains natural flow. An
authenticated post-fix Preview measurement remains pending; the supplied authenticated
before-measurement is the root-cause evidence, while the local matrix verifies the corrected CSS
architecture and breakpoint invariant.

### Root document scroll-lock correction

The next authenticated Preview measurement showed that the pane architecture was correct while
the root HTML document remained scrollable: at 1218×1270, the document element reported
`scrollHeight = 13186px`, while `body` and `.browse-shell` were both correctly bounded at
1270px. The Games, Markets, and Bet Slip panes remained the intended independent scroll owners.

The correction adds `BrowseRootScrollLock` to the existing `/sports/[competition]` layout. It
adds and removes a route-scoped `browse-route-active` class on `html`; CSS locks `html` and
`body` to `100dvh` with `overflow-y: hidden` only at the same `min-width: 980px` desktop
breakpoint. Unmount cleanup restores ordinary document scrolling when leaving Browse, and below
980px the class has no locking effect so mobile/tablet natural flow remains unchanged.

The new browser regression covers the exact alternate-line interaction, one
selection with the retained line/price metadata, switching games, returning to
the original game, and clean removal. No migration or provider request path was
added.

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
- `src/app/sports/[competition]/layout.tsx`
- `src/components/browse-bet-slip-host.tsx`
- `scripts/check-browse-slip-navigation.mjs`
- `test/v0-15-1-browse-corrections.test.ts`
- `test/v0-15-1-slip-navigation.test.ts`
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
- Logo-coverage correction: `src/config/team-catalog.json`, `src/lib/teams/logos.ts`,
  `src/lib/odds/types.ts`, `src/lib/odds/normalize.ts`, `src/components/team-mark.tsx`,
  `src/components/browse-game-card.tsx`, `src/app/sports/[competition]/page.tsx`,
  `src/lib/betslip/event-matching.ts`, `src/lib/odds/server.ts`, `scripts/audit-team-logos.mjs`,
  `test/team-logos.test.ts`, `test/fixtures/odds-ucl-provider-teams.json`, and
  `TEAM_LOGO_IDENTITY_AUDIT.md`
- `README.md`, `docs/ARCHITECTURE.md`, `docs/MIGRATIONS.md`, `docs/PRODUCT_SPEC.md`,
  `docs/TESTING.md`, `docs/Virtual Sportsbook - Governing Specification V1.docx`
- Desktop overflow correction: `src/app/globals.css`,
  `src/app/sports/[competition]/layout.tsx`, `src/components/browse-root-scroll-lock.tsx`,
  `scripts/browse-pane-layout-diagnostics.mjs`, `scripts/diagnose-browse-pane-layout.mjs`,
  `scripts/check-browse-pane-breakpoints.mjs`, `scripts/check-browse-pane-layout.mjs`,
  `test/v0-15-1-browse-corrections.test.ts`, `test/v0-15-browse-schedule.test.ts`,
  and `package.json`.

Unrelated pre-existing Watchlist/cache/Postgres-store worktree changes were preserved and are not
claimed as part of this patch.

## Tests and validation

Passed:

- Final external-correction validation on `release/v0.15.1`: `npm.cmd run validate`
  passed formatting, lint, typecheck, 52 test files / 314 tests, secret scan, and
  production build. `npm.cmd audit --audit-level=high` found 0 vulnerabilities.
- Final desktop height correction validation: the focused Browse layout contracts passed
  (2 test files / 16 tests), followed by the full 52 test files / 314 tests validation,
  production build, secret scan, and `npm.cmd audit --audit-level=high` with 0 vulnerabilities.
- `node --check scripts/check-browse-pane-layout.mjs` passed. The authenticated browser
  regression was attempted with the local Playwright harness but blocked before Browse
  navigation because this checkout has no Supabase authentication configuration/session.
- Development React browser regression passed for the exact Florida/Gators
  provider `3.5` → simulated `2.5` selection, one durable selection,
  exact simulated odds/provider anchor metadata, game switching, return navigation,
  and clean mobile removal.
- Clean exact portal-lifecycle validation at `c19d0f1`: `npm ci`, `npm.cmd run validate` with
  format check, lint, typecheck, 47 test files / 280 tests, secret scan, and production build.
- `node --check scripts/check-browse-slip-navigation.mjs` passed; the Playwright regression is
  ready for an authenticated environment.
- Clean exact-remediation validation at `4933d8a`: `npm ci`, `npm.cmd run validate` with format
  check, lint, typecheck, 47 test files / 280 tests, secret scan, and production build.
- Focused Bet Slip regression validation: 3 test files / 41 tests passed, including straight,
  parlay/mobile slip-store behavior and the v0.15.1 event-navigation contracts.
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
- Desktop overflow breakpoint regression passed at 979/980/1218/1239/1240px for short and long
  synthetic slates. The 980px-and-up desktop cases held document/body/shell height at the 1270px
  viewport while the long Games content remained inside its pane.
- Root scroll-lock regression covers desktop `html`/`body` overflow, attempted `window.scrollTo`,
  and route-exit cleanup. Authenticated post-fix Preview execution remains pending because the
  local checkout still has no authenticated session.
- Clean corrective-commit validation at `ddeb96bf41ea4484f4bd98bbe5eae4d24737ffd7`: `npm ci`, lint, typecheck, 46 test files / 277
  tests, production build, and secret scan all passed.
- Clean desktop-remediation validation at `486923315a59fb0be4b34ec6798b9d305fc0b6f6`: `npm ci`,
  format check, lint, typecheck, 46 test files / 277 tests, production build, and secret scan all
  passed. The Vercel Preview check also passed.
- The current pushed Preview for `c19d0f1` passed its Vercel deployment check.
- The logo-coverage correction is source-control-ready after its focused audit and
  full validation run; authenticated visual QA remains subject to the existing
  protected-Preview limitation below.
- Logo-correction validation: formatting, lint, typecheck, secret scan, production
  build, and 51 test files / 310 tests passed; the structural team audit and bounded
  external asset check passed for NFL 32/32, NHL 32/32, EPL 20/20, UCL 36/36, and
  NCAAF FBS 138/138. The follow-up UCL provider-string audit passed with 36/36
  provider strings resolved, 0 unresolved, 0 ambiguous, and 7 exact data-backed
  aliases. `npm audit --audit-level=high` reported 0 vulnerabilities.

Blocked or pending:

- Authenticated responsive QA at 375px, 430px, tablet, 1366px, 1440px, and short-height laptop
  dimensions remains blocked because this checkout has no `.env.local`, public Supabase
  configuration, or authenticated browser/session. The available unauthenticated local smoke
  safely redirected `/sports/ncaaf` to `/auth`; it did not prove the authenticated Browse screen.
- The pushed desktop Preview is available and its deployment check passed, but authenticated smoke
  tests at 1920px, 1440px, 1366px, and 1280px, including a short-height laptop and mobile Bet Slip
  navigation, remain pending before final release approval. The available browser session reached
  Vercel Login rather than the application, so the post-fix A→B→A+B result cannot be claimed here.
- The new browser-level smoke script could not run against the protected Preview without an
  authenticated Vercel/application session. The prior authenticated failure remains the reason
  this release gate is open; this checkout does not independently prove the post-fix result.
- Authenticated desktop height QA at 1920x1080, 1440x900, 1366x768, and 1280x800 remains
  pending for the same reason. The unauthenticated local route redirected to `/auth` because
  this checkout has no `.env.local` or authenticated application session; source-level layout
  contracts and production validation passed.
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
selection, desktop master/detail structure, portal lifecycle correction, mobile behavior, metadata
fallbacks, version metadata, and documentation are implemented and covered by passing code/database
validation. Final release approval must wait for an authenticated Preview run of the exact A→B→A+B
flow, authenticated responsive QA, and DOCX visual rendering on an appropriately configured
environment. No database migration needs to be applied.
