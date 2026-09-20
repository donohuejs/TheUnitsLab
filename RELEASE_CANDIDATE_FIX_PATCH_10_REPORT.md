# Release Candidate Fix Patch 10 Report

Date: 2026-09-20

## Scope and recommendation

Patch 10 and its production hotfix harden the release UX around the shared header/navigation,
mobile drawer, approved logo asset usage, and final Bet Slip removal. No betting logic,
imported-wager logic, analytics, vision accounting, canonical matching, provider behavior, quota
behavior, database schema, or migration was changed.

The deterministic hotfix browser harness is green. Authenticated production-route browser smoke
remains a separate follow-up because this workspace has no `.env.local` Supabase public
configuration, so the existing Browse Odds smoke correctly stops at disabled sign-up.

## Files changed

Application and styling:

- `src/lib/navigation.ts`
- `src/components/mobile-nav.tsx`
- `src/components/bet-slip.tsx`
- `src/lib/ui/scroll-lock.ts`
- `src/components/patch-10-hotfix-harness.tsx`
- `src/app/globals.css`
- `package.json`

Tests and browser coverage:

- `test/release-candidate-fix-patch-10.test.ts`
- `test/mobile-bet-slip-ux.test.ts`
- `test/release-candidate-fix-patch-2.test.ts`
- `test/ui-polish.test.ts`
- `scripts/check-patch-10-release-ux.mjs`
- `scripts/check-patch-10-hotfix.mjs`

Documentation:

- `RELEASE_CANDIDATE_FIX_PATCH_10_REPORT.md`
- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `README.md`

No database migration was created.

## Logo audit

Production source confirmed: `public/brand/the-units-lab-logo.png`.

| Measurement                   |                                  Before |     After |
| ----------------------------- | --------------------------------------: | --------: |
| PNG dimensions                |                               1448×1086 | 1448×1086 |
| Nontransparent artwork bounds |                  x=27..1399, y=21..1059 | unchanged |
| Edge canvas                   | left 27, top 21, right 48, bottom 26 px | unchanged |

The source has only small antialiased safety canvas, not meaningful excess whitespace. The asset was
therefore intentionally not cropped, preserving the exact approved artwork, colors, proportions,
transparency, and quality. Header sizing was corrected in CSS instead of using negative margins or
adding an image-processing dependency.

## Root causes and fixes

### Desktop header collision

The previous desktop header combined a very large fixed logo height (`clamp(12rem, 14vw, 17rem)`),
large navigation text (`clamp(1.1rem, 1.45vw, 1.5rem)`), right-justified flex spacing, and the
redundant Home item. That left insufficient predictable space at narrower desktop widths.

The header now uses a two-column responsive grid, a bounded logo scale, smaller responsive nav
typography, deliberate logo-to-nav spacing, and distributed one-row links. Home was removed from the
shared navigation source while active-page semantics remain on the remaining links.

### Mobile header dead space and drawer disappearance

The mobile shell/header padding and wrapper width are compact and safe-area aware. The production
disappearance failure and its corrective fix are documented in the hotfix section below. The final
hotfix trims only safe surrounding mobile spacing (`padding-bottom: 0.15rem` and `margin-bottom:
0.75rem`); the visible logo width remains `min(58vw, 12rem)`.

### Final Bet Slip item removal

The production root cause and corrective fix are documented in the hotfix section below. The
earlier identity hardening remains in place, and the new browser harness traces the complete remove
event through canonical state, persistence, derived count, and sheet behavior.

### Touch reliability

Bet Slip Remove controls remain native semantic buttons and now have inline-flex layout, minimum
44×44px dimensions, touch-action manipulation, visible hover/pressed treatment, and the existing
focus ring. One tap maps to one canonical removal call.

## Production Hotfix — Header Drawer + Final Slip Removal

### Header drawer disappearance

