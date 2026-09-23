import { describe, expect, it } from "vitest";

import {
  displayLabel,
  importedSourceLabel,
  marketLabel,
  PRODUCT_NAME,
  PRODUCT_SUBTITLE,
  sourceLabel,
  ticketTypeLabel,
  welcomeName,
} from "../src/lib/ui";
import { normalizeUsdToVials, USD_PER_VIAL } from "../src/lib/vials";
import { primaryNavigation } from "../src/lib/navigation";

describe("shared product presentation", () => {
  it("uses the approved product name", () => {
    expect(PRODUCT_NAME).toBe("The Units Lab");
    expect(PRODUCT_SUBTITLE).toBe("Experiment | Analyze | Improve");
    expect(welcomeName(" ")).toBe("Scientist");
    expect(welcomeName("Ada")).toBe("Ada");
  });

  it("keeps the primary navigation in the signed-in information architecture", () => {
    expect(primaryNavigation.map((item) => item.key)).toEqual([
      "sports",
      "my-bets",
      "watchlist",
      "import-betslip",
      "performance",
      "leaderboards",
      "account",
    ]);
  });

  it("uses explicit labels for wager source and ticket type", () => {
    expect(sourceLabel("simulated")).toBe("Simulated");
    expect(sourceLabel("external")).toBe("Imported");
    expect(importedSourceLabel("FanDuel")).toBe("Imported · FanDuel");
    expect(importedSourceLabel()).toBe("Imported · Other");
    expect(ticketTypeLabel("straight")).toBe("Straight");
    expect(ticketTypeLabel("parlay")).toBe("Parlay");
  });

  it("uses readable status and market labels rather than storage values", () => {
    expect(displayLabel("push")).toBe("Push");
    expect(displayLabel("user_attested")).toBe("User attested");
    expect(marketLabel("moneyline")).toBe("Moneyline");
    expect(marketLabel("total")).toBe("Total");
  });

  it("normalizes source dollars to Vials with fixed precision", () => {
    expect(USD_PER_VIAL).toBe("1.00");
    expect(normalizeUsdToVials("50")).toBe("50.00");
    expect(normalizeUsdToVials("50.25")).toBe("50.25");
  });
});
