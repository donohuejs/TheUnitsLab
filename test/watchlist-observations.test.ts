import { describe, expect, it } from "vitest";

import type { OddsDataset } from "@/lib/odds/types";
import { oddsObservations } from "@/lib/watchlist/observations";

const dataset: OddsDataset = {
  competitionId: "ncaaf",
  fetchedAt: "2026-09-22T12:00:00.000Z",
  events: [
    {
      id: "ncaaf:watch-event",
      providerEventId: "watch-event",
      sport: "football",
      competitionId: "ncaaf",
      competitionName: "College Football",
      homeTeam: "Clemson",
      awayTeam: "Duke",
      scheduledStart: "2026-09-23T18:00:00.000Z",
      status: "scheduled",
      providerSportKey: "americanfootball_ncaaf",
      odds: [
        {
          bookmakerId: "fanduel",
          bookmakerName: "FanDuel",
          marketType: "spread",
          selection: "home",
          selectionName: "Clemson",
          point: -7.5,
          americanOdds: -110,
          decimalOdds: 1.9091,
          providerUpdatedAt: "2026-09-22T11:55:00.000Z",
          fetchedAt: "2026-09-22T12:00:00.000Z",
        },
        {
          bookmakerId: "fanduel",
          bookmakerName: "FanDuel",
          marketType: "spread",
          selection: "home",
          selectionName: "Clemson",
          point: -6.5,
          americanOdds: -120,
          decimalOdds: 1.8333,
          isAlternate: true,
          providerUpdatedAt: "2026-09-22T11:59:00.000Z",
          fetchedAt: "2026-09-22T12:00:00.000Z",
        },
        {
          bookmakerId: "fanduel",
          bookmakerName: "FanDuel",
          marketType: "moneyline",
          selection: "home",
          selectionName: "Clemson",
          point: null,
          americanOdds: -290,
          decimalOdds: 1.3448,
          providerUpdatedAt: "2026-09-22T11:55:00.000Z",
          fetchedAt: "2026-09-22T12:00:00.000Z",
        },
      ],
    },
  ],
};

describe("shared odds-history observations", () => {
  it("keeps one supported base-market outcome and excludes simultaneous alternates", () => {
    const result = oddsObservations(dataset);
    expect(result.seenEventIds).toEqual(["watch-event"]);
    expect(result.observations).toHaveLength(2);
    expect(result.observations.find((row) => row.market_type === "spread")?.line).toBe(-7.5);
    expect(result.observations.some((row) => row.line === -6.5)).toBe(false);
  });
});
