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

## Post-Patch-9 Tutorial Blocker Fix

Date: 2026-09-19

### Root cause

The production teaser was visually present but the tutorial contract was not sufficiently production-safe: the activation control did not clearly communicate that it opened the walkthrough, the modal had no explicit media-failure recovery, and the video was WebM-only with `preload="none"`. A browser that could not decode the WebM asset could therefore present an apparently empty or unusable tutorial surface. The public asset itself was present, but the experience did not provide a reliable fallback or complete modal focus behavior.

### Implementation

- `src/components/import-tutorial.tsx` now exposes a clearly labeled `Watch a quick example` button with keyboard/touch activation and an expanded state.
- The existing viewport overlay remains the single tutorial surface. It now has an accessible title/description, explicit close control, backdrop dismissal, Escape dismissal, document/body scroll locking, focus trapping, and focus return to the CTA.
- The video uses native controls, `playsInline`, `preload="metadata"`, no autoplay, and the production assets `/help/import-betslip-demo.webm` and `/help/import-betslip-demo.vtt`.
- A readable fallback walkthrough appears when the video fails to load or decode, covering screenshot upload, Luna extraction, review/correction, canonical event confirmation, Study or No Study — Personal, Confirm Import, and My Bets.
- `src/app/globals.css` constrains the dialog to `100dvh`, prevents narrow-viewport overflow, and styles the fallback without changing the betting or desktop page layout.
- The existing `scripts/record-import-demo.mjs` remains the recording path and uses the real `/track-bet` and `/my-bets?filter=imported` routes with the current import flow; no mock HTML or alternate tutorial flow was introduced.

MP4/H.264 was checked as the preferred primary format, but no H.264-capable encoder is available in this workspace and no new media dependency was added. The verified WebM asset remains bundled, while the in-product written fallback keeps the tutorial usable when a target browser cannot play it.

### Tests and responsive validation

- Extended the Patch 9 contract tests to verify the interactive CTA, dialog/close/Escape/backdrop/focus-lock contracts, media controls and metadata preload, fallback content, and the existence and non-zero size of the production WebM/VTT assets.
- Verified the built Next production server serves `/help/import-betslip-demo.webm` and `/help/import-betslip-demo.vtt` with HTTP 200 and the expected `video/webm` and `text/vtt` content types.
- The recording contract test verifies that `scripts/record-import-demo.mjs` still drives `/track-bet`, the real Upload Screenshot/Luna review flow, No Study — Personal, Confirm and save to My Bets, and `/my-bets?filter=imported`.
- Updated the earlier tutorial contract from `preload="none"` to the production-safe `preload="metadata"` requirement.
- The dialog uses the existing responsive system and `100dvh` sizing; static validation covers narrow widths without horizontal overflow. The remaining deployed-device check is required at approximately 375px, 390px, and 430px, including iPhone Safari fallback/playback behavior.

### Scope and manual production step

No server, wager-placement, pricing, bankroll, database, or security behavior changed. Desktop betting behavior is preserved. This follow-up was not committed or pushed.

After deployment, manually open `/track-bet` while authenticated at desktop and 375px/390px/430px widths: activate the CTA with mouse, keyboard, and touch; confirm `/help/import-betslip-demo.webm` and captions load; verify close, Escape, backdrop, focus return, and no page scroll/overflow regression; then temporarily exercise the browser-failure path or an unsupported mobile browser to confirm the written walkthrough is shown. The local authenticated Playwright recording/smoke path remains unavailable without the deployment's Supabase environment configuration.

### Recommendation

PASS for the scoped implementation: the full validation gate and dependency audit are green, with the deployed responsive/browser smoke test above remaining as the final production check. No remaining code blocker is known for the tutorial path.

## Post-Deployment Mobile Smoke Follow-up

Date: 2026-09-19

### Same-event same-market replacement

- **Production reproduction:** Selecting the opposite side of a spread, total, or moneyline in the same event was incorrectly rejected by the generic unsupported same-game-parlay message, leaving the first pick active.
- **Root cause:** The mobile and desktop add-leg paths checked same-event restrictions before distinguishing mutually exclusive outcomes in the same market.
- **Fix:** Added a shared canonical selection comparison. Opposite spread, total, and two-/three-way moneyline outcomes replace the existing leg atomically through the persistent slip store. Same-event different-market selections still use the existing unsupported-SGP behavior.
- **Regression coverage:** Added spread, total, home/away/draw moneyline, replacement, and different-market tests in `test/wager-slip.test.ts` and `test/mobile-bet-slip-ux.test.ts`.

### Stable parlay-leg removal

- **Production reproduction:** Removing the first leg of a two-leg parlay worked, but removing the remaining second leg could target a stale array position and leave the selection active.
- **Root cause:** The parlay renderer passed an array index into the removal callback; the straight list also filtered by index.
- **Fix:** All removal controls now use `slipSelectionKey`, the existing deterministic selection identity, and the persistent key-based removal helpers. Counts, odds, selected states, and persisted state therefore update from the same source of truth.
- **Regression coverage:** Added first, second, middle, final, and replacement/removal state-transition coverage, including the former “second leg is not removable” case.

### Sticky mobile header

