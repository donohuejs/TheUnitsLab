import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../supabase/migrations/20260911000000_phase_0_foundation.sql",
  import.meta.url,
);

const phaseOneMigrationUrl = new URL(
  "../supabase/migrations/20260912000000_phase_1_auth_users_groups.sql",
  import.meta.url,
);
const phaseTwoMigrationUrl = new URL(
  "../supabase/migrations/20260913000000_phase_2_sports_odds.sql",
  import.meta.url,
);
const phaseThreeMigrationUrl = new URL(
  "../supabase/migrations/20260914000000_phase_3_simulated_straight_bets.sql",
  import.meta.url,
);
const phaseFourMigrationUrl = new URL(
  "../supabase/migrations/20260915000000_phase_4_scores_settlement.sql",
  import.meta.url,
);
const phaseFiveMigrationUrl = new URL(
  "../supabase/migrations/20260916000000_phase_5_external_wagers.sql",
  import.meta.url,
);
const phaseSixMigrationUrl = new URL(
  "../supabase/migrations/20260917000000_phase_6_analytics_leaderboards.sql",
  import.meta.url,
);
const phaseSevenMarketTypeMigrationUrl = new URL(
  "../supabase/migrations/20260917100000_phase_7_parlay_market_type.sql",
  import.meta.url,
);
const phaseSevenMigrationUrl = new URL(
  "../supabase/migrations/20260918000000_phase_7_parlays.sql",
  import.meta.url,
);
const releaseCandidateMigrationUrl = new URL(
  "../supabase/migrations/20260920000000_release_candidate_ux_patch_1.sql",
  import.meta.url,
);

describe("Phase 0 database foundation", () => {
  it("keeps server-only objects outside exposed schemas", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");

    expect(sql).toContain("create schema if not exists app_private");
    expect(sql).toContain("revoke all on schema app_private from anon");
    expect(sql).toContain("revoke all on schema app_private from authenticated");
    expect(sql).not.toMatch(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\./i);
  });
});

