# Phase 6 Plan — Analytics and Leaderboards

## Outcome and boundary

Phase 6 derives exact personal analytics and private-group leaderboards from the authoritative Phase 3–5 wager records. It adds no mutable summary counters, upstream provider calls, paid services, real-money behavior, parlays, social features, or Phase 7+ product work. The gate passes only when independently calculated fixture expectations reconcile with the production aggregation and direct database tests prove the new read surfaces preserve personal and group authorization.

The governing Word source, repository transcription, architecture, Phase 0–5 plans and completion reports, ordered migrations, wager models, correction audit, group policies, pages, numeric utilities, and test infrastructure were inspected before this plan was written. No source/repository conflict was found. The source leaves formula edge cases, time boundaries, season definition, tie behavior, and an exact minimum sample unresolved; this plan records the explicit Phase 6 decisions below.

## Analytics data model

- `app_private.analytics_wager_rows` is the single canonical relational projection. It uses `union all` over one-leg simulated straight tickets and current external-wager rows without changing either persistence model.
- Every projected row retains wager ID, owner, optional group, source (`simulated` or `external`), current authoritative status, accepted stake/odds, exact profit/loss, canonical wager timestamp, sport, competition, market, sportsbook, and `ticket_type = straight`.
- Simulated profit/loss comes only from immutable ticket economics and settled status: win is stored potential profit, loss is negative stored stake, and push/void is zero. External profit/loss is the current database-calculated `profit_loss_units`. Correction audit rows are evidence only and are never unioned, so a corrected IRL wager remains one wager and one current result.
- No summary table, trigger-maintained counter, materialized view, data warehouse, or mutable client aggregate is introduced. Analytics are recomputed from persisted records at request time.
- Two narrow `security definer` RPCs expose canonical rows: one derives the personal owner from `auth.uid()` and accepts no user ID; one requires current membership in a supplied group and returns only wagers explicitly associated with that group. A third member-list RPC applies the same membership check and returns no email/authentication data.
- Shared TypeScript exact-arithmetic aggregation is the only metric implementation used by personal analytics and leaderboards. It also keeps the row shape ready for Phase 7 ticket types without fabricating parlay records.

## Canonical metric definitions

- Total bets: every submitted wager in the selected wager-time/filter window, including open, push, and void records.
- Wins, losses, pushes, and voids: current authoritative result counts. Open wagers contribute to none of these result counts.
- Units wagered: stored stake summed for settled won, lost, and push wagers. Open and void stakes are excluded, preserving the Phase 5 convention.
- Units won/lost: exact sum of authoritative profit/loss. Open, push, and void contribute zero.
- ROI: `units won/lost ÷ units wagered × 100`, rounded half away from zero to two percentage places. A zero denominator returns `0.00%` and is ineligible for rate rankings.
- Win percentage: `wins ÷ (wins + losses) × 100`, rounded half away from zero to two percentage places. Pushes, voids, and open wagers are excluded. A zero denominator returns `0.00%` and is ineligible for rate rankings.
- Average odds: arithmetic mean of stored accepted decimal odds for settled non-void wagers, rounded half away from zero to four decimal places. Open and void wagers are excluded. Current market data is never used.
- Current streak: the consecutive run of the latest decisive results, displayed as `Wn` or `Ln`. Best streak is the longest winning run. Open, push, and void records are neutral and skipped rather than breaking or extending a streak. Ordering is canonical wager timestamp, then source and wager ID for deterministic equal-time behavior.
- Calculations parse fixed-precision database values into integer minor units / decimal ten-thousandths. Binary floating point is not used for financial-style accumulation or ranking.

## Source and breakdown semantics

- Source filters are `simulated`, `irl` (mapped to stored `external`), and `combined`.
- Personal breakdowns group the same filtered record set by sport, competition, market, and sportsbook. Each row uses the same canonical metric calculator as the overall summary.
- All current records are `straight`. The projection and calculation types retain `ticketType`, permitting Phase 7 to add straight-versus-parlay breakdowns without changing Phase 6 formulas.
- Group sport categories map to centralized sport keys: soccer, football (college football), and basketball (college basketball). They rank units won within that sport; no parlay data is implied.

## Date and period semantics

