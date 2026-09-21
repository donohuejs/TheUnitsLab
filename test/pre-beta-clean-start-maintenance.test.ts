import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("pre-beta clean-start maintenance contracts", () => {
  it("keeps the database cleanup exact, transactional, and service-role-only", () => {
    const migration = read(
      "../supabase/migrations/20261005000000_pre_beta_clean_start_maintenance.sql",
    );

    expect(migration).toContain("create or replace function public.pre_beta_clean_start");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "pg_catalog.set_config('app_private.pre_beta_cleanup', 'on', true)",
    );
    expect(migration).toContain("perform app_private.allocate_initial_bankroll(p_admin_user_id)");
    expect(migration).toContain("revoke all on function public.pre_beta_clean_start(uuid, uuid)");
    expect(migration).toContain(
      "grant execute on function public.pre_beta_clean_start(uuid, uuid) to service_role",
    );
    expect(migration).toContain("public.vision_usage_ledger");
    expect(migration).toContain("public.vision_diagnostics");
    expect(migration).toContain("public.simulated_placement_idempotency");
    expect(migration).not.toMatch(/truncate\s+/i);
    expect(migration).not.toMatch(/disable\s+trigger/i);
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security/i);
  });

  it("requires exact production execution guards and deletes Auth only after the RPC", () => {
    const lib = read("../scripts/pre-beta-reset-maintenance-lib.mjs");
    const script = read("../scripts/pre-beta-reset-maintenance.mjs");

    expect(lib).toContain('export const TEST_USER_EMAIL = "jadaxi4311@meonvr.com"');
    expect(lib).toContain('export const EXECUTION_CONFIRMATION = "RESET_PRIVATE_BETA_TEST_DATA"');
    expect(lib).toContain('environment !== "production"');
    expect(lib).toContain("PRE_BETA_ADMIN_USER_ID");
    expect(script).toContain("PRE_BETA_TEST_USER_ID");
    expect(script).toContain('supabase.rpc("pre_beta_clean_start"');
    expect(script.indexOf("supabase.auth.admin.deleteUser")).toBeGreaterThan(
      script.indexOf('supabase.rpc("pre_beta_clean_start"'),
    );
    expect(script.indexOf('if (mode === "dry-run")')).toBeGreaterThan(-1);
    expect(script.indexOf('if (mode === "dry-run")')).toBeLessThan(
      script.indexOf('supabase.rpc("pre_beta_clean_start"'),
    );
    expect(script).toContain("Application cleanup rolled back");
    expect(script).toContain('"DRY RUN — no mutations"');
    expect(script).toContain('"VERIFY — read-only"');
  });
});
