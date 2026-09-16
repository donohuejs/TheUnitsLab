# Phase 0 Completion Report

Date: 2026-09-12  
Gate recommendation: **Passed**

## Work completed

- Created a pinned Next.js and TypeScript repository scaffold with npm lockfile, formatting, linting, type checking, unit testing, coverage, production build, and CI commands.
- Added a credential-free environment template with explicit public Supabase values and server-only Supabase, provider, and scheduling credentials.
- Added runtime validation schemas for public and server-only environment configuration.
- Added centralized, typed, runtime-validated sports and provider configuration for EPL, UCL, NCAAF, NCAAB, event-based NFL and NBA support, supported straight markets, bookmakers, cache windows, and source-recommended quota bands.
- Added a Supabase local-development configuration, empty synthetic seed, and ordered foundation migration. The migration creates only a server-only schema and grants no browser access; Phase 1 remains responsible for profiles, groups, memberships, RLS, and authorization tests.
- Added a conceptual full-domain ERD showing multi-user private groups, immutable ticket snapshots, separate external wagers, virtual-bankroll ledger, settlement audit, provider data, cache, configuration, and quota records.
- Documented the migration, testing, caching, quota, cost, portability, scheduling, and security strategies.
- Recorded the technical stack decision and the approved parlay clarification. No Phase 1 or product workflow was implemented.

## Files created or modified

Created:

- `.env.example`, `.gitignore`, `.nvmrc`, `.prettierignore`
- `.github/workflows/ci.yml`
- `package.json`, `package-lock.json`, `tsconfig.json`
- `next-env.d.ts`, `next.config.ts`, `eslint.config.mjs`, `prettier.config.mjs`, `vitest.config.ts`
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- `src/config/env.public.ts`, `src/config/env.schema.ts`, `src/config/env.server.ts`, `src/config/sports.ts`
- `test/config.test.ts`, `test/migration-foundation.test.ts`
- `supabase/config.toml`, `supabase/seed.sql`, `supabase/migrations/20260911000000_phase_0_foundation.sql`
- `docs/DATABASE_ERD.md`, `docs/MIGRATIONS.md`, `docs/TESTING.md`, `docs/COST_AND_QUOTA.md`
- `docs/decisions/0001-phase-0-technical-foundation.md`
- `docs/PHASE_0_COMPLETION_REPORT.md`

