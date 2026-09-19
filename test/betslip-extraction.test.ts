import { describe, expect, it } from "vitest";

import {
  parseBetslipText,
  shouldUseVisionFallback,
  visionDraftToBetslipDraft,
} from "../src/lib/betslip/extraction";

describe("local betslip text extraction", () => {
  it("normalizes common sportsbook receipt labels into a review draft", () => {
    const result = parseBetslipText(`
      DraftKings
      Bet ID: DK-ABC123
      Detroit Lions vs Buffalo Bills
      Moneyline
      Buffalo Bills -110
      Stake: $25.00
      Payout: $47.73
      Game time: 09/18/2026 8:20 PM
      Placed: 09/17/2026 7:42 PM
    `);

    expect(result.ticketType).toBe("straight");
    expect(result.fields).toMatchObject({
      sportsbookId: "draftkings",
      sportsbookBetId: "DK-ABC123",
      eventDescription: "Detroit Lions at Buffalo Bills",
      selection: "Buffalo Bills",
      marketType: "moneyline",
      americanOdds: "-110",
      stakeDollars: "25.00",
      returnDollars: "47.73",
    });
    expect(result.uncertainFields).not.toContain("sportsbook");
  });

  it("returns a partial draft and uncertainty flags instead of inventing values", () => {
    const result = parseBetslipText("FanDuel\nMoneyline\nBuffalo Bills -115");

    expect(result.fields.sportsbookId).toBe("fanduel");
    expect(result.fields.americanOdds).toBe("-115");
    expect(result.uncertainFields).toEqual(
      expect.arrayContaining(["event", "event date", "stake", "payout"]),
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("identifies a parlay and returns probable legs for review", () => {
    const result = parseBetslipText(`
      DraftKings
      Same Game Parlay
      Buffalo Bills at Detroit Lions -110
      Kansas City Chiefs at Las Vegas Raiders +125
      Stake: $10.00
    `);

    expect(result.ticketType).toBe("parlay");
    expect(result.parlayLegs).toEqual([
      {
        eventDescription: "Buffalo Bills at Detroit Lions",
        selection: "Buffalo Bills",
        americanOdds: "-110",
      },
      {
        eventDescription: "Kansas City Chiefs at Las Vegas Raiders",
        selection: "Kansas City Chiefs",
        americanOdds: "+125",
      },
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("2 probable legs were extracted")]),
    );
  });

  it("keeps explicitly numbered parlay legs associated with their own pick and odds", () => {
    const result = parseBetslipText(`
      DraftKings
      Parlay
      Leg 1
      Hoffenheim
      Moneyline (3-way)
      -350
      Leg 2
      Crystal Palace
      Moneyline (3-way)
      -340
      Leg 3
      Juventus
      Moneyline (3-way)
      -750
      Combined odds: -113
      Stake: $12.00
    `);

    expect(result.ticketType).toBe("parlay");
    expect(result.fields.americanOdds).toBe("-113");
    expect(result.parlayLegs).toEqual([
      { eventDescription: "Hoffenheim", selection: "Hoffenheim", americanOdds: "-350" },
      {
        eventDescription: "Crystal Palace",
        selection: "Crystal Palace",
        americanOdds: "-340",
      },
      { eventDescription: "Juventus", selection: "Juventus", americanOdds: "-750" },
    ]);
  });

  it("recovers the prominent fields from a FanDuel-style straight receipt", () => {
    const result = parseBetslipText(`
      FanDuel
      Rutgers @ Boston College
      Alternate Spread
      Boston College -2.5 -170
      Stake: $8.00
      Total Return: $12.71
      Sep 11, 7:30 PM ET
    `);

    expect(result.ticketType).toBe("straight");
    expect(result.fields).toMatchObject({
      sportsbookId: "fanduel",
      eventDescription: "Rutgers at Boston College",
      selection: "Boston College",
      marketType: "spread",
      line: "-2.5",
      americanOdds: "-170",
      stakeDollars: "8.00",
      returnDollars: "12.71",
    });
    expect(result.fields.eventDate).toBeTruthy();
    expect(result.uncertainFields).not.toEqual(
      expect.arrayContaining(["sportsbook", "event", "odds", "stake", "payout"]),
    );
  });

  it("does not escalate a complete local draft or escalate only because stake is absent", () => {
    const complete = parseBetslipText(`
      FanDuel
      Rutgers @ Boston College
      Alternate Spread
      Boston College -2.5 -170
      Stake: $8.00
      Total Return: $12.71
      Sep 11, 7:30 PM ET
    `);
    const noStake = parseBetslipText(`
      FanDuel
      Rutgers @ Boston College
      Alternate Spread
      Boston College -2.5 -170
      Total Return: $12.71
      Sep 11, 7:30 PM ET
    `);

    expect(shouldUseVisionFallback(complete)).toBe(false);
    expect(shouldUseVisionFallback(noStake)).toBe(false);
    expect(noStake.uncertainFields).toContain("stake");
  });

  it("escalates an ambiguous draft and keeps vision legs atomic", () => {
    const local = parseBetslipText("FanDuel\nParlay\n-350\n-340");
    expect(shouldUseVisionFallback(local)).toBe(true);

    const vision = visionDraftToBetslipDraft({
      ticketType: "parlay",
      sportsbook: "FanDuel",
      sportsbookBetId: null,
      wagerDateText: null,
      stake: null,
      totalReturn: null,
      combinedAmericanOdds: "-113",
      legs: [
        {
          eventText: "Hoffenheim vs Mainz",
          eventDateText: "Sep 18, 2026 12:30 PM ET",
          market: "moneyline",
          selectionText: "Hoffenheim",
          line: null,
          americanOdds: "-350",
        },
        {
          eventText: "Crystal Palace vs Juventus",
          eventDateText: "Sep 18, 2026 3:00 PM ET",
          market: "moneyline",
          selectionText: "Crystal Palace",
          line: null,
          americanOdds: "-340",
        },
      ],
    });
    expect(vision.parlayLegs.map((leg) => [leg.selection, leg.americanOdds])).toEqual([
      ["Hoffenheim", "-350"],
      ["Crystal Palace", "-340"],
    ]);
    expect(vision.fields.americanOdds).toBe("-113");
  });

  it.each([
    ["Wake +21.5 with separate American odds", "+21.5", "-110"],
    ["negative line with negative odds", "-7.5", "-115"],
    ["positive line with negative odds", "+21.5", "-105"],
  ])("keeps %s line and price separate", (_label, line, odds) => {
    const result = visionDraftToBetslipDraft({
      ticketType: "straight",
      sportsbook: "FanDuel",
      sportsbookBetId: null,
      wagerDateText: null,
      stake: "10.00",
      totalReturn: "19.09",
      combinedAmericanOdds: line,
      legs: [
        {
          eventText: "Miami vs Wake Forest",
          eventDateText: "Sep 20, 2026 12:00 PM ET",
          market: "spread",
          selectionText: "Wake Forest",
          line,
          americanOdds: odds,
        },
      ],
    });
    expect(result.fields.line).toBe(line);
    expect(result.fields.americanOdds).toBe(odds);
    expect(result.parlayLegs[0]?.americanOdds).toBe(odds);
  });

  it("keeps a moneyline without a market line and preserves parlay leg prices", () => {
    const moneyline = visionDraftToBetslipDraft({
      ticketType: "straight",
      sportsbook: "DraftKings",
      sportsbookBetId: null,
      wagerDateText: null,
      stake: null,
      totalReturn: null,
      combinedAmericanOdds: "-125",
      legs: [
        {
          eventText: "Miami vs Wake Forest",
          eventDateText: null,
          market: "moneyline",
          selectionText: "Wake Forest",
          line: null,
          americanOdds: "-125",
        },
      ],
    });
    expect(moneyline.fields.line).toBe("");
    expect(moneyline.fields.americanOdds).toBe("-125");

    const parlay = visionDraftToBetslipDraft({
      ticketType: "parlay",
      sportsbook: "DraftKings",
      sportsbookBetId: null,
      wagerDateText: null,
      stake: null,
      totalReturn: null,
      combinedAmericanOdds: "+475",
      legs: [
        {
          eventText: "Miami vs Wake Forest",
          eventDateText: null,
          market: "spread",
          selectionText: "Wake Forest",
          line: "+21.5",
          americanOdds: "-110",
        },
        {
          eventText: "Georgia vs Arkansas",
          eventDateText: null,
          market: "moneyline",
          selectionText: "Georgia",
          line: null,
          americanOdds: "+105",
        },
      ],
    });
    expect(parlay.fields.americanOdds).toBe("+475");
    expect(parlay.parlayLegs.map((leg) => leg.americanOdds)).toEqual(["-110", "+105"]);
  });
});
