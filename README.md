# The Units Lab

The Units Lab is a private, entertainment-focused sports wagering simulator and betting-performance tracker. It uses real sportsbook odds with virtual Vials and lets invited users import wagers placed independently elsewhere for statistical tracking. It never accepts, transmits, executes, facilitates, escrows, or settles real-money wagers.

## Phase status

Phases 0-8 are complete. v0.13.0 is the group-invite-code enhancement following the v0.12.1
authentication onboarding hotfix. New private-group invites include both the existing secure link
and a short code for authenticated users joining from Study Management. Release-candidate Fix Patch
10 remains the wager-engine baseline; Phase 9 has not started.

The interface supports account/group workflows, pregame odds for EPL, UCL, NCAAF, NCAAB, NFL, NHL, La Liga, and Europa League, straight and multi-leg simulated bet slips, a unified My Bets ledger, cached scores, deterministic simulated settlement, reviewed local screenshot/text/manual betslip import, imported straight/parlay tracking, Performance analytics, private-group leaderboards, and a dashboard that keeps simulated and imported records distinct. External records never change the simulated virtual-bankroll ledger. Screenshot extraction remains review-first: OCR runs locally first, and only low-confidence or incomplete images may use the server-only configured vision fallback. No canonical sport, competition, event, or settlement fact is invented by the fallback, and no provider polling or Phase 9 work was added.

Parlays use one bookmaker and distinct provider events; same-event combinations and cross-book tickets are rejected because the current provider model has no verified correlation pricing. Push and void legs are neutral prices; if no active leg remains, all-void is `void` and any push/void mixture is `push` with the stake returned. Settlement waits for every non-void leg to have a durable final result.

## Selected foundation

- Node.js 24.18.1 and npm 11.16.0.
- Next.js 16.3.5, React 19.3.0, and TypeScript 6.0.3.
- Supabase CLI 2.117.0 with PostgreSQL 17 for local migrations.
- Vitest 5, ESLint 9, and Prettier 3.
- Vercel Hobby is the deployment baseline for this private, non-commercial project; deployment is not part of Phase 0.
- The Odds API v4 is the provider boundary; no live provider calls occur in tests.

Exact versions are pinned in `package.json` and `package-lock.json`.

## Prerequisites

- Node.js 24.18.1 and npm 11.16.0.
- A Docker-compatible container runtime with enough memory for the local Supabase stack (Supabase currently recommends at least 7 GB).
- User-supplied Supabase and The Odds API credentials when a later phase first needs them.

## Setup

```powershell
npm ci
Copy-Item .env.example .env.local
```

Replace placeholder values in `.env.local`; never commit that file. Browser-safe variables use the `NEXT_PUBLIC_` prefix. `APP_URL` is server-only and must be `https://theunitslab.vercel.app` in production (use `http://localhost:3000` locally) so Supabase confirmation and password-recovery links return to the intended application. The Odds API key and Supabase service-role key are server-only and intentionally have no public prefix.

The application build does not require credentials and renders setup behavior when public Supabase configuration is absent. Authentication requires the project URL and public key. Live odds and scores require server-only `SUPABASE_SERVICE_ROLE_KEY` and `THE_ODDS_API_KEY`. Screenshot vision fallback is disabled unless server-only `OPENAI_API_KEY` is set; its default monthly application budget is $5.00 and the admin dashboard supports audited increases. Set `CRON_SECRET` to a random server-only value before invoking the bounded settlement job endpoint, and set `APP_ADMIN_USER_IDS` to comma-separated Supabase user UUIDs for the quota dashboard. The browser never receives these credentials.

### Supabase Auth URL configuration

For the production project, set the Supabase Dashboard Auth URL Configuration values as follows:

- Site URL: `https://theunitslab.vercel.app`
- Redirect URL: `https://theunitslab.vercel.app/auth/callback?next=%2Fauth%2Fconfirmed`
- Redirect URL: `https://theunitslab.vercel.app/auth/callback?next=%2Fauth%2Frecovery`

For local development, add the corresponding localhost URLs:

- `http://localhost:3000/auth/callback?next=%2Fauth%2Fconfirmed`
- `http://localhost:3000/auth/callback?next=%2Fauth%2Frecovery`

