import { describe, expect, it } from "vitest";

import {
  displayLabel,
  marketLabel,
  PRODUCT_NAME,
  sourceLabel,
  ticketTypeLabel,
} from "../src/lib/ui";
import { primaryNavigation } from "../src/lib/navigation";

describe("shared product presentation", () => {
  it("uses the approved product name", () => {
    expect(PRODUCT_NAME).toBe("The Units Lab");
  });

  it("keeps the primary navigation in the signed-in information architecture", () => {
    expect(primaryNavigation.map((item) => item.key)).toEqual([
      "home",
      "sports",
      "my-bets",
      "track-bet",
      "performance",
      "leaderboards",
      "account",
    ]);
  });

  it("uses explicit labels for wager source and ticket type", () => {
    expect(sourceLabel("simulated")).toBe("Simulated");
    expect(sourceLabel("external")).toBe("IRL / external");
    expect(ticketTypeLabel("straight")).toBe("Straight");
    expect(ticketTypeLabel("parlay")).toBe("Parlay");
  });

  it("uses readable status and market labels rather than storage values", () => {
    expect(displayLabel("push")).toBe("Push");
    expect(displayLabel("user_attested")).toBe("User attested");
    expect(marketLabel("moneyline")).toBe("Moneyline");
    expect(marketLabel("total")).toBe("Total");
  });
});
