import { describe, expect, it } from "vitest";

import { reconcileActiveStraightSelection, type SlipSelection } from "../src/lib/wagers/slip";

function selection(overrides: Partial<SlipSelection> = {}): SlipSelection {
  return {
    clientSelectionId: "florida-gators-spread",
    competitionKey: "ncaaf",
    eventId: "florida-gators",
    sport: "football",
    competition: "College Football",
    event: "Florida at Gators",
    scheduledStart: "2026-09-24T23:30:00.000Z",
    homeTeam: "Gators",
    awayTeam: "Florida",
    bookmakerId: "fanduel",
    bookmaker: "FanDuel",
    marketType: "spread",
    selection: "away",
    selectionName: "Florida / Gators",
    line: -3.5,
    americanOdds: -110,
    decimalOdds: 1.9091,
    ...overrides,
  };
}

describe("v0.15.1 alternate-line reconciliation", () => {
  it("replaces the provider anchor with one simulated alternate without re-adding the anchor", () => {
    const provider = selection();
    const alternate = selection({
      line: -2.5,
      americanOdds: -122,
      decimalOdds: 1.8197,
      pricingSource: "simulated_alternate",
      anchorProviderLine: -3.5,
      anchorProviderAmericanOdds: -110,
      pricingModel: "simulated-alternate-spread-v1",
      pricingModelVersion: "1",
    });

    const replaced = reconcileActiveStraightSelection([provider], provider, alternate);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({
      line: -2.5,
      americanOdds: -122,
      pricingSource: "simulated_alternate",
      anchorProviderLine: -3.5,
      anchorProviderAmericanOdds: -110,
    });
    expect(reconcileActiveStraightSelection(replaced, provider, alternate)).toBe(replaced);
  });

  it("replaces a previous simulated line for the same provider anchor", () => {
    const provider = selection();
    const firstAlternate = selection({
      line: -2.5,
      americanOdds: -122,
      decimalOdds: 1.8197,
      pricingSource: "simulated_alternate",
      anchorProviderLine: -3.5,
      anchorProviderAmericanOdds: -110,
    });
    const secondAlternate = selection({
      line: -1.5,
      americanOdds: -137,
      decimalOdds: 1.7299,
      pricingSource: "simulated_alternate",
      anchorProviderLine: -3.5,
      anchorProviderAmericanOdds: -110,
    });

    const replaced = reconcileActiveStraightSelection([firstAlternate], provider, secondAlternate);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.line).toBe(-1.5);
  });
});
