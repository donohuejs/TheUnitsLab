import { describe, expect, it } from "vitest";

import {
  getSlipSnapshot,
  getStraightSlipSnapshot,
  parseSlipSelections,
  removeSlipSelectionKeys,
  areMutuallyExclusiveSelections,
  assessParlayAvailability,
  getPendingSlipSnapshot,
  getClientSelectionId,
  removePendingSlipSelectionIdsAndPersist,
  replaceMutuallyExclusiveSelection,
  setPendingSlipSelections,
  setSlipSelections,
  setStraightSlipSelections,
  slipSelectionKey,
  type SlipSelection,
} from "../src/lib/wagers/slip";

const leg = (competitionKey: string, eventId: string): SlipSelection => ({
  clientSelectionId: `test-${eventId}`,
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

  it("keeps independent straight selections separate from the parlay slip", () => {
    const selections = [leg("ncaaf", "straight-one"), leg("epl", "straight-two")];

    setSlipSelections([selections[0]]);
    setStraightSlipSelections(selections);

    expect(getSlipSnapshot()).toEqual([selections[0]]);
    expect(getStraightSlipSnapshot()).toEqual(selections);
  });

  it.each([
    ["spread", "home", "away"],
    ["total", "over", "under"],
    ["moneyline", "home", "away"],
    ["moneyline", "home", "draw"],
    ["moneyline", "draw", "away"],
  ] as const)("recognizes opposite %s outcomes as a replacement", (marketType, left, right) => {
    expect(
      areMutuallyExclusiveSelections(
        { eventId: "same-event", marketType, selection: left },
        { eventId: "same-event", marketType, selection: right },
      ),
    ).toBe(true);
  });

  it("does not classify a same-event different-market selection as a replacement", () => {
    expect(
      areMutuallyExclusiveSelections(
        { eventId: "same-event", marketType: "spread", selection: "home" },
        { eventId: "same-event", marketType: "total", selection: "over" },
      ),
    ).toBe(false);
  });

  it("replaces exactly one existing mutually exclusive leg in persistent-order state", () => {
    const first = { ...leg("ncaaf", "replace-event"), selection: "home" as const };
    const other = leg("nfl", "other-event");
    const replacement = { ...first, selection: "away" as const, selectionName: "Away" };
    expect(replaceMutuallyExclusiveSelection([first, other], replacement)).toEqual([
      replacement,
      other,
    ]);
    expect(
      replaceMutuallyExclusiveSelection([first], {
        ...first,
        marketType: "total",
        selection: "over",
        line: 45.5,
      }),
    ).toBeNull();
  });

  it("keeps same-event different-market and mixed-book picks as independent selections", () => {
    const moneyline = { ...leg("ncaaf", "same-event"), bookmakerId: "fanduel" };
    const spread = {
      ...moneyline,
      clientSelectionId: "same-event-spread",
      marketType: "spread" as const,
      selection: "home" as const,
      line: -7.5,
    };
    const differentBook = {
      ...leg("ncaaf", "other-event"),
      clientSelectionId: "other-event-draftkings",
      bookmakerId: "draftkings",
    };
    expect(assessParlayAvailability([moneyline, spread])).toMatchObject({ eligible: false });
    expect(assessParlayAvailability([moneyline, differentBook])).toMatchObject({ eligible: false });
    setPendingSlipSelections([moneyline, spread, differentBook]);
    expect(getPendingSlipSnapshot()).toHaveLength(3);
  });

  it("assigns and persists a client selection identity when a new pick is added", () => {
    const selection = { ...leg("ncaaf", "generated-id"), clientSelectionId: undefined };
    setPendingSlipSelections([selection]);
    const stored = getPendingSlipSnapshot()[0];
    expect(stored?.clientSelectionId).toBeTruthy();
    expect(JSON.stringify(stored)).toContain(stored?.clientSelectionId ?? "");
  });

  it.each([0, 1, 2])("removes exact stable leg identity at position %s", (index) => {
    const selections = [leg("ncaaf", "first"), leg("nfl", "middle"), leg("epl", "final")];
    setPendingSlipSelections(selections);
    removePendingSlipSelectionIdsAndPersist([getClientSelectionId(selections[index]!, index)]);
    expect(getPendingSlipSnapshot().map((selection) => selection.eventId)).not.toContain(
      selections[index]!.eventId,
    );
    expect(getPendingSlipSnapshot()).toHaveLength(2);
  });
});
