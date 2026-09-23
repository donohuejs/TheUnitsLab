# Database Migration Strategy

## Production release boundary

The canonical production sequence is documented in [Production Release Workflow](PRODUCTION_RELEASE_WORKFLOW.md).
Creating a SQL file under supabase/migrations changes only the repository; it does not apply the
migration to the linked Supabase project. Before any production release, compare local files with
npx.cmd supabase migration list --linked, classify every difference, run the supported dry run,
apply only reviewed safe forward-only migrations, and verify local/remote parity afterward. GitHub
and Vercel deployments do not apply Supabase migrations automatically.

Migration history is append-only. An ordinary release may autonomously apply a reviewed additive or
otherwise safe forward migration after the release gates pass. Destructive, irreversible, or
ambiguous data operations require separate operator approval; see [Production Release Workflow](PRODUCTION_RELEASE_WORKFLOW.md)
and [Production Backup and Recovery](PRODUCTION_BACKUP_AND_RECOVERY.md).

Phase 2 adds `20260913000000_phase_2_sports_odds.sql`: shared odds cache, API usage ledger, private refresh leases, forced RLS, authenticated read-only cache access, and service-only lease functions.

Phase 3 adds `20260914000000_phase_3_simulated_straight_bets.sql`: exact ticket and leg snapshots, the append-only bankroll ledger, idempotent 10,000-unit allocation and backfill, forced RLS, immutable terms, and the authenticated atomic placement function. It replays after the Phase 0-2 migrations without manual state.

v0.12.1 adds `20261006000000_auth_onboarding_bankroll_lifecycle.sql`: it removes only the profile-
insert bankroll trigger so an unconfirmed Auth identity has no permanent ledger state, while keeping
profile creation, the canonical caller-derived allocator, idempotency/advisory locking, RLS, and
append-only protections. It also adds a service-role-only exact-UUID cleanup boundary for legacy
unconfirmed users; it refuses confirmed users and any application history, and Auth Admin deletion
remains a separate supported operation.

v0.13.0 adds `20261007000000_v0_13_group_invite_codes.sql`. It adds a nullable hashed invite-code
column so pre-v0.13.0 link-only invitations remain valid, generates a cryptographically random
eight-character code for new invites with uniqueness retries, and adds the code redemption wrapper.
Both link and code redemption call one locked membership transaction. The unexposed schema records
authenticated code attempts and applies a bounded rate limit without adding infrastructure or a
paid dependency. `supabase/tests/v0_13_group_invite_codes.sql` covers creation, normalization,
legacy links, authorization, existing-member behavior, invalid states, and throttling.

v0.14.0 adds `20261008000000_v0_14_terminal_score_states.sql` and
`20261008010000_v0_14_odds_watchlist.sql`. The first commits terminal score enum values before the
Watchlist schema references them. The second adds owner-scoped active watches, shared market state
and change-point history, lookup/uniqueness indexes, forced RLS, and authenticated watch/clear RPCs.
Only the trusted existing odds-cache write path records shared history; cache state and history are
committed together, unchanged observations update last-seen metadata, and history rows are never
duplicated per user. Score processing clears all user watches when it records a terminal state,
while full odds snapshots safely clear a market that disappears before kickoff.
`supabase/tests/v0_14_odds_watchlist.sql` covers lifecycle, history, RLS, user isolation, shared data,
market disappearance, terminal cleanup, and analytics/bankroll exclusion. The local
`npm run test:db:watchlist-history-concurrency` command races trusted cache snapshots and verifies
one row per meaningful change. `supabase/tests/v0_14_my_bets_settlement.sql` covers owner-only
imported-result entry/correction and zero simulated-bankroll effects; existing external-wager and
screenshot policies remain in force. The owner-scoped Watchlist read boundary also clears that
user's watches after scheduled kickoff, so active views remain pregame if score refresh is delayed.
No additional provider polling path or high-frequency cleanup scheduler is introduced.

Phase 4 adds `20260914100000_phase_4_bankroll_void_type.sql` and `20260915000000_phase_4_scores_settlement.sql`. The first commits the PostgreSQL enum addition before later constraints reference it. The second adds normalized shared scores, score refresh state, quota-ledger purposes, append-only settlement audits, forced RLS, final-score protection, deterministic grading, atomic settlement and documented void functions, and the database-enforced one-economic-credit rule.

Phase 5 adds `20260916000000_phase_5_external_wagers.sql`: centralized read-only sport, competition, and external-sportsbook catalogs; the separate external-wager system of record; append-only result-correction audits; deterministic owner-only creation and result functions; a private five-MiB screenshot bucket; and object policies aligned with wager ownership and current group membership. The migration contains no virtual-bankroll mutation.

Phase 6 adds `20260917000000_phase_6_analytics_leaderboards.sql`: one private canonical wager projection, caller-derived personal and membership-gated group read RPCs, a privacy-aware leaderboard-member RPC, explicit least-privilege execute grants, and analytics-oriented user/time indexes. It creates no mutable aggregate table and changes no wager, audit, settlement, screenshot, or bankroll write path.

Phase 7 adds `20260917100000_phase_7_parlay_market_type.sql` and `20260918000000_phase_7_parlays.sql`. The first migration extends the market enum before any parlay rows can reference it. The second extends existing simulated ticket/leg rows with constrained leg counts, immutable per-leg results, and effective settlement economics; adds server-authoritative atomic parlay placement and service-only settlement/void functions; adds normalized external parlay legs and owner-scoped create/result functions; and replaces the canonical analytics projection with one row per parent ticket. Existing straight rows are backfilled without reinterpretation, external records remain outside the bankroll, and all new exposed tables/functions retain forced RLS or least-privilege grants.

