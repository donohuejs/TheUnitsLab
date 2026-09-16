# Phase 0 Architecture and Repository Plan

## Outcome

Phase 0 creates a reproducible foundation for the later vertical product phases. It ends only when the repository can be set up consistently, the architecture and data model support multiple users and private groups, the cost and quota approach is credible at $0 per month, and the required strategies and configuration are reviewable.

This file is an implementation plan. The current documentation bootstrap has not executed it.

## Governing scope

Required Phase 0 deliverables from the source are:

- Repository scaffold.
- README.
- Environment-variable template.
- Architecture document.
- Database ERD.
- Migration strategy.
- Testing strategy.
- Sports and provider configuration file.
- Cost and quota strategy.

No production UI is required. The gate is that the architecture supports multiple users and groups before work proceeds.

Phase 0 must not implement authentication flows, live odds pages, bet placement, settlement, external-wager tracking, analytics, parlays, or product polish. Those belong to later phases.

## Entry conditions

Before implementation:

1. Read AGENTS.md, docs/PRODUCT_SPEC.md, and docs/ARCHITECTURE.md.
2. Inspect the repository and confirm it still contains no unreviewed application scaffold.
3. Review the unresolved decisions below with the owner or record a narrow, reversible technical assumption.
4. Verify current free-tier limits and compatibility for the proposed services at implementation time. If the target cannot remain free, stop and follow the cost-escalation rule.

## Decisions required before or during Phase 0

### Owner decisions

These change product behavior or external commitments and should not be guessed:

- Whether ordinary parlays are required for MVP or remain Phase 7 only.
- Supabase Auth method: email and password or email magic link.
- Invite-only account admission and group invitation flow.
- Initial bankroll value and whether the UI term is units or credits.
- Whether launch supports multiple group memberships in the UI.
- Owner, admin, member, and application-admin permissions.
- Whether preferred unit-size descriptions can contain real currency amounts.
- Screenshot visibility, retention, deletion, and moderation rules.
- Stake limits, insufficient-balance behavior, and bankroll reset or adjustment policy.
- Grading, void, correction, precision, and rounding rules.
- External-wager verification workflow.
- Analytics formulas, period boundaries, time-zone handling, tie-breaking, and minimum samples.

### Technical selections

Record each selection and its reason in the architecture document or a decision record:

- Exact Next.js, TypeScript, Node.js, and dependency versions.
- Package manager and lockfile.
- Vercel versus another zero-cost host.
- Supabase local-development and migration workflow.
- Shared cache implementation.
- Background scheduling mechanism.
- Unit, integration, RLS, provider-contract, and end-to-end test tools.
- Formatting, linting, type-checking, and continuous-integration commands.
- Configuration format and validation method.
- Logging and minimal operational visibility that fit free tiers.

Use the source-proposed stack as the planning baseline. A change to a confirmed component such as Supabase Auth, Supabase Row Level Security, secure object storage, or The Odds API requires owner approval. A different choice where the source itself allows an alternative, such as Vercel or an equivalent zero-cost host, must be documented with its cost and portability effects.

## Implementation sequence

### 1 Establish the repository scaffold

Create the minimum source-controlled structure needed for a Next.js TypeScript application and Supabase development, without production UI.

Reasonable technical recommendation:

- Use the framework's standard TypeScript scaffold.
- Commit the package-manager lockfile.
- Keep generated files to the minimum needed to install, type-check, test, and build.
- Add ignore rules for dependencies, build output, local environment files, local Supabase state, coverage, and temporary artifacts.
- Add scripts for install-independent validation: formatting check, lint, type-check, test, and build, subject to selected tools.

Acceptance evidence:

- A clean checkout can install from the lockfile.
- Type-check and build complete without secrets.
- No sportsbook screens or product features are present.

### 2 Add safe environment configuration

Create an environment-variable template with names and descriptions but no credentials. At minimum it must account for:

- Public Supabase project URL and public anonymous key.
- Server-only Supabase service-role credential, if a phase requires it.
- Server-only The Odds API key.
- Any selected server-only cache or scheduling credential.

