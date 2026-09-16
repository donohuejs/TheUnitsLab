# SportsbookSimulator Agent Guidance

## Governing context

Before changing this repository, read:

1. docs/PRODUCT_SPEC.md
2. docs/ARCHITECTURE.md
3. The plan for the current phase, such as docs/PHASE_0_PLAN.md or docs/PHASE_1_PLAN.md

The source authority is “Virtual Sportsbook - Governing Specification V1.docx.” docs/PRODUCT_SPEC.md is its repository transcription. If the source and repository documents differ, stop and surface the difference. A later explicit user instruction may change the product, but the change must be documented rather than silently overriding the governing specification.

## Non-negotiable rules

- This is a private entertainment and statistics product. Never add real-money wagering, deposits, withdrawals, purchasable wagering credits, prizes of monetary value, user-to-user bankroll transfers, sportsbook bet execution, wagering commissions, or V1 referral functionality.
- Simulated wagers use virtual units. External wagers are records of bets placed elsewhere and must never affect the virtual bankroll.
- Preserve submitted ticket terms. Odds, lines, bookmaker, market, and the rest of the ticket snapshot are immutable after submission.
- Settlement and bankroll updates must be deterministic, auditable, and idempotent.
- Keep provider and service-role secrets on the server. Never expose The Odds API key or Supabase service-role credentials to client code.
- Use Supabase Row Level Security on every exposed application table. UI hiding is not authorization; test direct database and API access.
- Treat the $0 monthly target and free-tier quotas as architectural constraints. Do not add a paid dependency without explicit user approval. If a phase cannot remain free, stop and document the limit, cause, alternatives, expected cost, and recommendation.
- Use a shared server-side cache and an API-usage ledger. Do not create uncontrolled polling loops.
- Keep sports, competitions, and bookmakers configurable rather than scattered as hard-coded UI logic.
- Maintain reproducible database migrations and tests for authorization, financial-style calculations, grading, and settlement idempotency.
- Build phases sequentially and vertically. Do not begin a later phase until the current phase gate is validated.

## Working discipline

- Distinguish confirmed requirements, source recommendations, assumptions, and unresolved decisions. Do not promote a recommendation into a product decision without recording it.
- Inspect existing work before editing, keep changes within the active phase, and update the governing repository documents when an approved decision changes them.
- Every phase must end with validation and a Phase Completion Report covering work completed, files changed, database changes, tests and results, remaining issues, API-cost implications, security implications, deviations, and a gate recommendation.
- Phase 0 and Phase 1 are implemented. Do not begin Phase 2 until the Phase 1 completion report and authorization gate have been reviewed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
