# The Units Lab — Rollout Part 1 Release Readiness Report

**Review date:** 2026-09-15  
**Scope:** Whole-system audit of the Phase 0–8 release candidate  
**Deployment performed:** No  
**Vercel project or production settings changed:** No

## 1. Executive summary

The Phase 0–8 implementation is safe to proceed to release-candidate deployment. The audit found no known blocker involving security, RLS or group privacy, ticket immutability, virtual-bankroll integrity, deterministic settlement, parlay handling, provider-cache protection, or Next.js production build compatibility.

The audit applied four low-risk corrections:

- Promoted **The Units Lab** to the user-facing product name across the app shell, metadata, auth screen, fallback error screen, README, architecture title, and package description.
- Added a shared `PRODUCT_NAME` constant and a presentation test so the approved name is not reintroduced inconsistently.
- Added a protected `GET /api/settlement` adapter to the existing settlement route. Vercel Cron invokes configured paths with GET; the existing POST remains available.
- Reordered settlement-route checks so an invalid bearer token receives 401 before server configuration is parsed. Settlement and authorization semantics are otherwise unchanged.

The release candidate is **not yet a production V1**. Live provider credentials and exact provider-cost behavior remain unverified; the Vercel project, production environment, Supabase production configuration, and final scheduling invocation remain to be configured and validated. Those are explicitly permitted rollout items under the requested gate and are captured below.

## 2. Current architecture

The system is a Next.js 16.3.5 App Router application written in TypeScript 6.0.3, React 19.3.0, and Node 24.18.1/npm 11.16.0. It uses `proxy.ts` for Supabase SSR cookie refresh, server actions for authenticated mutations, route handlers for bounded server endpoints, and `server-only` boundaries around provider and service-role code.

Supabase provides PostgreSQL, email/password authentication, Row Level Security, and private object storage. Ten ordered migrations build the database. Phase 8 adds no migration. The browser receives only the Supabase URL and anon key; the Supabase service-role key, Odds API key, quota configuration, admin allowlist, and settlement secret are server-side configuration.

The principal data paths are:

- Odds: normalized provider responses → canonical PostgreSQL `odds_cache` rows → read-only authenticated views. Refresh leases, TTLs, cooldowns, quota state, and the API-usage ledger prevent per-user polling and stampedes.
- Scores: normalized score responses → shared `event_scores` and `score_refresh_state` rows. Settlement work is prioritized for open wagers and finalization needs.
- Simulated wagers: server-authoritative database functions validate fresh cached prices, terms, group membership, stake, and bankroll availability, then insert immutable ticket/leg snapshots and one atomic ledger debit.
- Bankroll: `bankroll_ledger` is append-only. Only simulated wagers affect it; external/IRL records never do.
- Settlement: final scores are durable and protected. Straight and parlay settlement functions lock the parent wager, grade deterministically, append audits/credits, and enforce retry idempotency.
- External tracking: separate external straight/parlay tables and result-audit tables record wagers placed elsewhere. Screenshot objects use one private Supabase Storage bucket and short-lived signed access.
- Analytics: a private canonical union projection feeds personal analytics and membership-gated group leaderboards. Parlays count as one wager in aggregate analytics.
- UI: protected account, sports, My Bets, IRL tracking, performance, leaderboard, and admin-quota surfaces use the same navigation model. Loading, empty, unavailable, and error states are explicit.
- Operations: `.github/workflows/ci.yml` runs `npm ci` and the application `validate` script on pushes and pull requests. Database tests run locally through Supabase because CI does not start the local Supabase stack.

Intended hosting is Next.js frontend/server on Vercel, with Supabase for database/auth/storage and GitHub as source control. No persistent process, local filesystem state, paid cache, or external queue is required by the current code.

## 3. Product-name transition status

**Status: Complete for user-facing surfaces.** The official name is **The Units Lab**. It is now used in:

- Root metadata and browser title default.
- Signed-in navigation brand and accessible home label.
- Setup/landing page, authentication page, and global error fallback.
- README and architecture document title.
- Package description and shared `PRODUCT_NAME` presentation constant.

The historical repository directory, package identifier, migration filenames, environment names, source-specification title, AGENTS guidance, and prior phase reports retain legacy/internal wording where renaming would add risk or erase history. `TUL` is not used as the public brand.

