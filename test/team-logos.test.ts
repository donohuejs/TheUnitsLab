import { describe, expect, it } from "vitest";

import {
  TEAM_REGISTRY,
  auditTeamCoverage,
  normalizeTeamName,
  resolveTeamIdentity,
  resolveTeamRecord,
  teamInitials,
  teamLogoStatus,
  teamNamesMatch,
} from "../src/lib/teams/logos";

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

  it("covers all 32 NFL teams with unique scoped provider identities", () => {
    const nflTeams = [
      ["Arizona Cardinals", "22"],
      ["Atlanta Falcons", "1"],
      ["Baltimore Ravens", "33"],
      ["Buffalo Bills", "2"],
      ["Carolina Panthers", "29"],
      ["Chicago Bears", "3"],
      ["Cincinnati Bengals", "4"],
      ["Cleveland Browns", "5"],
      ["Dallas Cowboys", "6"],
      ["Denver Broncos", "7"],
      ["Detroit Lions", "8"],
      ["Green Bay Packers", "9"],
      ["Houston Texans", "34"],
      ["Indianapolis Colts", "11"],
      ["Jacksonville Jaguars", "30"],
      ["Kansas City Chiefs", "12"],
      ["Las Vegas Raiders", "13"],
      ["Los Angeles Chargers", "24"],
      ["Los Angeles Rams", "14"],
      ["Miami Dolphins", "15"],
      ["Minnesota Vikings", "16"],
      ["New England Patriots", "17"],
      ["New Orleans Saints", "18"],
      ["New York Giants", "19"],
      ["New York Jets", "20"],
      ["Philadelphia Eagles", "21"],
      ["Pittsburgh Steelers", "23"],
      ["San Francisco 49ers", "25"],
      ["Seattle Seahawks", "26"],
      ["Tampa Bay Buccaneers", "27"],
      ["Tennessee Titans", "10"],
      ["Washington Commanders", "28"],
    ] as const;

    const resolved = nflTeams.map(([name]) => resolveTeamRecord(name, "football", "nfl"));
    expect(resolved.every((team) => team.resolution === "RESOLVED")).toBe(true);
    expect(new Set(resolved.map((team) => team.canonicalId)).size).toBe(32);
    expect(resolved.map((team) => team.logoUrl)).toEqual(
      nflTeams.map(([, id]) => `https://a.espncdn.com/i/teamlogos/nfl/500/${id}.png`),
    );
  });

  it("does not cross-resolve same-name teams between sports or competitions", () => {
    expect(resolveTeamRecord("Carolina Panthers", "football", "nfl").canonicalId).toBe("nfl:29");
    expect(resolveTeamRecord("Florida Panthers", "hockey", "nhl").canonicalId).toBe("nhl:13");
    expect(resolveTeamRecord("New York Giants", "hockey", "nhl").resolution).toBe(
      "TEAM_UNRESOLVED",
    );
    expect(resolveTeamRecord("Miami Hurricanes", "football", "nfl").resolution).toBe(
      "TEAM_UNRESOLVED",
    );
    expect(resolveTeamRecord("Miami Hurricanes", "football", "ncaaf").canonicalId).toBe(
      "ncaa:2390",
    );
  });

  it("leaves ambiguous or generic NCAA names unresolved", () => {
    for (const name of ["Miami", "Miami (OH)", "USC", "UT", "Tigers"]) {
      const result = resolveTeamRecord(name, "football", "ncaaf");
      expect(result.resolution, name).toBe("TEAM_UNRESOLVED");
      expect(result.logoUrl, name).toBeNull();
    }
    expect(resolveTeamRecord("Houston", "football", "ncaaf").canonicalId).toBe("ncaa:248");
    expect(resolveTeamRecord("Houston Texans", "football", "nfl").canonicalId).toBe("nfl:34");
  });

  it("shares one canonical soccer identity across domestic and European scopes", () => {
    const epl = resolveTeamRecord("Arsenal", "soccer", "epl");
    const ucl = resolveTeamRecord("Arsenal FC", "soccer", "ucl");
    expect(epl.canonicalId).toBe("soccer:359");
    expect(ucl.canonicalId).toBe(epl.canonicalId);
    expect(ucl.logoUrl).toBe(epl.logoUrl);
    expect(resolveTeamRecord("Brighton and Hove Albion", "soccer", "epl").resolution).toBe(
      "RESOLVED",
    );
    expect(resolveTeamRecord("Real Madrid", "soccer", "ucl").resolution).toBe("RESOLVED");
  });

  it("keeps matching exact and scoped rather than using fuzzy text", () => {
    expect(
      teamNamesMatch("NY Giants", "New York Giants", { sport: "football", competitionId: "nfl" }),
    ).toBe(true);
    expect(
      teamNamesMatch("New York Giants", "Florida Panthers", {
        sport: "football",
        competitionId: "nfl",
      }),
    ).toBe(false);
    expect(
      teamNamesMatch("Miami", "Miami (FL)", { sport: "football", competitionId: "ncaaf" }),
    ).toBe(false);
    expect(teamNamesMatch("Unknown Club", "Unknown Club")).toBe(true);
    expect(teamNamesMatch("Unknown Club", "Unknown Club FC")).toBe(false);
  });

  it("classifies unresolved teams and failed images without exposing an algorithm", () => {
    const resolved = resolveTeamRecord("Miami Dolphins", "football", "nfl");
    const unknown = resolveTeamRecord("A completely new club", "soccer", "epl");
    expect(teamLogoStatus(resolved, null)).toBe("LOGO_AVAILABLE");
    expect(teamLogoStatus(resolved, resolved.logoUrl)).toBe("LOGO_LOAD_FAILED");
    expect(teamLogoStatus(unknown, null)).toBe("TEAM_UNRESOLVED");
  });

  it("reports coverage without guessing missing teams", () => {
    const audit = auditTeamCoverage([
      { teamName: "Arizona Cardinals", sport: "football", competitionId: "nfl" },
      { teamName: "Miami", sport: "football", competitionId: "ncaaf" },
      { teamName: "Arsenal", sport: "soccer", competitionId: "ucl" },
    ]);
    expect(audit).toMatchObject({ encountered: 3, resolved: 2, unresolved: 1 });
    expect(audit.unresolvedTeams[0]).toMatchObject({ teamName: "Miami", reason: "UNKNOWN_TEAM" });
  });

  it("keeps registry provider identities unique", () => {
    expect(new Set(TEAM_REGISTRY.map((entry) => entry.canonicalId)).size).toBe(
      TEAM_REGISTRY.length,
    );
  });
});