Add the `127.0.0.1` equivalents only when that exact host is used. Keep Supabase's confirmation and recovery email templates pointed at their standard confirmation URL; the application callback exchanges the returned PKCE `code` server-side.

## Local database

Start Docker, then run:

```powershell
npm run supabase:start
npm run db:reset
npm run db:lint
```

Stop local services with `npm run supabase:stop`. `db:reset` is destructive to the local Supabase database only. Never run a linked reset against production. See [Migration strategy](docs/MIGRATIONS.md).

## Validation

Run repository checks with:

```powershell
npm run validate
```

Individual commands are `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run security:scan`, and `npm run build`. With local Supabase running, use `npm run test:db` for direct authorization and integrity tests, `npm run test:db:invite-code-concurrency` for limited-use invite-code redemption, `npm run test:db:concurrency` and `npm run test:db:parlay-placement-concurrency` for concurrent overspend, and `npm run test:db:settlement-concurrency` plus `npm run test:db:parlay-settlement-concurrency` for duplicate-payout gates. `npm run record:import-demo` regenerates the private-safe 390x844 tutorial video after Playwright browsers are installed. `npm run validate` includes the secret scan. Tests and builds make no live provider calls and require no paid service; the optional vision fallback is never called by automated tests.

## Documentation

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Phase 0 plan](docs/PHASE_0_PLAN.md)
- [Phase 1 plan](docs/PHASE_1_PLAN.md)
- [Phase 2 plan](docs/PHASE_2_PLAN.md)
- [Phase 3 plan](docs/PHASE_3_PLAN.md)
- [Phase 4 plan](docs/PHASE_4_PLAN.md)
- [Phase 5 plan](docs/PHASE_5_PLAN.md)
- [Phase 6 plan](docs/PHASE_6_PLAN.md)
- [Phase 7 plan](docs/PHASE_7_PLAN.md)
- [Database ERD](docs/DATABASE_ERD.md)
- [Migration strategy](docs/MIGRATIONS.md)
- [Testing strategy](docs/TESTING.md)
- [Cost and quota strategy](docs/COST_AND_QUOTA.md)
- [Technical decision record](docs/decisions/0001-phase-0-technical-foundation.md)
- [Phase 1 decision record](docs/decisions/0002-phase-1-authentication-and-groups.md)
- [Phase 0 completion report](docs/PHASE_0_COMPLETION_REPORT.md)
- [Phase 1 completion report](PHASE_1_COMPLETION_REPORT.md)
- [Phase 2 completion report](PHASE_2_COMPLETION_REPORT.md)
- [Phase 3 completion report](PHASE_3_COMPLETION_REPORT.md)
- [Phase 4 completion report](PHASE_4_COMPLETION_REPORT.md)
- [Phase 5 completion report](PHASE_5_COMPLETION_REPORT.md)
- [Phase 6 completion report](PHASE_6_COMPLETION_REPORT.md)
- [Phase 7 completion report](PHASE_7_COMPLETION_REPORT.md)
- [Phase 8 plan](docs/PHASE_8_PLAN.md)
- [Phase 8 completion report](PHASE_8_COMPLETION_REPORT.md)
- [Release-candidate UX Patch 3 report](RELEASE_CANDIDATE_UX_PATCH_3_REPORT.md)
- [Release-candidate Fix Patch 1 report](RELEASE_CANDIDATE_FIX_PATCH_1_REPORT.md)
- [Release-candidate Fix Patch 3 report](RELEASE_CANDIDATE_FIX_PATCH_3_REPORT.md)
- [Release-candidate Fix Patch 6 report](RELEASE_CANDIDATE_FIX_PATCH_6_REPORT.md)
- [Rollout Part 1 release-readiness report](ROLLOUT_PART_1_RELEASE_READINESS_REPORT.md)
- [Release candidate checklist](RELEASE_CANDIDATE_CHECKLIST.md)
- [Agent guidance](AGENTS.md)
- [Production backup and recovery runbook](docs/PRODUCTION_BACKUP_AND_RECOVERY.md)
- [Pre-beta reset runbook](docs/PRE_BETA_RESET_RUNBOOK.md)
- [Product backlog](PRODUCT_BACKLOG.md)

The governing source is `docs/Virtual Sportsbook - Governing Specification V1.docx`. If it conflicts with repository documentation, stop and surface the difference. Later explicit product changes must be recorded rather than silently overriding it.
