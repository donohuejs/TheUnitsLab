import { describe, expect, it } from "vitest";

import { resolveTeamIdentity, teamInitials } from "../src/lib/teams/logos";

describe("team logo resolver", () => {
  it("returns a centralized provider logo for known teams", () => {
    expect(resolveTeamIdentity("Miami Dolphins", "football")).toMatchObject({
      initials: "MD",
      logoUrl: expect.stringContaining("espncdn.com"),
    });
  });

  it("keeps unknown teams safe with initials fallback", () => {
    expect(resolveTeamIdentity("A completely new club", "hockey")).toEqual({
      initials: "AC",
      logoUrl: null,
      sport: "hockey",
    });
    expect(teamInitials("")).toBe("?");
  });
});
