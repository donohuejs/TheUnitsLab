# Release Candidate UX Patch 1 Report

## 1. Summary

Implemented the focused release-candidate usability and testability patch requested for The Units
Lab. The patch stays within the existing Phase 0–8 architecture and does not begin Phase 9. It adds
centralized team identity, NFL/NHL browse configuration, clearer parlay construction, explicit SGP
blocking, provider-priced alternate-line loading, an admin-only settlement harness, and the
corresponding specification, architecture, quota, migration, and test documentation.

The CI route-handler issue was also corrected: the screenshot route now declares its source-level
Next 16 context type (`params: Promise<{ wagerId: string }>`), so typecheck does not depend on a
previous `.next` route-type generation step.

No real-money wagering, deposits, withdrawals, purchasable credits, prizes, sportsbook execution,
paid dependency, uncontrolled polling loop, or client-authoritative payout behavior was added.

## 2. Team logo implementation

`src/lib/teams/logos.ts` is the centralized resolver and `src/components/team-mark.tsx` is the
shared presentation component. Known NFL, NHL, college-football, EPL, and Champions League names
resolve to best-effort public ESPN CDN marks; every display also retains readable initials fallback
when a name is unknown or a mark is unavailable. The component is used in Browse Odds, the bet slip,
open/recent dashboard tickets, My Bets history, and parlay leg displays.

The normalized provider model does not currently expose a stable licensed team-logo identifier, so
the resolver uses normalized team names rather than treating an image URL as wager data. ESPN CDN
availability, branding rights, and future URL stability remain documented limitations. No paid image
dependency was added, and a missing mark cannot break a page.

## 3. NFL support

NFL is enabled as a core browse competition with provider key `americanfootball_nfl`. It uses the
existing competition configuration, provider client, normalized event/market model, PostgreSQL
cache, refresh leases, quota ledger, and standard bet-slip placement path. Featured moneyline,
spread, and total markets remain the base request shape.

## 4. NHL support

NHL is enabled as a core browse competition with provider key `icehockey_nhl`, and hockey is added to
the shared sport types and external-recording UI. NHL uses the same provider/cache/quota/selection/
settlement boundaries as the existing competitions; no parallel fetch system was introduced.

## 5. Parlay UX changes

The bet slip now labels the one-leg state as a straight bet and the multi-leg state as “Build a
parlay,” including the current leg count and twelve-leg maximum. Each parlay leg shows its event,
team marks, market, selection, line, bookmaker, American odds, and decimal odds. Individual legs
remain removable, incompatible duplicate/same-event/same-book selections are explained inline, and
combined odds/return are labeled as a preview while the server remains authoritative.

The existing server-side parlay calculation and placement function were not weakened or replaced.

## 6. SGP handling

Same-event selections are rejected in both client affordances and the server placement action. The
message now explicitly says that same-game parlay pricing is not currently supported and directs the
user to choose another event. No correlated price is fabricated or created by multiplying correlated
legs. Standard multi-event parlays remain supported.

## 7. Alternate-line support

`createAlternateOddsRequest` creates an event-scoped request using the configured
`alternate_spreads` and/or `alternate_totals` markets. The provider client routes it through
`/sports/{sport}/events/{eventId}/odds`; the response normalizer accepts the event-object response
shape and marks alternate selections explicitly. The selection identity carries the numeric point,
so a different line cannot silently reuse the base line's price.

