import { describe, expect, it } from "vitest";

import {
  buildBreakdown,
  filterAnalyticsWagers,
  getAnalyticsPeriodStart,
  normalizeAnalyticsTimeZone,
  rankLeaderboard,
  summarizeAnalytics,
  type AnalyticsWager,
} from "../src/lib/analytics/calculations";

const userA = "10000000-0000-0000-0000-000000000001";
const userB = "20000000-0000-0000-0000-000000000002";

function wager(
  wagerId: string,
  overrides: Partial<AnalyticsWager> &
    Pick<AnalyticsWager, "status" | "stakeUnits" | "profitLossUnits">,
): AnalyticsWager {
  return {
    wagerId,
    userId: userA,
    source: "simulated",
    ticketType: "straight",
    decimalOdds: "2.0000",
    wageredAt: "2026-09-07T04:00:00.000Z",
    sportKey: "soccer",
    competitionKey: "epl",
    competitionName: "English Premier League",
    marketType: "moneyline",
    sportsbookId: "fanduel",
    sportsbookName: "FanDuel",
    ...overrides,
  };
}

const fixture: AnalyticsWager[] = [
  wager("01", {
    status: "won",
    stakeUnits: "5.00",
    profitLossUnits: "5.00",
    wageredAt: "2026-09-01T16:00:00Z",
  }),
  wager("02", { status: "won", stakeUnits: "100.00", profitLossUnits: "100.00" }),
  wager("03", {
    status: "lost",
    stakeUnits: "50.00",
    profitLossUnits: "-50.00",
    decimalOdds: "1.9100",
    wageredAt: "2026-09-08T12:00:00Z",
    sportKey: "football",
    competitionKey: "ncaaf",
    competitionName: "NCAA Football",
    marketType: "spread",
    sportsbookId: "draftkings",
    sportsbookName: "DraftKings",
  }),
  wager("04", {
    status: "push",
    stakeUnits: "25.00",
    profitLossUnits: "0.00",
    decimalOdds: "1.9500",
    wageredAt: "2026-09-09T12:00:00Z",
    sportKey: "basketball",
    competitionKey: "ncaab",
    competitionName: "NCAA Basketball",
    marketType: "total",
    sportsbookId: "betmgm",
    sportsbookName: "BetMGM",
  }),
  wager("05", {
    status: "void",
    stakeUnits: "30.00",
    profitLossUnits: "0.00",
    decimalOdds: "2.1000",
    wageredAt: "2026-09-10T12:00:00Z",
  }),
  wager("06", {
    status: "won",
    stakeUnits: "20.00",
    profitLossUnits: "30.00",
    decimalOdds: "2.5000",
    source: "external",
    wageredAt: "2026-09-11T12:00:00Z",
    competitionKey: "ucl",
    competitionName: "UEFA Champions League",
    sportsbookId: "caesars",
    sportsbookName: "Caesars",
  }),
  // Current corrected IRL row: its former winning result exists only in audit history and is not a second record.
  wager("07", {
    status: "lost",
    stakeUnits: "10.00",
    profitLossUnits: "-10.00",
    decimalOdds: "1.8000",
    source: "external",
    wageredAt: "2026-09-12T12:00:00Z",
    sportKey: "football",
    competitionKey: "ncaaf",
    competitionName: "NCAA Football",
    sportsbookId: "draftkings",
    sportsbookName: "DraftKings",
  }),
  wager("08", {
    status: "open",
    stakeUnits: "15.00",
    profitLossUnits: "0.00",
    source: "external",
    wageredAt: "2026-09-13T12:00:00Z",
  }),
];

