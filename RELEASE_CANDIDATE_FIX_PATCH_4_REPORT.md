# The Units Lab — Release Candidate Fix Patch 4 Report

Date: 2026-09-17  
Scope: Universal betslip import, free/local OCR, optional sportsbook metadata, and mobile leaderboard redesign  
Phase status: Phase 8 / pre-UAT; Phase 9 not started

## 1. Universal screenshot import

Implemented one `ImportBetslipForm` action for screenshot, pasted text, and manual entry. Screenshot
upload no longer assumes a straight ticket. The draft detects straight/parlay, asks for confirmation
when confidence is low, preserves the screenshot privately, and requires an editable review before save.
Parlay drafts show two-to-twelve editable legs with add/remove support.

## 2. OCR preprocessing

Implemented browser-local preprocessing in `src/lib/betslip/extraction.ts`: EXIF-aware orientation,
bounded downscale/upscale, grayscale conversion, contrast enhancement, and a threshold/binarization
pass. One local Tesseract worker runs enhanced and threshold passes asynchronously with progress updates;
the better normalized parse is selected. No paid OCR or vision dependency was added.

## 3. Parsing architecture

The normalized parser remains sportsbook-agnostic while recognizing common FanDuel, DraftKings, BetMGM,
and Caesars labels. It extracts ticket-level economics and metadata plus probable leg-level event,
market, selection, line, odds, and date fields. Missing or uncertain fields remain editable and produce
review warnings rather than fabricated values.

## 4. Straight/parlay detection

Explicit straight/parlay labels are detected with confidence. Ambiguous receipts default to a straight
review draft with a low-confidence ticket-type warning and a review selector. Parlay receipts produce
probable legs; each leg can be corrected and canonicalized independently before the universal save action.

The synthetic FanDuel acceptance case is covered: FanDuel, Rutgers at Boston College, Boston College,
spread `-2.5`, `-170`, `$8.00` stake, `$12.71` total return, and a parsed September 11 event date.

## 5. OCR limitations

OCR is intentionally best-effort. It may not resolve small text, dates without a year, sportsbook IDs,
selection sides, or parlay leg boundaries. The UI exposes Processing, progress, confidence/warnings,
partial extraction, and a failure message; failure preserves the private screenshot and continues into
the guided draft. No permanent private screenshot fixture was committed.

## 6. Optional sportsbook change

Sportsbook is now optional import metadata. Blank or unrecognized sources save with a null catalog ID
and the stable display label `Unknown sportsbook`; configured sources retain their catalog identity.
Canonical event matching and deterministic settlement do not depend on sportsbook identity.

## 7. Manual import redesign

Manual entry now starts at `Find the event`, followed by market/selection, pricing, review, and save.
Optional sportsbook, sportsbook bet ID, verification, group, and notes moved under
`More details (optional)`. The same review/save boundary is used for screenshot, pasted, and manual
imports.

## 8. Cached-event search

`CachedEventSearch` is the primary event control. Selecting a normalized cached event fills sport,
competition, matchup, kickoff, and provider event ID. The freeform sport/team/date inputs are behind
`Can't find my event`. Parlay legs expose the same cached-event search independently.

## 9. Pricing calculations

The existing exact minor-unit `calculateImportedEconomics` helper remains the pricing boundary. The
form accepts any two of stake, American odds, and total return, calculates the third immediately, and
labels the result correctly: total return equals stake plus profit. The server revalidates the final
values before persistence.

## 10. Canonical matching

Cached-event selections carry canonical event identity. The existing server-side matching/readiness
boundary remains authoritative for supported moneyline, soccer three-way, spread, and total markets.
Records are `Auto settlement ready` only when event, selection, and deterministic grading evidence is
sufficient; unsupported, unmatched, incomplete, prop, teaser/SGP, cash-out, and promotional records
remain manual-review records.

## 11. Leaderboard redesign

Leaderboards now render the header, compact `LeaderboardControls`, filters, and ranking surface before
secondary group management. The desktop table remains available. The previous large group access and
invite UI was removed from above the standings.

## 12. Mobile player cards

At the existing narrow breakpoint, the desktop table is hidden and ranked participant cards are shown.
Cards expose rank, participant, Vials won/lost, ROI, record, bet count, and eligibility detail. Cards use
bounded grid columns and `overflow-wrap:anywhere`; the page retains `overflow-x:hidden` and no horizontal
leaderboard scrolling path.

