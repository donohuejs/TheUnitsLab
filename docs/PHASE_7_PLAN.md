# Phase 7 Plan — Parlays

## Outcome and boundary

Phase 7 adds first-class multi-leg tickets to the existing simulated and IRL wager paths. A simulated parlay is validated from fresh shared odds, persisted as one parent with immutable leg snapshots, debited once, settled from durable scores, and projected as one analytics wager. An IRL parlay is entered and corrected through the existing external-wager audit and screenshot boundaries and never touches the virtual bankroll.

Work stops at the Phase 7 gate. No product-polish, social, screenshot-intelligence, recommendation, live-wagering, player-prop, same-game-parlay-pricing, public-group, referral, or real-money feature is included.

## Authority review and entry state

The governing Word source, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, every Phase 0–6 plan and completion report, all ordered migrations and database suites, the straight placement and settlement paths, external wager and screenshot paths, canonical analytics projection, leaderboard code, concurrency suites, and relevant Next.js 16 bundled guides were inspected before this plan was written. No governing-source conflict was found.

Phase 6 has passed. Two operational issues remain nonblocking and unchanged unless final validation proves otherwise:

1. Successful live-provider odds and score validation remains pending credentials.
2. A zero-cost production score and settlement scheduling strategy remains unresolved.

Phase 7 uses fixtures and the existing local Supabase stack and consumes no live provider quota.

## Domain decisions and assumptions

### Simulated ticket shape

- Reuse `public.bets` and `public.bet_legs`; do not create a second simulated wager subsystem.
- A straight ticket continues to contain exactly one leg. A parlay contains 2–12 legs. Placement records the expected leg count on the immutable parent and validates the final inserted count transactionally.
- Every parlay leg must reference a different provider event and the same bookmaker. Same-event combinations are rejected because the application has no verified correlation-pricing model. Cross-book combinations are rejected because they do not represent one sportsbook ticket.
- Supported leg markets remain moneyline, soccer three-way result including draw, spread, and total. No additional market type is introduced at leg level.
- Existing historical straight tickets are backfilled to `leg_count = 1` and retain their accepted economics and results.

### Odds precision and rounding

- Accepted leg decimal odds remain canonical `numeric(12,4)` snapshots.
- Combined decimal odds are produced by exact PostgreSQL numeric multiplication of all accepted leg values with no intermediate rounding, then rounded once, half away from zero, to four decimal places for the parent ticket.
- Effective settlement odds use the same multiply-then-round-once rule after push and void legs are excluded.
- Parent potential and final unit amounts round once to `numeric(14,2)` after multiplying the stake by the final four-place parent odds. This matches the Phase 3/6 positive-value PostgreSQL and integer-helper rounding convention.
- Combined American odds are derived from the canonical four-place decimal value by the existing conversion rule and integer half-away-from-zero rounding. A parlay whose combined price cannot fit the existing parent numeric/integer bounds is rejected.
- The browser may display an exact preview using integer/BigInt helpers, but the database ignores client combined odds and payout values and recalculates all authoritative economics.

### Per-leg and ticket settlement

- Add mutable result evidence to otherwise immutable simulated leg snapshots: result, result time, and final-score snapshot. Accepted ticket terms remain protected.
- Automated parlay settlement waits until every non-void leg has a durable final score. This preserves a complete per-leg record and follows the provider-safe existing convention of settling only from final results. A known loss therefore does not finalize the ticket early.
- Any lost leg makes the completed parlay lost. If all active legs win, the parlay wins.
- Push and void legs contribute a neutral multiplier of `1.0` and are excluded from effective odds. This Phase 7 void treatment is an explicit assumption because the validated provider contract has no stronger abnormal-event rule.
- If every leg is void, the ticket is void. If no active leg remains and at least one leg pushed, the ticket is push. Both return the original stake exactly once and generate zero profit.
- A service-role-only documented leg-void function preserves the existing cautious abnormal-event boundary. Automated score ingestion does not infer voids.
- Winning credit uses the effective return after push/void adjustment. Loss creates no credit. Push or void creates one stake return. Parent result, effective odds, final profit/return, leg evidence, audit, and ledger mutation are committed under the existing row lock and uniqueness constraints.
- Straight settlement is extended only to populate the new common leg/final-economics fields; its grading and payout behavior remain unchanged.

### IRL parlays and corrections

- Extend `public.external_wagers` with `ticket_type` and `leg_count`, keeping historical rows as straight tickets.
- Add `public.external_wager_legs` for normalized immutable leg terms and current per-leg result. Historical straight wagers are not duplicated into this table; their existing parent fields remain authoritative.
- An external parlay uses one existing parent for owner, optional authorized group, sportsbook, wager date, stake, combined odds, current result, current profit/loss, notes, screenshot, and audit behavior. It contains 2–12 normalized legs.
- All external legs inherit the parent sportsbook. The entered combined American odds remains the externally accepted ticket price; individual leg odds are retained for reconstruction but are not used to override the accepted sportsbook combined price.
- Ticket-level result entry accepts a complete leg-result payload. A won ticket requires no lost/open leg and at least one won leg (push/void legs are neutral); a lost ticket requires at least one lost leg; a push ticket requires only push/void legs and at least one push; a void ticket requires all legs void; an open ticket requires at least one open leg and may contain noncontradictory partial states. This keeps manual IRL results aligned with simulated effective-price behavior.
- Corrections update the current parent and leg results under one owner-only row lock and append before/after parent economics plus leg-result JSON evidence to the existing audit table. Analytics continues to read only the current parent once.
- Screenshot storage, object path, signed access, owner mutation, and owner/current-group-member read policies remain unchanged.
- External parlays never insert, update, delete, or reference virtual-bankroll ledger entries.