Exact root cause: the drawer was rendered inside the sticky `.top-nav`, whose `backdrop-filter` and
isolated stacking context could become the containing/painting context for the drawer’s fixed
descendant. After a deep scroll, the drawer and header no longer behaved as independent viewport
surfaces: the close control could be outside the viewport or have pointer events intercepted by the
header. The header/body lifecycle also had separate scroll-lock snapshots in the header and Bet
Slip, so overlapping open/close cleanup could restore stale styles. This was a positioning and
scroll-lock interaction, not a logo or isolated CSS-height issue.

The browser harness reproduced the pre-fix state with a real touch tap: scroll, open, then the
drawer close control resolved outside the viewport. The fix portals the drawer backdrop and panel
to `document.body`, keeps the header mounted in its own tree, gives the backdrop a layer below the
header and the panel its own layer above the header, and removes the drawer portal completely on
close. `acquireBodyScrollLock` now owns one reference-counted HTML overflow lock for the drawer,
Bet Slip, and import tutorial. It restores the captured scroll position only after the final lock
releases, so one surface cannot undo another surface’s lock.

Why prior tests missed it: the previous smoke path stopped at authentication before reaching the
real header, and the earlier source contracts did not scroll a real page, perform touch hit testing,
or exercise repeated open/close cleanup. The new harness uses the production `AppNav` and
`MobileNav`, not a mock drawer.

Files changed: `src/components/mobile-nav.tsx`, `src/lib/ui/scroll-lock.ts`,
`src/app/globals.css`, `src/components/patch-10-hotfix-harness.tsx`,
`scripts/check-patch-10-hotfix.mjs`, and the related release-candidate tests.

Regression test: `npm.cmd run check:release:ux:hotfix` runs ten open/close cycles at 375px, 390px,
and 430px; checks header and hamburger bounding boxes while open and after close; checks hamburger
and Remove hit targets with `elementFromPoint`; covers Close, backdrop, Escape, and navigation-item
close; verifies the backdrop is removed, page controls remain clickable, body/html lock state is
restored, scroll is blocked while open and restored after close, and normal page scrolling resumes.

### Final slip removal

Exact root cause: the Remove handler was invoked with the correct stable ID, the canonical store
mutation ran, and `writeState` already persisted an empty `selections: []` state. The removed item
was then immediately re-added by the mobile auto-add effect because the server/page selection was
still present in the URL. The effect saw that selection missing from the updated slip and treated it
as a new pick. This was a state/route synchronization rehydration bug, not a persistence refusal,
hydration fallback, form submission, propagation, or stale-ID bug. The derived straight/parlay
views reflected the rehydrated canonical state, which made both straight collections and parlays
appear impossible to remove.

The fix adds a suppression guard for the just-removed URL selection, clears the selection query
after the canonical mutation, and uses one `removeSelection(clientSelectionId, mode)` action. The
mutation occurs first; only then can the URL and sheet state change. The same path supports 3→2,
2→1, and 1→0. Every Remove control is explicitly `type="button"`; the browser test verifies no
Remove control is inside a submitting form and that its center is not intercepted by another layer.
The existing slip persistence was audited and intentionally left unchanged because it already
writes the canonical empty state rather than skipping empty arrays.

Why prior tests missed it: prior tests asserted store-level removal and source contracts, but did
not render the real selection URL, tap the real mobile Remove controls, or refresh after the final
removal. They therefore never observed the auto-add effect rehydrating the selection.

Files changed: `src/components/bet-slip.tsx`, `src/components/patch-10-hotfix-harness.tsx`,
`scripts/check-patch-10-hotfix.mjs`, and the related Bet Slip/release-candidate tests. No database
file or Odds API file changed.

Regression test: the same real-component browser run covers one selection → Remove → zero →
refresh → zero; two selections removing item #2 and item #1; three selections removing #3 → #2 →
#1 → zero; final current straight removal; final parlay-list removal; unique row hit targets; and
form isolation. Unit coverage also checks canonical parlay and straight removal through the empty
state.