## 4. Phase 0–8 requirements reconciliation

| Capability                                     | Status                                         | Audit evidence or boundary                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js/TypeScript scaffold                    | Implemented and verified                       | Next production build passes on the current pinned toolchain.                                                                         |
| Supabase architecture                          | Implemented and verified                       | SSR client, admin client, migrations, RLS, and local reset all pass.                                                                  |
| Environment validation                         | Implemented and verified                       | Public/server Zod schemas and secret scan pass; real production values remain a deployment validation item.                           |
| Migration strategy                             | Implemented and verified                       | Ten ordered migrations replay cleanly with seed data; no manual schema step was found.                                                |
| CI                                             | Implemented and verified                       | GitHub workflow runs `npm ci` and `npm run validate`; local database suites are not part of CI.                                       |
| Cost/quota assumptions                         | Implemented and verified                       | Shared cache, leases, usage ledger, quota modes, cooldowns, and planning envelope are tested; exact live provider cost remains open.  |
| Email/password authentication                  | Implemented but requires production validation | SSR cookie flow and auth database coverage pass; production email confirmation and Site URL are not configured here.                  |
| Profiles                                       | Implemented and verified                       | Own-profile reads/updates and cross-user denial are covered.                                                                          |
| Private groups                                 | Implemented and verified                       | Group visibility and membership boundaries are covered by RLS/RPC tests.                                                              |
| Memberships and roles                          | Implemented and verified                       | Owner/admin/member operations are security-definer and directly tested.                                                               |
| Expiring, single-use invites                   | Implemented and verified                       | Token hashing, expiry, redemption, and reuse denial are covered.                                                                      |
| Odds API integration                           | Implemented but requires production validation | Server provider adapter and redacted fixtures pass; no real credential was available for a live call.                                 |
| Server-only provider credentials               | Implemented and verified                       | Provider and admin clients are server-only; scan found no populated secret assignment or client exposure.                             |
| Normalized events, markets, bookmakers, prices | Implemented and verified                       | Provider contract/unit fixtures and placement validation cover normalized supported markets.                                          |
| Shared persistent odds cache                   | Implemented and verified                       | PostgreSQL cache is authenticated read-only and service-refreshable; cache authorization tests pass.                                  |
| TTL behavior and refresh leases                | Implemented and verified                       | Fresh/stale/state-sensitive TTL and coalescing fixtures pass; lease mutation is service-only.                                         |
| Manual refresh cooldown                        | Implemented and verified                       | Server refresh path applies per-user cooldown and quota policy.                                                                       |
| API-call accounting                            | Implemented and verified                       | Usage rows capture canonical key, purpose, endpoint, response, and quota headers.                                                     |
| Quota modes                                    | Implemented and verified                       | Normal/conserve/high/critical behavior is typed and fixture-tested.                                                                   |
| Straight simulated wagers                      | Implemented and verified                       | Atomic placement, immutable snapshots, stale-price rejection, and RLS pass.                                                           |
| Moneyline and soccer draw                      | Implemented and verified                       | Grading and database tests cover ordinary moneyline and soccer three-way behavior.                                                    |
| Spread and total                               | Implemented and verified                       | Line shape, grading, push, and settlement tests pass.                                                                                 |
| Immutable ticket snapshots                     | Implemented and verified                       | Trigger protections and reconstruction-after-cache-mutation tests pass.                                                               |
| Atomic stake debit and virtual bankroll        | Implemented and verified                       | Placement concurrency produces one debit and no overspend; ledger is append-only.                                                     |
| Open wagers and wager history                  | Implemented and verified                       | My Bets reads owner-scoped rows and reconstructs accepted terms from snapshots.                                                       |
| Shared scores and score coalescing             | Implemented and verified                       | Normalization, refresh state, leases, TTL, and quota fixtures pass.                                                                   |
| Deterministic settlement                       | Implemented and verified                       | Final-score association, grading, audit, return credit, push/void, and retry tests pass.                                              |
| Settlement idempotency                         | Implemented and verified                       | Database and concurrent settlement suites enforce one economic credit.                                                                |
| External straight wagers                       | Implemented and verified                       | Separate table/functions, owner/group reads, calculations, corrections, and isolation pass.                                           |
| Private screenshot storage                     | Implemented and verified                       | Private 5 MiB JPEG/PNG/WebP bucket, ownership paths, attachment checks, and signed reads pass locally.                                |
| Manual results and append-only corrections     | Implemented and verified                       | Result functions and immutable correction audits are covered.                                                                         |
| Simulated-bankroll isolation for IRL records   | Implemented and verified                       | External operations have no bankroll ledger mutation.                                                                                 |
| Canonical analytics projection                 | Implemented and verified                       | Personal/group RPCs derive caller/membership scope and read the canonical union.                                                      |
| Fixed-precision metrics and filters            | Implemented and verified                       | BigInt/fixed-precision calculations, timezone, period, source, sport, market, and team dimensions pass.                               |
| Performance pages and breakdowns               | Implemented and verified                       | Page reads match the tested analytics helpers and RPC shape.                                                                          |
| Group leaderboards                             | Implemented and verified                       | Membership-gated RPC, five-wager minimum, dense ties, and privacy tests pass.                                                         |
| Simulated parlays                              | Implemented and verified                       | 2–12 legs, same bookmaker, distinct events, atomic debit, payout, and settlement pass.                                                |
| External parlays                               | Implemented and verified                       | Parent/leg creation, correction, screenshot, and analytics treatment pass.                                                            |
| Immutable parlay leg snapshots                 | Implemented and verified                       | Accepted per-leg terms and settlement-only result fields are trigger-protected.                                                       |
| Combined odds and payout logic                 | Implemented and verified                       | Exact fixed-precision combined odds and effective push/void economics pass.                                                           |
| Navigation and dashboard                       | Implemented and verified                       | Current app shell and dashboard are covered by presentation tests/manual Phase 8 review.                                              |
| Mobile responsiveness and accessibility        | Implemented and verified                       | Responsive CSS, semantic labels, keyboard focus, and non-color status text were reviewed in Phase 8.                                  |
| Loading, empty, error, and UI consistency      | Implemented and verified                       | Route/page states are explicit; no known debug-only surface remains.                                                                  |
| Phase 3 one-leg-only model                     | Superseded by a later phase                    | Phase 7 extends the parent/leg model to straight and 2–12-leg parlays and backfills straight rows.                                    |
| Phase 6 pre-parlay analytics projection        | Superseded by a later phase                    | Phase 7 replaces it with one canonical parent-ticket row, preserving straight history.                                                |
| Broader administration beyond quota view       | Partially implemented                          | Admin quota/API-usage dashboard and allowlist exist; moderation, manual bankroll adjustment, and feature-control UI are not V1 scope. |
| Automatic production scheduler                 | Documented but not implemented                 | The protected settlement endpoint exists, now accepts GET/POST, but no `vercel.json` or scheduler is configured in Part 1.            |
| OAuth/password-reset flows                     | Intentionally deferred                         | V1 Phase 1 uses email/password; no unused callback route was invented.                                                                |
| Optional product enhancements                  | Intentionally deferred                         | Strategy tagging, saved strategies, notifications, additional sports, and advanced dashboards remain Phase 9 candidates.              |

