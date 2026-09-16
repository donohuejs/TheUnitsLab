# Phase 4 Plan — Scores and Automated Settlement

## Scope and authority

Phase 4 implements live score tracking and automated settlement for the Phase 3 simulated straight markets only. It follows the governing source and the explicit Phase 4 authorization. Parlays, external wagers, uploads, analytics, leaderboards, social features, and Phase 5+ work remain excluded.

## Implementation slices

1. Normalize The Odds API score responses behind a server-only provider boundary and retain the Phase 2 provider event ID as the association key.
2. Store shared scores and refresh metadata in PostgreSQL, reuse cross-instance leases, record real upstream requests in the quota ledger, and vary refresh frequency by event and quota state.
3. Display cached score, provider-supported status detail, refresh time, and informational market position on open tickets.
4. Grade supported straight markets from immutable leg terms plus a durable final score.
5. Settle tickets, append the appropriate ledger return, and append audit evidence in one row-locked database transaction with duplicate-credit constraints.
6. Expose a bounded authenticated job endpoint and user-requested shared refresh path; do not add a permanent process or paid scheduler.
7. Validate fixtures, grading, wallet math, RLS, failure audit, retry safety, real concurrent settlement, clean replay, build, smoke, audit, and secret posture.

## Recorded assumptions

- The Odds API scores response supplies `completed`, team-oriented integer score strings, `commence_time`, and an optional `last_update`; the normalized model does not claim clock, period, cancellation, postponement, or abandonment data that the endpoint has not supplied.
- `completed: true` with both team scores is the only provider state that automatically authorizes grading.
- Soccer moneyline snapshots represent three-way match result; a tied final makes Home or Away lose and Draw win. Non-soccer two-way moneyline ties push.
- Final score rows are durable and no longer automatically refreshed. A future explicit correction workflow is required to replace a recorded final.
- Provider data cannot reliably auto-void abnormal events in the fixture-validated contract. A narrow service-only void operation requires a documented reason and refunds the stored stake once.
- `daysFrom=3` bounds the initial score endpoint request. Live validation of response behavior and exact credit cost remains pending credentials.
- The zero-cost Vercel Hobby baseline cannot provide frequent live cron. The job remains safe for an external/manual bounded invocation; production scheduling frequency is an operational decision and must not silently add paid infrastructure.
