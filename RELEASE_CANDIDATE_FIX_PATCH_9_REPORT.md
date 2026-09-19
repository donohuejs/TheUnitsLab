# Release Candidate Fix Patch 9 Report

Date: 2026-09-19

## Recommendation

Patch 9 is implemented and locally validated. Recommend advancing to the staged production smoke test after the deployed Supabase grants, configured Luna model, and real-device responsive checks are verified. No commit or push was performed.

## Scope completed

1. **Vision accounting and admin diagnostics**

   - Added forward-only `service_role` grants for the five vision accounting/diagnostic tables, the budget sequence, and the reservation/ledger functions.
   - Revoked table access from `public`, `anon`, and `authenticated`.
   - Added safe correlation IDs when diagnostic writes fail; failures are logged without image data, prompts, or private payloads.
   - Expanded the server-side admin view with configured model, calls, token totals, actual/estimated cost, per-user usage, budget, remaining budget, latest attempt/success, and ledger/diagnostic write status.

2. **Straight-bet odds extraction**

   - Strengthened the Luna schema and instructions so event, selection, market, line, and American odds remain atomic and literal.
   - Explicitly distinguishes a signed spread such as `-2.5` from signed American odds such as `-170`.
   - Added one bounded same-image odds-recovery request only when critical American odds are missing. Recovery is separately reserved, ledgered, and budgeted, and cannot change event, selection, market, or line fields.
   - Recovery never calculates or guesses odds.

3. **Duplicate import protection**

   - Added content-hash and provider-event matching to the new duplicate RPC while retaining the existing normalized composite checks.
   - The import flow performs duplicate preflight after Luna extraction and canonical selection, including normalized parlay legs.
   - The review UI exposes the required `Potential duplicate wager`, `View existing`, `Cancel`, and `Import anyway` choices.

4. **Canonical event matching**

   - Matching now uses retained non-synthetic provider scores/cache, explicit provider IDs, team identities, and date proximity without requiring a guessed competition.
   - Unique matches fill canonical provider/sport/competition/description/kickoff fields while preserving submitted ticket terms.
   - Ambiguous matches remain `needs_review` with candidates; unmatched wagers remain available for manual resolution. Parlay legs are reconciled independently.

5. **Parlay moneyline validation**

   - Added shared parlay normalization/validation. Moneyline lines are stored and sent as `null`; spreads and totals require a line.
   - Switching a leg to moneyline clears stale line values in the UI and server action path.
   - Mixed-market, moneyline-only, and soccer three-way cases are covered by tests.

6. **Lab Notes analytics**

   - Replaced the analytics projection with a canonical wager-level projection.
   - Imported settled wagers contribute normalized ticket stake and ROI/return metrics without mutating bankroll or settlement data.
   - Open imported wagers are counted as bets, and existing All/Simulated/Imported/period filtering remains supported.

7. **Desktop/mobile navigation**

   - Desktop header is sticky with a modest logo lockup; mobile header reduces excess whitespace.
   - Mobile drawer uses a true viewport-fixed backdrop/drawer with `100dvh`, z-index layering, internal scrolling, focus handling, Escape/outside close, and restoration of document/body scroll state.

8. **Import tutorial**

   - Added an obvious accessible inline/modal tutorial entry point with written steps and callouts.
   - The video uses the existing real-route recording, native controls, `playsInline`, `preload="none"`, and WebVTT captions; autoplay is disabled.
   - The asset is served from the production public path and the recording script exercises the real `/track-bet` and `/my-bets?filter=imported` routes.

## Files changed

Application changes were made in the admin usage page, import/duplicate/vision routes, track-bet action, import/parlay/tutorial/mobile components, global styles, and the betslip extraction, vision, event matching, canonical discovery, and parlay helper modules.

New files:

- `src/lib/betslip/parlay.ts`
- `supabase/migrations/20261001000000_release_candidate_fix_patch_9.sql`
- `supabase/tests/release_candidate_fix_patch_9.sql`
- `test/release-candidate-fix-patch-9.test.ts`
- `test/mobile-bet-slip-ux.test.ts`
- `scripts/check-mobile-bet-slip.mjs`

## Mobile Bet Slip UX Addendum

### Root cause

Browse Odds represented the current odds tap in the URL, but the useful slip controls remained in a document-flow sidebar after the full odds list. On a long mobile catalog, the selection could therefore be valid and persisted while the user received little immediate feedback and could not reach the slip without a long scroll.

### Implementation