- Simulated wagers use immutable `bets.created_at`; external wagers use authoritative `external_wagers.wager_date`. Settlement time is never substituted.
- Period boundaries use the authenticated viewer's validated IANA profile time zone and are converted to UTC before filtering. Invalid legacy time zones fall back to UTC without modifying the profile.
- This week starts Monday at 00:00 local time. This month starts on the local calendar month's first day at 00:00. All-time has no lower bound.
- Group “season” uses August 1 at 00:00 local time through the request instant. Before August, it begins August 1 of the previous year. This single cross-sport boundary is a conservative V1 choice because no competition-season table exists and the initial soccer/college schedule cluster begins in August. A later competition-specific season model can replace it explicitly.
- Lower bounds are inclusive and the request instant is exclusive. Boundary and daylight-saving behavior are unit tested.

## Leaderboard and minimum-sample architecture

- Units Won is the default category and ROI is displayed alongside every row. Categories are units won, ROI, win percentage, total wagers, soccer, college football, and college basketball.
- ROI and win-percentage categories require five settled non-void wagers after all source/time/sport filters. Five is a conservative configurable default that prevents a single result from leading while remaining usable for small private groups. The threshold lives in one exported configuration constant and is passed to the shared ranking function.
- Ineligible members remain visible with a clear “needs N eligible wagers” state; they are not treated as having poor/zero rate performance. Units Won, total wagers, and sport-category rankings have no minimum.
- Equal primary values share a dense rank. Stable display order within a tie uses case-insensitive display name, then user UUID; these are presentation keys only and do not imply superior performance.

## Security model

- Personal RPC identity comes only from `auth.uid()` and exposes no target-user parameter.
- Group wager/member RPCs verify current membership inside the `security definer` function before reading cross-user data. They expose only wager-performance fields, display names permitted by profile visibility (otherwise `Private member`), and opaque application user IDs; never email or auth metadata.
- Functions use an empty `search_path`, explicit schema qualification, revoked public/anonymous execution, and authenticated-only grants. They intentionally bypass base-table RLS only after their explicit caller checks; tests do not assume view/function inheritance.
- Existing tables, mutation grants, screenshot policies, immutable ticket terms, correction audits, settlement paths, and bankroll isolation remain unchanged. No aggregate input is accepted or persisted.

## Reconciliation and authorization tests

- Pure tests build a deterministic independent fixture with simulated/external wins, losses, pushes, voids, open wagers, a corrected external current result, multiple dimensions/users/groups, timestamps on and outside boundaries, and fractional odds/stakes. Hand-written expected totals validate counts, exact stake/net, ROI, win percentage, average odds, streaks, breakdowns, filters, ranking order, ties, eligibility boundaries, and rounding.
- pgTAP inserts authoritative database fixtures, including an external correction through the Phase 5 RPC, and compares canonical RPC rows and independently written SQL sums/counts. It proves the audit history does not become extra analytics rows.
- Direct authorization tests prove own-personal access, absence of a target-user override, member group access, nonmember/anonymous denial, no email output, function grant boundaries, forced RLS continuity, unchanged screenshot isolation, denied mutation, and zero bankroll effects.
- All Phase 0–5 unit, database, storage, concurrency, replay, lint, build, smoke, audit, and secret checks remain required.

## Database and performance changes

- One ordered migration adds only the canonical private function and narrow read RPCs plus covering indexes for simulated group/user wager time and external group/user wager time. Existing indexes are retained.
- Queries operate only on PostgreSQL persisted data and do not call The Odds API. At current private-group scale, request-time aggregation avoids drift and is simpler than paid analytics or materialization. Query-plan-driven indexing can evolve if measured scale requires it.

## Cost and unresolved items

Phase 6 adds no dependency, service, cache, polling, scheduler, or provider request. Expected operating cost remains $0/month within the existing Supabase/hosting free-tier assumptions.

The following remain explicitly unresolved and are not treated as Phase 6 work:

1. Live odds/score provider validation remains pending unavailable credentials.
2. A zero-cost production score/settlement scheduling strategy remains pending; no paid scheduler is introduced.

## Implementation sequence and gate

1. Add the canonical projection, secured RPCs, indexes, and database tests.
2. Add exact shared analytics/date/ranking utilities and independent reconciliation tests.
3. Build authenticated Performance and private Group Leaderboard pages with query-string filters and existing components/styles.
4. Add navigation and update architecture, ERD, migrations, testing, product baseline, cost, and README documentation.
5. Run the complete validation matrix, record fixture expected/actual reconciliation, produce `PHASE_6_COMPLETION_REPORT.md`, recommend PASS only if every gate condition is met, and stop before Phase 7.
