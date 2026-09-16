# The Units Lab — Release Candidate Fix Patch 1 Completion Report

Date: 2026-09-16  
Gate: Release Candidate Fix Patch 1  
Recommendation: **PASS**  
Phase 9: **Not started**

## Outcome

The focused production-smoke-test blocker patch is implemented. The app now uses local,
hydration-safe timestamps; distinguishes started events as LIVE and locks their pregame prices;
groups event markets; supports multiple persistent independent straight selections; provides
audited pre-kickoff simulated cancellation; exposes a provider-backed alternate-line path with
clear unavailable states; and gives screenshot imports an actionable private-upload, editable-draft,
review, and My Bets path. Imported wagers remain outside the simulated Vial bankroll.

The explicit fix-patch clarification is recorded in `docs/PRODUCT_SPEC.md` and bounded in
`docs/ARCHITECTURE.md`. No unrelated Phase 9 feature work was started.

## Work completed

### Branding and presentation

- Preserved the approved science-forward beaker/money inline SVG treatment and applied **The Units
  Lab** with `Experiment | Analyze | Improve` across the existing responsive brand surfaces.
- Kept Vials terminology, Scientist fallback, team marks, persistent parlay slip, SGP blocking,
  quota-protected odds access, and the administrator settlement harness intact.

### Timezone and LIVE behavior

- Added shared `LocalDateTime` rendering and changed kickoff/refresh/history timestamps to a
  readable local formatter with no seconds.
- Used an identical deterministic server snapshot plus browser-local `useSyncExternalStore`
  snapshot to avoid hydration mismatch.
- Re-evaluated event start status when serving cached odds. Started events render LIVE, lock all
  displayed pregame selections, and label locked prices clearly. The existing server-side
  `EVENT_ALREADY_STARTED` rejection remains authoritative.

### Markets and alternate lines

- Grouped event odds into Moneyline, Point spread / handicap, Total, and Props / Other.
- Preserved soccer three-way moneyline including draw and normalized provider-returned soccer
  spreads without fabricating missing markets. Soccer handicap availability is provider-data-
  limited, not UI-limited.
- Added the production-verifiable provider path through the `event_odds` request for configured
  alternate spreads/totals. It uses the existing shared cache, lease/coalescing, quota ledger, and
  free-tier policy. The UI distinguishes loaded provider prices, no provider return, and an
  unavailable request; no interpolation is performed.

### Multiple straight bets

- Added a separate persistent straight-selection store and explicit Straights and Parlay sections
  in the bet slip.
- Added `Place all straight bets`; the server validates each immutable selection and calls the
  existing authoritative straight-placement RPC once per selection, creating independent tickets
  and ledger debits. A partial response warns when only some independent tickets were accepted and
  retains failed selections for review or retry.
- Successful placement clears only the submitted straight selections; the existing parlay slip
  remains independent and persistent.

### Pre-kickoff simulated cancellation

- Added owner-only `cancel_simulated_bet(uuid)` in the new migration. It locks the open,
  non-synthetic ticket, verifies every leg is before kickoff using the database clock, voids the
  ticket and legs, refunds the original stake exactly once through the existing
  `settlement:<bet_id>` ledger idempotency boundary, and appends audit evidence.
- The UI shows Cancel Bet only for eligible open simulated tickets. Post-kickoff requests remain
  open, return an auditable `EVENT_ALREADY_STARTED` failure, and cannot refund. Imported wagers do
  not use this path.

### My Bets and import flow

- My Bets now shows local placed time and local kickoff/start time for simulated and imported
  records.
- Screenshot imports visibly report the selected private file, preserve the attachment, and
  continue through editable normalized fields, review, explicit confirmation, and My Bets. OCR is
  not guessed when unavailable.
- Manual import supports canonical provider event ID, competition, market, selection/grading side,
  line, and odds. Matching uses canonical score rows; supported complete records are eligible for
  deterministic automatic settlement, while unmatched or unsupported records retain a manual
  reason.
- Preserved exact `1 USD = 1 Vial` normalization, raw source-dollar provenance, zero imported
  bankroll mutation, group-empty leaderboard messaging, and existing RLS/privacy boundaries.

## Database changes

- Added `supabase/migrations/20260923000000_release_candidate_fix_patch_1.sql`.
- Added `supabase/tests/release_candidate_fix_patch_1.sql` with 14 pgTAP assertions covering the
  authenticated grant, owner cancellation, exact refund, void/audit state, idempotent retry,
  post-kickoff rejection, unchanged open status, and no refund after kickoff.
- No imported-wager table, source-dollar field, RLS policy, provider secret, or analytics projection
  was broadened by this patch.

## Validation results

| Check                                               | Result                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm.cmd run validate`                              | PASS — formatting, lint, typecheck, 18 Vitest files / 116 tests, secret scan, production build |
| `npm.cmd audit --audit-level=high`                  | PASS — 0 vulnerabilities                                                                       |
| Clean `npm.cmd run db:reset`                        | PASS — all migrations through `20260923000000_release_candidate_fix_patch_1.sql` replayed      |
| `npm.cmd run db:lint`                               | PASS exit code — only the two documented pre-existing admin settlement-test warnings           |
| `npm.cmd run test:db`                               | PASS — 11 files / 351 pgTAP assertions                                                         |
| `npm.cmd run test:db:concurrency`                   | PASS — one accepted concurrent straight placement, one debit                                   |
| `npm.cmd run test:db:settlement-concurrency`        | PASS — one return credit under concurrent settlement                                           |
| `npm.cmd run test:db:parlay-placement-concurrency`  | PASS — one accepted concurrent parlay placement, one debit                                     |
| `npm.cmd run test:db:parlay-settlement-concurrency` | PASS — one return credit under concurrent parlay settlement                                    |

## Cost, security, and regression assessment

- No dependency, paid service, background poller, provider key, or service-role credential was
  added. Alternate lines remain explicit, on-demand provider requests protected by the existing
  cache/quota path.
- Server actions and the database function enforce ownership/authentication. Existing RLS, immutable
  ticket terms, one-credit ledger uniqueness, synthetic-row isolation, and imported-bankroll
  isolation remain in force.
- Existing supported catalog coverage remains NFL, NHL, EPL, UCL, Europa League, La Liga, and NCAA
  sports. Team logo fallback, persistent parlay slip, SGP blocking, analytics isolation, and admin
  settlement surfaces were retained.

## Intentional limitations and deviations

- The current provider model does not expose a verified per-price in-play flag. Therefore all
  started-event odds are locked as pregame prices; no live wagering capability was invented.
- Alternate-line visibility is now production-verifiable when the provider/plan returns
  `alternate_spreads` or `alternate_totals`, but this local gate has no production credentials or
  guaranteed live event/book/plan response. The UI reports no-return and request-failure states.
- OCR is not enabled within the current dependency and free-tier constraints. The screenshot
  fallback is intentionally private-upload plus editable manual normalization with explicit review.
- Independent straight placement is intentionally one authoritative RPC per selection; partial
  acceptance is surfaced rather than treated as an atomic multi-ticket transaction.
- This patch explicitly resolves only owner-initiated pre-kickoff simulated cancellation. It does
  not resolve broader provider postponement, cancellation, or live-market semantics.

## Gate recommendation

**PASS.** The requested production-smoke-test blockers are addressed with source, server, database,
and regression coverage. Proceed to human UAT/production-provider smoke verification with configured
credentials; do not begin Phase 9 from this report.
