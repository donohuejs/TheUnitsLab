# Phase 5 Plan — External Bet Tracking

## Outcome and boundary

Phase 5 delivers a complete IRL/external-wager tracking workflow: an authenticated user manually records a wager placed elsewhere, optionally associates it with a current private group, optionally uploads one private screenshot, manually records or corrects its result, and sees an IRL-only performance summary. External-wager activity never inserts, updates, or deletes a virtual-bankroll ledger row. Work stops at the Phase 5 gate.

Phase 5 does not place or transmit a wager, store a dollar stake, call a sportsbook account, parse screenshots, poll a provider, automatically grade an external wager, build combined analytics or leaderboards, add parlays, or implement Phase 6+ behavior.

## Authority review

The governing Word source, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, all Phase 0–4 plans and completion reports, ordered migrations, tests, and current application surfaces were reviewed before implementation. No conflict was found. The source requires manual external-wager entry, optional screenshots, unit-normalized results, IRL analytics, and absolute separation from the virtual bankroll. The explicit Phase 5 instruction resolves the implementation details below.

## Decisions and assumptions

- External wagers use a separate `public.external_wagers` table rather than reusing simulated `bets` or `bet_legs`. Every row has the fixed source `external`, which keeps persistence, settlement, queries, and future source-filtered analytics distinct.
- Straight external wagers support the already approved V1 markets only: moneyline, spread, and total. Player props, live wagers, same-game parlays, and multi-leg tickets remain excluded.
- Stake and profit/loss use exact `numeric(14,2)` units. No currency amount, currency code, deposit, payout, or sportsbook execution field exists.
- American odds are integral, at least `+100` or at most `-100`, and limited to an absolute value of 1,000,000 so their decimal equivalent remains representable at four places. Decimal odds are calculated server-side and stored to four places. A win produces `round(stake × (decimal odds - 1), 2)` units; a loss produces negative stake; push and void produce zero. Open wagers have zero profit/loss and no settlement timestamp.
- Sport, competition, and sportsbook choices are validated against small read-only catalog tables populated from the existing centralized Phase 0 configuration. The initial sportsbook catalog includes configured V1 books plus an `other` choice whose supplied display name is stored as an immutable snapshot.
- A private wager is readable only by its owner. A group-associated wager is also readable by users who are current members of that group. Only the owner can create, attach a screenshot, or enter/correct a result.
- Accepted ticket terms, ownership, group association, wager date, and screenshot association are immutable after creation. Result corrections are allowed only through the owner RPC and create append-only before/after audit rows. This permits correction without erasing statistical history.
- Verification status is `unverified` or `user_attested`. It records the user’s assertion only and does not claim sportsbook, group-admin, or application verification.
- One optional screenshot is supported per wager. Accepted MIME types are JPEG, PNG, and WebP; the application limit is 5 MiB. The object path is generated server-side as `<authenticated-user>/<wager-id>/<random-name>.<extension>` in a non-public Supabase bucket.
- Storage insert and select policies enforce the same owner/current-group-member boundary as the wager. Attachment requires the caller-owned namespace, matching wager ID, an existing caller-owned storage object, and a caller-owned wager. Screenshot access uses a short-lived signed URL after an authenticated RLS-protected lookup.
- Phase 5 personal analytics count won, lost, push, and void as settled results. Units wagered and ROI denominator include won, lost, and push stakes but exclude void stakes. Net units is the exact sum of stored calculated profit/loss. ROI is `net units ÷ non-void settled stake × 100`, or zero when the denominator is zero.
- Automated event/result association is deferred. Manual entry satisfies Phase 5 without consuming provider credits. Existing cached event data could later suggest form values, but automatic association would add ambiguity and is not needed for this gate.

## Implementation sequence

1. Add one ordered migration with catalog tables, external wager and result-audit tables, constraints, forced RLS, private storage bucket and policies, and narrow authenticated creation/result/attachment functions.
2. Add exact external-result and IRL-summary calculation utilities with edge-case unit tests.
3. Add authenticated Server Actions for creation, screenshot upload/attachment, and manual result entry. Reauthenticate and validate every untrusted form submission before calling database functions.
4. Add the Track Bet page with practical manual entry, optional screenshot upload, open/history views, result controls, screenshot links, explicit IRL source labels, and a small IRL-only summary.
5. Add an authenticated screenshot route that performs the RLS-protected wager lookup and returns a short-lived signed URL only for an authorized object.
6. Add pgTAP coverage for constraints, ownership, group visibility, result calculation/correction, screenshot upload/read/association policies, direct mutation denial, source separation, and zero bankroll side effects.
7. Update architecture, ERD, migration, testing, cost/storage, README, and product implementation-baseline documentation.
8. Run formatting, ESLint, TypeScript, unit/integration tests, coverage, clean migration replay, database lint, database/storage authorization tests, both existing concurrency suites, production build, HTTP smoke, dependency audit, and secret scan. Produce `PHASE_5_COMPLETION_REPORT.md` and stop.

## Gate evidence required

The gate passes only if validation proves that an authenticated user can persist and manually settle an external wager with correct unit profit/loss; source and storage records remain distinguishable and protected; another user cannot create, mutate, settle, attach, or read without current group authorization; and creation, wins, losses, pushes, voids, corrections, and screenshot operations leave the simulated bankroll ledger unchanged. Any failed invariant produces a **FAIL** recommendation.