### Analytics and leaderboards

- Replace the Phase 6 canonical function with an extended projection that emits exactly one row per straight or parlay parent from both sources.
- A parlay counts once for totals, sample thresholds, stake, profit/loss, ROI, average odds, and streaks. Legs never become aggregate wager rows and stake is never duplicated across them.
- Add the existing required straight-versus-parlay breakdown to Performance.
- If every leg shares one sport, that sport is used; otherwise the parent is classified as `mixed`. If every leg shares one competition, that competition is used; otherwise competition is `mixed` with label `Mixed competitions`. Parlay market breakdown uses `parlay`.
- Mixed-sport parlays remain in overall analytics but are excluded naturally from the single-sport leaderboard categories. Same-sport mixed-competition parlays remain eligible for that sport leaderboard without being assigned to one competition.
- The existing source/time filters, exact calculation code, five-wager rate minimum, Units Won default, and deterministic dense ties remain unchanged.

## Security and integrity design

- New exposed leg tables enable and force RLS. Simulated leg reads inherit the existing owner-only ticket policy. External leg reads use the same owner/current-group-member predicate as the parent.
- Authenticated users receive no direct insert, update, or delete grant on parlay parents, legs, settlement economics, ledger rows, or audits.
- Placement and external mutation functions derive identity from `auth.uid()`, validate current group membership, use an empty search path, and receive explicit per-role revocations and narrow grants.
- Settlement and simulated leg void functions remain service-role-only. Direct result, effective-price, payout, ledger, and audit manipulation is denied.
- Parent ownership and leg ownership are inherited exclusively through foreign keys to the parent. Accepted leg terms remain immutable after insert.
- Database checks and functions enforce positive stake, valid prices, supported market/selection/line shapes, 2–12 parlay legs, one straight leg, same-book simulated parlays, distinct simulated events, and one economic settlement credit.

## Implementation sequence

1. Add the ordered Phase 7 migration extending common simulated ticket/leg economics, atomic parlay placement, deterministic parlay grading/settlement, external parlay parents/legs/corrections, RLS/grants, and canonical analytics.
2. Add exact combined-odds and effective-parlay calculation helpers and pure tests for two/three legs, mixed American signs, rounding, push/void removal, and boundary failures.
3. Extend the simulated competition experience with a persistent multi-selection slip while preserving one-click straight placement. Make the 2–12 leg, distinct-event, single-book rules visible and submit only leg identifiers/displayed terms plus stake/group.
4. Extend My Bets to display ticket type, all leg snapshots and current per-leg results, original and effective odds, original potential economics, and final adjusted economics.
5. Extend Track Bet with straight/parlay entry, repeatable normalized leg fields, ticket-level manual result/correction including per-leg states, existing notes/group/screenshot controls, and explicit bankroll isolation.
6. Extend Performance with straight/parlay breakdown and mixed classification while keeping leaderboard behavior driven by the canonical projection.
7. Add pgTAP coverage for placement, settlement combinations, external creation/correction, analytics, RLS/function authorization, screenshot continuity, and zero IRL bankroll effects.
8. Add real concurrent parlay placement and settlement suites and keep both existing straight concurrency suites unchanged.
9. Update architecture, ERD, migrations, testing, cost/quota, product implementation baseline, README, and phase status documentation.
10. Run the full Phase 0–7 validation matrix, produce `PHASE_7_COMPLETION_REPORT.md` with exact evidence, make an explicit PASS/FAIL recommendation, and stop.

## Required gate evidence

The gate passes only if all of the following are demonstrated:

- Two- and three-leg combined odds and payouts reconcile exactly; manipulated client totals are ignored.
- A fresh supported multi-leg ticket persists atomically with immutable snapshots and one stake debit; an invalid/stale/unauthorized leg rolls back the entire operation.
- Existing and parlay concurrent placement cannot overspend.
- Automated simulated parlay tests cover all-win, losses in different positions, push and void removal, all-push, all-void, mixed push/void, push/void plus loss, adjusted effective payout, repeat settlement, and concurrent settlement.
- IRL parlays persist multiple normalized legs, settle and correct with current-result-only analytics, preserve screenshots and authorization, and cause zero virtual-bankroll mutation.
- Canonical analytics counts a parlay once, applies source/time filters, provides straight/parlay and deterministic mixed-dimension behavior, and feeds unchanged minimum-sample and tie rules.
- Anonymous and nonmember access is denied for every new exposed table and function, including privileged functions that bypass RLS.
- All prior unit, integration, database, storage, migration replay, lint, concurrency, formatting, ESLint, TypeScript, build, HTTP smoke, dependency-audit, and secret-scan checks remain passing.
- No provider quota, paid dependency, real-money functionality, or Phase 8 work is introduced.

Any unmet gate condition produces a Phase 7 **FAIL** recommendation with the exact remaining issue.
