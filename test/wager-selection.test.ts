import { describe, expect, it } from "vitest";

import type { NormalizedEvent, NormalizedOdds, OddsDataset } from "../src/lib/odds/types";
import { findStraightSelection, isSupportedStraightSelection } from "../src/lib/wagers/selection";

const baseOdds: NormalizedOdds = {
  bookmakerId: "fanduel",
  bookmakerName: "FanDuel",
  marketType: "moneyline",
  selection: "home",
  selectionName: "Arsenal",
  point: null,
  americanOdds: 150,
  decimalOdds: 2.5,
  providerUpdatedAt: "2026-09-12T12:00:00Z",
  fetchedAt: "2026-09-12T12:01:00Z",
};
const event: NormalizedEvent = {
  id: "epl:event-1",
  providerEventId: "event-1",
  sport: "soccer",
  competitionId: "epl",
  competitionName: "English Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  scheduledStart: "2099-09-13T12:00:00Z",
  status: "scheduled",
  providerSportKey: "soccer_epl",
  odds: [baseOdds],
};

describe("Phase 3 straight-market selection", () => {
  it.each([
    ["moneyline", "home", null],
    ["moneyline", "draw", null],
    ["spread", "away", 1.5],
    ["total", "over", 45.5],
  ] as const)("accepts %s %s", (marketType, selection, point) => {
    expect(isSupportedStraightSelection(event, { ...baseOdds, marketType, selection, point })).toBe(
      true,
    );
  });

  it("rejects a soccer draw on a non-soccer event and invalid line shapes", () => {
    expect(
      isSupportedStraightSelection(
        { ...event, sport: "football" },
        { ...baseOdds, selection: "draw" },
      ),
    ).toBe(false);
    expect(isSupportedStraightSelection(event, { ...baseOdds, marketType: "spread" })).toBe(false);
    expect(isSupportedStraightSelection(event, { ...baseOdds, marketType: "total" })).toBe(false);
  });

  it("resolves only the exact displayed bookmaker, market, and outcome", () => {
    const dataset: OddsDataset = {
      competitionId: "epl",
      fetchedAt: event.odds[0].fetchedAt,
      events: [event],
    };
    expect(
      findStraightSelection(dataset, {
        eventId: event.id,
        bookmakerId: "fanduel",
        marketType: "moneyline",
        selection: "home",
      }),
    ).toEqual({ event, odds: baseOdds });
    expect(
      findStraightSelection(dataset, {
        eventId: event.id,
        bookmakerId: "draftkings",
        marketType: "moneyline",
        selection: "home",
      }),
    ).toBeNull();
  });
});
