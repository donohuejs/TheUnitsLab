import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("pre-beta permissions and My Bets read hotfix", () => {
  it("grants only the preview audit read and exact My Bets table reads", () => {
    const migration = read(
      "../supabase/migrations/20261004000000_pre_beta_permissions_my_bets.sql",
    );

    expect(migration).toContain(
      "grant select on table public.wager_study_assignment_audits to service_role",
    );
    expect(migration).toContain("public.bets");
    expect(migration).toContain("public.bet_legs");
    expect(migration).toContain("public.bankroll_ledger");
    expect(migration).toContain("public.external_wagers");
    expect(migration).toContain("public.external_wager_legs");
    expect(migration).toContain("public.event_scores");
    expect(migration).not.toMatch(/grant\s+select\s+on\s+all\s+tables/i);
    expect(migration).not.toMatch(/disable row level security/i);
    expect(migration).not.toMatch(/drop policy/i);
  });

  it("keeps My Bets reads explicitly scoped and records safe server diagnostics", () => {
    const page = read("../src/app/my-bets/page.tsx");

    expect(page).toContain('.from("bets")');
    expect(page).toContain('.eq("user_id", authData.user.id)');
    expect(page).toContain(
      'supabase.from("bankroll_ledger").select("amount_units").eq("user_id", authData.user.id)',
    );
    expect(page).toContain('console.error("My Bets read failed"');
    expect(page).toContain('"simulated wagers"');
    expect(page).toContain('"imported wagers"');
    expect(page).toContain('"bankroll ledger"');
    expect(page).not.toContain("wager_study_assignment_audits");
  });
});
