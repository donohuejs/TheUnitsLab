import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeBrowseTimeZone } from "../src/lib/browse-schedule";
import {
  filterEventsForBrowseDate,
  formatBrowseTime,
  getLocalDateKey,
  groupEventsByKickoff,
  shouldShowBrowseEventStatus,
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

  it("keeps ordinary scheduled cards quiet while preserving meaningful statuses", () => {
    expect(shouldShowBrowseEventStatus("scheduled")).toBe(false);
    expect(shouldShowBrowseEventStatus("live")).toBe(true);
    expect(shouldShowBrowseEventStatus("completed")).toBe(true);
    expect(shouldShowBrowseEventStatus("postponed")).toBe(true);
  });

  it("does not auto-open a game and uses a master/detail desktop contract", () => {
    const page = read("../src/app/sports/[competition]/page.tsx");
    const controls = read("../src/components/browse-schedule-controls.tsx");
    const filterSelect = read("../src/components/browse-filter-select.tsx");
    const card = read("../src/components/browse-game-card.tsx");
    const grid = read("../src/components/odds-selection-grid.tsx");
    const pane = read("../src/components/browse-market-pane.tsx");
    const gamesPane = read("../src/components/browse-games-pane.tsx");
    const css = read("../src/app/globals.css");

    expect(page).toContain("const activeEvent = requestedActiveEvent;");
    expect(page).not.toContain("orderedEvents[0]");
    expect(page).toContain("browse-games-rail");
    expect(page).toContain("browse-market-detail");
    expect(page).toContain("desktop-browse-filter-control");
    expect(page).toContain("mobile-browse-filter-control");
    expect(controls).toContain("Select a matchup...");
    expect(controls).toContain("if (value) changes.event = value");
    expect(controls).toContain("showPicker");
    expect(controls).toContain('aria-label={"Choose date, " + selectedDateLabel}');
    expect(filterSelect).toContain("useRouter");
    expect(filterSelect).toContain("BrowseFilterSelectOption");
    expect(card).toContain("browse-game-mobile-board");
    expect(card).toContain("browse-game-action-label");
    expect(card).toContain("aria-expanded={active}");
    expect(grid).toContain("watchlistAvailable?: boolean");
    expect(grid).toContain("watchlistAvailable && !odd.eventStarted && !odd.isAlternate");
    expect(grid).toContain("eventStatus");
    expect(grid).not.toContain("pregame price");
    expect(css).toContain("minmax(320px, 350px) minmax(500px, 1fr) minmax(330px, 360px)");
    expect(css).toContain(".browse-filter-select-control");
    expect(css).toContain(".browse-game-side");
    expect(css).toContain(".browse-game-action-label");
    expect(css).not.toContain("scrollbar-gutter: stable");
    expect(css).toContain(".browse-market-detail");
    expect(css).toContain(".browse-date-native-input");
    expect(css).toContain("height: min(72rem, calc(100dvh - var(--desktop-header-offset) - 1rem))");
    expect(page).toContain("<BrowseMarketPane activeEventId={selectedEvent?.id ?? null}>");
    expect(pane).toContain('scrollTo({ top: 0, behavior: "auto" })');
    expect(gamesPane).toContain("browse-games-scroll");
    expect(gamesPane).toContain("sessionStorage");
    expect(css).toContain(".browse-master-detail-layout > .browse-games-rail");
  });
});