## 5. Missing or partially implemented requirements

These are known scope or rollout items, not hidden failures in the current code:

1. A successful live Odds API/score smoke test has not run. The real key was intentionally not placed in this repository or audit environment.
2. No Vercel project, production URL, `vercel.json`, cron schedule, DNS record, or production Supabase project was created. The route is scheduler-compatible after the GET correction, but the final invocation still needs deployment-time validation.
3. Supabase production Auth Site URL/redirect configuration and production migration push remain manual deployment tasks.
4. CI runs application validation but not the local Docker/Supabase database suites. Local release evidence covers those suites; adding a hosted database-test job would be a future CI improvement.
5. UAT has not been performed in this task, by the explicit stop condition.
6. The current app has an admin quota dashboard, not a general operations console. This is consistent with the implemented V1 scope; broader controls should not be inferred from future-oriented architecture notes.

## 6. Database/migration audit

### Migration order and replay

The clean replay passed all ten repository migrations, in this order:

1. `20260911000000_phase_0_foundation.sql`
2. `20260912000000_phase_1_auth_users_groups.sql`
3. `20260913000000_phase_2_sports_odds.sql`
4. `20260914000000_phase_3_simulated_straight_bets.sql`
5. `20260914100000_phase_4_bankroll_void_type.sql`
6. `20260915000000_phase_4_scores_settlement.sql`
7. `20260916000000_phase_5_external_wagers.sql`
8. `20260917000000_phase_6_analytics_leaderboards.sql`
9. `20260917100000_phase_7_parlay_market_type.sql`
10. `20260918000000_phase_7_parlays.sql`

