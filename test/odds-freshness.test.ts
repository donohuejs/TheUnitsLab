import { describe, expect, it } from "vitest";

import {
  adaptiveOddsFreshness,
  cacheIsHardExpired,
  policyForTests,
} from "../src/lib/odds/freshness";

const now = new Date("2026-09-28T12:00:00.000Z");
const event = (leadSeconds: number, status: "scheduled" | "live" | "completed" = "scheduled") => ({
  scheduledStart: new Date(now.getTime() + leadSeconds * 1000).toISOString(),
  status,
});

describe("adaptive odds freshness", () => {
  it.each([
    [8 * 24 * 60 * 60, "distant", 24 * 60 * 60],
    [7 * 24 * 60 * 60, "week", 6 * 60 * 60],
    [24 * 60 * 60, "day", 2 * 60 * 60],
    [6 * 60 * 60, "near", 30 * 60],
    [60 * 60, "imminent", 10 * 60],
    [59 * 60, "imminent", 10 * 60],
  ] as const)("selects the %s band at the exact boundary", (lead, band, ttl) => {
    const decision = adaptiveOddsFreshness([event(lead)], now);
    expect(decision.band).toBe(band);
    expect(decision.targetFreshnessSeconds).toBe(ttl);
    expect(decision.refreshAllowed).toBe(true);
  });

  it("uses the nearest upcoming event in a shared competition cache", () => {
    const decision = adaptiveOddsFreshness([event(8 * 24 * 60 * 60), event(2 * 60 * 60)], now);
    expect(decision.band).toBe("near");
    expect(decision.scheduledStart).toBe(event(2 * 60 * 60).scheduledStart);
  });

  it("stops refreshing when every event has started or is final", () => {
    const decision = adaptiveOddsFreshness(
      [
        { scheduledStart: "2026-09-28T11:00:00.000Z", status: "live" },
        { scheduledStart: "2026-09-27T11:00:00.000Z", status: "completed" },
      ],
      now,
    );
    expect(decision).toMatchObject({ band: "started", refreshAllowed: false });
  });

  it("fails closed at the configured hard maximum age", () => {
    const [distant] = policyForTests();
    const decision = adaptiveOddsFreshness([event(8 * 24 * 60 * 60)], now);
    expect(distant.id).toBe("distant");
    expect(
      cacheIsHardExpired(
        "2026-09-28T12:00:00.000Z",
        "2026-09-30T12:00:00.000Z",
        decision,
        new Date("2026-09-30T12:00:00.000Z"),
      ),
    ).toBe(true);
  });
});