describe("Phase 6 exact analytics reconciliation", () => {
  it("matches independently calculated all-time fixture totals", () => {
    const actual = summarizeAnalytics(fixture);
    expect(actual).toEqual({
      totalBets: 8,
      wins: 3,
      losses: 2,
      pushes: 1,
      voids: 1,
      open: 1,
      eligibleSettledBets: 6,
      unitsWagered: "210.00",
      unitsWonLost: "75.00",
      roiPercent: "35.71",
      winPercentage: "60.00",
      averageDecimalOdds: "2.0267",
      currentStreak: "L1",
      bestStreak: 2,
    });
  });

  it("uses settled W-L-P counts for Lab Notes wager qualification and display semantics", () => {
    const actual = summarizeAnalytics(fixture);
    expect(actual.wins).toBe(3);
    expect(actual.losses).toBe(2);
    expect(actual.pushes).toBe(1);
    expect(actual.eligibleSettledBets).toBe(6);
    expect(actual.totalBets).toBe(8);
    const row = rankLeaderboard(
      [{ userId: userA, displayName: "Alpha" }],
      fixture.map((record) => ({ ...record, userId: userA })),
      "total_wagers",
    )[0];
    expect(row?.summary.eligibleSettledBets).toBe(6);
    expect(row?.eligible).toBe(true);
  });

  it("reconciles source, wager-time, sport, market, and sportsbook filters", () => {
    const now = new Date("2026-09-14T00:00:00Z");
    const week = filterAnalyticsWagers(fixture, {
      period: "week",
      timeZone: "America/New_York",
      now,
    });
    expect(summarizeAnalytics(week)).toMatchObject({
      totalBets: 7,
      unitsWagered: "205.00",
      unitsWonLost: "70.00",
    });
    expect(
      summarizeAnalytics(filterAnalyticsWagers(fixture, { source: "simulated", now })),
    ).toMatchObject({ totalBets: 5, unitsWonLost: "55.00" });
    expect(
      summarizeAnalytics(filterAnalyticsWagers(fixture, { source: "irl", now })),
    ).toMatchObject({ totalBets: 3, unitsWonLost: "20.00" });
    expect(
      summarizeAnalytics(filterAnalyticsWagers(fixture, { sportKey: "football", now })),
    ).toMatchObject({ totalBets: 2, unitsWonLost: "-60.00" });
    expect(
      summarizeAnalytics(filterAnalyticsWagers(fixture, { marketType: "spread", now })),
    ).toMatchObject({ totalBets: 1, unitsWonLost: "-50.00" });
    expect(
      summarizeAnalytics(filterAnalyticsWagers(fixture, { competitionKey: "ucl", now })),
    ).toMatchObject({ totalBets: 1, unitsWonLost: "30.00" });
    expect(
      summarizeAnalytics(filterAnalyticsWagers(fixture, { sportsbookId: "draftkings", now })),
    ).toMatchObject({ totalBets: 2, unitsWonLost: "-60.00" });
  });

  it("uses the canonical formulas for every breakdown", () => {
    const sports = buildBreakdown(fixture, (record) => record.sportKey);
    expect(sports.find((row) => row.key === "soccer")?.summary).toMatchObject({
      totalBets: 5,
      unitsWonLost: "135.00",
    });
    const competitions = buildBreakdown(fixture, (record) => record.competitionKey);
    expect(competitions.find((row) => row.key === "ncaaf")?.summary.unitsWonLost).toBe("-60.00");
  });

  it("counts a mixed parlay parent once and excludes it from single-sport ranking", () => {
    const mixedParlay = wager("parlay", {
      ticketType: "parlay",
      status: "won",
      stakeUnits: "10.00",
      profitLossUnits: "20.00",
      sportKey: "mixed",
      competitionKey: "mixed",
      competitionName: "Mixed competitions",
      marketType: "parlay",
    });
    expect(summarizeAnalytics([mixedParlay])).toMatchObject({
      totalBets: 1,
      wins: 1,
      unitsWagered: "10.00",
      unitsWonLost: "20.00",
    });
    expect(
      rankLeaderboard([{ userId: userA, displayName: "Alpha" }], [mixedParlay], "soccer")[0].summary
        .totalBets,
    ).toBe(0);
  });

  it("rounds exact positive and negative ratios without floating-point accumulation", () => {
    const positive = summarizeAnalytics([
      wager("p", {
        status: "won",
        stakeUnits: "3.00",
        profitLossUnits: "1.00",
        decimalOdds: "1.3333",
      }),
    ]);
    const negative = summarizeAnalytics([
      wager("n", {
        status: "lost",
        stakeUnits: "3.00",
        profitLossUnits: "-1.00",
        decimalOdds: "1.3333",
      }),
    ]);
    expect(positive.roiPercent).toBe("33.33");
    expect(negative.roiPercent).toBe("-33.33");
  });
});

