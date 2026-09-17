# Release Candidate Fix Patch 3 Report

Date: 2026-09-17  
Scope: The Units Lab pre-UAT release-candidate fix patch 3  
Recommendation: PASS for pre-UAT, subject to the documented OCR asset and authenticated-mobile limitations below.

## 1. Scope and guardrails

This patch implements only the requested pre-UAT fixes. Phase 9 has not started. Existing migrations
were not edited; one forward-only migration was added. No real-money wagering, deposits, withdrawals,
prizes, purchasable credits, peer transfers, sportsbook execution, provider polling, paid OCR, or
referral behavior was added.

Existing RLS, private screenshot storage, simulated-bankroll isolation, cache/quota boundaries,
immutable ticket snapshots, deterministic calculations, and settlement idempotency remain the
authoritative boundaries.

## 2. Branding and Home

- `public/brand/the-units-lab-logo.png` is used directly for the full Home lockup.
- `public/brand/the-units-lab-mark.png` is used directly for compact desktop/mobile navigation and
  the app icon.
- The exact tagline is `Experiment | Analyze | Improve`; no `Bet Smarter` or hand-redrawn SVG mark is
  used.
- Home presents the full lockup prominently and keeps `Welcome back, {Name}` subordinate, with
  `Scientist` as the fallback.

## 3. Screenshot OCR and import review

Added a free browser-local Tesseract adapter with the contract `extractBetslip(image) -> normalized
draft`. It reports Processing progress, attempts common sportsbook, bet ID, event, kickoff, market,
selection, line, American odds, stake, payout/return, straight/parlay type, and probable parlay legs.
Missing or uncertain fields produce visible review warnings. Every draft remains editable and the
server save boundary requires explicit confirmation. OCR failure falls back to the guided draft.

The screenshot stays in the private application upload flow and is not sent to an OCR or vision API.
Tesseract's default worker/language assets may be fetched from its public CDN on first use; image
recognition itself runs in the browser, and no paid service is used. The parser is deliberately
heuristic: extracted parlay legs are probable drafts and require review in the parlay importer.

## 4. Mobile manual import

Manual entry now leads with cached-event search, showing the most relevant upcoming or recent cached
events and limiting the result list. Selecting a canonical event fills sport, competition, teams,
kickoff, and provider event ID. `Can't find my event` exposes the freeform fallback. The remaining
flow is sportsbook → event → market/selection/line → any two of stake, odds, payout → exact third
value → review → save.

## 5. Deterministic imported economics

The existing exact fixed-precision helper remains the only imported economics authority. Any two of
stake, American odds, and payout/return calculate the third without floating-point drift. Imported
source dollars continue to normalize as `$1 USD = 1 Vial` for comparison only and never debit or
credit the simulated bankroll.

## 6. Canonical event readiness

The existing canonical matching and readiness boundary remains in use. A supported matched event can
be marked Auto settlement ready; unmatched, unsupported, prop, teaser/SGP, cash-out, promo, and
incomplete records remain manual-review records with no automatic settlement claim.

## 7. Reusable group invites

Added `supabase/migrations/20260925000000_release_candidate_fix_patch_3.sql`:

- default invite expiry remains seven days;
- `max_uses = null` means reusable until expiry, while an optional cap accepts 1–50 uses;
- tokens remain random and only their hashes are stored;
- joins remain authenticated, expiry-checked, revocation-checked, and row-locked;
- owner/admin revoke remains enforced by a security-definer RPC;
- `list_group_invites` exposes expiry, revocation, cap, and usage count without token material.

Leaderboards now exposes Create Group, Join Group, Invite, Copy Invite Link, and Revoke Invite, plus
owner/admin invite usage history. A group name alone never grants access.

## 8. Files changed

- UI: `src/components/brand.tsx`, `src/components/cached-event-search.tsx`,
  `src/components/import-betslip-form.tsx`, `src/components/invite-form.tsx`,
  `src/app/leaderboards/page.tsx`, `src/app/track-bet/page.tsx`, `src/app/actions.ts`,
  `src/app/layout.tsx`, `src/app/globals.css`.