Choose exact names to match the selected current SDKs and record them in the template. Public browser configuration must use the framework's explicit public naming convention; provider and service-role secrets must not. Validate required server variables at startup or at the server boundary that uses them. Document local setup without committing a populated environment file.

Acceptance evidence:

- The template contains no secret values.
- Client code has no access path to provider or service-role secrets.
- Missing configuration fails with a clear development-time error.

### 3 Finalize architecture records

Update docs/ARCHITECTURE.md with approved Phase 0 decisions and create lightweight decision records if multiple material choices need history.

The architecture must show:

- Browser, server, Supabase, storage, cache, The Odds API, and scheduled-work boundaries.
- Identity, group, wager, ledger, settlement, analytics, and administration domains.
- Server-only secret and provider-call boundaries.
- Immutable ticket and idempotent settlement principles.
- Shared caching and quota-ledger flow.
- Portability and free-tier constraints.

Acceptance evidence:

- Every material component maps to a governing requirement or is labeled a technical recommendation.
- Open questions remain visibly open.

### 4 Produce the database ERD

Create a version-controlled ERD that distinguishes the Phase 1 implementation subset from later conceptual entities.

Required concepts:

- Supabase authentication identity and application profile.
- groups and group_members, including role and join date.
- Simulated versus external wager source.
- bets and bet_legs capable of immutable submitted terms.
- Virtual-bankroll ledger.
- External-wager screenshot reference and verification status.
- Settlement audit.
- Provider events, odds or market snapshots, and retained event identifiers.
- API usage ledger.
- Configurable sports, competitions, and bookmakers.

Reasonable technical recommendation:

- Represent group membership as a join table from the first migration.
- Use fixed-precision numeric types for odds and unit quantities.
- Use database uniqueness constraints for settlement and ledger idempotency.
- Keep mutable provider cache records separate from durable ticket snapshots.

Do not finalize columns that depend on unresolved product rules. Mark them pending and explain the decision needed.

Acceptance evidence:

- The ERD supports multiple users and private groups.
- It shows ownership and group visibility boundaries.
- It can represent source filtering and prevents IRL records from sharing the simulated-bankroll path.
- It can preserve submitted ticket state independently of current odds.

### 5 Define the migration strategy

Document and establish how database changes are reproduced from the repository.

Reasonable technical recommendation:

- Use ordered Supabase SQL migrations under the conventional Supabase migration directory.
- Treat migrations as append-only after they have been shared; fix deployed schema with a new migration.
- Keep seed data separate from migrations and make it clearly synthetic.
- Include RLS policies and relevant constraints in migrations, not only dashboard configuration.
- Provide local reset and verification commands using the selected Supabase workflow.

Phase 0 may create only the foundation migration needed to prove the workflow; Phase 1 owns the user and group implementation.

Acceptance evidence:

- A local database can be created from repository artifacts.
- No required schema or policy exists only in a hosted dashboard.
- Migration ordering and rollback or repair policy are documented.

### 6 Define the testing strategy

Document test layers, ownership, fixtures, and commands.

The strategy must cover, in their implementation phases:

- American odds conversion and payout calculations.
- Push, soccer draw, spread, total, and parlay grading.
- Settlement idempotency and duplicate-credit prevention.
- RLS and direct authorization attempts.
- Provider normalization and quota capture using saved fixtures, not paid or uncontrolled live calls.
- Analytics and leaderboard reconciliation.

Reasonable test layers:

- Pure unit tests for calculations and grading.
- Database integration tests for constraints, transactions, and RLS.
- Provider-contract tests against checked-in redacted fixtures.
- End-to-end tests for each phase's vertical gate.

Acceptance evidence:

- The repository has one documented command for all Phase 0 checks.
- A minimal test proves the selected test runner works.
- Tests do not require paid services or live provider calls by default.

### 7 Add sports and provider configuration

Create one typed, validated configuration source rather than scattering constants through UI code.

It must be capable of representing:

