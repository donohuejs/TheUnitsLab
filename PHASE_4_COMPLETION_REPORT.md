# Phase 4 Completion Report — Scores and Automated Settlement

## Gate result

**Recommendation: PASS.** The Phase 4 gate is satisfied: supported simulated straight wagers settle deterministically without duplicate payouts. Phase 5 has not begun.

This recommendation is based on fixture/unit validation, 137 passing database authorization and integrity assertions, and real concurrent local settlement calls. Live The Odds API validation remains pending because `THE_ODDS_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` were not available. No live success or quota consumption is claimed.

## Work completed

- Added a server-only The Odds API scores client for all four configured core competitions: EPL, UCL, NCAAF, and NCAAB.
- Added a provider-independent normalized score model retaining provider event ID, sport/competition, teams, scheduled start, scheduled/live/final state, score pair, provider update time, application refresh time, and nullable clock/period fields.
- Added shared PostgreSQL score state and refresh metadata with canonical request keys and cross-instance refresh leases.
- Extended the API usage ledger with score active-view, open-wager, and settlement purposes.
- Added quota-state-aware score refresh behavior and event-state TTLs without a permanent polling loop.
- Upgraded My Bets with shared score refresh, team scores, status, supported clock/period display, refresh time, and informational moneyline, soccer draw, spread, and total position.
- Added deterministic TypeScript and PostgreSQL grading for two-way moneyline, soccer three-way result, spread, total, and pushes.
- Added atomic, row-locked settlement using immutable stored ticket economics and authoritative final results.
- Added append-only win, push, and documented void ledger behavior plus a database rule allowing at most one economic settlement credit per ticket.
- Added durable append-only settlement audits for success, retry/already-settled, deferral, association failure, and transactional failure.
- Added a service-role-only documented-void operation and intentionally did not infer abnormal provider semantics.
- Added a bounded `POST /api/settlement` job surface protected by `CRON_SECRET`; it derives work from open straight wagers, refreshes shared competition scores, and runs an idempotent batch.
- Added fixture, unit, database, authorization, idempotency, and concurrent-settlement tests.

## Files created

- `docs/PHASE_4_PLAN.md`
- `supabase/migrations/20260914100000_phase_4_bankroll_void_type.sql`
- `supabase/migrations/20260915000000_phase_4_scores_settlement.sql`
- `supabase/tests/phase_4_scores_settlement.sql`
- `src/app/api/settlement/route.ts`
- `src/app/my-bets/actions.ts`
- `src/lib/scores/normalize.ts`
- `src/lib/scores/postgres-store.ts`
- `src/lib/scores/provider.ts`
- `src/lib/scores/request.ts`
- `src/lib/scores/server.ts`
- `src/lib/scores/service.ts`
- `src/lib/scores/types.ts`
- `src/lib/settlement/grading.ts`
- `test/fixtures/scores-epl.json`
- `test/phase4-settlement-concurrency.mjs`
- `test/score-cache.test.ts`
- `test/score-normalization.test.ts`
- `test/settlement-grading.test.ts`