- Import logic: `src/lib/betslip/extraction.ts`.
- Database: `supabase/migrations/20260925000000_release_candidate_fix_patch_3.sql` and
  `supabase/tests/release_candidate_fix_patch_3.sql`.
- Tests: `test/betslip-extraction.test.ts` and `test/release-candidate-fix-patch-3.test.ts`.
- Dependency metadata: `package.json` and `package-lock.json` (`tesseract.js@6.0.1`).
- Documentation: `docs/PRODUCT_SPEC.md`, `docs/MIGRATIONS.md`, `docs/TESTING.md`, and `README.md`.

## 9. Database and authorization validation

- Clean local Supabase reset/replay: PASS through migration `20260925000000`.
- `npm run db:lint`: PASS. Only the pre-existing admin settlement test-function warnings remain
  (`leg_number` shadow/unused); no new patch-3 warning was reported.
- `npm run test:db`: PASS — 13 SQL files, 390 pgTAP assertions/tests.
- Patch-3 database coverage: PASS for reusable and capped redemption, expiry/revocation rejection,
  usage counts, secure listing, token non-disclosure, grants, and authorization.
- RLS and bankroll isolation remain covered by the full database suite; imported records do not
  create simulated ledger entries.

## 10. Concurrency validation

All four required suites passed:

- Straight placement: one accepted ticket, one debit, 2,500-unit balance.
- Straight settlement: one 25.00-unit return credit, 10,015-unit balance.
- Parlay placement: one accepted two-leg ticket, one debit, 2,500-unit balance.
- Parlay settlement: one 50.00-unit return credit, two won legs, 10,040-unit balance.

## 11. Application validation

- `npm run typecheck`: PASS.
- `npm test`: PASS — 23 test files, 135 tests.
- `npm run build`: PASS — production build completed with 15 routes.
- `npm audit --audit-level=high`: PASS — 0 vulnerabilities.
- `npm run validate`: PASS after the final documentation and source updates.

## 12. Mobile smoke review

The local app was opened in the in-app browser's narrow 465px viewport. Home visibly rendered the
approved full logo, exact tagline, subordinate copy, and a usable sign-in CTA. The authentication
surface visibly rendered stacked, touch-sized controls without horizontal clipping. Authenticated
Import Betslip and Leaderboards actions were not submitted in the browser because no real account or
credential was used; their narrow-layout contracts and authorization paths are covered by source and
database tests.

## 13. Security and privacy review

- Provider and service-role secrets remain server-only.
- Screenshot evidence remains in the private bucket with existing owner/member storage policies.
- Local OCR does not transmit screenshot bytes to a paid OCR/vision provider.
- Save requires an authenticated server action, validated fields, and explicit review confirmation.
- Imported records remain outside the virtual-bankroll ledger.
- Invite creation, joining, listing, and revocation retain least-privilege authorization.
- Invite listing never returns the raw token or stored token hash.
- Expiry, optional usage caps, row locking, and idempotent membership insertion prevent unintended
  repeated access or usage inflation.

## 14. Cost and quota implications

No paid dependency or provider endpoint was added. Tesseract.js is an open-source dependency and OCR
is browser-local after its worker/language assets are available. The Odds API cache, shared refresh
lease, usage ledger, and quota protections are unchanged. No uncontrolled polling loop was added.

## 15. Remaining issues and gate recommendation

Remaining limitations are explicit rather than hidden: OCR quality depends on screenshot quality and
the English Tesseract model; first-use model assets may require network access; probable parlay legs
still require user review; and authenticated UI smoke was not performed with a real account.

All requested automated, database, concurrency, security, dependency, build, and narrow mobile
rendering gates passed. Recommend **PASS** for the release-candidate pre-UAT gate, with the OCR
first-use asset behavior and authenticated-account UAT checks recorded as follow-up verification items.