Phase 8 adds no database migration. The dashboard and presentation changes consume existing rows and RPCs only; the database, RLS, storage, ledger, settlement, and analytics boundaries remain those established through Phase 7.

v0.15.0 adds no database migration. Schedule filtering, kickoff grouping, canonical event
navigation, ranking snapshots, standings adapters, and sport-aware priority metadata are
application configuration/presentation concerns. No new exposed table, mutation path, RLS policy,
provider/cache table, quota ledger purpose, wager field, settlement function, or bankroll boundary
is introduced. If a future reliable standings or ranking source requires persistence, it must be a
new forward-only migration with explicit RLS and source/update provenance rather than an edit to
this release's migration history.

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

Release-candidate fix patch 2 adds the forward-only migration
`20260924000000_release_candidate_fix_patch_2.sql`. It extends immutable simulated leg snapshots with
provider-anchor and versioned simulated-alternate-spread metadata, adds the server-authoritative
adjusted-spread placement RPC and parlay validation, and adds canonical imported-wager readiness and
automatic-settlement state without touching the virtual bankroll. Imported economics remain exact and
separate from simulated ledger entries. Existing RLS, forced-RLS tables, least-privilege grants,
private storage, cache leases, quota ledger, settlement idempotency, synthetic isolation, and group
invite authorization are preserved. `supabase/tests/release_candidate_fix_patch_2.sql` verifies the
new columns and checks, pricing monotonicity and metadata preservation, canonical imported readiness,
bankroll isolation, grants, RLS, and anonymous denial. The migration must replay after
`20260923000000_release_candidate_fix_patch_1.sql`; no applied migration is modified.

Release-candidate fix patch 3 adds the forward-only migration
`20260925000000_release_candidate_fix_patch_3.sql`. It changes new group invites to reusable until
expiry by default, keeps an optional 1–50 use cap, preserves random token generation and hashed token
storage, and retains authenticated-only join plus owner/admin revoke authorization. The
`list_group_invites` RPC returns expiry, revocation, cap, and usage metadata without token material.
`supabase/tests/release_candidate_fix_patch_3.sql` verifies the nullable cap, repeated redemption,
bounded redemption, expiry/revocation rejection, usage counts, grants, and token non-disclosure. No
prior migration is edited, and no wager, ledger, provider/cache, quota, storage, or settlement path
is changed.

Release-candidate fix patch 4 adds the forward-only migration
`20260926000000_release_candidate_fix_patch_4.sql`. It makes external sportsbook identity optional,
updates the external and imported wager creation functions to accept a null catalog ID, and keeps
`Unknown sportsbook` as the stable display fallback. The migration also makes the immutable-field
trigger null-safe; ownership, RLS, grants, imported canonical matching, settlement idempotency, and
virtual-bankroll isolation remain unchanged. `supabase/tests/release_candidate_fix_patch_4.sql`
verifies the nullable schema, authenticated creation with an unknown sportsbook, persisted display
fallback, no bankroll mutation, and anonymous execute denial. No prior migration is edited.

Release-candidate fix patch 5 adds the forward-only migration
`20260927000000_release_candidate_fix_patch_5.sql`. It adds owner-audited Study reassignment for
open simulated and imported wagers, deterministic imported selection inference, canonical matching
readiness for straight and parlay legs, and automatic imported settlement retry boundaries. The
migration preserves immutable submitted terms, Study membership authorization, private storage,
virtual-bankroll isolation, and least-privilege grants. `supabase/tests/release_candidate_fix_patch_5.sql`
verifies the Study audit and imported readiness boundaries.

Release-candidate fix patch 6 adds the forward-only migration
`20260928000000_release_candidate_fix_patch_6.sql`. It adds the server-only Luna usage ledger,
local-OCR outcome telemetry, the locked monthly budget and administrator audit, and the historical
canonical matching/readiness corrections used by screenshot import. The migration contains no
provider polling and does not connect imported records to the virtual bankroll.

Release-candidate fix patch 7 adds the forward-only migration
`20260929000000_release_candidate_fix_patch_7.sql`. It adds forced-RLS operational diagnostics for
server-side Luna attempts, strengthens duplicate review with normalized ticket and atomic parlay
terms, refreshes straight and parlay imported-event matching from retained canonical score/cache
data, and exposes a bounded authenticated reconciliation RPC. `supabase/tests/release_candidate_fix_patch_7.sql`
verifies the diagnostics table, RLS, ordinary-role grants, and RPC grants. No provider polling,
real-money behavior, bankroll mutation, or Phase 9 work is introduced.

Release-candidate fix patch 8 adds the forward-only migration
`20260930000000_release_candidate_fix_patch_8.sql`. It permits imported source ticket time to remain
unknown without changing the canonical event kickoff, extends the shared API ledger for cached
no-odds event discovery, and expands forced-RLS Luna telemetry with attempt/completion timestamps,
provider metadata, latency, fallback state, and nullable usage-derived costs. The migration keeps
immutable external-wager terms null-safe, preserves service-only vision functions and existing grants,
and keeps unknown usage reservations budget-occupied. Application code uses the shared event catalog
cache and The Odds API event-list endpoint before any priced odds refresh. No prior migration is
rewritten, and no RLS, bankroll, audit, or settlement boundary is weakened.

v0.11.0 adds `20261003000000_private_beta_feedback.sql`. It creates the forced-RLS
`beta_feedback` table, caller-derived idempotent submission RPC, authenticated own-row reads, and
service-role administrator review access. Feedback status is not writable by the ordinary role.
`supabase/tests/private_beta_feedback.sql` covers schema, direct authorization, cross-user
isolation, caller identity, status protection, context capture, and duplicate-submit behavior.

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
