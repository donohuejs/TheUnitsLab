import { describe, expect, it } from "vitest";

import {
  calculateExternalProfitLoss,
  summarizeExternalWagers,
} from "../src/lib/external-wagers/calculations";

describe("external wager settlement calculations", () => {
  it("calculates wins from positive and negative American odds", () => {
    expect(calculateExternalProfitLoss("2.00", 150, "won")).toEqual({
      decimalOdds: "2.5000",
      profitLoss: "3.00",
    });
    expect(calculateExternalProfitLoss("2.00", -200, "won")).toEqual({
      decimalOdds: "1.5000",
      profitLoss: "1.00",
    });
  });

  it("calculates losses, pushes, voids, and open records deterministically", () => {
    expect(calculateExternalProfitLoss("1.25", -110, "lost").profitLoss).toBe("-1.25");
    expect(calculateExternalProfitLoss("1.25", -110, "push").profitLoss).toBe("0.00");
    expect(calculateExternalProfitLoss("1.25", -110, "void").profitLoss).toBe("0.00");
    expect(calculateExternalProfitLoss("1.25", -110, "open").profitLoss).toBe("0.00");
  });

  it("rejects invalid odds and stakes", () => {
    expect(() => calculateExternalProfitLoss("0", 150, "won")).toThrow();
    expect(() => calculateExternalProfitLoss("1.001", 150, "won")).toThrow();
    expect(() => calculateExternalProfitLoss("1", 99, "won")).toThrow();
    expect(() => calculateExternalProfitLoss("1", -1_000_001, "won")).toThrow();
    expect(() => calculateExternalProfitLoss("1", Number.NaN, "won")).toThrow();
  });
});

describe("IRL-only summary", () => {
  it("reconciles settled records and excludes void stakes from ROI", () => {
    expect(
      summarizeExternalWagers([
        { status: "won", stakeUnits: "2.00", profitLossUnits: "3.00" },
        { status: "lost", stakeUnits: "1.00", profitLossUnits: "-1.00" },
        { status: "push", stakeUnits: "1.00", profitLossUnits: "0.00" },
        { status: "void", stakeUnits: "5.00", profitLossUnits: "0.00" },
        { status: "open", stakeUnits: "8.00", profitLossUnits: "0.00" },
      ]),
    ).toEqual({
      totalSettled: 4,
      wins: 1,
      losses: 1,
      pushes: 1,
      voids: 1,
      unitsWagered: "4.00",
      netUnits: "2.00",
      roiPercent: "50.00",
    });
  });

  it("returns zero ROI when only voids are settled", () => {
    expect(
      summarizeExternalWagers([{ status: "void", stakeUnits: "1.00", profitLossUnits: "0.00" }])
        .roiPercent,
    ).toBe("0.00");
  });
});