- EPL, UCL, NCAAF, and NCAAB as enabled core competitions.
- NFL playoff or Super Bowl and NBA playoff or Finals event-based enablement.
- Future sports without UI rewrites.
- FanDuel, DraftKings, Caesars, and BetMGM as configurable bookmakers.
- Provider sport, competition, bookmaker, market, and score identifiers.
- Enabled markets by sport.
- Cache policy and quota priority where appropriate.

Do not guess provider keys. Verify them against current provider documentation during implementation and record any provider assumptions.

Acceptance evidence:

- Sports, competitions, and bookmakers can be enabled or disabled in one configuration layer.
- Client-facing configuration contains no secrets.
- Automated validation rejects duplicate or incomplete identifiers.

### 8 Document the cost and quota strategy

Create a Phase 0 cost document or a dedicated section in architecture that records:

- Current verified free allowance for each selected service.
- Expected calls by endpoint, sport, competition, and purpose.
- Shared-cache assumptions.
- Recommended schedule and pregame cache windows.
- Normal, conserve, high, and critical behavior, clearly noting that the source thresholds are suggested until approved.
- Score-polling priorities for open wagers, viewed events, and final settlement.
- Manual-refresh controls and abuse limits.
- Quota header capture and API-usage ledger fields.
- Monitoring and the stop condition for a free-tier breach.

Use explicit arithmetic and conservative scenarios. Do not make live provider calls as part of routine tests.

Acceptance evidence:

- The plan explains how multiple users share one upstream response.
- It has no uncontrolled polling path.
- It identifies the highest-risk quota assumptions.
- It states what functionality degrades at each approved threshold.
- Expected monthly cost remains $0 or work stops for owner review.

### 9 Add contributor and setup documentation

Update README.md with:

- Prerequisites and selected versions.
- Install and local setup commands.
- Environment setup.
- Supabase migration and reset workflow.
- Validation commands.
- Documentation map.
- Current phase status.

Keep AGENTS.md concise and update it only when a new non-negotiable rule or document location changes.

Acceptance evidence:

- Another task can set up a clean checkout using only repository instructions and user-supplied credentials.

### 10 Validate and produce the Phase Completion Report

Run every Phase 0 validation command and review the repository for accidental product implementation, leaked secrets, paid dependencies, provider-key exposure, and undocumented decisions.

Create a Phase Completion Report containing:

- Work completed.
- Files created or modified.
- Database changes.
- Tests run and exact results.
- Remaining issues.
- API-cost implications.
- Security implications.
- Deviations from the governing specification.
- A recommendation on whether the Phase 0 gate passed.

The report must not claim the gate passed unless all acceptance criteria below are met.

## Phase 0 acceptance criteria

- A clean checkout has reproducible installation, build, type-check, and test instructions.
- Environment configuration is documented and contains no secrets.
- The architecture supports multiple users and private groups.
- The ERD identifies ownership, group membership, immutable wager snapshots, separate external wagers, a ledger, audits, configuration, and quota records.
- Database migrations and RLS policy changes are reproducible from source control.
- The testing strategy covers calculations, authorization, provider normalization, idempotency, and reconciliation in the appropriate phases.
- Supported sports, competitions, bookmakers, and markets have a centralized, validated configuration model.
- The cost and quota plan demonstrates a credible $0 monthly path and no uncontrolled polling.
- No production UI or later-phase feature was implemented.
- All unresolved product decisions and provider assumptions remain documented.
- A complete Phase Completion Report recommends pass or fail with evidence.

## Known blockers and review questions

The most immediate owner review items are:

1. Confirm whether ordinary parlays are outside MVP until Phase 7 despite the broader V1 wording.
2. Select email and password or email magic-link authentication.
3. Approve or replace the 10,000-unit default and “units” label.
4. Define invite admission, group roles, initial multi-group behavior, and application-admin authority.
5. Approve privacy and lifecycle rules for profiles, external wagers, and screenshots.
6. Define stake, bankroll, settlement, correction, precision, and rounding policies before schema fields become binding.
7. Define external-wager verification and analytics formulas.
8. Approve source-suggested quota thresholds or request different ones after free-tier verification.

Other missing decisions remain cataloged in docs/PRODUCT_SPEC.md. Phase 0 may proceed on reversible tooling choices, but it must not bury product decisions in code defaults.
