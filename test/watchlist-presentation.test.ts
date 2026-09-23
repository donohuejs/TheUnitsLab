import { describe, expect, it } from "vitest";

import { americanPrice, lineLabel, movementSummary } from "@/lib/watchlist/presentation";

describe("watchlist movement presentation", () => {
  it("reports line and price changes independently", () => {
    expect(movementSummary(-7.5, -6.5, lineLabel)).toBe("-7.5 → -6.5");
    expect(movementSummary(-110, -115, americanPrice)).toBe("-110 → -115");
    expect(movementSummary<number | null>(null, undefined, lineLabel)).toBe(
      "Current price unavailable",
    );
  });

  it("does not invent movement when the observed value is unchanged", () => {
    expect(movementSummary(-145, -145, americanPrice)).toBe("No change");
    expect(movementSummary(51.5, 51.5, lineLabel)).toBe("No change");
    expect(movementSummary<number | null>(null, null, lineLabel)).toBe("No change");
  });
});
