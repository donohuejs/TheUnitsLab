import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearStraightSlip,
  getSlipDiagnosticsSnapshot,
  getStraightSlipSnapshot,
  setSlipDiagnosticsEnabled,
  setStraightSlipSelections,
  type SlipSelection,
} from "../src/lib/wagers/slip";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function selection(eventId: string): SlipSelection {
  return {
    clientSelectionId: `v0151-diagnostics-${eventId}`,
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

describe("v0.15.1 isolated Bet Slip diagnostics", () => {
  beforeEach(() => {
    setSlipDiagnosticsEnabled(false);
    clearStraightSlip();
  });

  afterEach(() => {
    setSlipDiagnosticsEnabled(false);
    clearStraightSlip();
  });

  it("keeps diagnostics disabled without changing straight-slip behavior", () => {
    const beforeMutationCount = getSlipDiagnosticsSnapshot().recentMutations.length;
    const event = selection("diagnostic-disabled");

    setStraightSlipSelections([event]);

    expect(getStraightSlipSnapshot().map(({ eventId }) => eventId)).toEqual([event.eventId]);
    expect(getSlipDiagnosticsSnapshot().recentMutations.length).toBe(beforeMutationCount);
  });

  it("records the durable store separately from the visible selection source", () => {
    setSlipDiagnosticsEnabled(true);
    const eventA = selection("diagnostic-a");
    const eventB = selection("diagnostic-b");

    setStraightSlipSelections([eventA, eventB]);

    const diagnostics = getSlipDiagnosticsSnapshot();
    expect(diagnostics.enabled).toBe(true);
    expect(diagnostics.durableStraight.map(({ eventId }) => eventId)).toEqual([
      eventA.eventId,
      eventB.eventId,
    ]);
    expect(diagnostics.recentMutations.at(-1)).toMatchObject({
      action: "ADD",
      beforeCount: 0,
      afterCount: 2,
      afterEventIds: [eventA.eventId, eventB.eventId],
    });
    expect(getStraightSlipSnapshot().map(({ eventId }) => eventId)).toEqual([
      eventA.eventId,
      eventB.eventId,
    ]);
  });

  it("keeps only the most recent twenty mutation records", () => {
    setSlipDiagnosticsEnabled(true);

    for (let index = 0; index < 25; index += 1) {
      setStraightSlipSelections([selection(`diagnostic-${index}`)]);
    }

    const recentMutations = getSlipDiagnosticsSnapshot().recentMutations;
    expect(recentMutations).toHaveLength(20);
    expect(recentMutations.at(-1)?.afterEventIds).toEqual(["diagnostic-24"]);
    expect(recentMutations.every(({ timestamp }) => timestamp.length > 0)).toBe(true);
  });

  it("keeps diagnostics local to the Bet Slip component", () => {
    const betSlip = read("../src/components/bet-slip.tsx");
    const page = read("../src/app/sports/[competition]/page.tsx");
    const host = read("../src/components/browse-bet-slip-host.tsx");
    const controls = read("../src/components/browse-schedule-controls.tsx");

    expect(betSlip).toContain('data-testid="bet-slip-diagnostics"');
    expect(betSlip).toContain("getSlipDiagnosticsSnapshot");
    expect(page).not.toContain("getSlipDiagnostics");
    expect(page).not.toContain("debugSlip");
    expect(host).not.toContain("getSlipDiagnostics");
    expect(host).not.toContain("debugSlip");
    expect(controls).not.toContain("getSlipDiagnostics");
    expect(controls).not.toContain("debugSlip");
  });
});
