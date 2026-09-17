import { describe, expect, it } from "vitest";

import { parseBetslipText } from "../src/lib/betslip/extraction";

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
});
