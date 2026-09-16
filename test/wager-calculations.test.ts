import { describe, expect, it } from "vitest";

import {
  americanToDecimalString,
  calculatePotential,
  decimalToAmerican,
  parseStakeToMinorUnits,
} from "../src/lib/wagers/calculations";

describe("exact wager calculations", () => {
  it("converts positive and negative American odds deterministically", () => {
    expect(americanToDecimalString(150)).toBe("2.5000");
    expect(americanToDecimalString(-200)).toBe("1.5000");
    expect(decimalToAmerican("2.5000")).toBe(150);
    expect(decimalToAmerican("1.5000")).toBe(-200);
  });

  it("calculates potential profit and return in exact virtual-unit minor units", () => {
    expect(calculatePotential("10", "2.5000")).toEqual({
      stake: "10.00",
      profit: "15.00",
      return: "25.00",
    });
    expect(calculatePotential("10.00", "1.5000")).toEqual({
      stake: "10.00",
      profit: "5.00",
      return: "15.00",
    });
  });

  it("permits hundredth-unit stakes and rounds half up to the nearest hundredth", () => {
    expect(calculatePotential("0.01", "2.5000")).toEqual({
      stake: "0.01",
      profit: "0.02",
      return: "0.03",
    });
  });

  it("rejects invalid odds and zero, negative, or over-precise stakes", () => {
    expect(() => americanToDecimalString(0)).toThrow();
    expect(() => americanToDecimalString(99)).toThrow();
    expect(() => decimalToAmerican("1.0000")).toThrow();
    expect(() => parseStakeToMinorUnits("0")).toThrow();
    expect(() => parseStakeToMinorUnits("-1")).toThrow();
    expect(() => parseStakeToMinorUnits("1.001")).toThrow();
  });
});
