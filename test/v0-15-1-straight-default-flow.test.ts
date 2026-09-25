import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import {
  assessParlayAvailability,
  clearSlip,
  clearStraightSlip,
  getSlipSnapshot,
  getStraightSlipSnapshot,
  setSlipSelections,
  setStraightSlipSelections,
  type SlipSelection,
} from "../src/lib/wagers/slip";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function selection(eventId: string, overrides: Partial<SlipSelection> = {}): SlipSelection {
  return {
    clientSelectionId: `v0151-straight-${eventId}`,
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
    ...overrides,
  };
}

describe("v0.15.1 direct straight-bet workflow", () => {
  beforeEach(() => {
    clearSlip();
    clearStraightSlip();
  });

  it("persists a price click immediately and keeps it through event navigation", () => {
    const brentford = selection("brentford");
    const brighton = selection("brighton");

    setStraightSlipSelections([brentford]);
    expect(getStraightSlipSnapshot().map(({ eventId }) => eventId)).toEqual(["brentford"]);

    setStraightSlipSelections([brentford, brighton]);
    expect(getStraightSlipSnapshot().map(({ eventId }) => eventId)).toEqual([
      "brentford",
      "brighton",
    ]);
  });

  it("builds an explicit parlay from selected straights without removing them", () => {
    const brentford = selection("brentford");
    const brighton = selection("brighton");

    setStraightSlipSelections([brentford, brighton]);
    expect(assessParlayAvailability([brentford, brighton]).eligible).toBe(true);
    setSlipSelections([brentford, brighton]);

    expect(getStraightSlipSnapshot()).toEqual([brentford, brighton]);
    expect(getSlipSnapshot()).toEqual([brentford, brighton]);
  });

  it("keeps invalid parlay combinations blocked while straights remain intact", () => {
    const sameEventA = selection("same-event", { selectionName: "Home" });
    const sameEventB = selection("same-event", {
      selection: "draw",
      selectionName: "Draw",
      clientSelectionId: "v0151-straight-same-event-draw",
    });

    setStraightSlipSelections([sameEventA, sameEventB]);
    expect(assessParlayAvailability([sameEventA, sameEventB])).toMatchObject({ eligible: false });
    expect(getStraightSlipSnapshot()).toEqual([sameEventA, sameEventB]);
    expect(getSlipSnapshot()).toEqual([]);
  });

  it("does not duplicate a repeated straight selection", () => {
    const brentford = selection("brentford");

    setStraightSlipSelections([brentford]);
    setStraightSlipSelections([brentford]);

    expect(getStraightSlipSnapshot()).toEqual([brentford]);
  });

  it("removes the old confirmation workflow while preserving explicit parlay controls", () => {
    const betSlip = read("../src/components/bet-slip.tsx");
    const oddsGrid = read("../src/components/odds-selection-grid.tsx");

    expect(betSlip).toContain("reconcileActiveStraightSelection");
    expect(betSlip).toContain("Add selected bets to parlay");
    expect(betSlip).toContain("setSlipSelections(selectedParlaySelections)");
    expect(betSlip).not.toContain("Add to straight bets");
    expect(betSlip).not.toContain("Straight bet — one leg");
    expect(betSlip).not.toContain("setPendingSlipSelections");
    expect(oddsGrid).toContain("Add to Bet Slip");
    expect(oddsGrid).toContain("Added to Bet Slip");
  });
});
