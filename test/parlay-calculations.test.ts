import { describe, expect, it } from "vitest";

import {
  calculateEffectiveParlay,
  calculateParlayPotential,
  combineDecimalOdds,
} from "../src/lib/parlays/calculations";
import { americanToDecimalString } from "../src/lib/wagers/calculations";

describe("exact parlay calculations", () => {
  it("combines two legs and rounds once to four places", () => {
    expect(combineDecimalOdds(["2.5000", "1.9091"])).toBe("4.7728");
  });

  it("combines three legs without intermediate rounding", () => {
    expect(combineDecimalOdds(["2.5000", "1.9091", "1.8333"])).toBe("8.7499");
  });

  it("combines mixed positive and negative American prices", () => {
    const odds = [150, -110, -120].map(americanToDecimalString);
    expect(odds).toEqual(["2.5000", "1.9091", "1.8333"]);
    expect(calculateParlayPotential("10.00", odds)).toEqual({
      decimalOdds: "8.7499",
      americanOdds: 775,
      stake: "10.00",
      profit: "77.50",
      return: "87.50",
    });
  });

  it("uses explicit half-up final rounding", () => {
    expect(combineDecimalOdds(["1.2345", "1.2345"])).toBe("1.5240");
  });

  it("removes push and void legs from a winning effective price", () => {
    expect(
      calculateEffectiveParlay("10.00", [
        { decimalOdds: "2.5000", result: "won" },
        { decimalOdds: "1.9091", result: "push" },
        { decimalOdds: "1.8333", result: "won" },
        { decimalOdds: "1.8000", result: "void" },
      ]),
    ).toEqual({
      status: "won",
      decimalOdds: "4.5833",
      americanOdds: 358,
      stake: "10.00",
      profit: "35.83",
      return: "45.83",
    });
  });

  it("makes any active loss decisive after all legs resolve", () => {
    expect(
      calculateEffectiveParlay("10.00", [
        { decimalOdds: "2.0000", result: "push" },
        { decimalOdds: "1.9000", result: "lost" },
      ]),
    ).toEqual({ status: "lost", decimalOdds: "1.9000", americanOdds: -111 });
  });

  it("returns stake for all-push, all-void, and mixed neutral tickets", () => {
    expect(
      calculateEffectiveParlay("10.00", [
        { decimalOdds: "2.0000", result: "push" },
        { decimalOdds: "1.9000", result: "push" },
      ]),
    ).toMatchObject({ status: "push", decimalOdds: "1.0000", return: "10.00" });
    expect(
      calculateEffectiveParlay("10.00", [
        { decimalOdds: "2.0000", result: "void" },
        { decimalOdds: "1.9000", result: "void" },
      ]),
    ).toMatchObject({ status: "void", decimalOdds: "1.0000", return: "10.00" });
    expect(
      calculateEffectiveParlay("10.00", [
        { decimalOdds: "2.0000", result: "push" },
        { decimalOdds: "1.9000", result: "void" },
      ]),
    ).toMatchObject({ status: "push", decimalOdds: "1.0000", return: "10.00" });
  });

  it("does not settle while any required leg is open", () => {
    expect(() =>
      calculateEffectiveParlay("10.00", [
        { decimalOdds: "2.0000", result: "won" },
        { decimalOdds: "1.9000", result: "open" },
      ]),
    ).toThrow("Open legs cannot be settled");
  });
});
