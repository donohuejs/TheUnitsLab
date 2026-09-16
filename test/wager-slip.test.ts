import { describe, expect, it } from "vitest";

import {
  getSlipSnapshot,
  parseSlipSelections,
  removeSlipSelectionKeys,
  setSlipSelections,
  slipSelectionKey,
  type SlipSelection,
} from "../src/lib/wagers/slip";

const leg = (competitionKey: string, eventId: string): SlipSelection => ({
  competitionKey,
  eventId,
  sport: competitionKey === "epl" ? "soccer" : "football",
  competition: competitionKey.toUpperCase(),
  event: `${eventId} at home`,
  scheduledStart: "2099-09-17T23:30:00Z",
  homeTeam: "Home",
  awayTeam: "Away",
  bookmakerId: "fanduel",
  bookmaker: "FanDuel",
  marketType: "moneyline",
  selection: "home",
  selectionName: "Home",
  line: null,
  americanOdds: 110,
  decimalOdds: 2.1,
});

describe("persistent simulated parlay slip", () => {
  it("keeps mixed-sport selections intact across competition transitions", () => {
    const selections = [
      leg("ncaaf", "ncaaf-event"),
      leg("nfl", "nfl-event"),
      leg("epl", "epl-event"),
      leg("nhl", "nhl-event"),
    ];

    setSlipSelections(selections.slice(0, 1));
    setSlipSelections([...getSlipSnapshot(), selections[1]]);
    setSlipSelections([...getSlipSnapshot(), selections[2]]);
    setSlipSelections([...getSlipSnapshot(), selections[3]]);

    expect(getSlipSnapshot().map((selection) => selection.competitionKey)).toEqual([
      "ncaaf",
      "nfl",
      "epl",
      "nhl",
    ]);
    expect(parseSlipSelections(JSON.stringify(getSlipSnapshot()))).toEqual(selections);
  });

  it("supports remove-leg and clear-style updates without losing other legs", () => {
    const selections = [leg("ncaaf", "one"), leg("nfl", "two"), leg("epl", "three")];
    const removed = removeSlipSelectionKeys(selections, [slipSelectionKey(selections[1])]);

    expect(removed).toEqual([selections[0], selections[2]]);
    setSlipSelections([]);
    expect(getSlipSnapshot()).toEqual([]);
  });
});