Modified:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PRODUCT_SPEC.md`

Unchanged governing files:

- `AGENTS.md`
- `docs/PHASE_0_PLAN.md`
- `docs/Virtual Sportsbook - Governing Specification V1.docx`

## Database changes

The ordered Phase 0 migration creates `app_private`, revokes all access from `public`, `anon`, and `authenticated`, and documents the schema as server-only. It creates no exposed application table and no Phase 1 profile, group, membership, or authorization behavior.

The local configuration targets PostgreSQL 17 and keeps migrations, seed data, and Supabase settings source-controlled. Database changes are append-only after sharing; later corrections require a new migration.

## Tests and validation results

Passed:

- `npm ci`: 392 packages installed from `package-lock.json`; audit reported 0 vulnerabilities.
- `npm run format:check`: all files matched Prettier formatting.
- `npm run lint`: completed with zero warnings.
- `npm run typecheck`: completed with no TypeScript errors.
- `npm test`: 2 files passed, 8 tests passed.
- `npm run test:coverage`: 2 files and 8 tests passed; configuration coverage reported 91.3% statements and 90.47% lines.
- `npm run build`: Next.js 16.3.5 production build compiled, type-checked, and generated the static foundation page and not-found route.
- `npm run validate`: the complete format, lint, type-check, test, and build chain passed.
- `npx supabase --version`: reported the pinned CLI version 2.117.0.
- `npm run supabase:start`: started the local Supabase development stack and applied the Phase 0 migration and seed successfully.
- `npm run db:reset`: recreated the local database, reapplied `20260911000000_phase_0_foundation.sql`, seeded the empty Phase 0 seed file, and completed successfully on branch `main`.
- `npm run db:lint`: linted `app_private`, `extensions`, and `public`; reported `No schema errors found`.
- Repository scan: no credential value or later-phase implementation was identified. `.env.example` contains placeholders only, and tests make no live service calls.

The local database checks were completed on 2026-09-12 after Docker Desktop, WSL, and Windows virtualization support were enabled. The user supplied the successful command output for the gate record.

## Remaining issues and unresolved decisions

- Authentication method, invite admission, exact group permissions, application-admin identity, initial bankroll and label, multi-group launch behavior, preferred-unit description, stake and balance rules, numeric precision and rounding, settlement correction policy, screenshot lifecycle, external verification, and analytics definitions remain owner decisions for their owning phases.
- The source-recommended quota thresholds remain pending owner approval.
- Exact provider endpoint credit costs must be measured using bounded Phase 2 integration work before scheduling calls.
- Vercel Hobby cron cannot supply frequent or precise live-score polling. Phase 4 requires a bounded zero-cost alternative or an explicit cost decision.
- ESLint 9.39.5 is pinned because the current Next.js lint dependency tree does not support ESLint 10. npm reports the compatible ESLint 9 release as deprecated; revisit when `eslint-config-next` supports ESLint 10.
- npm reports one unapproved dependency install script for `unrs-resolver`. Installation and all validations succeeded; the script policy should be reviewed before enabling it explicitly.

## API cost implications

The expected monthly platform cost remains $0. The Odds API free allowance is currently 500 credits. Shared PostgreSQL caching, six-hour schedule caching, 15-minute pregame odds caching, request coalescing, bounded manual refresh, and prioritized score retrieval prevent page views from mapping directly to upstream calls.

Caesars is currently marked paid-subscription-only by The Odds API. It remains represented by `williamhill_us` but is disabled and marked ineligible for the free baseline. FanDuel, DraftKings, and BetMGM are enabled. No paid provider or uncontrolled polling path was added.

Supabase free-tier storage, egress, project pausing, and missing backup features are documented constraints. Vercel Hobby is eligible only for private non-commercial use and pauses rather than authorizing overage spend.

## Security implications

- Provider and service-role variables have server-only names and the server reader imports `server-only`.
- Only the public Supabase URL and anonymous key use the framework's public prefix.
- The migration's private schema denies `public`, `anon`, and `authenticated` roles.
- The ERD and test strategy require RLS on every exposed table and direct unauthorized-access tests beginning in Phase 1.
- Immutable ticket terms, separate external wagers, ledger derivation, settlement audits, and database-enforced idempotency are preserved as later-phase boundaries.
- No credentials, real-money capability, authentication workflow, wagering logic, or external network call was added.

## Deviations and approved clarifications

- Approved clarification: parlays remain part of V1 but are deferred until Phase 7. Phases 3 and 4 implement and settle straight wagers only.
- Technical compatibility adjustment: TypeScript 6.0.3 and ESLint 9.39.5 are used instead of their newest major versions because the selected current Next.js lint stack rejects TypeScript 7 and has peer dependencies limited to ESLint 9.
- Free-tier constraint: Caesars is disabled because current provider documentation marks it paid-only. This does not remove it from configuration and does not change the source's description of bookmakers of interest.
- Environment note: local database validation initially required Docker Desktop, WSL, and virtualization setup. After setup, migration replay and database linting passed without repository changes.

## Gate recommendation

The repository implementation satisfies the Phase 0 scope and contains no Phase 1 feature work. A clean dependency installation, formatting, linting, type checking, unit tests, production build, local Supabase startup, migration replay, and database lint all passed. The architecture and conceptual data model support multiple users and private groups while preserving the security, immutability, idempotency, configurability, and zero-cost constraints.

The Phase 0 gate should be considered **passed**. Stop here until the owner explicitly authorizes Phase 1.
