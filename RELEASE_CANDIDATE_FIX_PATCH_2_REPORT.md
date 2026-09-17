# The Units Lab — Release Candidate Fix Patch 2 Report

Date: 2026-09-17
Scope: focused pre-UAT fix patch only. Phase 9 was not started.

## 1. Branding fix

- Added reusable `BrandLockup` and `LaboratoryMark` components.
- Home uses a larger full lockup with prominent `The Units Lab` and the subtitle `Experiment | Analyze | Improve`.
- Navigation uses a compact mark/wordmark treatment.
- The mark is inline SVG laboratory glassware with liquid, a visible `$` money cue inside the liquid, measurement marks, and vapor above the neck. It is not an emoji or placeholder flask.
- Removed the old `Bet Smarter` presentation from the application UI.

## 2. Mobile navigation/layout

- Replaced the overflowing mobile header with a compact brand, hamburger, and focus-managed drawer.
- Drawer links include Home, Browse Odds, My Bets, Import Betslip, Performance, Leaderboards, Settings, and Admin when authorized.
- Escape, backdrop, close, and navigation actions close the menu; focus returns to the menu button after close. Body scrolling is locked while open.
- Responsive layout rules cover Home, Browse Odds, the bet slip, My Bets, Import Betslip, Performance, Leaderboards, and Settings. Cards, forms, grids, controls, and buttons collapse to mobile-safe widths.
- Page-level horizontal overflow is suppressed and verified absent at 390x844 and 375x812. Intentional filter/method chip strips remain horizontally scrollable within their own controls.

## 3. Persistent multi-straight slip

- Unified parlay and straight selections under one versioned local slip model and storage key.
- Legacy parlay/straight state migrates into the unified model.
- Selections remain across competition navigation, refresh, and browser history navigation. NCAA, NFL, NHL, EPL, UCL, Europa League, and La Liga are not treated as separate carts.
- Removing a selection is selective. Successful placement removes only accepted submitted keys; cancelled/voided records remove their corresponding active pending keys.
- Server-side stale-price and placement validation remain authoritative. Existing bankroll isolation, idempotency, and parlay behavior are preserved.

## 4. Market filters

- Added All, Moneyline, Spread / Handicap, Total, and Props / Other filters.
- Market filtering composes with bookmaker filtering, preserves grouped event presentation, and uses Handicap for soccer display where appropriate.
- Mobile filters use tap-friendly horizontally scrollable chips without causing page overflow.

## 5. Simulated alternate spread model

- Added spread-only `Adjust line` controls in the bet slip.
- Provider-priced alternate lines remain preferred when available. Otherwise the UI and server use the deterministic `simulated-alternate-spread-v1` model.
- The model preserves the provider anchor line and American price, derives implied probability, adjusts probability by `0.025 × (adjustedLine - anchorLine)`, clamps it to `[0.02, 0.98]`, and converts it back to American odds. This makes an easier line lower-payout and a harder line higher-payout, monotonically.
- The UI shows original provider line/price, adjusted line, simulated price, and updated potential return. It explicitly says `Simulated alternate line` and never presents the calculated price as bookmaker pricing.
- Anchor line/price, adjusted line, simulated price, model, and version are persisted and revalidated by the new server RPC. Existing provider terms remain immutable.

## 6. Screenshot import redesign

- Screenshot import now presents an explicit `Processing` state, an extraction-attempt step, and an editable review-draft path.
- Safe automated OCR is not available in the current architecture, so the flow immediately becomes a short guided draft with a clear next action and does not fabricate sportsbook, event, market, odds, or payout data.
- Confirmed imports continue to My Bets. The screenshot remains private to the authenticated workflow.

## 7. Manual import redesign

- Straight import now uses progressive entry: sportsbook, canonical event when available, market, selection/line, then economics.
- Any two of stake, American odds, and payout/return calculate the third using exact deterministic integer/BigInt arithmetic.
- Canonical event selection fills sport, competition, teams, kickoff, and event ID. Free-text event entry remains the fallback.
- The straight workflow is the primary mobile path; the existing parlay editor remains available for supported imported parlays.

## 8. Canonical matching / auto-settlement

- Imported records matched to canonical cached events and supported deterministic markets are marked `Auto settlement ready`.
- Supported deterministic readiness covers moneyline, spread/handicap, total, supported three-way results, and supported fully matched parlays.
- Unsupported markets, unmatched events, props, teasers/SGPs requiring sportsbook-specific rules, early cash-out, promo/free-bet ambiguity, and insufficient data retain an explicit manual-settlement reason.
- Imported USD accounting remains analytics-only at `$1 USD = 1 Vial equivalent`; imported wagers never debit or credit the simulated bankroll.