## 13. Manage Group UI

`Manage Group` is now the single secondary group-management control. It opens a native dialog on desktop
and a bottom-aligned sheet at narrow widths with Create, Join, and authorized Invite sections. Invite
history is collapsed by default.

## 14. Reusable invites

Existing reusable invite behavior is preserved: authenticated join, hashed random token storage, seven-day
default expiry, optional 1–50 use cap, usage counts, owner/admin revoke, and no token material in list
results. The token fallback remains behind `Advanced: token fallback`; copy link and revoke behavior remain
available to authorized users.

## 15. Security review

The new database boundary retains security-definer ownership/group checks, existing external-wager RLS,
least-privilege authenticated grants, null-safe immutable-field protection, canonical matching on the
server, imported-vs-simulated bankroll isolation, private screenshot storage, and settlement idempotency.
The pgTAP suite includes anonymous execute denial and unknown-sportsbook creation with no additional
simulated ledger movement. No provider credentials, service-role credentials, or screenshot bytes enter
client source or OCR API calls.

## 16. Migration changes

Added forward-only `supabase/migrations/20260926000000_release_candidate_fix_patch_4.sql` and
`supabase/tests/release_candidate_fix_patch_4.sql`. The migration makes `external_wagers.sportsbook_id`
and `sportsbook_name` nullable, updates the external/imported create RPCs for null sportsbook identity,
stores `Unknown sportsbook` for display, and makes the immutable trigger null-safe. No deployed or prior
migration was edited. The new pgTAP file adds 7 assertions.

## 17. Test counts

- `npm.cmd run validate`: PASS — formatting, lint, typecheck, 24 Vitest files / 140 tests, secret scan,
  and production build.
- `npm.cmd audit --audit-level=high`: PASS — 0 vulnerabilities.
- Clean local `supabase db reset --local`: PASS — 18 migrations replayed through Patch 4.
- `npm.cmd run db:lint`: PASS (exit 0); two existing warnings remain in `admin_settle_settlement_test`
  and `admin_create_settlement_test` for shadowed/unused loop variables.
- `npm.cmd run test:db`: PASS — 14 pgTAP files / 397 assertions.
- `npm.cmd run test:db:concurrency`: PASS.
- `npm.cmd run test:db:settlement-concurrency`: PASS.
- `npm.cmd run test:db:parlay-placement-concurrency`: PASS.
- `npm.cmd run test:db:parlay-settlement-concurrency`: PASS.
- `npm.cmd run build`: PASS — all 15 application routes generated/compiled successfully.

## 18. Mobile validation

The available Codex in-app browser smoke pass rendered `/` and `/auth` on its narrow surface with no
horizontal overflow, usable full-width form controls, and expected vertical scrolling. `/import-betslip`
and `/leaderboards` correctly route unauthenticated users to `/auth` when Supabase public configuration
is absent. Source/CSS contracts verify that both requested widths, 390×844 and 375×812, take the same
`max-width:760px` path: mobile cards replace the table, filters and management dialogs become bottom
sheets, URLs/tokens wrap, and the page does not create horizontal overflow.

The connected in-app browser exposes no viewport emulation/override API, so exact pixel-specific rendered
captures at 390×844 and 375×812 could not be executed in this environment. This is the only requested
validation item not directly reproduced by the browser tool.

## 19. Remaining limitations

The exact-width browser capture limitation above remains a pre-UAT manual follow-up. OCR still depends on
the quality and legibility of the supplied receipt, and no live provider or real authenticated account was
used during smoke review. Existing Supabase lint warnings are pre-existing and unrelated to Patch 4.

## 20. PASS/FAIL recommendation

**FAIL — release gate incomplete only because exact 390×844 and 375×812 viewport captures were unavailable
from the connected browser tool.**

All implementation, source-contract, unit, security, migration, pgTAP, concurrency, audit, lint, and
production-build gates pass. The functional PASS criteria are implemented, including straight/parlay
universal import, materially improved free/local OCR with non-dead-ending fallback, optional sportsbook,
cached-event-first manual import, exact pricing, rankings-first Leaderboards, mobile ranked cards,
compact group management, and reusable invites. Re-run the two exact-width visual checks with a viewport-
controllable browser, then this patch is ready for the requested pre-UAT gate. No Phase 9 work was started.