describe("Phase 2 shared-data authorization migration", () => {
  it("uses forced RLS and grants authenticated users read-only shared cache access", async () => {
    const sql = await readFile(fileURLToPath(phaseTwoMigrationUrl), "utf8");
    for (const table of ["odds_cache", "api_usage_ledger"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
    expect(sql).toContain("grant select on table public.odds_cache to authenticated");
    expect(sql).not.toMatch(/grant[^;]*(?:insert|update|delete)[^;]*odds_cache[^;]*authenticated/i);
    expect(sql).not.toMatch(/grant[^;]*api_usage_ledger[^;]*authenticated/i);
  });

  it("keeps provider calls and credentials behind server-only imports", async () => {
    const provider = await readFile(
      new URL("../src/lib/odds/provider.ts", import.meta.url),
      "utf8",
    );
    const server = await readFile(new URL("../src/lib/odds/server.ts", import.meta.url), "utf8");
    expect(provider).toMatch(/^import "server-only";/);
    expect(server).toMatch(/^import "server-only";/);
    expect(provider).not.toMatch(/NEXT_PUBLIC_.*ODDS/i);
  });
});

describe("Phase 1 authorization migration", () => {
  it("enables and forces RLS on every exposed Phase 1 table", async () => {
    const sql = await readFile(fileURLToPath(phaseOneMigrationUrl), "utf8");

    for (const table of ["profiles", "groups", "group_members", "group_invites"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
  });

  it("does not grant invitation or membership mutation access directly", async () => {
    const sql = await readFile(fileURLToPath(phaseOneMigrationUrl), "utf8");

    expect(sql).toContain("grant select on table public.group_members to authenticated");
    expect(sql).not.toMatch(/grant[^;]*(?:insert|update|delete)[^;]*group_members/i);
    expect(sql).not.toMatch(/grant[^;]*group_invites[^;]*to authenticated/i);
    expect(sql).toContain("revoke all on function public.join_group_with_invite(text) from public");
  });

  it("stores invitation hashes rather than plaintext tokens", async () => {
    const sql = await readFile(fileURLToPath(phaseOneMigrationUrl), "utf8");

    expect(sql).toContain("token_hash text not null unique");
    expect(sql).not.toMatch(/create table public\.group_invites[\s\S]*\btoken\s+text/i);
    expect(sql).toContain("extensions.digest(plaintext_token, 'sha256')");
  });
});

describe("Phase 3 wager and bankroll authorization migration", () => {
  it("forces RLS and exposes read-only owned records", async () => {
    const sql = await readFile(fileURLToPath(phaseThreeMigrationUrl), "utf8");
    for (const table of ["bets", "bet_legs", "bankroll_ledger"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).toContain(`grant select on table public.${table} to authenticated`);
      expect(sql).not.toMatch(
        new RegExp(`grant[^;]*(?:insert|update|delete)[^;]*${table}[^;]*authenticated`, "i"),
      );
    }
  });

  it("uses one atomic function, immutable snapshots, and per-user transaction locking", async () => {
    const sql = await readFile(fileURLToPath(phaseThreeMigrationUrl), "utf8");
    expect(sql).toContain("create or replace function public.place_simulated_straight_bet");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("insert into public.bets");
    expect(sql).toContain("insert into public.bet_legs");
    expect(sql).toContain("insert into public.bankroll_ledger");
    expect(sql).toContain("Accepted ticket terms are immutable");
    expect(sql).toContain("Accepted bet leg snapshots are immutable");
  });

  it("enforces one idempotent initial allocation and one stake debit per bet", async () => {
    const sql = await readFile(fileURLToPath(phaseThreeMigrationUrl), "utf8");
    expect(sql).toContain("bankroll_one_initial_allocation_per_user");
    expect(sql).toContain("bankroll_one_transaction_type_per_bet");
    expect(sql).toContain("on conflict do nothing");
  });
});

describe("Phase 4 score and settlement authorization migration", () => {
  it("forces RLS and prevents authenticated mutation of provider and audit records", async () => {
    const sql = await readFile(fileURLToPath(phaseFourMigrationUrl), "utf8");
    for (const table of ["event_scores", "score_refresh_state", "settlement_audits"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).not.toMatch(
        new RegExp(`grant[^;]*(?:insert|update|delete)[^;]*${table}[^;]*authenticated`, "i"),
      );
    }
    expect(sql).toContain(
      "grant execute on function public.settle_simulated_straight_bet(uuid) to service_role",
    );
    expect(sql).toContain("bankroll_one_settlement_credit_per_bet");
    expect(sql).toContain("A settled ticket cannot be regraded");
  });
});

describe("Phase 5 external wager and screenshot authorization migration", () => {
  it("keeps external wagers separate from simulated tickets and the bankroll", async () => {
    const sql = await readFile(fileURLToPath(phaseFiveMigrationUrl), "utf8");
    expect(sql).toContain("create table public.external_wagers");
    expect(sql).toContain("external_wagers_external_source check (source = 'external')");
    expect(sql).not.toMatch(/insert into public\.bankroll_ledger/i);
    expect(sql).not.toMatch(/insert into public\.bets/i);
  });

  it("uses forced RLS, narrow owner mutation functions, and a private bucket", async () => {
    const sql = await readFile(fileURLToPath(phaseFiveMigrationUrl), "utf8");
    for (const table of [
      "sports_catalog",
      "competitions_catalog",
      "sportsbooks_catalog",
      "external_wagers",
      "external_wager_result_audits",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
    }
    expect(sql).toContain("'external-wager-screenshots'");
    expect(sql).toContain("false,\n  5242880");
    expect(sql).toContain("external_wager_screenshots_select_authorized");
    expect(sql).not.toMatch(
      /grant[^;]*(?:insert|update|delete)[^;]*external_wagers[^;]*authenticated/i,
    );
  });
});

describe("Phase 6 analytics read surfaces", () => {
  it("uses a canonical projection with caller-derived personal and membership-gated group access", async () => {
    const sql = await readFile(fileURLToPath(phaseSixMigrationUrl), "utf8");
    expect(sql).toContain("create or replace function app_private.analytics_wager_rows()");
    expect(sql).toContain("union all");
    expect(sql).toContain("create or replace function public.get_personal_analytics_wagers()");
    expect(sql).not.toMatch(/get_personal_analytics_wagers\s*\([^)]*uuid/i);
    expect(sql).toContain(
      "create or replace function public.get_group_analytics_wagers(p_group_id uuid)",
    );
    expect(sql).toContain("GROUP_ANALYTICS_FORBIDDEN");
    expect(sql).toContain(
      "revoke all on function public.get_group_analytics_wagers(uuid) from public, anon, authenticated, service_role",
    );
    expect(sql).not.toMatch(/\bemail\b/i);
  });
});

describe("Phase 7 parlay authorization and settlement migration", () => {
  it("adds a first-class parlay market value before the parlay schema migration", async () => {
    const sql = await readFile(fileURLToPath(phaseSevenMarketTypeMigrationUrl), "utf8");
    expect(sql).toContain("alter type public.bet_market_type add value 'parlay'");
  });

  it("extends immutable tickets, validates server-authoritative legs, and settles atomically", async () => {
    const sql = await readFile(fileURLToPath(phaseSevenMigrationUrl), "utf8");
    expect(sql).toContain("create or replace function public.place_simulated_parlay_bet");
    expect(sql).toContain("create or replace function public.settle_simulated_parlay_bet");
    expect(sql).toContain("create or replace function app_private.combine_decimal_odds");
    expect(sql).toContain("SAME_EVENT_PARLAY_NOT_SUPPORTED");
    expect(sql).toContain("PARLAY_REQUIRES_ONE_BOOKMAKER");
    expect(sql).toContain("settlement:' || ticket.id::text");
    expect(sql).toContain("insert into public.bankroll_ledger");
    expect(sql).toContain("Accepted bet leg snapshots are immutable");
    expect(sql).toContain("effective_settlement_decimal_odds");
  });

  it("adds normalized external legs with forced RLS and owner/function boundaries", async () => {
    const sql = await readFile(fileURLToPath(phaseSevenMigrationUrl), "utf8");
    expect(sql).toContain("create table public.external_wager_legs");
    expect(sql).toContain("alter table public.external_wager_legs enable row level security");
    expect(sql).toContain("alter table public.external_wager_legs force row level security");
    expect(sql).toContain("create or replace function public.create_external_parlay");
    expect(sql).toContain("create or replace function public.set_external_parlay_result");
    expect(sql).not.toMatch(
      /grant[^;]*(?:insert|update|delete)[^;]*external_wager_legs[^;]*authenticated/i,
    );
    expect(sql).toContain(
      "grant execute on function public.settle_simulated_parlay_bet(uuid) to service_role",
    );
    expect(sql).toMatch(
      /grant execute on function public\.set_external_parlay_result\(uuid, public\.bet_status, jsonb\)[\s\S]*to authenticated/,
    );
  });
});

describe("Release candidate UX patch 1 migration", () => {
  it("keeps synthetic settlement tests flagged, immutable, and outside normal reads", async () => {
    const sql = await readFile(fileURLToPath(releaseCandidateMigrationUrl), "utf8");

    expect(sql).toContain("add column is_synthetic boolean not null default false");
    expect(sql).toContain("new.is_synthetic <> old.is_synthetic");
    expect(sql).toContain("new.leg_count <> old.leg_count");
    expect(sql).toContain("not ticket.is_synthetic");
    expect(sql).toContain("where ticket.source = 'simulated' and not ticket.is_synthetic");
    expect(sql).toContain("revoke all on function public.admin_create_settlement_test");
    expect(sql).toContain("grant execute on function public.admin_settle_settlement_test");
  });
});
