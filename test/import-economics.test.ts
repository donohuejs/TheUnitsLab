import { describe, expect, it } from "vitest";

import { calculateImportedEconomics } from "../src/lib/external-wagers/calculations";

describe("progressive imported wager economics", () => {
  it("calculates payout from stake and odds", () => {
    expect(calculateImportedEconomics("10.00", "-110", "")).toEqual({
      stakeDollars: "10.00",
      americanOdds: -110,
      returnDollars: "19.09",
      calculatedField: "return",
    });
  });

  it("derives odds from stake and payout", () => {
    expect(calculateImportedEconomics("10.00", "", "19.09")).toEqual({
      stakeDollars: "10.00",
      americanOdds: -110,
      returnDollars: "19.09",
      calculatedField: "odds",
    });
  });

  it("derives stake from odds and payout", () => {
    expect(calculateImportedEconomics("", "-110", "19.09")).toEqual({
      stakeDollars: "10.00",
      americanOdds: -110,
      returnDollars: "19.09",
      calculatedField: "stake",
    });
  });

  it("requires at least two valid fields", () => {
    expect(() => calculateImportedEconomics("10.00", "", "")).toThrow(
      "Enter any two of stake, odds, or payout",
    );
    expect(() => calculateImportedEconomics("10.00", "-110", "18.00")).not.toThrow();
  });
});