Alternate lines are lazy/on-demand for a selected event, are stored through the same canonical
PostgreSQL cache/lease/quota path, and are not interpolated. The implementation was checked against
the provider's current [v4 API guide](https://the-odds-api.com/liveapi/guides/v4/),
[betting-markets reference](https://the-odds-api.com/sports-odds-data/betting-markets.html), and
[alternate-market error guidance](https://the-odds-api.com/liveapi/guides/v4/api-error-codes.html).

## 8. Teaser decision

Teasers were not implemented. Alternate spread/total lines are presented as provider-priced
alternate markets and are not described as teasers. A teaser remains a future wager type requiring
its own point-adjustment and pricing rules.

## 9. IRL custom-line changes

The existing external-wager forms already accept manually entered sportsbook, market, line,
American odds, stake, result, and parlay-leg terms; those records remain external-only and auditable
under the existing correction functions. This patch adds hockey to the manual sport selector and
keeps custom terms out of simulated provider-backed pricing and the virtual bankroll.

## 10. Settlement test harness

The migration `supabase/migrations/20260920000000_release_candidate_ux_patch_1.sql` adds immutable
`is_synthetic` flags to bets and event scores, an admin-only create RPC, and an admin-only settle RPC.
`src/app/admin/settlement-tests/` provides the protected UI and server actions. The harness supports
straight and two-leg parlay win, loss, push, and void scenarios, uses the existing authoritative
settlement/void functions, records normal stake and settlement ledger movements, and supports safe
reruns that resolve as already settled without a second credit.

Synthetic bets, legs, scores, audits, and analytics rows are excluded from normal authenticated
history, score reads, settlement-job selection, analytics, and leaderboards. Browser roles cannot
execute the harness functions; the server action checks the existing administrator allowlist and the
RPCs are granted only to `service_role`. Synthetic test debits and credits use the administrator's
virtual ledger by design, so the admin page labels that effect; they are excluded from production
metrics and normal user views.

## 11. Quota impact

NFL and NHL add configurable browse targets but no automatic upstream work by themselves. Base
requests use the existing featured-market shape. Alternate markets are fetched only for an explicitly
selected event, through the shared cache and refresh lease, and their usage is recorded in the same
quota ledger. No per-user cache, alternate polling loop, second provider key, paid service, or bypass
of conservation modes was added.

## 12. Security review

- Provider and Supabase service-role secrets remain server-only.
- Existing forced-RLS boundaries remain in place; synthetic rows are explicitly excluded from normal
  authenticated policies and application queries.
- Synthetic classification and ticket terms, including parlay leg count, are immutable after insert.
- Only service-role RPC execution is granted for synthetic creation and settlement; the admin server
  action also requires the existing administrator identity check.
- Same-event rejection and server-authoritative parlay odds remain enforced server-side.
- Alternate selection identity includes the provider-priced point, preventing line/price substitution.
- External/manual odds remain in external tables and never create virtual-bankroll transactions.
- The secret scan passed.

## 13. Test counts

Completed in this workspace:

- Unit/static suite: **14 test files, 82 tests passed**.
- TypeScript: **passed** (`npm.cmd run typecheck`).
- ESLint: **passed with zero warnings** (`npm.cmd run lint`).
- Prettier: **passed** (`npm.cmd run format:check`).
- Secret scan: **passed** (`npm.cmd run security:scan`).
- Production build: **passed** (`npm.cmd run build`); the application route manifest generated successfully.
- Local production HTTP smoke: **passed**, `GET /` returned **200** from `next start`.
- Clean CI reproduction: **passed**. `.next` and `tsconfig.tsbuildinfo` were removed, then the exact
  `npm.cmd run validate` sequence passed with typecheck completing before the build regenerated `.next`.

Not completed successfully:

- Local database reset/replay and database lint were blocked by the Supabase CLI's inability to write
  its telemetry temp file under `C:\Users\donoh\.supabase`; a destructive reset was not forced.
- The database authorization/integrity, storage/RLS, settlement, and concurrency suites therefore
  remain **unverified in this workspace** after this migration.
- `npm.cmd audit --audit-level=high` failed before returning advisories because the npm audit endpoint
  request errored and npm could not write its local log directory. No dependency change was made by
  this patch.

## 14. Migration changes

The release-candidate migration:

- Adds the hockey catalog, enables NFL, and inserts NHL.
- Adds immutable synthetic flags and filtered indexes.
- Recreates relevant ticket, leg, score, and settlement-audit policies to hide synthetic rows.
- Filters synthetic simulated tickets from canonical analytics and settlement-job selection.
- Adds service-role-only test creation and settlement functions.

`supabase/tests/release_candidate_ux_patch_1.sql` covers admin authorization, all requested outcome
scenarios, parlay handling, ledger credits, idempotent reruns, and analytics/history exclusion. The
static migration test in `test/migration-foundation.test.ts` verifies the critical isolation and
immutability clauses. A clean database replay is still required before release approval.

## 15. Production deployment result

**Not verified.** This workspace has the GitHub remote and is on `main`, but no authenticated Vercel
production deployment was executed or confirmed during this run. Production secrets, Supabase
configuration, DNS, and cron configuration were not changed. The requested commit/push/deploy step
was not performed because the required database gate and production deployment verification were not
green.

## 16. Remaining limitations

- Clean Supabase migration replay, DB lint, RLS tests, settlement tests, and concurrency tests need a
  permitted local database run.
- Live NFL/NHL/alternate provider calls need the configured production credentials and a bounded
  smoke; this workspace did not spend provider quota to simulate them.
- Logo mapping is best-effort name-based public CDN presentation with licensing/availability risk.
- Synthetic harness ledger activity affects the selected administrator's virtual balance while being
  excluded from normal analytics and user history; this is visible in the admin UI and must be
  treated as test data.
- The npm audit service was unavailable during validation.
- No SGP, teaser, live wagering, futures, or player-prop pricing was added.

## 17. Recommended next UAT steps

After the database environment is available, replay migrations from empty state, run database lint,
then run `supabase/tests/release_candidate_ux_patch_1.sql` and the existing Phase 0–7 DB/concurrency
suites. Verify an administrator can create and rerun every synthetic scenario while a normal user
cannot see or invoke any synthetic record. Then perform bounded provider-backed checks for NFL, NHL,
and one event's alternate lines, followed by responsive/keyboard checks for Browse Odds, the bet slip,
My Bets, and Track IRL Bet. Only after those checks pass should the changes be committed, pushed, and
deployed to the configured production target.

## 18. PASS/FAIL recommendation

**FAIL for the release gate at this time.** The implemented code-level checks and local HTTP smoke
pass, and no unresolved fabricated-pricing or settlement-architecture issue was identified. However,
the gate explicitly requires a successful clean database validation and confirmed production deploy;
both remain unverified in this environment. The patch is ready for the blocked DB/deployment UAT steps,
but should not be declared production-approved yet.
