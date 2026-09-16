# Phase 5 Completion Report — External Bet Tracking

Date: 2026-09-13  
Gate recommendation: **PASS**

## Gate conclusion

Phase 5 is complete. An authenticated caller can record a straight wager placed elsewhere, optionally associate it with a current private group, optionally attach one private screenshot, and manually enter or correct an open, won, lost, push, or void result. The database calculates decimal odds and unit profit/loss from stored accepted terms. External creation, settlement, correction, push, void, and screenshot activity produced zero additional virtual-bankroll ledger rows and left the exact simulated balance unchanged.

The external system of record is physically separate from simulated `bets` and `bet_legs`, every external row is constrained to `source = external`, and external rows cannot be referenced through `bankroll_ledger.bet_id`. Direct database and storage-policy tests prove owner-only mutation, private/group visibility, screenshot ownership and association, and nonmember denial. Phase 6 has not begun.

## Work completed

- Added a dedicated external-wager model with user, optional group, sportsbook, sport, competition, event, event date, selection, V1 market, optional line, American odds, derived decimal odds, unit stake, result, calculated unit profit/loss, wager date, optional screenshot path, verification state, notes, and timestamps.
- Added centralized read-only sport, competition, and external-sportsbook catalogs aligned with the existing typed Phase 0 configuration. Four core competitions are enabled; event-based NFL and NBA entries remain disabled.
- Added an authenticated creation function that derives the user from `auth.uid()`, verifies group membership and catalog values, validates fixed-precision stake and odds, derives decimal odds, and calculates any initially entered result.
- Added an owner-only, row-locked result function for open, won, lost, push, and void. It accepts no profit/loss input and appends before/after correction evidence.
- Preserved accepted external ticket terms and ownership as immutable. Result changes and one-time screenshot attachment use narrow functions; ordinary authenticated clients have read-only table grants.
- Added a private Supabase Storage bucket for one optional JPEG, PNG, or WebP screenshot per wager, limited to 5 MiB.
- Added storage policies requiring the caller's ownership namespace and matching caller-owned wager for upload, plus owner/current-group-member authorization for attached-object reads.
- Added a one-time attachment function that verifies caller, object owner, owner/wager path, stored object, and wager ownership.
- Added authenticated screenshot retrieval through a 60-second signed URL after an RLS-protected wager lookup.
- Added the Track Bet UI for creation, optional upload, open wagers, settled history, manual result entry/correction, attached screenshot viewing, and explicit IRL/external source labels.
- Added a personal IRL-only summary with settled count, win-loss-push record, units wagered, net units, and ROI. Void stake is excluded from units wagered and the ROI denominator.
- Added Track Bet navigation to sports, competition, simulated bet, and account pages without a broad redesign.
- Deferred optional automatic event/result association because manual entry satisfies the phase and avoids provider calls, polling, ambiguity, and quota use.

## Files created

- `docs/PHASE_5_PLAN.md`
- `supabase/migrations/20260916000000_phase_5_external_wagers.sql`
- `supabase/tests/phase_5_external_wagers.sql`
- `src/lib/external-wagers/calculations.ts`
- `src/app/track-bet/actions.ts`
- `src/app/track-bet/page.tsx`
- `src/app/track-bet/screenshot/[wagerId]/route.ts`
- `test/external-wager-calculations.test.ts`
- `PHASE_5_COMPLETION_REPORT.md`