## 9. Group invite flow

- Group discovery and creation/join actions moved to Leaderboards. Settings retains membership management rather than being the discovery surface.
- Owners/admins receive a clear Invite action with copyable share link and token-entry fallback.
- Invite tokens are generated securely, stored hashed, expire, and reject invalid/expired/reused or unauthorized attempts. Existing private-group RLS and membership checks remain in force.

## 10. Security review

- No provider API keys or Supabase service-role credentials were moved to client code.
- Existing RLS, forced RLS, grants, server-side cache/quota protections, settlement idempotency, and synthetic admin-test isolation were preserved.
- New simulated pricing and imported auto-settlement readiness are server-authoritative; immutable wager snapshots include the new pricing metadata.
- Imported and simulated accounting remain separate.

## 11. Migration changes

- Added one forward-only migration: `supabase/migrations/20260924000000_release_candidate_fix_patch_2.sql`.
- It adds pricing metadata/constraints, imported readiness fields and helpers, deterministic simulated-spread pricing, placement support, and the required immutable-snapshot/backfill paths.
- No already-deployed migration was modified.
- Added database coverage in `supabase/tests/release_candidate_fix_patch_2.sql`.
- Updated the governing product, architecture, and migration documents with the approved patch-2 clarification and boundaries.

## 12. Test counts and validation

| Check                              | Result                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm.cmd run validate`             | PASS — 21 Vitest files, 128 tests; format, lint, typecheck, secret scan, and production build passed |
| `npm.cmd audit --audit-level=high` | PASS — 0 vulnerabilities found                                                                       |
| `npm.cmd run db:reset`             | PASS — clean local reset/replay through `20260924000000_release_candidate_fix_patch_2.sql` and seed  |
| `npm.cmd run db:lint`              | PASS — 2 pre-existing warnings only (`leg_number` shadow/unused in existing admin test helpers)      |
| `npm.cmd run test:db`              | PASS — 12 files, 378 tests                                                                           |
| DB placement concurrency           | PASS — concurrent requests produced one ticket, one debit, balance 2,500                             |
| DB settlement concurrency          | PASS — one 25.00 return credit, ledger 10,015                                                        |
| DB parlay placement concurrency    | PASS — one 2-leg ticket, one debit, balance 2,500                                                    |
| DB parlay settlement concurrency   | PASS — one 50.00 return credit, two won legs, ledger 10,040                                          |

Targeted patch-2 unit/static coverage is included in the 21-file/128-test validation result and covers import economics, simulated alternate monotonicity/labels, unified slip behavior, mobile/import/group wiring, and prior regressions.

## 13. Mobile validation

Using the local app at 390x844 and 375x812, verified:

- Home full branding lockup and no page overflow.
- Browse Odds and NFL odds layout, bookmaker/market chip behavior, and no page overflow.
- Bet slip layout and compact navigation.
- My Bets, Import Betslip, Performance, Leaderboards, and Settings fit the viewport with mobile navigation active and desktop navigation hidden.
- Import Betslip screenshot mode exposes the processing/review/fallback next step rather than a dead-end confirmation.
- Menu open/close, Escape handling, navigation close, and focus return behavior.

The local smoke environment intentionally had no populated provider event feed, so populated odds-card placement was covered by the automated/unit/database suites rather than the visual smoke run.

## 14. Remaining limitations

- Safe OCR/extraction is not enabled; screenshot import uses the required honest guided-draft fallback.
- The simulated alternate model uses the provider anchor when consensus data is unavailable. It is deterministic and monotonic, but not sportsbook-perfect.
- Provider/live visual smoke coverage depends on configured provider data and was not asserted against fabricated local events.
- `db:lint` still reports the two pre-existing admin-test-helper warnings noted above.

## 15. PASS/FAIL recommendation

**PASS for the pre-UAT release-candidate gate.** The requested branding, mobile navigation/layout, persistent multi-straight slip, market filters, deterministic clearly labeled simulated alternate spreads, actionable screenshot fallback, progressive manual import, canonical auto-settlement readiness, secure/discoverable group invites, imported accounting isolation, and regression/database/concurrency validation are complete.

Stop at this gate. Phase 9 and unrelated future work were not started.