`supabase/seed.sql` then applied successfully. No duplicate or conflicting migration object was found, and Phase 8 correctly has no database migration.

### Integrity and authorization findings

- Exposed product tables use RLS and are forced where intended; direct browser writes to cache, usage ledger, wagers, legs, ledger, scores, audits, and catalog data are not granted.
- Security-definer functions derive `auth.uid()` or enforce the service role and use an empty `search_path`; exposed execute grants are explicit.
- Foreign keys, enum constraints, numeric precision, market/line shape, result shape, ownership, group association, supported catalog values, and parlay 2–12-leg constraints are present.
- Accepted ticket and leg terms are protected by triggers. Result fields are only mutable through the intended settlement path and cannot change after settlement.
- Bankroll debits and return credits are transactionally coupled to the parent wager, with append-only ledger protection and one-economic-credit uniqueness/idempotency.
- External wager records are a separate system of record and contain no virtual-bankroll write path.
- Group reads use current membership; analytics and leaderboard RPCs do not expose email fields or unrestricted projections.
- The screenshot bucket is private, accepts JPEG/PNG/WebP, has a 5 MiB bucket limit, and has insert/select policies tied to wager ownership and current group visibility. The local global storage setting is 10 MiB, but the bucket-specific cap is the effective lower limit.

`npm run db:lint` reported no schema errors. The clean replay and 284-test pgTAP suite are the release evidence for migration correctness.

## 7. Security audit

**Finding: no known release-blocking security defect.**

Verified controls include:

- No service-role or Odds API secret is imported by client components; `.env`/`.env.*` files are ignored except `.env.example`.
- The repository secret scan found no private-key material, JWT-like secret, or populated server-secret assignment.
- Profile, group, membership, invite, ticket, leg, ledger, score, external-wager, screenshot, analytics, and leaderboard boundaries are tested directly at database/RPC level rather than relying on UI hiding.
- Client-provided stake, odds, lines, bookmaker, competition, and parlay economics are revalidated by server actions/database functions. Accepted ticket terms are stored from the server-side cache snapshot.
- Redirects are fixed to known destinations (`/auth`, `/account`, `/sports`, and related in-app paths); no untrusted return URL is accepted.
- Settlement is service-secret protected and uses constant-time bearer comparison. The route now checks authorization before parsing the rest of server configuration.
- Screenshot paths are server-generated under `<user>/<wager>/<uuid>.<ext>` and are checked against Storage ownership and the corresponding external wager before attachment.
- Admin visibility is derived from the server-side `APP_ADMIN_USER_IDS` allowlist after authentication; the browser cannot grant itself admin access.
- User-facing failures are generic and do not intentionally return provider keys, service credentials, SQL, or internal exception detail.

Residual operational security work is deployment configuration: protect Vercel environment variables, use a high-entropy `CRON_SECRET`, set the final HTTPS origin in Supabase Auth, and verify production Storage/API settings without making buckets public.

## 8. Provider/quota audit

The architecture honors the $0/month constraint in code:

- Odds and scores cross one server boundary and persist in shared PostgreSQL cache rows.
- Canonical cache keys, refresh leases, state-sensitive TTLs, manual cooldowns, and quota modes prevent equivalent page views from becoming independent upstream calls.
- Score refresh is prioritized for open wagers/finalization and active use; the UI has no provider polling loop.
- Analytics and historical dashboard rendering read persisted data and do not call the provider.
- The usage ledger records endpoint, purpose, sport/competition, canonical request key, HTTP outcome, and provider quota headers when available.
- Caesars remains disabled in the free-tier Odds API configuration while catalog support can still represent externally placed wagers. NFL/NBA are intentionally disabled in the current provider configuration.

