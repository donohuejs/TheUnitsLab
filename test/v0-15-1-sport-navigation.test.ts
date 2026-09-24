import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sportsProviderConfiguration } from "../src/config/sports";
import { getCompetition } from "../src/lib/odds/request";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("v0.15.1 Browse Odds sport navigation", () => {
  it("keeps every enabled core competition linked to a resolvable sport route", () => {
    const sportsPage = read("../src/app/sports/page.tsx");
    const competitionPage = read("../src/app/sports/[competition]/page.tsx");
    const competitions = sportsProviderConfiguration.competitions.filter(
      (competition) => competition.enabled && competition.availability === "core",
    );

    expect(competitions.length).toBeGreaterThan(0);
    for (const competition of competitions) {
      expect(getCompetition(competition.id)?.providerSportKey).toBe(competition.providerSportKey);
      expect(sportsPage).toContain(`href={\`/sports/\${item.id}\`}`);
    }
    expect(competitionPage).toContain("const competition = getCompetition(id);");
    expect(competitionPage).toContain('if (!competition) redirect("/sports");');
    expect(competitionPage).toContain("getCompetitionOdds(id as CompetitionId)");
    expect(competitionPage).toContain("<CompetitionSwitcher currentCompetition={id} />");
  });

  it("does not make temporary Bet Slip diagnostics a route dependency", () => {
    const competitionPage = read("../src/app/sports/[competition]/page.tsx");
    const layout = read("../src/app/sports/[competition]/layout.tsx");

    expect(competitionPage).not.toContain("BrowseBetSlipDebug");
    expect(competitionPage).not.toContain("debugSlipEnabled");
    expect(layout).toContain("BrowseBetSlipProvider");
  });
});
