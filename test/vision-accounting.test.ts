import { describe, expect, it } from "vitest";

import {
  VISION_DEFAULT_BUDGET_USD,
  calculateVisionCostUsd,
  visionRemainingUsd,
  visionThreshold,
} from "../src/lib/betslip/vision-accounting";

describe("vision accounting", () => {
  it("uses exact fixed-precision Luna pricing", () => {
    expect(calculateVisionCostUsd(10_000, 500)).toBe(0.0026);
    expect(calculateVisionCostUsd(0, 0)).toBe(0);
  });

  it("exposes the documented application thresholds", () => {
    expect(VISION_DEFAULT_BUDGET_USD).toBe(5);
    expect(visionThreshold(3.5)).toBe("warning");
    expect(visionThreshold(4.25)).toBe("high");
    expect(visionThreshold(4.75)).toBe("critical");
    expect(visionThreshold(5)).toBe("limit");
    expect(visionRemainingUsd(4.25)).toBe(0.75);
  });

  it("rejects invalid token counts instead of writing ambiguous cost records", () => {
    expect(() => calculateVisionCostUsd(-1, 2)).toThrow();
    expect(() => calculateVisionCostUsd(1.5, 2)).toThrow();
  });
});