- `OddsSelectionGrid` now reads the existing persistent slip store, keeps selected outcomes visibly marked with a check indicator, expands a selected bookmaker comparison group when needed, and uses `scroll={false}` so an odds tap does not reset the Browse Odds position.
- `BetSlip` remains the only rendered slip content source. On mobile it adds the tapped selection to the existing persistent parlay-leg store, presents a fixed tray, and wraps the same straight/parlay controls in an accessible bottom sheet. Desktop continues to use the existing sticky sidebar and explicit add controls.
- The mobile sheet uses a fixed backdrop, `100dvh` sizing, independent internal scrolling, safe-area padding, Escape/backdrop/close-button handling, focus return, and document/body scroll locking with exact scroll restoration.
- Existing server-authoritative RPC placement, fresh-price validation, bankroll logic, parlay restrictions, and cleanup paths remain unchanged. The only server action addition is a validated return path and slip-key cleanup redirect so a mobile placement failure can return to the open sheet and a successful single straight placement can remove its shared pending selection.
- No database migration was added for this UX addendum.

### Tests and responsive validation

- Added 15 focused Vitest contracts covering selected-state feedback, tray appearance/count, sheet opening, scroll locking/restoration, leg removal/final cleanup, parlay state, market detail rendering, success/failure cleanup behavior, desktop suppression, bottom-of-page suppression, safe-area layering, and unchanged placement RPCs.
- Added `check:mobile:bet-slip`, a Playwright smoke script covering 375px, 390px, and 430px widths, selected odds feedback, tray/sheet interaction, scroll restoration, multi-leg parlay state, leg removal, final tray removal, and horizontal-overflow checks. It requires a running environment with at least two odds-bearing events.

The addendum does not change the server-authoritative wager terms or pricing boundary.

## Database changes

- Added the Patch 9 migration with service-role privilege hardening, canonical matching/reconciliation, duplicate detection v3, imported analytics projection, and immutable-ticket update guards.
- Added database coverage for authorization, RLS, canonical resolution, analytics normalization, imported-bankroll isolation, duplicate helper presence, and privilege boundaries.
- The migration replays cleanly from an empty local database.

## Validation

| Check                              | Result                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm.cmd run validate`             | PASS: formatting, lint, typecheck, 194 Vitest tests, secret scan, and Next build                     |
| `npm.cmd run db:reset`             | PASS: clean migration replay                                                                         |
| `npm.cmd run test:db`              | PASS: 19 files, 498 database assertions                                                              |
| `npm.cmd run db:lint`              | PASS; only pre-existing shadowed/unused-variable warnings in settlement test helpers                 |
| `npm.cmd audit --audit-level=high` | PASS: 0 vulnerabilities found                                                                        |
| Placement concurrency              | PASS: one ticket, one debit, expected balance                                                        |
| Settlement concurrency             | PASS: one return credit, expected balance                                                            |
| Parlay placement concurrency       | PASS: one two-leg parlay, one debit                                                                  |
| Parlay settlement concurrency      | PASS: one return credit, both legs won                                                               |
| Vision budget concurrency          | PASS: reservation cap enforced; 100 of 120 reservations succeeded and spend stayed within the budget |
| `git diff --check`                 | PASS                                                                                                 |

## Security and cost implications

- No provider or service-role secret is exposed to client code.
- Vision tables and functions are service-role-only; admin reads occur server-side.
- Imported wagers do not mutate the virtual bankroll.
- Submitted odds, lines, bookmaker, market, and other ticket terms remain immutable after submission; only canonical event metadata may be reconciled.
- Odds recovery is bounded to one same-image call, uses the existing budget/ledger controls, and adds no new paid dependency. The existing monthly budget target remains the controlling limit.

## Known deviation and manual follow-up

The tutorial ships the existing WebM recording plus VTT captions. MP4/H.264 was preferred as an optional fallback, but an H.264 encoder was not available in this environment, so a missing or unverified MP4 was not added. Verify WebM playback and captions in the deployed Chrome/Safari target matrix.

The local Playwright smoke scripts were attempted at the required widths but stopped at `/auth` because this workspace has no `.env.local` Supabase public configuration; account creation is intentionally disabled without it. The remaining checks require a configured/deployed environment: confirm the configured GPT-5.6 Luna model and account budget, verify production Supabase privileges/RLS with direct unauthorized requests, exercise duplicate/recovery flows against the deployed API, and smoke-test sticky navigation/drawer and the mobile Bet Slip tray/sheet on real desktop and mobile viewports.