## Files modified

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/COST_AND_QUOTA.md`
- `docs/DATABASE_ERD.md`
- `docs/MIGRATIONS.md`
- `docs/PRODUCT_SPEC.md`
- `docs/TESTING.md`
- `package.json`
- `src/app/globals.css`
- `src/app/my-bets/page.tsx`
- `test/migration-foundation.test.ts`
- `vitest.config.ts`

## Database changes

- Added `score_state` and `settlement_disposition` enums.
- Added `simulated_void` to the bankroll transaction enum in its own ordered migration so later constraints can reference the committed value.
- Added `event_scores`, keyed by the Phase 2/3 retained provider event ID.
- Added `score_refresh_state` for shared score request freshness.
- Added `settlement_audits` as append-only durable evidence.
- Extended API usage purposes for score calls.
- Added forced RLS to all three new exposed tables; authenticated users can read shared scores and their own audits only. Refresh coordination remains server-only.
- Added immutable-final and append-only-audit triggers.
- Tightened settled tickets so their result and settlement time cannot be regraded.
- Added `bankroll_one_settlement_credit_per_bet`, covering win, push, and void returns.
- Added service-role-only score recording, single-ticket settlement, documented void, and batch settlement functions.

## Score integration design

The provider client calls `/v4/sports/{sport_key}/scores` with `daysFrom=3` and ISO dates. Competition keys and provider sport keys come from the existing configuration. Normalization resolves provider team-oriented score entries back to the configured home and away teams and refuses a completed result missing either score.

The fixture-confirmed contract includes provider event ID, sport key, commence time, teams, `completed`, nullable scores, and optional `last_update`. The provider response used here does not reliably define clock, period, cancelled, postponed, rescheduled, or abandoned semantics. The internal model preserves clock and period fields for reliable future provider data but does not fabricate values.

Only `completed: true` plus both team scores becomes an authoritative final eligible for automatic settlement. Provider event ID is the primary association, with competition and exact home/away team checks as additional safeguards.

## Cache and refresh behavior

- Equivalent requests share one canonical competition score cache and one cross-instance lease.
- Normal TTL: 15 minutes for pregame/unknown responses and 60 seconds when any returned event is live.
- Conserve TTL: 30 minutes pregame and 120 seconds live.
- High: active-view refresh is denied before open-wager or settlement work.
- Critical: only settlement-purpose refresh is allowed.
- An all-final response uses a 24-hour TTL, and each durable final event row stops accepting automatic updates.
- Only competitions identified by open wagers or an explicit My Bets refresh enter the flow. No broad competition loop or per-user/per-ticket upstream request exists.
- One API usage row is written per actual upstream response; cache hits write none.

## Settlement architecture and rules

`settle_simulated_straight_bet` locks the ticket row. A concurrent or repeated caller waits, then observes the already-settled state and performs no economic mutation. The function requires one simulated straight leg and a durable final score with matching provider event ID, competition, home team, and away team.

Rules use only the immutable leg snapshot:

- Non-soccer two-way moneyline: selected winner wins, selected loser loses, and an exact tie pushes.
- Soccer three-way result: Home, Draw, and Away are distinct; a draw makes a selected side lose rather than push.
- Spread: the stored signed line is added to the selected team's final score; positive is a win, negative a loss, and zero a push.
- Total: final combined score is compared with the stored line; equality pushes.
- Void: no provider state is automatically mapped to void. A service-only operation requires a documented operator-confirmed reason.

The final score evidence, calculation outcome, disposition, timestamps, and error/detail fields are appended to `settlement_audits`. An association mismatch is audited and leaves the ticket open.

## Bankroll-credit behavior

- Win: credits the ticket's immutable `potential_return_units`; historical odds are not recalculated.
- Loss: creates no settlement credit.
- Push: credits the immutable original stake.
- Documented void: credits the immutable original stake.
- All credits use the existing append-only ledger and `settlement:<bet_id>` idempotency key.
- The partial unique index prohibits more than one win/push/void economic credit for the same ticket even if application logic regresses.
- Current bankroll remains exactly `sum(bankroll_ledger.amount_units)`.

## Tests and exact results

- `npm.cmd run validate`: PASS.
  - Prettier: PASS.
  - ESLint: PASS, zero warnings/errors.
  - TypeScript: PASS.
  - Vitest: PASS, 9 files and 45 tests.
  - Next.js 16.3.5 production build: PASS, including the dynamic `/api/settlement` route.
- `npm.cmd run test:coverage`: PASS, 9 files and 45 tests. Expanded configured scope: 87.67% statements, 76.39% branches, 94.59% functions, and 90.65% lines.
- `npm.cmd run db:reset`: PASS. All Phase 0-4 migrations and seed replayed from a clean local database.
- `npm.cmd run db:lint`: PASS. No schema errors or warnings in `app_private`, `extensions`, or `public`.
- `npm.cmd run test:db`: PASS, 4 files and 137 assertions. The prior 79 assertions remain and Phase 4 adds 58.
- `npm.cmd run test:db:concurrency`: PASS. Existing two-request 7,500-unit overspend regression still produces one ticket, one debit, and a 2,500-unit balance.
- `npm.cmd run test:db:settlement-concurrency`: PASS. Two simultaneous settlement calls produce one success, one `already_settled` result, one 25.00-unit stored-return credit, and a 10,015.00-unit reconciled balance.
- `npm.cmd audit --audit-level=high`: PASS, 0 vulnerabilities.
- Secret scan: PASS, 0 JWT-like files, 0 populated provider/service/cron secret assignments, and 0 non-example environment files.
- HTTP smoke against the existing local Next development server: `/` 200, `/auth` 200, `/sports` 307 to `/auth`, `/my-bets` 307 to `/auth`, and unconfigured `POST /api/settlement` 503 without attempting work.

Unit coverage includes home/away/loss moneylines; all soccer three-way outcomes and side-on-draw loss; favorite cover/failure, underdog cover, spread push, and line signs; over/under wins/losses and push; live informational states; normalized score association; malformed finals; canonical competition requests; cache coalescing; quota priority; and event-state TTLs.

Database coverage includes stored-return winner credit, no loser credit, push refund, void refund, retry idempotency, immutable snapshot use, score association, mismatch failure audit, final protection, no settled regrade, one-credit uniqueness, ledger reconciliation, forced RLS, direct mutation denial, own-audit visibility, cross-user isolation, and service-function denial to users.

## Security and authorization results

- Provider and service credentials remain in `server-only` modules and never use a `NEXT_PUBLIC_` name.
- The settlement endpoint uses constant-time bearer comparison against optional server-only `CRON_SECRET`.
- Browser roles cannot write scores, score refresh state, tickets, settlement audits, or bankroll ledger rows.
- Browser roles cannot invoke score recording, settlement, batch settlement, or documented void functions.
- Users read only their own tickets, ledger entries, and settlement audits. Existing group privacy tests remain passing.
- Shared scores are intentionally readable to authenticated users and contain no user-private data.
- Final scores and settled results are protected against silent direct rewriting.
- The economic operation and success audit occur in one transaction; failures roll back partial credit/status mutations and append failure evidence where a ticket exists.

## API-cost and scheduling implications

No paid dependency or scheduler was added. The implementation remains within the existing 150-of-500 monthly planning envelope for score/finalization calls through shared requests, bounded event windows, quota priority, and adaptive TTLs. This envelope is still an assumption until a live response confirms the exact endpoint charge.

Vercel Hobby's daily cron cannot provide frequent live-score polling. Production automation therefore still needs an approved invocation cadence for the authenticated endpoint. On-demand My Bets refresh and any future scheduler use the same shared cache and idempotent job. Introducing a paid scheduler would require explicit approval; none was assumed.

## Live-provider validation

At implementation time, process-level credential presence checks returned false for `THE_ODDS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and public Supabase configuration. No populated local environment file exists.

