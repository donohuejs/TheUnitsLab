import { describe, expect, it } from "vitest";

import { firstObservedQuote, latestPregameQuote, quoteAtWagerTime } from "../src/lib/odds/history";

const quotes = [
  {
    line: -2.5,
    americanOdds: -110,
    decimalOdds: 1.9091,
    firstSeenAt: "2026-09-28T08:00:00Z",
    lastSeenAt: "2026-09-28T09:00:00Z",
    isPregame: true,
  },
  {
    line: -3.5,
    americanOdds: -105,
    decimalOdds: 1.9524,
    firstSeenAt: "2026-09-28T09:00:01Z",
    lastSeenAt: "2026-09-28T11:59:59Z",
    isPregame: true,
  },
  {
    line: -3.5,
    americanOdds: -115,
    decimalOdds: 1.8696,
    firstSeenAt: "2026-09-28T12:00:00Z",
    lastSeenAt: "2026-09-28T13:00:00Z",
    isPregame: false,
  },
];

describe("odds history semantics", () => {
  it("keeps first observed and latest pregame quotes deterministic", () => {
    expect(firstObservedQuote(quotes)?.line).toBe(-2.5);
    expect(latestPregameQuote(quotes, "2026-09-28T12:00:00Z")?.americanOdds).toBe(-105);
  });

  it("resolves the quote active when a wager was created", () => {
    expect(quoteAtWagerTime(quotes, "2026-09-28T10:00:00Z")?.line).toBe(-3.5);
    expect(quoteAtWagerTime(quotes, "2026-09-28T07:00:00Z")).toBeNull();
  });

  it("does not use a post-start quote as a pregame close", () => {
    expect(latestPregameQuote(quotes, "2026-09-28T13:00:00Z")?.americanOdds).toBe(-105);
  });
});
