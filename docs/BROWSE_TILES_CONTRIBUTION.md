# Browse tiles contribution

## Problem and proposed behavior

Selecting a game far down the previous navigator required returning to the top to see its odds.
The proposed shared competition view presents games as centered responsive tiles and opens the
selected market board in a dialog at the current scroll position. It includes the reviewed 1.2rem
team typography, compact spacing, a 68rem maximum grid width, and a viewport-filling mobile dialog.
This is a Phase 8 presentation refinement submitted for maintainer review, not a production release.

## Files and boundaries

The shared sports route, global CSS, Browse game/pane/market/schedule components, Bet Slip host,
and embedded BetSlip mode implement the change. `browse-odds-dialog.tsx` and the development-only
`browse-preview` fixture are new. Existing source-contract tests and the three Browse smoke script
entry points follow the new presentation. PRODUCT_SPEC section 30.6 and ARCHITECTURE record the
proposal. No production deployment target, release workflow, version number, or environment file is
changed in this contribution.

No migration, database operation, new dependency, paid service, or provider polling is introduced.
RLS, server secrets, immutable submitted terms, bankroll, settlement, and provider quotas retain
their existing boundaries. The fixture uses scheduled samples, includes both spread sides, disables
placement, and returns not-found in production.

## Validation and review

- `npm ci`: completed with zero reported vulnerabilities.
- `npm run validate`: passed formatting, lint, TypeScript, all 307 tests across 51 files,
  secret scanning, and the production build.
- Browser verification of the isolated development fixture passed at 1440 × 900, 1024 × 768,
  and 390 × 844. The desktop grid measured 1088px with equal side margins; no horizontal page
  overflow appeared at any checked size. Dialogs stayed within the viewport.
- Opening the last scheduled game preserved page scroll, focused the close button, and displayed
  both spread sides. Escape returned focus to the originating tile. Desktop and mobile dismissal
  preserved scroll. A home-team spread selection and 25.00 stake persisted after closing, reopening,
  and selecting another game. Fixture placement remained disabled. No browser console errors were
  observed.
- Browser checks used the in-app browser directly; the standalone Playwright smoke script was not
  executed in this session. Authenticated provider-backed placement was not exercised.
- `git diff --check`: passed. No database migration was created or changed, and no migration or
  production deployment was performed.

Recommendation: ready for maintainer review as a Phase 8 presentation proposal. The existing
production migration and release gates remain applicable if the maintainer later chooses to
release it. This contribution does not change the existing Phase 8 gate or begin a later phase.
