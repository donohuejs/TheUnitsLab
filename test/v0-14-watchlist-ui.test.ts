import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { primaryNavigation } from "@/lib/navigation";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("v0.14 Watchlist UI contract", () => {
  it("includes Watchlist in shared desktop and mobile navigation", () => {
    const index = primaryNavigation.findIndex((item) => item.key === "watchlist");
    expect(index).toBeGreaterThan(0);
    expect(primaryNavigation[index]?.href).toBe("/watchlist");
    expect(read("../src/components/app-nav.tsx")).toContain("primaryNavigation");
    expect(read("../src/components/mobile-nav.tsx")).toContain("navigation.map");
  });

  it("offers a distinct watch action only for eligible pregame base markets", () => {
    const grid = read("../src/components/odds-selection-grid.tsx");
    expect(grid).toContain("!odd.eventStarted && !odd.isAlternate");
    expect(grid).toContain("action={watchOdds}");
    expect(grid).toContain("☆ Watch Odds");
    expect(grid).toContain("★ Watching");
  });

  it("opens the normal sportsbook slip against current odds without a watched line", () => {
    const page = read("../src/app/watchlist/page.tsx");
    expect(page).toContain("Add Current Odds to Bet Slip");
    expect(page).toContain("market: watch.marketType");
    expect(page).toContain("selection: watch.selection");
    expect(page).not.toContain("point: watch.initialLine");
    expect(page).toContain("watch.currentAvailable && currentPrice !== undefined");
    expect(page).not.toContain("getCompetitionOdds(");
  });

  it("keeps current odds available if optional Watchlist reads fail", () => {
    const sportsbook = read("../src/app/sports/[competition]/page.tsx");
    const grid = read("../src/components/odds-selection-grid.tsx");
    const watchlist = read("../src/app/watchlist/page.tsx");

    expect(sportsbook).toContain("continuing to render current odds");
    expect(sportsbook).toContain("Watchlist status is temporarily unavailable");
    expect(sportsbook).toContain("watchlistAvailable={!watchlistUnavailable}");
    expect(grid).toContain("watchlistAvailable && !odd.eventStarted && !odd.isAlternate");
    expect(watchlist).toContain("Watchlist data could not be loaded.");
  });
});
