import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_RANKING_SNAPSHOTS,
  getActiveRankingSnapshot,
  getTeamRanking,
  type LeagueStandingsSnapshot,
  type RankingSnapshot,
} from "../src/config/sport-context";
import {
  availableBrowseDates,
  filterEventsForBrowseDate,
  getDefaultBrowseDate,
  getLocalDateKey,
  getMarqueeEventIds,
  groupEventsByKickoff,
  sortEventsForBrowse,
  type BrowsePriorityContext,
} from "../src/lib/browse-schedule";
import type { NormalizedEvent } from "../src/lib/odds/types";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function event(
  id: string,
  awayTeam: string,
  homeTeam: string,
  scheduledStart: string,
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    id,
    providerEventId: `provider-${id}`,
    sport: overrides.sport ?? "football",
    competitionId: overrides.competitionId ?? "ncaaf",
    competitionName: overrides.competitionName ?? "College Football",
    homeTeam,
    awayTeam,
    scheduledStart,
    status: overrides.status ?? "scheduled",
    providerSportKey: overrides.providerSportKey ?? "test",
    odds: overrides.odds ?? [],
  };
}

const rankingSnapshot: RankingSnapshot = {
  source: "ap",
  label: "AP Top 25",
  updatedAt: "2026-09-20T20:00:00.000Z",
  entries: [
    { teamId: "ole_miss", rank: 4 },
    { teamId: "florida", rank: 21 },
    { teamId: "texas", rank: 10 },
    { teamId: "michigan", rank: 18 },
    { teamId: "georgia", rank: 2 },
  ],
};

const standingsSnapshot: LeagueStandingsSnapshot = {
  competitionId: "epl",
  source: "manual",
  label: "EPL standings",
  updatedAt: "2026-09-21T08:00:00.000Z",
  entries: [
    { teamId: "arsenal", position: 1 },
    { teamId: "liverpool", position: 2 },
    { teamId: "manchester_city", position: 3 },
    { teamId: "chelsea", position: 4 },
    { teamId: "tottenham_hotspur", position: 6 },
    { teamId: "everton", position: 14 },
  ],
};

const ncaafContext: BrowsePriorityContext = { rankingSnapshot };

