# Phase 8 Plan — Product Polish and Release Readiness

## Outcome and boundary

Phase 8 makes the existing Phase 0–7 product coherent and release-ready at the presentation
layer. It covers signed-in navigation, dashboard composition, straight/parlay and simulated/IRL
clarity, deliberate loading/empty/error/success states, responsive behavior, accessibility, shared
visual conventions, setup documentation, and regression validation.

No database schema, provider integration, betting type, settlement rule, analytics formula,
leaderboard rule, paid dependency, scheduler, or real-money behavior is added. Phase 9 is not
started.

## Confirmed inputs

- Phase 7 passed its gate on 2026-09-15.
- The canonical wager, settlement, analytics, leaderboard, RLS, screenshot, and shared provider
  boundaries are regression-protected.
- Live-provider validation with production credentials remains pending.
- A confirmed zero-cost production scheduling/invocation strategy for automated score refresh and
  settlement remains pending.

## Implementation decisions

- The signed-in root route is the dashboard. It reads the existing personal analytics RPC,
  persisted bankroll ledger, simulated tickets, and private groups; it does not create a second
  analytics implementation or call the provider.
- All signed-in pages use one navigation component with active-location semantics. The Admin link
  is rendered only for the existing server-side admin allowlist; the admin route continues to
  enforce its own authorization.
- Source, ticket type, market, and result states use reusable text badges with non-color labels.
- Loading UI uses Next.js route loading boundaries. Error and not-found boundaries use safe,
  user-facing copy and do not display provider, database, or credential details.
- Forms use native semantic labels and server actions, with shared pending-submit affordances. The
  server remains authoritative for odds, ticket terms, payout, bankroll, result, and authorization.
- CSS remains the existing no-dependency approach and adds shared tokens, focus states, responsive
  layouts, reduced-motion support, and touch-friendly data regions.

## Validation plan

Run the existing Phase 0–7 unit, database, concurrency, migration replay, formatting, lint,
TypeScript, build, HTTP smoke, dependency-audit, and secret-scan checks. Add focused pure tests for
the shared navigation and presentation labels. Perform a local desktop/mobile and keyboard review
where the environment permits. Record exact evidence and any environmental limitation in
`PHASE_8_COMPLETION_REPORT.md`.

## Gate

Recommend PASS only when the existing wager and authorization gates remain green and the product
has deliberate states, coherent navigation, clear simulated-versus-IRL semantics, responsive
primary flows, visible keyboard focus, and updated release-readiness documentation. Stop at the
Phase 8 gate.