The documented planning envelope is 500 monthly credits: 240 for four core competition odds windows, 150 for score/finalization work, 20 for discovery, 40 for user refresh, and 50 reserve. This is a ceiling and planning assumption, not a claim about exact provider billing. No unnecessary live provider call was made during this audit. Exact request cost and response behavior must be measured once production-safe credentials are supplied.

Likely production pattern: shared cache hits serve most page loads; a competition refresh produces at most one upstream request per cache window; scores refresh only for open/finalization or explicit active use; analytics produces zero provider calls. A misconfigured scheduler must not be allowed to bypass the shared cache or quota ledger.

## 9. Environment-variable inventory

| Variable                        | Purpose                                                         | Visibility                    | Requiredness                                                | Local source                          | Production source                                             | Manual supply                | Browser-safe                 |
| ------------------------------- | --------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL for SSR/client auth                        | Client-visible                | Required for auth/app                                       | `.env.local` from `.env.example`      | Vercel Project Environment Variables                          | Yes                          | Yes; URL is not a secret     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key                                        | Client-visible                | Required for auth/app                                       | `.env.local` from `.env.example`      | Vercel Project Environment Variables                          | Yes                          | Yes, subject to Supabase RLS |
| `SUPABASE_SERVICE_ROLE_KEY`     | Privileged server-side database/storage client                  | Server-only                   | Required for provider/score/admin paths                     | `.env.local` only                     | Vercel server-side environment variable                       | Yes                          | No                           |
| `THE_ODDS_API_KEY`              | The Odds API credential                                         | Server-only                   | Required for live odds/scores                               | `.env.local` only                     | Vercel server-side environment variable                       | Yes                          | No                           |
| `ODDS_API_MONTHLY_ALLOWANCE`    | Quota ceiling used by server mode logic/admin view              | Server-only                   | Optional schema default `500`; set explicitly in production | `.env.local`/default                  | Vercel server-side environment variable                       | Recommended                  | No                           |
| `APP_ADMIN_USER_IDS`            | Comma-separated admin Supabase UUID allowlist                   | Server-only                   | Optional; blank means no admin users                        | `.env.local`                          | Vercel server-side environment variable                       | If admin access is wanted    | No                           |
| `CRON_SECRET`                   | Bearer secret for the bounded settlement endpoint               | Server-only                   | Optional globally; required to invoke scheduling endpoint   | `.env.local`                          | Vercel server-side environment variable and scheduler secret  | Yes if scheduling is enabled | No                           |
| Application/site URL            | Auth origin and email confirmation target                       | Not an app env variable today | Required in hosted Supabase Auth settings                   | `supabase/config.toml` local URL      | Supabase Auth Site URL, e.g. `https://theunitslab.vercel.app` | Yes                          | N/A                          |
| Storage bucket                  | Private screenshot storage                                      | No env variable               | Created by migration                                        | Local Supabase Storage                | Created/verified by hosted migration                          | No separate value            | N/A                          |
| Auth callback/OAuth URL         | No callback/OAuth flow is implemented                           | No env variable               | Not applicable to current email/password V1 flow            | N/A                                   | Add only if a future auth flow introduces it                  | No                           | N/A                          |
| Feature flags                   | Sports/provider choices live in typed config and catalog tables | No env variable               | Not applicable                                              | `src/config/sports.ts` and migrations | Deploy the reviewed code/config                               | No                           | N/A                          |

The only localhost assumptions found are the intentionally local `site_url = "http://127.0.0.1:3000"` and `additional_redirect_urls = ["http://localhost:3000"]` in `supabase/config.toml`. They are not production URLs and were not copied into application code. No `NEXT_PUBLIC_SITE_URL` variable is currently consumed; production Auth uses the Supabase dashboard Site URL until an explicit redirect flow needs an application URL variable.

## 10. Vercel compatibility assessment

**Assessment: application-compatible; deployment configuration still pending.**