- **Production reproduction:** The fixed hamburger drawer passed, but the header scrolled away on Browse Odds.
- **Root cause:** The actual hierarchy is `body → main.shell → nav.top-nav`; the global horizontal `hidden` overflow created an unnecessary scrolling mechanism in the header's ancestor chain, making mobile sticky behavior unreliable. No nested application scroll container or transform is used.
- **Fix:** Changed the global horizontal overflow guard to `clip`, which preserves no-horizontal-overflow behavior without creating a scroll container, kept the shell explicitly overflow-visible, and explicitly set mobile `position: sticky`, `top: 0`, stacking, and alignment on `.top-nav`. Drawer z-index remains above the header. Playwright smoke scripts now compare the real header bounding box before and after browser scrolling at 375/390/430px and retain a desktop assertion.
- **Regression coverage:** `scripts/check-mobile-smoke.mjs` and `scripts/check-mobile-bet-slip.mjs` now use actual scroll and bounding-box assertions rather than only checking CSS source.

### Straight screenshot American odds

- **Production reproduction:** A Miami–Wake straight screenshot recovered the event, Wake, and `+21.5` spread line but left American odds blank.
- **Root cause:** The normalized vision-draft mapper accepted any non-empty string as American odds, allowing a line-like value to override the price, and the route returned before the bounded recovery path when the primary usage-completion write failed.
- **Fix:** American odds are now accepted only as literal signed three-to-seven-digit prices. Spread/total lines remain separate, parlay combined odds remain ticket-level, and missing odds continue through the existing one-call, budget-reserved same-image recovery. The recovery prompt remains non-inventive and returns blank when unreadable.
- **Regression coverage:** Added fixtures for Wake `+21.5` with separate `-110`, negative and positive lines with negative prices, moneyline without a line, and a multi-leg parlay with per-leg prices. Existing recovery and parlay tests remain green.

### Lab Notes imported settled performance

- **Production reproduction:** Lab Notes counted imported Study wagers but showed a zero record, zero Vials won/lost, and zero ROI.
- **Root cause:** The canonical imported analytics projection only fell back to the legacy profit field after attempting the raw source-return calculation; older settled imports can lack raw return data even though the authoritative normalized settled return is present.
- **Fix:** The existing `app_private.analytics_wager_rows()` projection now falls back through source return, `settled_return_units`, and normalized profit without introducing a parallel calculation. A forward-only migration preserves the analytics-only `$1 USD = 1 Vial` mapping and does not write bankroll rows.
- **Regression coverage:** Added a production-shaped group fixture with three settled imported wins, one open imported wager, and one personal imported wager. The group RPC returns the Study wagers with non-zero record/P&L, excludes the personal wager, and leaves simulated bankroll state unchanged.

### Simulated placement double submission

- **Production reproduction:** A single mobile placement action produced two simulated tickets during retesting.
- **Root cause:** UI pending state alone did not provide a durable server boundary for a repeated action or retry.
- **Fix:** Placement forms create one attempt key, submit it with a clear disabled/pending `SubmitButton`, and call new server-only idempotent wrappers for straight, adjusted-spread, batch-straight, and parlay placement. A per-user key/fingerprint is serialized and the original result is replayed; a later intentional wager uses a new key. Existing odds, group, parlay, bankroll, and settlement validation remains delegated to the original RPCs.
- **Regression coverage:** The database fixture submits one straight placement twice with the same key and asserts exactly one ticket and one simulated debit. The table is force-RLS and not readable by authenticated clients.

### Files, database, and validation

- Added `supabase/migrations/20261002000000_post_deployment_mobile_smoke_fixes.sql` and `supabase/tests/post_deployment_mobile_smoke_fixes.sql`. No applied migration was edited; the migration replays cleanly and no unrelated schema/data migration was added.
- Updated the mobile slip, shared wager identity, odds extraction/recovery, placement actions, submit state, responsive CSS, Playwright smoke scripts, focused tests, and this report. Existing Patch 9 tutorial changes remain uncommitted and preserved.
- Focused Vitest coverage: PASS, 45 tests. Full `npm.cmd run validate`: PASS, including format, lint, typecheck, 211 Vitest tests, secret scan, and production build. Database coverage: PASS, 20 files / 507 assertions. DB lint: PASS with the repository's two pre-existing settlement-helper shadow/unused-variable warnings. Placement concurrency and parlay-placement concurrency: PASS. `npm.cmd audit --audit-level=high`: PASS, 0 vulnerabilities. `git diff --check`: PASS.

### Manual production smoke tests remaining

After deployment, verify on real authenticated Browse Odds at 375px, 390px, and 430px: opposite same-market replacement, same-event different-market rejection, removal of both legs including the former second leg, header position after deep scroll, drawer layering/scroll restoration, sheet placement retry behavior, and one rapid double tap producing one My Bets ticket. Verify a Miami–Wake straight import with separate `+21.5` line and American price, and verify Lab Notes shows imported settled record/P&L/ROI while bankroll is unchanged. The local Playwright smoke scripts were attempted at all required widths plus desktop but stopped at disabled `/auth` sign-up because this workspace lacks the deployed Supabase public configuration; they remain the required authenticated production smoke gate. No commit or push was performed.
