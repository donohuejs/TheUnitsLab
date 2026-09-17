# The Units Lab — Release Candidate Fix Patch 5 Report

Date: 2026-09-17  
Scope: import reliability, deterministic grading readiness, Study assignment, My Bets filtering,
responsive Browse Odds, and Lab Notes terminology  
Phase status: Phase 8 / pre-UAT; Phase 9 not started

## 1. Screenshot parsing fixes

The existing universal `ImportBetslipForm` remains the single screenshot, pasted-text, and manual
entry path. Patch 4’s local-only OCR continues to use EXIF-aware orientation, bounded resize/upscale,
grayscale/contrast, threshold preprocessing, and multiple Tesseract passes. Sportsbook recognition
remains optional and recovered fields remain editable.

The parser and UI retain partial extraction. Missing stake is explicitly shown as `Stake not shown`
and the user can continue into the economics review step to enter it; save remains blocked until the
reviewed economics are complete.

## 2. Parlay leg-boundary fix

The parser now associates numbered legs, event blocks, and odds-bound blocks together before extracting
a leg. It no longer zips independent event/selection/odds arrays across unrelated legs, and ticket-level
combined/parlay odds are preferred over the first leg price. The synthetic three-leg acceptance case
keeps Hoffenheim `-350`, Crystal Palace `-340`, and Juventus `-750` attached to their own blocks with
combined odds `-113`.

OCR failure preserves the private screenshot attachment, reports the failure, marks the draft fields
as incomplete, and continues into the guided review flow.

## 3. Continue validation and focus behavior

Every guided Continue path now produces a visible field-level error and focuses/scrolls the first
blocking field: screenshot attachment, event/kickoff, parlay leg count, leg selection/odds/line,
straight `Your Pick`, market line, and missing economics. Browser-native validation is disabled during
the guided steps so these messages are not silent or browser-dependent.

## 4. Your Pick / grading inference

The visible `Grading side` control was removed. Straight and legacy parlay editors use `Your Pick`;
side/total/draw keys remain internal metadata. The universal form infers metadata from pick text and
market, while the database re-infers it from submitted event, canonical score evidence, and market
before marking a record settlement-ready.

## 5. Imported auto-settlement readiness

Migration `20260927000000_release_candidate_fix_patch_5.sql` adds before-insert/update server-side
grading population for imported straight wagers and imported parlay legs. Canonical event identity,
supported market/line, and inferred pick are required for `auto_settlement_ready`; otherwise the
record stays manual with a visible reason.

Supported final canonical straight imports are retried by an after-insert trigger and settle through
the existing deterministic, idempotent settlement RPC. The trigger is limited to open straight
records and does not override later manual settlement updates.

## 6. Imported analytics and bankroll isolation

Imported wagers continue through the existing normalized analytics projection with `$1 USD = 1 Vial`
normalization. They remain eligible for Lab Notes/Study Results when associated with a Study, while
raw source dollars remain owner-facing import/My Bets detail. Imported settlement never writes a
simulated bankroll movement.

## 7. Pregame Study assignment

Added owner-authenticated RPCs `assign_simulated_bet_study` and `assign_imported_wager_study`. Both
require an open wager, verify Study membership, and reject assignment after any relevant event has
started. The imported and simulated accepted ticket terms remain immutable.

Assignment-only trigger authorization is transaction-local, and every association change is recorded
in RLS-protected `public.wager_study_assignment_audits`. Assignment can be changed back to private
before kickoff.

## 8. My Bets

My Bets now defaults to Open. Settled excludes void records, while a dedicated Cancelled / Void filter
de-emphasizes void cards with reduced saturation/opacity, strike-through treatment, and the existing
clear `Void / Cancelled` status badge. Open future wagers expose Assign to Study / Change Study.

## 9. Browse Odds mobile presentation

Added `OddsSelectionGrid`. Desktop retains individual book selections. At the existing narrow
breakpoint, each selection/point is one card, the best American price is shown first, and `Compare N
books` expands the remaining book prices. Started events remain locked in both desktop and mobile
cards.

## 10. Lab Notes redesign

Primary navigation now presents Analysis and Lab Notes. Visible ranking copy uses Study Results,
Study Partner, Study Name, Study Invite, Start Study, Join Study, and Manage Study. Stable `/leaderboards`
routes, RPC names, and database `groups` identifiers remain unchanged for compatibility.

