import { describe, expect, it } from "vitest";

import {
  alternateSpreadLines,
  simulateAlternateSpreadPrice,
  SIMULATED_ALTERNATE_SPREAD_MODEL,
} from "../src/lib/wagers/simulated-alternate";

describe("simulated alternate spread pricing", () => {
  const anchor = simulateAlternateSpreadPrice({
    anchorProviderLine: -4.5,
    anchorProviderAmericanOdds: -110,
    adjustedLine: -4.5,
  });
  const easier = simulateAlternateSpreadPrice({
    anchorProviderLine: -4.5,
    anchorProviderAmericanOdds: -110,
    adjustedLine: -3.5,
  });
  const harder = simulateAlternateSpreadPrice({
    anchorProviderLine: -4.5,
    anchorProviderAmericanOdds: -110,
    adjustedLine: -5.5,
  });

  it("preserves the provider anchor and stores deterministic model metadata", () => {
    expect(anchor).toMatchObject({
      anchorProviderLine: -4.5,
      anchorProviderAmericanOdds: -110,
      adjustedLine: -4.5,
      simulatedAmericanOdds: -110,
      pricingSource: "simulated_alternate",
      pricingModel: SIMULATED_ALTERNATE_SPREAD_MODEL,
      pricingModelVersion: "1",
    });
  });

  it("moves odds monotonically in both directions", () => {
    expect(easier.simulatedDecimalOdds).toBeLessThan(anchor.simulatedDecimalOdds);
    expect(harder.simulatedDecimalOdds).toBeGreaterThan(anchor.simulatedDecimalOdds);
    expect(easier.simulatedAmericanOdds).toBeLessThan(anchor.simulatedAmericanOdds);
    expect(harder.simulatedAmericanOdds).toBeGreaterThan(anchor.simulatedAmericanOdds);
  });

  it("offers a bounded half-point adjustment range", () => {
    expect(alternateSpreadLines(-4.5)).toEqual([
      -7, -6.5, -6, -5.5, -5, -4.5, -4, -3.5, -3, -2.5, -2,
    ]);
  });
});