Validation output for this hotfix: `npm.cmd run check:release:ux:hotfix` passed all three viewport
stress runs and the final straight/parlay removal, empty persistence, hit-testing, and form-isolation
checks. `npm.cmd run validate`, `npm.cmd audit --audit-level=high`, and `git diff --check` are run
below for the final gate.

## Responsive dimensions covered

The new browser smoke script asserts:

- Mobile: 375×812, 390×844, and 430×932.
- Desktop: 1024×768, 1280×768, 1440×768, and 1920×768.

The mobile assertions cover logo link destination, compact header dimensions, no horizontal
overflow, deep-scroll sticky positioning, ten open/close stress cycles, visible header while the
drawer is open, body scroll lock, Escape/close/backdrop paths, and exact scroll restoration. The
desktop assertions cover logo/navigation separation, one-row link positions, no overlap, no overflow,
and removal of the Home link.

## Automated tests added or updated

- Added `test/release-candidate-fix-patch-10.test.ts` for logo/home-link contracts, 3→0 removal,
  final parlay/straight removal, drawer mounting/layering, responsive sizing, and touch controls.
- Updated existing mobile Bet Slip contracts for the canonical `clientSelectionId` removal action
  and shared scroll-lock utility.
- Updated older navigation/style contracts to reflect the explicit Patch 10 removal of Home and new
  responsive sizing.
- Added `npm run check:release:ux:hotfix`, a real-component Playwright smoke command using touch
  taps and the development-only hotfix harness.

Focused result: 3 test files, 33 tests passed; hotfix browser run passed all required reproductions.

## Validation

| Check                                                | Result                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run validate`                               | PASS — formatting, lint, typecheck, 32 Vitest files / 226 tests, secret scan, Next build                                                |
| `npm.cmd audit --audit-level=high`                   | PASS — 0 vulnerabilities; sandbox request required approved network retry                                                               |
| `git diff --check`                                   | PASS                                                                                                                                    |
| `node --check scripts/check-patch-10-release-ux.mjs` | PASS                                                                                                                                    |
| `npm.cmd run check:release:ux:hotfix`                | PASS — real production header/drawer/slip harness; 375/390/430px drawer stress and removal regressions                                  |
| `npm.cmd run check:release:ux`                       | BLOCKED at authenticated sign-up because `.env.local`/Supabase public configuration is absent; no browser assertion was falsely claimed |

The attempted browser run reached `/auth`; the Sign up button was disabled by the application’s
missing-environment setup behavior. Run `npm.cmd run check:release:ux` and the existing
`npm.cmd run check:mobile:bet-slip` against a configured local or deployed environment before
production release.

## Database, security, cost, and provider impact

- Database changes: none. No migration is required.
- Security: logo links retain accessible names; mobile drawer focus, Escape, backdrop, and body
  scroll-lock behavior remain keyboard/touch accessible. No authorization boundary changed.
- Cost: no new dependency, service, request, cache, scheduler, or paid capability.
- Odds API: no request behavior, provider architecture, quota logic, caching, throttling, or
  sportsbook-count behavior was changed.
- Wager integrity: submitted ticket terms, bankroll, placement, settlement, imported wager
  isolation, analytics, vision accounting, and canonical matching remain unchanged.

## Remaining manual production smoke requirements

With configured authentication and representative odds data, verify on real desktop/mobile targets:

1. Logo navigation and keyboard focus at 1024/1280/1440/1920px.
2. Mobile header readability and compact height at 375/390/430px after deep scroll.
3. Ten-cycle hamburger open/close stress, close button, backdrop, Escape, navigation selection,
   and browser back/forward behavior.
4. Exact scroll restoration and body unlock after drawer close.
5. Straight and parlay Bet Slip removal through 3→2→1→0, including final mobile tap removal,
   refresh persistence of empty state, tray disappearance, synchronized counts, same-market
   replacement, mixed-book straight picks, and compatible parlay behavior.
6. Verify no real-device safe-area, browser zoom, or Safari fixed-position regression.

PATCH 10 HOTFIX GATE RECOMMENDATION: PASS
