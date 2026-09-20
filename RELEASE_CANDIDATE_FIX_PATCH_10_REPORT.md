# Release Candidate Fix Patch 10 Report

Date: 2026-09-20

## Scope and recommendation

Patch 10 hardens the release UX around the shared header/navigation, mobile drawer, approved logo
asset usage, and final Bet Slip removal. No betting logic, imported-wager logic, analytics, vision
accounting, canonical matching, provider behavior, quota behavior, database schema, or migration was
changed.

The implementation is complete and the repository validation gate is green. Authenticated browser
smoke remains a required deployed/local-environment follow-up because this workspace has no
`.env.local` Supabase public configuration, so sign-up was correctly disabled during the attempted
Playwright run.

## Files changed

Application and styling:

- `src/lib/navigation.ts`
- `src/components/mobile-nav.tsx`
- `src/components/bet-slip.tsx`
- `src/app/globals.css`
- `package.json`

Tests and browser coverage:

- `test/release-candidate-fix-patch-10.test.ts`
- `test/mobile-bet-slip-ux.test.ts`
- `test/release-candidate-fix-patch-2.test.ts`
- `test/ui-polish.test.ts`
- `scripts/check-patch-10-release-ux.mjs`

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

The mobile layout had unnecessary shell top padding and a larger-than-needed full-lockup wrapper.
The open drawer backdrop also used a higher stacking layer than the header while living inside the
header’s isolated sticky stacking context, so opening it could paint over the header and make the
bar appear to disappear. Conditional drawer rendering added avoidable mount/unmount churn during
repeated open/close cycles.

The mobile shell/header padding and wrapper width are now compact and safe-area aware. The drawer
backdrop remains mounted, toggles through `hidden` and an open class, and is layered below the
visible mobile header while remaining above page content. The existing body scroll lock, exact
scroll restoration, focus management, Escape handling, close-button handling, backdrop close, and
navigation close behavior remain in place.

### Final Bet Slip item removal

The vulnerable path was inconsistent identity resolution: list removal passed an identity derived
with a list index, while the mobile current-selection path called the identity helper without first
resolving the item in the current canonical collection. Separate straight/parlay callbacks also
made it easier for the final item to remain in a derived view or for a stale identity to be used.

All visible removal controls now use one helper. It resolves the candidate against the current
collection, obtains its current stable `clientSelectionId` with the current index, and applies the
appropriate persisted view removal. The same action handles 3→2, 2→1, and 1→0. Non-final mobile
removals keep the sheet open; the final removal closes it, removes the tray, and leaves valid empty
persisted state.

### Touch reliability

Bet Slip Remove controls remain native semantic buttons and now have inline-flex layout, minimum
44×44px dimensions, touch-action manipulation, visible hover/pressed treatment, and the existing
focus ring. One tap maps to one canonical removal call.

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
- Updated existing mobile Bet Slip contracts for the canonical `(leg, index)` removal callback.
- Updated older navigation/style contracts to reflect the explicit Patch 10 removal of Home and new
  responsive sizing.
- Added `npm run check:release:ux`, a Playwright smoke command using real locators and touch taps.

Focused result: 3 test files, 43 tests passed.

## Validation

| Check                                                | Result                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run validate`                               | PASS — formatting, lint, typecheck, 32 Vitest files / 226 tests, secret scan, Next build                                                |
| `npm.cmd audit --audit-level=high`                   | PASS — 0 vulnerabilities; sandbox request required approved network retry                                                               |
| `git diff --check`                                   | PASS                                                                                                                                    |
| `node --check scripts/check-patch-10-release-ux.mjs` | PASS                                                                                                                                    |
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

PATCH 10 GATE RECOMMENDATION: PASS
