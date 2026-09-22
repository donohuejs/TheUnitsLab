import { describe, expect, it } from "vitest";

import { formatInviteCode, isInviteCode, normalizeInviteCode } from "../src/lib/invite-code";

describe("group invite code formatting and normalization", () => {
  it("normalizes case, outer whitespace, and optional hyphens", () => {
    expect(normalizeInviteCode("  abcd-efgh  ")).toBe("ABCDEFGH");
    expect(normalizeInviteCode("abcd efgh")).toBe("ABCD EFGH");
  });

  it("accepts the displayed alphabet and rejects ambiguous or malformed values", () => {
    expect(isInviteCode("ABCDEFGH")).toBe(true);
    expect(isInviteCode("ABCD0FGH")).toBe(false);
    expect(isInviteCode("ABCD- EFGH")).toBe(false);
    expect(isInviteCode("ABCDEFG")).toBe(false);
  });

  it("formats a canonical code for readable display and copying", () => {
    expect(formatInviteCode("abcd efgh")).toBe("ABCD EFGH");
    expect(formatInviteCode("abcdefgh")).toBe("ABCD-EFGH");
  });
});
