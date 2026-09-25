import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getPendingSlipSnapshot,
  getStraightSlipSnapshot,
  setPendingSlipSelections,
  setStraightSlipSelections,
  type SlipSelection,
} from "../src/lib/wagers/slip";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function selection(eventId: string): SlipSelection {
  return {
    clientSelectionId: `v0151-navigation-${eventId}`,
    competitionKey: "epl",
    eventId,
    sport: "soccer",
    competition: "Premier League",
    event: `${eventId} away at home`,
    scheduledStart: "2099-09-17T23:30:00Z",
    homeTeam: "Home",
    awayTeam: eventId,
    bookmakerId: "fanduel",
    bookmaker: "FanDuel",
    marketType: "moneyline",
    selection: "away",
    selectionName: eventId,
    line: null,
    americanOdds: -110,
    decimalOdds: 1.9091,
  };
}

describe("v0.15.1 active-event and Bet Slip separation", () => {
  it("keeps straight selections while navigating A to B, adding B, and returning to A", () => {
    const eventA = selection("brentford");
    const eventB = selection("brighton");
    let activeEventId = eventA.eventId;

    setStraightSlipSelections([]);
    setStraightSlipSelections([eventA]);
    expect(getStraightSlipSnapshot().map(({ eventId }) => eventId)).toEqual([eventA.eventId]);

    activeEventId = eventB.eventId;
    expect(activeEventId).toBe(eventB.eventId);
    expect(getStraightSlipSnapshot().map(({ eventId }) => eventId)).toEqual([eventA.eventId]);

    setStraightSlipSelections([...getStraightSlipSnapshot(), eventB]);
    expect(getStraightSlipSnapshot().map(({ eventId }) => eventId)).toEqual([
      eventA.eventId,
      eventB.eventId,
    ]);

    activeEventId = eventA.eventId;
    expect(activeEventId).toBe(eventA.eventId);
    expect(getStraightSlipSnapshot().map(({ eventId }) => eventId)).toEqual([
      eventA.eventId,
      eventB.eventId,
    ]);
  });

  it("keeps mobile pending selections while navigating between events", () => {
    const eventA = selection("brentford-mobile");
    const eventB = selection("brighton-mobile");

    setPendingSlipSelections([eventA]);
    expect(getPendingSlipSnapshot().map(({ eventId }) => eventId)).toEqual([eventA.eventId]);

    setPendingSlipSelections([...getPendingSlipSnapshot(), eventB]);
    expect(getPendingSlipSnapshot().map(({ eventId }) => eventId)).toEqual([
      eventA.eventId,
      eventB.eventId,
    ]);
  });

  it("hosts Bet Slip above query-driven Browse page navigation", () => {
    const host = read("../src/components/browse-bet-slip-host.tsx");
    const layout = read("../src/app/sports/[competition]/layout.tsx");
    const page = read("../src/app/sports/[competition]/page.tsx");
    const controls = read("../src/components/browse-schedule-controls.tsx");
    const browserSmoke = read("../scripts/check-browse-slip-navigation.mjs");
    const layoutSmoke = read("../scripts/check-browse-pane-layout.mjs");
    const css = read("../src/app/globals.css");

    expect(host).toContain("createPortal");
    expect(host).toContain("BROWSE_BET_SLIP_TARGET_ID");
    expect(host).toContain("BrowseBetSlipTarget");
    expect(host).toContain("targetRef.current = target");
    expect(host).toContain("registerTarget(target)");
    expect(host).toContain("if (target) context.setTarget(target)");
    expect(layout).toContain("BrowseBetSlipProvider");
    expect(page).toContain("BrowseBetSlipBridge");
    expect(page).toContain("<BrowseBetSlipTarget />");
    expect(browserSmoke).toContain("page.goto(`${baseUrl}/sports/${competition}`");
    expect(browserSmoke).toContain("link.click()");
    expect(browserSmoke).toContain("selectOption(eventA)");
    expect(browserSmoke).toContain("Open Bet Slip, 1 pick");
    expect(layoutSmoke).toContain("documentScrollHeight");
    expect(layoutSmoke).toContain("games.scrollTop");
    expect(layoutSmoke).toContain("markets.scrollTop");
    expect(layoutSmoke).toContain("betSlip.scrollTop");
    expect(layoutSmoke).toContain("selected market header is outside the center pane viewport");
    expect(page).not.toContain("<BetSlip");
    expect(controls).toContain("browse-date-readable");
    expect(css).toContain(".browse-bet-slip-target");
    expect(css).toContain("minmax(15.5rem, 15.5rem)");
  });
});