describe("v0.15.0 Browse Odds schedule", () => {
  it("uses display-timezone calendar dates instead of slicing UTC timestamps", () => {
    expect(getLocalDateKey("2026-09-24T00:30:00.000Z", "America/New_York")).toBe("2026-09-23");
    expect(getLocalDateKey("2026-09-24T04:30:00.000Z", "America/New_York")).toBe("2026-09-24");

    const events = [
      event("late", "Texas", "Oklahoma", "2026-09-24T04:30:00.000Z"),
      event("early", "Ole Miss", "Florida", "2026-09-24T00:30:00.000Z"),
    ];
    expect(availableBrowseDates(events, "America/New_York")).toEqual(["2026-09-23", "2026-09-24"]);
    expect(filterEventsForBrowseDate(events, "2026-09-23", "America/New_York")).toEqual([
      events[1],
    ]);
  });

  it("defaults to today when relevant, otherwise the nearest upcoming date", () => {
    const now = new Date("2026-09-23T16:00:00.000Z");
    const events = [
      event("completed-today", "Texas", "Oklahoma", "2026-09-23T12:00:00.000Z", {
        status: "completed",
      }),
      event("tomorrow", "Ole Miss", "Florida", "2026-09-24T16:00:00.000Z"),
    ];
    expect(getDefaultBrowseDate(events, "America/New_York", now)).toBe("2026-09-24");

    events.push(
      event("live-today", "Georgia", "Alabama", "2026-09-23T15:00:00.000Z", { status: "live" }),
    );
    expect(getDefaultBrowseDate(events, "America/New_York", now)).toBe("2026-09-23");
  });

  it("groups events chronologically by local kickoff time", () => {
    const events = [
      event("evening", "Texas", "Oklahoma", "2026-09-25T23:00:00.000Z"),
      event("noon-2", "Florida State", "Tulane", "2026-09-25T16:00:00.000Z"),
      event("noon-1", "Ole Miss", "Florida", "2026-09-25T16:00:00.000Z"),
    ];
    const groups = groupEventsByKickoff(events, "America/New_York", ncaafContext);
    expect(groups.map((group) => group.label)).toEqual(["12:00 PM", "7:00 PM"]);
    expect(groups[0]?.events.map(({ id }) => id)).toEqual(["noon-1", "noon-2"]);
  });

  it("applies the NCAAF hierarchy inside a shared kickoff bucket", () => {
    const events = [
      event("nonconference", "Florida State", "Tulane", "2026-09-26T16:00:00.000Z"),
      event("conference", "Alabama", "Auburn", "2026-09-26T16:00:00.000Z"),
      event("ranked-unranked", "Georgia", "Vanderbilt", "2026-09-26T16:00:00.000Z"),
      event("ranked-ranked-28", "Texas", "Michigan", "2026-09-26T16:00:00.000Z"),
      event("ranked-ranked-25", "Ole Miss", "Florida", "2026-09-26T16:00:00.000Z"),
    ];
    expect(
      sortEventsForBrowse(events, "America/New_York", ncaafContext).map(({ id }) => id),
    ).toEqual([
      "ranked-ranked-25",
      "ranked-ranked-28",
      "ranked-unranked",
      "conference",
      "nonconference",
    ]);
  });

  it("uses rivalry and record context only after the major NCAAF level", () => {
    const events = [
      event("non-rival", "Florida", "Tulane", "2026-09-26T16:00:00.000Z"),
      event("rival", "Florida", "Florida State", "2026-09-26T16:00:00.000Z"),
    ];
    const ordered = sortEventsForBrowse(events, "America/New_York", { rankingSnapshot: null });
    expect(ordered.map(({ id }) => id)).toEqual(["rival", "non-rival"]);
  });

  it("has a deterministic canonical-id tie breaker", () => {
    const events = [
      event("b", "Rice", "Tulane", "2026-09-26T16:00:00.000Z"),
      event("a", "Rice", "Tulane", "2026-09-26T16:00:00.000Z"),
    ];
    expect(sortEventsForBrowse(events, "America/New_York").map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("prioritizes a stronger domestic-soccer matchup without crossing kickoff groups", () => {
    const context = { standingsSnapshot };
    const early = event("early", "West Ham", "Everton", "2026-09-26T15:00:00.000Z", {
      competitionId: "epl",
      competitionName: "Premier League",
      sport: "soccer",
    });
    const strong = event("strong", "Arsenal", "Manchester City", "2026-09-26T19:00:00.000Z", {
      competitionId: "epl",
      competitionName: "Premier League",
      sport: "soccer",
    });
    const ordered = sortEventsForBrowse([strong, early], "America/New_York", context);
    expect(ordered.map(({ id }) => id)).toEqual(["early", "strong"]);
  });

  it("marks at most one qualifying domestic-soccer matchup as marquee", () => {
    const candidates = [
      event("second", "Liverpool", "Chelsea", "2026-09-26T15:00:00.000Z", {
        competitionId: "epl",
        competitionName: "Premier League",
        sport: "soccer",
      }),
      event("first", "Arsenal", "Manchester City", "2026-09-26T15:00:00.000Z", {
        competitionId: "epl",
        competitionName: "Premier League",
        sport: "soccer",
      }),
    ];
    expect(getMarqueeEventIds(candidates, { standingsSnapshot })).toEqual(new Set(["first"]));
  });

  it("selects CFP only after a valid CFP snapshot exists and keeps unranked teams null", () => {
    const cfp: RankingSnapshot = {
      source: "cfp",
      label: "CFP",
      updatedAt: "2026-11-01T00:00:00.000Z",
      entries: [{ teamId: "texas", rank: 1 }],
    };
    const snapshots = { ...DEFAULT_RANKING_SNAPSHOTS, cfp };
    expect(getActiveRankingSnapshot(new Date("2026-10-01T00:00:00.000Z"), snapshots)?.source).toBe(
      "ap",
    );
    expect(getActiveRankingSnapshot(new Date("2026-11-02T00:00:00.000Z"), snapshots)?.source).toBe(
      "cfp",
    );
    expect(getTeamRanking("Florida State", rankingSnapshot)).toBeNull();
    expect(getTeamRanking("Ole Miss", rankingSnapshot)?.rank).toBe(4);
  });

  it("keeps the browse page schedule-first and the desktop rail coordinated", () => {
    const page = read("../src/app/sports/[competition]/page.tsx");
    const card = read("../src/components/browse-game-card.tsx");
    const controls = read("../src/components/browse-schedule-controls.tsx");
    const css = read("../src/app/globals.css");

    expect(page).toContain("BrowseScheduleControls");
    expect(page).toContain("groupEventsByKickoff");
    expect(page).toContain("activeEvent");
    const board = read("../src/components/browse-market-board.tsx");
    expect(page).toContain("BrowseMarketBoard");
    expect(board.match(/<OddsSelectionGrid/g)?.length).toBe(1);
    expect(controls).toContain("htmlFor={`browse-date-${competitionId}`}");
    expect(controls).toContain("Jump to game");
    expect(controls).toContain("browse-jump-${competitionId}");
    expect(card).toContain("#{team.rank}");
    expect(card).not.toContain("NR");
    expect(css).toContain(".sportsbook-layout > .bet-slip-stack");
    expect(css).toContain("height: min(72rem, calc(100dvh - var(--desktop-header-offset) - 1rem))");
    expect(css).toContain("overflow-y: auto");
  });
});