Therefore:

- Live score endpoint calls made: **0**.
- Live provider credits consumed: **0 claimed / none requested**.
- Live score-provider validation: **pending**.
- Phase 2 live odds smoke: **still pending**.

When credentials become available, the minimal validation should make one bounded `scores?daysFrom=3&dateFormat=iso` request for a single configured competition with an open test wager, record returned quota headers and exact credits, verify normalization/association, invoke immediate cache reuse, and confirm no second upstream call.

## Remaining issues and assumptions

- Live provider response behavior and exact score endpoint cost remain unverified.
- Production settlement schedule frequency remains an operational decision constrained by the free hosting plan. The safe endpoint/service exists, but no paid scheduler was introduced.
- The Odds API fixture contract provides no reliable clock/period or abnormal-event reason. Those UI fields remain absent unless reliable data is supplied.
- Cancelled, postponed, abandoned, and rescheduled events are not automatically voided. A documented service-only void is available; an explicit provider mapping and correction policy are still required before automation.
- Recorded finals are intentionally sticky. A later administrative correction workflow must preserve the original final and correction evidence rather than silently overwrite it.
- The append-only concurrency test fixture remains in the disposable local database until the next `db:reset`; it is isolated by random identifiers.

## Deviations from the governing specification

No conflicting product behavior was introduced. The explicit Phase 4 instruction narrows settlement to Phase 3 straight wagers despite the governing source's broader V1 parlay language; parlays remain Phase 7. The source requires void support but does not define abnormal-provider semantics, so Phase 4 implements a documented service-only void refund and deliberately does not auto-map uncertain states.

Clock and period display is conditional because the fixture-validated provider contract does not supply reliable values. Fully automated deployment scheduling is not enabled because the documented zero-cost Vercel baseline cannot provide frequent live cron; the explicit instruction permits implementing the safe endpoint/job and documenting the production requirement.

## Phase 4 gate evidence

1. Moneyline grading: PASS.
2. Soccer Home/Draw/Away distinction: PASS.
3. Spread grading and pushes: PASS.
4. Total grading and pushes: PASS.
5. Mathematically correct stored-return winner credit: PASS.
6. No losing return credit: PASS.
7. Push and documented void refund exactly once: PASS.
8. Repeated settlement idempotency: PASS.
9. Concurrent settlement duplicate-payout prevention: PASS.
10. Immutable stored ticket values used: PASS.
11. Direct score, settlement, audit, and bankroll-credit manipulation denied: PASS.
12. Shared, coalesced, quota-conscious score activity: PASS by deterministic fixture/unit/database tests; live quota-header validation remains pending credentials and is not claimed.

**The Phase 4 gate is satisfied. Recommendation: PASS. Stop here; do not begin Phase 5.**
