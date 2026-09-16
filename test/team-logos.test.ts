import { describe, expect, it } from "vitest";

import { normalizeTeamName, resolveTeamIdentity, teamInitials } from "../src/lib/teams/logos";

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

  it.each([
    ["Syracuse Orange", "syracuse orange"],
    ["Miami (FL)", "miami fl"],
    ["Notre Dame Fighting Irish", "notre dame fighting irish"],
  ])("normalizes provider team names: %s", (input, expected) => {
    expect(normalizeTeamName(input)).toBe(expected);
  });

  it.each([
    ["Syracuse Orange", "183"],
    ["Pitt Panthers", "221"],
    ["Miami Hurricanes", "2390"],
    ["Clemson Tigers", "228"],
    ["South Carolina Gamecocks", "2579"],
    ["Georgia Bulldogs", "61"],
    ["Alabama Crimson Tide", "333"],
    ["Ohio State Buckeyes", "194"],
    ["Notre Dame Fighting Irish", "87"],
    ["Michigan Wolverines", "130"],
  ])("resolves college alias %s", (teamName, expectedId) => {
    expect(resolveTeamIdentity(teamName, "football").logoUrl).toContain(
      `espncdn.com/i/teamlogos/ncaa/500/${expectedId}.png`,
    );
  });
});