describe("Phase 6 time boundaries and ranking", () => {
  it("calculates Monday, month, season, and DST-aware local boundaries", () => {
    expect(normalizeAnalyticsTimeZone("not/a-zone")).toBe("UTC");
    expect(
      getAnalyticsPeriodStart(
        "week",
        "America/New_York",
        new Date("2026-09-13T20:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-09-07T04:00:00.000Z");
    expect(
      getAnalyticsPeriodStart(
        "month",
        "America/New_York",
        new Date("2026-09-13T20:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-09-01T04:00:00.000Z");
    expect(
      getAnalyticsPeriodStart(
        "season",
        "America/New_York",
        new Date("2026-02-01T12:00:00Z"),
      )?.toISOString(),
    ).toBe("2025-08-01T04:00:00.000Z");
    expect(
      getAnalyticsPeriodStart(
        "week",
        "America/New_York",
        new Date("2026-03-10T12:00:00Z"),
      )?.toISOString(),
    ).toBe("2026-03-09T04:00:00.000Z");
  });

  it("shares tied ranks and uses stable display ordering without economic tie-breaking", () => {
    const records = [
      wager("a", { userId: userA, status: "won", stakeUnits: "10.00", profitLossUnits: "10.00" }),
      wager("b", { userId: userB, status: "won", stakeUnits: "5.00", profitLossUnits: "10.00" }),
    ];
    const rows = rankLeaderboard(
      [
        { userId: userB, displayName: "Bravo" },
        { userId: userA, displayName: "Alpha" },
      ],
      records,
      "units",
    );
    expect(rows.map((row) => [row.displayName, row.rank])).toEqual([
      ["Alpha", 1],
      ["Bravo", 1],
    ]);
  });

  it("orders group rows by the selected category's exact value", () => {
    const records = [
      wager("a", {
        userId: userA,
        status: "lost",
        stakeUnits: "10.00",
        profitLossUnits: "-10.00",
      }),
      wager("b", {
        userId: userB,
        status: "won",
        stakeUnits: "10.00",
        profitLossUnits: "2.50",
      }),
    ];
    const rows = rankLeaderboard(
      [
        { userId: userA, displayName: "Alpha" },
        { userId: userB, displayName: "Bravo" },
      ],
      records,
      "units",
    );
    expect(rows.map((row) => [row.userId, row.rank])).toEqual([
      [userB, 1],
      [userA, 2],
    ]);
  });

  it("distinguishes the five-wager eligibility boundary from poor performance", () => {
    const records = [
      ...Array.from({ length: 5 }, (_, index) =>
        wager(`a${index}`, {
          userId: userA,
          status: index ? "lost" : "won",
          stakeUnits: "1.00",
          profitLossUnits: index ? "-1.00" : "1.00",
        }),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        wager(`b${index}`, {
          userId: userB,
          status: "won",
          stakeUnits: "1.00",
          profitLossUnits: "10.00",
        }),
      ),
    ];
    const rows = rankLeaderboard(
      [
        { userId: userA, displayName: "Alpha" },
        { userId: userB, displayName: "Bravo" },
      ],
      records,
      "roi",
    );
    expect(rows[0]).toMatchObject({ userId: userA, eligible: true, rank: 1 });
    expect(rows[1]).toMatchObject({
      userId: userB,
      eligible: false,
      rank: null,
      neededForEligibility: 1,
    });
  });
});