- `npm run build` passes with no public environment variables and renders the setup fallback.
- A configured build using dummy public Supabase values passes and marks all Supabase-dependent pages dynamic, including `/`, `/auth`, `/sports`, `/my-bets`, `/performance`, `/leaderboards`, `/track-bet`, and `/admin/api-usage`.
- The settlement route and screenshot route are dynamic server handlers. The settlement route supports GET and POST; the GET adapter is compatible with Vercel Cron while preserving the existing protected POST path.
- `proxy.ts` uses the current Next.js proxy convention and Supabase SSR cookie refresh. Static/image/favicon paths are excluded by the matcher.
- Server actions are used for mutations and have a 6 MiB configured body limit; screenshot enforcement remains 5 MiB at the application and bucket layers.
- No local filesystem persistence, long-running worker, in-memory cache dependency, or paid service is required. Supabase PostgreSQL is the shared state boundary.
- Node `24.18.1` is pinned by `.nvmrc` and the package engine. Vercel documents Node 24.x as an available runtime; set the deployment runtime to the reviewed major/version range.
- There is no `vercel.json`, which is appropriate for this no-deploy audit. A future deployment must add/configure the chosen cron path only after cadence and cost review; Part 1 did not create it.

Vercel’s current cron documentation says configured jobs invoke an HTTP GET and that Hobby plans support a minimum once-daily cadence with imprecise timing. See [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [Vercel Cron jobs](https://vercel.com/docs/cron-jobs). Vercel’s [Node.js runtime documentation](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) lists Node 24.x support.

Preferred future identity remains project `theunitslab` and, if available, `https://theunitslab.vercel.app`. No availability claim was made and no project was created.

## 11. Supabase deployment requirements

For the final URL `https://theunitslab.vercel.app` or its approved fallback:

1. Create/select the production Supabase project on the reviewed free-tier plan.
2. Apply the repository migrations in order through the normal linked-project migration workflow; never use a destructive remote reset.
3. Verify `public`/`app_private` exposure, forced RLS, the private `external-wager-screenshots` bucket, Storage policies, and generated database state after migration.
4. Set Supabase Auth **Site URL** to the final HTTPS URL and add only the required additional redirect URLs for approved local/preview environments. The current email/password signup relies on Supabase’s configured Site URL for email confirmation; no OAuth callback is currently implemented.
5. Verify email confirmation in production, including the exact destination and sender/provider settings. Password reset and OAuth remain outside current V1 scope.
6. Add the public Supabase URL/anon key to the Vercel client environment and the service-role/Odds API/quota/admin/cron values only to server-side Vercel environments.
7. Confirm Storage remains private and that signed screenshot reads work for owners and current group members but not nonmembers.
8. Confirm the final HTTPS origin and Supabase Auth redirect behavior from a real deployed browser session.

Supabase documents that the Auth Site URL is important for email confirmations and password resets; see [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls). No production Supabase setting was changed in this task.

## 12. Live-provider validation status

**Status: Open; intentionally not marked complete.** No real provider credentials were available, and the audit made no uncontrolled live calls.

When production-safe credentials are supplied, perform one controlled validation in a non-publicly observable session:

- Verify the configured Odds API account, current allowance, endpoint cost, supported regions/markets, and competition availability.
- Load one configured competition through the application and confirm normalized events, event times, bookmaker names, supported markets, prices, and cache timestamp.
- Confirm the provider key is absent from browser source, rendered HTML, client network payloads, and error responses.
- Repeat the same request during the fresh TTL and verify a shared-cache hit with no second upstream call and correct usage-ledger accounting.
- Expire or invalidate the test cache in a disposable environment and confirm the refresh lease coalesces concurrent misses into one provider call.
- Verify malformed/missing quota headers are recorded as unknown rather than zero and that normal/conserve/high/critical behavior follows the configured policy.
- Exercise one controlled score response for a test event, verify shared score normalization, and test final-score protection and settlement only after durable final data.
- Compare actual provider credit consumption with the 500-credit planning envelope before enabling any automatic schedule.

## 13. Zero-cost scheduling status

**Status: Release-candidate limitation; deployment decision remains open.**

What needs to run automatically is the bounded score-refresh/settlement cycle for open simulated wagers and finalization. The code currently exposes `/api/settlement`, protected by `CRON_SECRET`, and `My Bets` can supplement it with a user-triggered shared-cache-aware cycle. If the job does not run, wagers remain open until a later valid score refresh/settlement invocation; no ledger credit is lost or duplicated because settlement is idempotent.

No paid scheduler, queue, polling loop, or new scheduling system was added. The new GET adapter makes the existing endpoint compatible with a future Vercel Cron configuration. Vercel Hobby’s documented once-daily/imprecise cron behavior is suitable only as a low-frequency safety net, not as a live-score polling guarantee. A final product decision is needed during Rollout Part 2:

- If daily safety-net settlement is acceptable, configure one protected daily invocation and validate it after deployment.
- If near-real-time score updates are required, the current $0/Vercel Hobby baseline cannot guarantee that cadence; do not silently add a paid scheduler. Revisit the requirement with a cost/architecture decision.
- Keep user-triggered refresh as a safe supplement because it uses the same shared cache, lease, TTL, and quota controls.

## 14. Test and validation results with exact counts

All code and database validations below were run after the audit corrections, except where explicitly labeled as an environment limitation.

| Validation                      | Result                 | Exact result                                                                                                                                                                                                       |
| ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run format:check`          | PASS                   | All checked files use Prettier style.                                                                                                                                                                              |
| `npm run lint`                  | PASS                   | ESLint completed with zero warnings/errors.                                                                                                                                                                        |
| `npm run typecheck`             | PASS                   | TypeScript completed with no errors.                                                                                                                                                                               |
| `npm test`                      | PASS                   | 13 test files, 77 tests.                                                                                                                                                                                           |
| `npm run security:scan`         | PASS                   | No private-key, JWT-like, or populated server-secret assignment found.                                                                                                                                             |
| `npm run build` (no env)        | PASS                   | Next 16.3.5 production build; setup fallback included.                                                                                                                                                             |
| Configured `npm run build`      | PASS                   | Dummy public Supabase env; all Supabase-dependent pages rendered dynamic.                                                                                                                                          |
| `npm run db:reset`              | PASS                   | All 10 migrations and seed data replayed from a clean local database.                                                                                                                                              |
| `npm run db:lint`               | PASS                   | `app_private`, `extensions`, and `public` linted; zero schema errors.                                                                                                                                              |
| `npm run test:db`               | PASS                   | 7 pgTAP files, 284 tests, all successful.                                                                                                                                                                          |
| Straight placement concurrency  | PASS                   | Two concurrent 7,500-unit requests → one ticket, one debit, 2,500-unit balance.                                                                                                                                    |
| Straight settlement concurrency | PASS                   | One return credit of 25.00 units and 10,015.00-unit balance.                                                                                                                                                       |
| Parlay placement concurrency    | PASS                   | One two-leg ticket, one debit, 2,500-unit balance.                                                                                                                                                                 |
| Parlay settlement concurrency   | PASS                   | One return credit of 50.00 units, two won legs, 10,040.00-unit balance.                                                                                                                                            |
| HTTP smoke                      | PASS                   | Configured production server: `/` 200; invalid-bearer `GET /api/settlement` 401 with `{"error":"Unauthorized"}`.                                                                                                   |
| `npm audit --audit-level=high`  | PASS                   | `found 0 vulnerabilities`.                                                                                                                                                                                         |
| `npm ci`                        | ENVIRONMENT LIMITATION | Windows `EPERM` while unlinking the locked Next SWC native binary. No lockfile resolution error.                                                                                                                   |
| Dependency repair               | PASS WITH WARNING      | `npm install` restored the ignored dependency tree from the lockfile, audited 403 packages, and found 0 vulnerabilities; npm emitted the existing eslint deprecation and pending install-script approval warnings. |
| Live provider smoke             | OPEN                   | No real credentials supplied; no live call made.                                                                                                                                                                   |
| Browser UAT                     | OPEN                   | Explicitly outside Rollout Part 1 stop condition.                                                                                                                                                                  |

The automated assertion total is **361** (`77` Vitest tests + `284` pgTAP tests), plus **4** dedicated concurrency scenarios and the HTTP smoke checks. The concurrency scripts report scenario outcomes rather than a framework assertion count, so they are not added to the 361 total.

## 15. Any changes made during the audit

| File                                         | Change                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/lib/ui.ts`                              | Added the shared `PRODUCT_NAME` constant.                                        |
| `src/components/app-nav.tsx`                 | Updated visible brand and accessible label to The Units Lab.                     |
| `src/app/layout.tsx`                         | Updated metadata title/description.                                              |
| `src/app/page.tsx`                           | Updated setup and unauthenticated landing headings.                              |
| `src/app/auth/page.tsx`                      | Updated auth heading.                                                            |
| `src/app/global-error.tsx`                   | Updated fallback brand label.                                                    |
| `src/app/api/settlement/route.ts`            | Added GET adapter and moved bearer authorization before full server-env parsing. |
| `README.md`                                  | Updated public product identity and linked the rollout artifacts.                |
| `docs/ARCHITECTURE.md`                       | Updated the document’s product-facing title.                                     |
| `package.json`                               | Updated the package description only; internal package name was retained.        |
| `test/ui-polish.test.ts`                     | Added an exact approved-product-name assertion.                                  |
| `ROLLOUT_PART_1_RELEASE_READINESS_REPORT.md` | Added this audit report.                                                         |
| `RELEASE_CANDIDATE_CHECKLIST.md`             | Added the actionable remaining-rollout checklist.                                |

No migration, database object, provider behavior, production setting, Vercel project, DNS record, or Phase 9 feature was changed.

## 16. Known limitations

- Actual Odds API/score behavior and exact credit cost require a controlled live credential smoke test.
- No automatic schedule is configured. Vercel Hobby cadence is daily at best and imprecise, so it cannot promise live-score polling.
- Production Vercel and Supabase projects, environment variables, Auth Site URL, redirect allowlist, and Storage verification remain unconfigured.
- GitHub CI does not run the local Supabase pgTAP/concurrency suites.
- Supabase free-tier pause/backup behavior and screenshot retention/volume policy remain operational decisions documented in `docs/COST_AND_QUOTA.md`.
- The Windows workspace encountered a locked native SWC file during `npm ci`; the dependency tree was repaired and all application checks passed afterward.
- No user acceptance test, cross-browser pass, or production observability review was performed in this task.

## 17. Required fixes before release-candidate deployment

No repository code or migration remediation is required by the Part 1 gate. Before the actual deployment, the following configuration prerequisites are required:

- Supply production-safe Supabase URL/anon key, service-role key, Odds API key, explicit allowance, admin UUIDs if needed, and high-entropy `CRON_SECRET` in the correct Vercel environment scopes.
- Create/link the production Supabase project and apply the ordered migrations without a remote reset.
- Set the final HTTPS Auth Site URL and narrowly scoped redirect URLs.
- Decide whether a daily Vercel Cron safety net meets the product requirement; if yes, add the minimal cron configuration during Part 2 and verify its GET invocation. If no, record the approved zero-cost alternative or requirement change before calling V1 production-ready.
- Run the live-provider checklist and confirm the measured credit pattern stays within the approved free-tier envelope.

These are deployment and production-validation actions, not known defects in the audited release candidate.

## 18. Recommended but nonblocking improvements

- Add a CI job or disposable hosted database workflow for pgTAP and concurrency tests, keeping secrets and costs bounded.
- Add a narrowly scoped route-level test for settlement GET/POST authorization and a deployment smoke script.
- Establish provider, Vercel, Supabase, storage-volume, and error-rate monitoring thresholds before inviting users.
- Establish screenshot retention/moderation and free-tier storage/egress review policy.
- Recheck current provider and platform free-tier limits immediately before deployment; the repository’s quota document records the assumptions and their review date.
- Consider a documented backup/recovery posture for any Supabase production project before treating it as a durable user data store.

## 19. Optional Phase 9 candidates

These were not implemented:

- Strategy tags and saved betting strategies.
- Advanced analytics or custom dashboards.
- Additional competitions/sports after provider-cost review.
- Expanded social/group features and notifications.
- More sportsbook tracking and comparison tools.
- Richer admin operations, if a future product decision requires them.

Each candidate requires a separate scope and cost/privacy review; none is implied by this audit.

## 20. Final Rollout Part 1 gate recommendation

# PASS — READY FOR RELEASE-CANDIDATE DEPLOYMENT

The repository can safely proceed to Vercel release-candidate deployment with the deployment prerequisites and open production validations explicitly listed above. No known defect threatens security, database integrity, authentication boundaries, core betting workflows, bankroll integrity, settlement integrity, group privacy, provider quota protection, or build/deployment compatibility.

This is **not** a declaration of V1 production readiness. Live provider validation, final scheduling behavior, production Supabase/Vercel configuration, and UAT must still pass before declaring V1 production-ready.