## 11. Study Partner cards

Existing mobile ranking cards remain in place and now label the participant as Study Partner while
showing rank, Vials won/lost, ROI, record, bet count, and eligibility detail. Filters remain in the
compact mobile sheet. Study management stays behind the secondary Manage Study dialog/sheet, and the
existing reusable hashed invite, expiry, cap, copy, and revoke behavior remains available there.

## 12. Study management UX

Compact filters remain above the ranking surface, and mobile opens Category, Source, and Period in a
sheet. One Manage Study dialog/sheet contains Start a Study, Join a Study, and Study Partners / Invite.
Advanced invite fallback/history stays collapsed. Existing reusable hashed invite, expiry, cap, copy,
and revoke behavior remains available there.

## 13. Terminology changes

Visible copy uses Analysis, Lab Notes, Study, Studies, Study Partner, Study Partners, Study Name,
Study Invite, Start a Study, Join a Study, Manage Study, Study Settings, and Study Results. Stable
`/leaderboards` routes, RPC names, and database `groups` identifiers remain unchanged for compatibility.

## 14. Security review and cost impact

RLS remains enabled/forced on exposed tables. The new audit table is not browser-readable. Study
assignment functions are security-definer owner/membership boundaries with authenticated-only grants.
Accepted ticket terms, submitted odds/lines, and immutable imported terms remain protected. No provider
key, Supabase service-role credential, or screenshot bytes enter client code or OCR APIs.

No paid dependency or upstream provider endpoint was added. OCR remains local. Browse Odds uses the
existing shared cache and provider request boundary; no polling loop was introduced. Imported grading
uses existing canonical score data and does not create a provider call.

No real-money wagering, deposits, withdrawals, purchasable credits, prizes, transfers, sportsbook
execution, commissions, or referral functionality was added.

## 15. Migration changes

Created:

- `supabase/migrations/20260927000000_release_candidate_fix_patch_5.sql`
- `supabase/tests/release_candidate_fix_patch_5.sql`
- `src/components/odds-selection-grid.tsx`
- `test/release-candidate-fix-patch-5.test.ts`
- `RELEASE_CANDIDATE_FIX_PATCH_5_REPORT.md`

Updated the import parser/form, My Bets/actions, Browse Odds page/styles, Lab Notes/Analysis and
Study terminology surfaces, account/dashboard copy, existing patch regression contracts, and the
governing Product Spec/Architecture amendments. The migration adds imported grading inference,
supported final-score retry, pregame assignment RPCs, and a protected assignment audit table. No
prior migration was edited.

## 16. Test counts

- `npm.cmd run validate`: PASS — Prettier, ESLint, TypeScript, 25 Vitest files / 148 tests, secret
  scan, and Next production build.
- `npm.cmd audit --audit-level=high`: PASS — 0 vulnerabilities.
- Clean `npm.cmd run db:reset`: PASS — all 19 migrations replayed through Patch 5.
- `npm.cmd run db:lint`: PASS — exit 0; only two pre-existing warnings remain in
  `admin_settle_settlement_test` and `admin_create_settlement_test`.
- `npm.cmd run test:db`: PASS — 15 pgTAP files / 417 assertions.
- `npm.cmd run test:db:concurrency`: PASS.
- `npm.cmd run test:db:settlement-concurrency`: PASS.
- `npm.cmd run test:db:parlay-placement-concurrency`: PASS.
- `npm.cmd run test:db:parlay-settlement-concurrency`: PASS.
- `git diff --check`: PASS.

## 17. Mobile validation

The source and CSS contracts cover the existing `max-width: 760px` responsive path, including the
selection-card switch, best-price grouping, Study cards, compact filters, and management dialog.
Exact 390×844 and 375×812 rendered browser captures were not executed in this turn because the
available environment did not provide a viewport-emulation control or an authenticated browser
session. This remains a pre-UAT visual follow-up, not an automated gate failure.

## 18. Remaining limitations

OCR quality remains dependent on screenshot legibility. Live-provider validation with production
credentials and an authenticated visual smoke pass remain pre-production/UAT work. The two existing
Supabase admin-function lint warnings are unrelated to Patch 5.

## 19. PASS/FAIL recommendation

PASS for the Patch 5 implementation and automated release-candidate gate. Proceed to the exact-width
authenticated visual smoke pass before final UAT sign-off. No Phase 9 work was started.