## Files modified

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/COST_AND_QUOTA.md`
- `docs/DATABASE_ERD.md`
- `docs/MIGRATIONS.md`
- `docs/PRODUCT_SPEC.md`
- `docs/TESTING.md`
- `next.config.ts`
- `src/app/account/page.tsx`
- `src/app/globals.css`
- `src/app/my-bets/page.tsx`
- `src/app/sports/page.tsx`
- `src/app/sports/[competition]/page.tsx`
- `test/migration-foundation.test.ts`
- `vitest.config.ts`

No dependency or lockfile change was required.

## Database changes

Migration `20260916000000_phase_5_external_wagers.sql` adds:

- `external_verification_status` with `unverified` and `user_attested`.
- `sports_catalog`, `competitions_catalog`, and `sportsbooks_catalog` as centralized read-only validation sources.
- `external_wagers` as a separate durable system of record with exact numeric constraints, catalog relationships, immutable accepted terms, result/nullability reconciliation, and a fixed external source.
- `external_wager_result_audits` as append-only before/after evidence for manual result entry and correction.
- Owner/status and group/date indexes.
- Forced RLS on every new exposed public table.
- Owner/current-group-member select authorization and no direct authenticated table mutations.
- `create_external_wager`, `set_external_wager_result`, and `attach_external_wager_screenshot` as narrow authenticated functions.
- No bankroll trigger, bankroll function call, `bets` insert, or `bankroll_ledger` insert.

External result calculation is exact:

- Win: `round(stake_units × (stored_decimal_odds - 1), 2)`.
- Loss: `-stake_units`.
- Push: `0.00`.
- Void: `0.00`.
- Open: `0.00` and no settlement timestamp.

## Storage changes

- Added the non-public `external-wager-screenshots` bucket.
- Maximum object size: 5,242,880 bytes.
- Allowed MIME types: `image/jpeg`, `image/png`, and `image/webp`.
- Object paths are generated server-side as `<authenticated user UUID>/<external wager UUID>/<random UUID>.<extension>`.
- Upload policy requires the caller namespace and an existing caller-owned wager matching the path.
- Read policy requires an attached external wager that the caller owns or can currently see through group membership.
- No public URL is stored. The application creates a 60-second signed URL only after an authorized lookup.
- No OCR, computer vision, image parsing, or automatic sportsbook extraction was added.

## Tests and exact results

- `npm.cmd run validate`: **PASS**.
  - Prettier: PASS; all matched files use Prettier style.
  - ESLint: PASS; zero warnings/errors.
  - TypeScript: PASS; no type errors.
  - Vitest: PASS; 10 files and **52 tests**.
  - Next.js 16.3.5 production build: PASS; `/track-bet` and dynamic `/track-bet/screenshot/[wagerId]` are present.
- `npm.cmd run test:coverage`: **PASS**, 10 files and 52 tests.
  - Overall configured scope: 89.51% statements, 79.02% branches, 95.12% functions, and 92.05% lines.
  - External-wager calculations: 100% statements, 91.17% branches, 100% functions, and 100% lines.
- `npm.cmd run db:reset`: **PASS**. All ordered Phase 0–5 migrations and the seed replayed cleanly.
- `npm.cmd run db:lint`: **PASS**. No schema errors in `app_private`, `extensions`, or `public`.
- `npm.cmd run test:db`: **PASS**, 5 files and **185 assertions**. The prior 137 assertions remain and Phase 5 adds 48.
- `npm.cmd run test:db:concurrency`: **PASS**. The Phase 3 overspend regression still produces one ticket, one debit, and a 2,500-unit balance.
- `npm.cmd run test:db:settlement-concurrency`: **PASS**. The Phase 4 concurrent settlement regression still produces one 25.00-unit return credit and a 10,015.00-unit balance.
- `npm.cmd audit --audit-level=high`: **PASS**, 0 vulnerabilities.
- Secret scan: **PASS**, 0 JWT-like files, 0 public provider/service/cron secret aliases, and 0 non-example environment files.
- HTTP smoke against the existing local development server:
  - `/`: 200.
  - `/auth`: 200.
  - `/sports`: 307 to `/auth` while unauthenticated.
  - `/my-bets`: 307 to `/auth` while unauthenticated.
  - `/track-bet`: 307 to `/auth` while unauthenticated.
  - `/track-bet/screenshot/<unknown UUID>`: 307 to `/auth` while unauthenticated.
  - Unconfigured `POST /api/settlement`: 503 without attempting provider work.

Unit coverage includes positive and negative American odds, winning profit, losing negative stake, push, void, open, invalid stake precision, invalid odds, IRL summary reconciliation, void exclusion from ROI, and zero-denominator ROI.

Database/storage coverage includes forced RLS; centralized catalogs; invalid stake, odds, competition, and group; caller-derived ownership; explicit external source; positive/negative odds conversion; win/loss/push/void calculations; owner correction audits; direct profit override denial; group-member and private visibility; nonmember denial; own upload namespace; foreign namespace denial; matching attachment; wager/object mismatch denial; owner-only settlement; attached group screenshot reads; discovered-path nonmember denial; anonymous denial; no simulated ticket creation; and exact zero bankroll change throughout all external activity.

## Security implications

- Every new exposed public table enables and forces RLS.
- Anonymous users receive no table access. Authenticated clients receive catalog and authorized wager/audit reads only.
- Mutation functions derive ownership from `auth.uid()` and have no user-ID parameter.
- Group association is accepted only while the owner is a current member. Group read visibility also requires current membership at read time.
- A group member may read an associated wager and screenshot but cannot enter or correct its result or attach an object.
- The client cannot submit authoritative decimal odds or profit/loss. Both are calculated inside the database.
- Accepted sportsbook, sport, competition, event, selection, market, line, odds, stake, ownership, and group association are protected from rewriting.
- Result corrections retain append-only evidence rather than silently replacing history.
- Screenshot policy is enforced in Supabase Storage/PostgreSQL, not only through UI visibility.
- Provider and service-role credentials remain in server-only boundaries and no new secret was introduced.
- External records cannot reference or mutate the simulated bankroll path.

## API cost implications

Phase 5 makes no The Odds API call and adds no polling, result-association request, scheduler, background process, or paid service. Existing odds and score quota behavior is unchanged. Automated event/result association is explicitly deferred; cached data could later provide optional suggestions, but no reliable zero-complexity association was required for this phase.

## Storage and cost implications

The selected private Supabase bucket is compatible with the documented free baseline. At the 1 GB storage allowance, a theoretical maximum-size-only workload holds roughly 204 five-MiB screenshots before accounting for other storage; ordinary compressed screenshots should generally be smaller. Signed reads consume normal storage egress. The existing 80% free-tier review threshold now applies to both storage and egress.

No paid storage, image processing, analytics, scheduler, or OCR dependency was introduced. Screenshot retention, deletion, and moderation policy remains unresolved. The application does not silently delete evidence or purchase capacity.

## Remaining issues

- Live The Odds API odds and score validation remains pending because production provider/service credentials have not been available. Phase 5 made zero provider calls and did not consume credits.
- Production score/settlement scheduling still requires an approved zero-cost invocation strategy. No paid scheduler was introduced.
- Screenshot retention, owner deletion, and administrator moderation rules remain product/operational decisions. Phase 5 provides secure upload, association, and authorized read only.
- A configured interactive browser session was not used for a live Storage API upload. The compiled vertical UI, clean bucket migration, direct storage-policy insertion/selection tests, attachment RPC tests, and signed-access route build provide the gate evidence. This does not depend on provider credentials or affect bankroll isolation.
- Automated external event/result association remains deferred because manual result entry satisfies the governing Phase 5 requirement without quota use.

## Deviations from the governing specification

No conflicting product behavior was introduced. The external verification field uses the narrow states `unverified` and `user_attested`; it does not invent sportsbook or group-admin verification. The implementation limits Phase 5 to the approved V1 straight markets and does not add props, live betting, or parlays.

The governing source does not define screenshot size, MIME types, signed-link duration, result-correction evidence, an American-odds upper bound, or the ROI treatment of voids. The explicit Phase 5 implementation records the following conservative decisions: private five-MiB image-only storage, 60-second signed access, append-only correction audits, an absolute American-odds limit of 1,000,000 so four-place decimal odds remain representable, and exclusion of void stake from the ROI denominator. These decisions preserve the $0 target, privacy, and statistical integrity and are documented in the Phase 5 plan and architecture.

## Carried-forward Phase 2–4 operational issues

1. Phase 2 live odds/provider validation is still pending due unavailable production credentials.
2. Phase 4 live score-provider validation and exact score endpoint cost remain pending for the same reason.
3. Phase 4 production score/settlement scheduling still needs an approved zero-cost invocation cadence.
4. Provider cancellation/postponement/abandonment semantics and final-score correction policy remain unresolved for simulated settlement; Phase 5 does not expand them.

## Phase 5 gate evidence

1. Authenticated external wager creation persists: PASS.
2. Manual open/won/lost/push/void result entry and correction persist: PASS.
3. Unit profit/loss is calculated from stored stake and odds: PASS.
4. External and simulated records remain distinguishable in persistence and source filtering: PASS.
5. Creation and every result path produce zero bankroll ledger mutation: PASS.
6. User A cannot create, modify, settle, or attach for User B: PASS.
7. Private and group visibility require owner or current membership: PASS.
8. Screenshot upload namespace, association, and read authorization are database-enforced: PASS.
9. Direct calculated-profit override is denied and corrections are audited: PASS.
10. Phase 5 personal IRL metrics reconcile and remain ready for later combined analytics: PASS.
11. Clean replay, database lint, prior-phase regressions, production build, audit, smoke, and secret checks pass: PASS.

**The Phase 5 gate is satisfied. Recommendation: PASS. Stop here; do not begin Phase 6.**
