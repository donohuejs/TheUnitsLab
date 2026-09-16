# Database Migration Strategy

Phase 2 adds `20260913000000_phase_2_sports_odds.sql`: shared odds cache, API usage ledger, private refresh leases, forced RLS, authenticated read-only cache access, and service-only lease functions.

Phase 3 adds `20260914000000_phase_3_simulated_straight_bets.sql`: exact ticket and leg snapshots, the append-only bankroll ledger, idempotent 10,000-unit allocation and backfill, forced RLS, immutable terms, and the authenticated atomic placement function. It replays after the Phase 0-2 migrations without manual state.

Phase 4 adds `20260914100000_phase_4_bankroll_void_type.sql` and `20260915000000_phase_4_scores_settlement.sql`. The first commits the PostgreSQL enum addition before later constraints reference it. The second adds normalized shared scores, score refresh state, quota-ledger purposes, append-only settlement audits, forced RLS, final-score protection, deterministic grading, atomic settlement and documented void functions, and the database-enforced one-economic-credit rule.

Phase 5 adds `20260916000000_phase_5_external_wagers.sql`: centralized read-only sport, competition, and external-sportsbook catalogs; the separate external-wager system of record; append-only result-correction audits; deterministic owner-only creation and result functions; a private five-MiB screenshot bucket; and object policies aligned with wager ownership and current group membership. The migration contains no virtual-bankroll mutation.

Phase 6 adds `20260917000000_phase_6_analytics_leaderboards.sql`: one private canonical wager projection, caller-derived personal and membership-gated group read RPCs, a privacy-aware leaderboard-member RPC, explicit least-privilege execute grants, and analytics-oriented user/time indexes. It creates no mutable aggregate table and changes no wager, audit, settlement, screenshot, or bankroll write path.

Phase 7 adds `20260917100000_phase_7_parlay_market_type.sql` and `20260918000000_phase_7_parlays.sql`. The first migration extends the market enum before any parlay rows can reference it. The second extends existing simulated ticket/leg rows with constrained leg counts, immutable per-leg results, and effective settlement economics; adds server-authoritative atomic parlay placement and service-only settlement/void functions; adds normalized external parlay legs and owner-scoped create/result functions; and replaces the canonical analytics projection with one row per parent ticket. Existing straight rows are backfilled without reinterpretation, external records remain outside the bankroll, and all new exposed tables/functions retain forced RLS or least-privilege grants.

Phase 8 adds no database migration. The dashboard and presentation changes consume existing rows and RPCs only; the database, RLS, storage, ledger, settlement, and analytics boundaries remain those established through Phase 7.

The release-candidate UX patch adds `20260920000000_release_candidate_ux_patch_1.sql`. It adds
configurable hockey/NHL catalog data, enables NFL, introduces immutable synthetic flags for
administrator settlement tests, filters synthetic rows from ordinary history/analytics/score and
settlement-job reads, and grants the narrow synthetic create/settle RPCs only to `service_role`.
`supabase/tests/release_candidate_ux_patch_1.sql` is the corresponding pgTAP authorization,
settlement, payout, idempotency, and analytics-exclusion test. This migration must replay after the
Phase 7 migrations and before any release-candidate UAT.

Release-candidate UX patch 2 adds `20260921000000_release_candidate_ux_patch_2.sql`. It inserts
enabled `uel` and `laliga` rows into the existing soccer competition catalog with `on conflict`
updates, without editing Patch 1. `supabase/tests/release_candidate_ux_patch_2.sql` verifies the
rows, names, sport association, enabled state, and identifier uniqueness. The migration replays
after Patch 1 and changes no RLS policy, wager function, cache table, quota ledger, settlement
function, or bankroll behavior.

Release-candidate UX patch 3 adds `20260922000000_release_candidate_ux_patch_3.sql`. It keeps all
existing external-wager and ledger columns/economics, then adds raw source-dollar stake/return
provenance, import method and duplicate signals, canonical event/selection matching state, and
automatic/manual settlement evidence. It adds owner-scoped duplicate lookup, reviewed imported
straight and parlay creation boundaries, canonical event matching, deterministic imported
straight/parlay settlement, manual-reason enforcement, and least-privilege authenticated grants.
Existing storage policies, external-wager RLS, settlement audits, and virtual-bankroll isolation
remain in force. `supabase/tests/release_candidate_ux_patch_3.sql` adds 33 pgTAP schema, grant,
RLS, normalization, duplicate, matching, settlement, manual-reason, and bankroll-isolation
assertions. The migration is forward-only and must replay after Patch 2.

Release-candidate fix patch 1 adds `20260923000000_release_candidate_fix_patch_1.sql`. It adds the
authenticated owner-only `cancel_simulated_bet` boundary for pre-kickoff simulated tickets. The
function locks the ticket, checks all immutable leg kickoffs, transitions ticket and legs to void,
refunds the original stake through the existing one-credit `simulated_void` ledger constraint, and
records success, rejection, or already-settled audit evidence. It does not touch imported wagers.
`supabase/tests/release_candidate_fix_patch_1.sql` verifies the function grant, successful exact
refund, idempotent retry, post-kickoff rejection, unchanged open status, and rejection audit. The
migration is forward-only and must replay after Patch 3.

## Source of truth

Ordered SQL files under `supabase/migrations` are the database source of truth. Configuration in a hosted dashboard is not sufficient. Migrations must include tables, constraints, functions, grants, Row Level Security enablement, policies, storage policies, and indexes needed by the corresponding phase.

The Phase 0 migration creates `app_private`. The Phase 1 migration adds profiles, groups, memberships, invitation records, constraints, triggers, grants, security-definer operations, and Row Level Security policies. No Phase 1 schema or policy depends on a hosted dashboard change.

## Workflow

1. Install exact dependencies with `npm ci` and start a Docker-compatible runtime.
2. Run `npm run supabase:start`.
3. Create a migration with `npx supabase migration new <descriptive_name>`.
4. Edit the generated SQL and add database integration tests for the same change.
5. Run `npm run db:reset`, `npm run db:lint`, and `npm run validate`.
6. Run `npm run test:db` for direct pgTAP authorization and integrity tests.
7. Run `npm run test:db:concurrency`, `npm run test:db:parlay-placement-concurrency`, `npm run test:db:settlement-concurrency`, and `npm run test:db:parlay-settlement-concurrency` for real parallel placement and settlement tests.
8. Generate database types before a later phase introduces a stable typed data-access layer.

Shared migrations are append-only. Correct an applied schema with a new migration; do not rewrite history. Seed data belongs in `supabase/seed.sql`, must be synthetic, and must never contain production exports or credentials.

Local reset destroys only local container data. Remote migrations use a linked-project dry run before `db push`. A linked `db reset` is destructive and is prohibited for production; use it only with explicit confirmation against a disposable environment.

If dashboard drift is discovered, capture and review it in a migration before further work. Secrets referenced by Supabase configuration must use environment indirection and must never be embedded in `config.toml` or SQL.
