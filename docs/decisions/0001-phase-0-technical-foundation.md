# Decision 0001 Phase 0 Technical Foundation

Status: accepted technical baseline on 2026-09-11

## Decision

Use Node.js 24.18.1, npm 11.16.0, Next.js 16.3.5 with App Router, React 19.3.0, TypeScript 6.0.3, Supabase CLI 2.117.0 with PostgreSQL 17 locally, Zod for runtime configuration validation, Vitest for unit and provider-contract tests, ESLint 9.39.5 and Prettier for static checks, and GitHub Actions for the repository validation workflow. TypeScript 7 and ESLint 10 are intentionally deferred until the current Next.js lint stack supports them.

Use Vercel Hobby as the private non-commercial zero-cost deployment baseline while preserving standard Next.js deployment portability. Use Supabase PostgreSQL as the initial shared cache rather than adding another service. Do not assume Vercel Hobby cron can perform live polling.

## Reasons

- Versions are current, pinned, and compatible with the locally available Node and npm toolchain.
- npm provides a committed lockfile and matches the owner's Windows environment.
- App Router is the current Next.js default and keeps server-only provider boundaries natural.
- PostgreSQL caching shares responses across server instances without a new paid dependency.
- Vitest supports fast TypeScript unit and fixture tests without live services.
- A minimal GitHub Actions workflow makes the clean-checkout gate reproducible.

## Consequences

Docker is required for full local Supabase validation. The free hosting scheduler is insufficient for frequent score polling, so scheduling remains a later bounded design decision. The cache is replaceable behind a narrow interface if database load or hosting changes. Tool upgrades require an explicit dependency update, validation run, and decision-record amendment when architectural effects are material.

Authentication method, group permissions, application-admin identity, numeric precision and rounding, correction rules, screenshot policy, and analytics definitions remain product decisions rather than tooling defaults.
