import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeBrowseTimeZone } from "../src/lib/browse-schedule";
import {
  filterEventsForBrowseDate,
  formatBrowseTime,
  getLocalDateKey,
  groupEventsByKickoff,
} from "../src/lib/browse-schedule";
import type { NormalizedEvent } from "../src/lib/odds/types";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const eastern = "America/New_York";

function event(id: string, scheduledStart: string): NormalizedEvent {
  return {
    id,
    providerEventId: `provider-${id}`,
    sport: "football",
    competitionId: "ncaaf",
    competitionName: "College Football",
    homeTeam: "Home",
    awayTeam: "Away",
    scheduledStart,
    status: "scheduled",
    providerSportKey: "americanfootball_ncaaf",
    odds: [],
  };
}

describe("v0.15.1 Browse Odds corrections", () => {
  it("keeps the exact Eastern-time regression events on their intended date and bucket", () => {
    const northwesternIndiana = event("northwestern-indiana", "2026-09-26T00:00:00.000Z");
    const clemsonCalifornia = event("clemson-california", "2026-09-26T02:30:00.000Z");
    const texasTennessee = event("texas-tennessee", "2026-09-26T16:00:00.000Z");
    const events = [northwesternIndiana, clemsonCalifornia, texasTennessee];

    expect(getLocalDateKey(northwesternIndiana.scheduledStart, eastern)).toBe("2026-09-25");
    expect(getLocalDateKey(clemsonCalifornia.scheduledStart, eastern)).toBe("2026-09-25");
    expect(getLocalDateKey(texasTennessee.scheduledStart, eastern)).toBe("2026-09-26");
    expect(formatBrowseTime(northwesternIndiana.scheduledStart, eastern)).toBe("8:00 PM");
    expect(formatBrowseTime(clemsonCalifornia.scheduledStart, eastern)).toBe("10:30 PM");
    expect(formatBrowseTime(texasTennessee.scheduledStart, eastern)).toBe("12:00 PM");

    expect(filterEventsForBrowseDate(events, "2026-09-25", eastern).map(({ id }) => id)).toEqual([
      "northwestern-indiana",
      "clemson-california",
    ]);
    expect(filterEventsForBrowseDate(events, "2026-09-26", eastern).map(({ id }) => id)).toEqual([
      "texas-tennessee",
    ]);
    expect(groupEventsByKickoff(events.slice(2), eastern)[0]?.label).toBe("12:00 PM");
  });

  it("handles the spring DST boundary without manual offset arithmetic", () => {
    const before = event("before-dst", "2026-03-08T06:30:00.000Z");
    const after = event("after-dst", "2026-03-08T07:30:00.000Z");

    expect(getLocalDateKey(before.scheduledStart, eastern)).toBe("2026-03-08");
    expect(getLocalDateKey(after.scheduledStart, eastern)).toBe("2026-03-08");
    expect(formatBrowseTime(before.scheduledStart, eastern)).toBe("1:30 AM");
    expect(formatBrowseTime(after.scheduledStart, eastern)).toBe("3:30 AM");
  });

  it("uses the established Eastern browse fallback while preserving an explicit profile zone", () => {
    expect(normalizeBrowseTimeZone()).toBe(eastern);
    expect(normalizeBrowseTimeZone("UTC")).toBe(eastern);
    expect(normalizeBrowseTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(normalizeBrowseTimeZone("not/a-zone")).toBe(eastern);
  });

  it("does not auto-open a game and uses a master/detail desktop contract", () => {
    const page = read("../src/app/sports/[competition]/page.tsx");
    const controls = read("../src/components/browse-schedule-controls.tsx");
    const card = read("../src/components/browse-game-card.tsx");
    const grid = read("../src/components/odds-selection-grid.tsx");
    const css = read("../src/app/globals.css");

    expect(page).toContain("const activeEvent = requestedActiveEvent;");
    expect(page).not.toContain("orderedEvents[0]");
    expect(page).toContain("browse-games-rail");
    expect(page).toContain("browse-market-detail");
    expect(controls).toContain("Select a matchup...");
    expect(controls).toContain("if (value) changes.event = value");
    expect(card).toContain("browse-game-mobile-board");
    expect(grid).toContain("watchlistAvailable?: boolean");
    expect(grid).toContain("watchlistAvailable && !odd.eventStarted && !odd.isAlternate");
    expect(css).toContain("minmax(17rem, 20rem) minmax(0, 1fr) minmax(20rem, 23rem)");
    expect(css).toContain(".browse-market-detail");
  });
});
