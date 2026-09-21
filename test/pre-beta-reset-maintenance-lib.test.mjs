import { describe, expect, it } from "vitest";

import {
  EXECUTION_CONFIRMATION,
  TEST_USER_EMAIL,
  parseMaintenanceArgs,
  requireExactEmailMatch,
  requireExecutionConfirmation,
  requireExactUserId,
} from "../scripts/pre-beta-reset-maintenance-lib.mjs";

const user = (id, email = TEST_USER_EMAIL) => ({ id, email });

describe("pre-beta reset maintenance operator guards", () => {
  it("defaults to a dry run and rejects conflicting or unknown modes", () => {
    expect(parseMaintenanceArgs([])).toEqual({ mode: "dry-run", confirmation: null });
    expect(parseMaintenanceArgs(["--dry-run"])).toEqual({ mode: "dry-run", confirmation: null });
    expect(parseMaintenanceArgs(["--verify"])).toEqual({ mode: "verify", confirmation: null });
    expect(parseMaintenanceArgs(["--execute", "--confirm", EXECUTION_CONFIRMATION])).toEqual({
      mode: "execute",
      confirmation: EXECUTION_CONFIRMATION,
    });
    expect(() => parseMaintenanceArgs(["--execute", "--verify"])).toThrow();
    expect(() => parseMaintenanceArgs(["--unknown"])).toThrow();
  });

  it("requires exact email/UUID matches and explicit production confirmation", () => {
    expect(requireExactEmailMatch([user("test-user")]).id).toBe("test-user");
    expect(() => requireExactEmailMatch([])).toThrow(/exactly one/);
    expect(() => requireExactEmailMatch([user("a"), user("b")])).toThrow(/exactly one/);
    expect(
      requireExactUserId([user("admin-user", "admin@example.test")], "admin-user", "admin").id,
    ).toBe("admin-user");
    expect(() => requireExactUserId([], "admin-user", "admin")).toThrow(/exact supplied UUID/);

    expect(() =>
      requireExecutionConfirmation({
        mode: "execute",
        confirmation: EXECUTION_CONFIRMATION,
        environment: "staging",
        adminUserId: "admin-user",
      }),
    ).toThrow(/production/);
    expect(() =>
      requireExecutionConfirmation({
        mode: "execute",
        confirmation: "yes",
        environment: "production",
        adminUserId: "admin-user",
      }),
    ).toThrow(/RESET_PRIVATE_BETA_TEST_DATA/);
    expect(() =>
      requireExecutionConfirmation({
        mode: "execute",
        confirmation: EXECUTION_CONFIRMATION,
        environment: "production",
        adminUserId: "admin-user",
      }),
    ).not.toThrow();
  });
});
