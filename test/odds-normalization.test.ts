import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { normalizeOddsResponse, americanToDecimal } from "../src/lib/odds/normalize";
import { canonicalRequestKey, createOddsRequest } from "../src/lib/odds/request";
import { parseQuotaHeaders, quotaState } from "../src/lib/odds/quota";

const fixture = JSON.parse(
  await readFile(new URL("fixtures/odds-epl.json", import.meta.url), "utf8"),
);

describe("Odds API normalization", () => {
  it("normalizes events, configured bookmakers, supported markets and prices", () => {
    const [event] = normalizeOddsResponse(fixture, "epl", "2026-09-12T12:01:00Z");
    expect(event).toMatchObject({
      id: "epl:event-1",
      providerEventId: "event-1",
      sport: "soccer",
      competitionId: "epl",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      status: "scheduled",
    });
    expect(event.odds).toHaveLength(7);
    expect(event.odds.map((odd) => odd.marketType)).toEqual(
      expect.arrayContaining(["moneyline", "spread", "total"]),
    );
    expect(event.odds.find((odd) => odd.selection === "draw")).toMatchObject({
      bookmakerId: "fanduel",
      americanOdds: 240,
      decimalOdds: 3.4,
    });
    expect(event.odds.some((odd) => odd.bookmakerId === "unconfigured_book")).toBe(false);
    expect(americanToDecimal(-110)).toBe(1.9091);
  });

  it("maps every initial competition to one stable provider key and canonical request", () => {
    const keys = (["epl", "ucl", "ncaaf", "ncaab"] as const).map((id) => createOddsRequest(id));
    expect(keys.map((item) => item.providerSportKey)).toEqual([
      "soccer_epl",
      "soccer_uefa_champs_league",
      "americanfootball_ncaaf",
      "basketball_ncaab",
    ]);
    expect(new Set(keys.map(canonicalRequestKey))).toHaveLength(4);
    expect(keys[0].bookmakers).toEqual(["betmgm", "draftkings", "fanduel"]);
  });
});

describe("quota metadata", () => {
  it("parses valid provider headers and preserves missing metadata as unknown", () => {
    expect(
      parseQuotaHeaders(
        new Headers({
          "x-requests-used": "71",
          "x-requests-remaining": "429",
          "x-requests-last": "3",
        }),
      ),
    ).toEqual({ used: 71, remaining: 429, lastRequestCost: 3 });
    expect(parseQuotaHeaders(new Headers())).toEqual({
      used: null,
      remaining: null,
      lastRequestCost: null,
    });
  });

  it("applies all governing quota transitions", () => {
    expect([0, 349, 350, 424, 425, 474, 475, 500].map((used) => quotaState(used, 500))).toEqual([
      "normal",
      "normal",
      "conserve",
      "conserve",
      "high",
      "high",
      "critical",
      "critical",
    ]);
  });
});
