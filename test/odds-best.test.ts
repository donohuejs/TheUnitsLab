import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getBestOdds, groupOddsByComparableSelection } from "../src/lib/odds/best";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

type TestOdd = {
  bookmakerId: string;
  marketType: "moneyline" | "spread" | "total";
  selection: "home" | "away" | "over" | "under";
  point: number | null;
  americanOdds: number;
};

const odd = (
  bookmakerId: string,
  americanOdds: number,
  overrides: Partial<Pick<TestOdd, "marketType" | "selection" | "point">> = {},
): TestOdd => ({
  bookmakerId,
  marketType: "moneyline",
  selection: "home",
  point: null,
  americanOdds,
  ...overrides,
});

describe("shared browse best-odds comparison", () => {
  it("returns the clear best price for one comparable selection", () => {
    const prices = [odd("draftkings", 105), odd("fanduel", 115), odd("betrivers", -105)];

    expect([...getBestOdds(prices)].map((price) => price.bookmakerId)).toEqual(["fanduel"]);
    expect(
      groupOddsByComparableSelection(prices)[0]?.prices.map((price) => price.bookmakerId),
    ).toEqual(["fanduel", "draftkings", "betrivers"]);
  });

  it("returns every sportsbook tied for the best price", () => {
    const prices = [odd("draftkings", 110), odd("fanduel", 110), odd("betrivers", 105)];

    expect([...getBestOdds(prices)].map((price) => price.bookmakerId)).toEqual([
      "draftkings",
      "fanduel",
    ]);
  });

  it("does not compare unlike spread or total lines", () => {
    const prices = [
      odd("draftkings", -105, { marketType: "spread", selection: "home", point: -3.5 }),
      odd("fanduel", 120, { marketType: "spread", selection: "home", point: -7.5 }),
      odd("betrivers", -110, { marketType: "total", selection: "over", point: 44.5 }),
      odd("caesars", 105, { marketType: "total", selection: "over", point: 45.5 }),
    ];

    expect([...getBestOdds(prices)].map((price) => price.bookmakerId)).toEqual([
      "draftkings",
      "fanduel",
      "betrivers",
      "caesars",
    ]);
  });

  it("wires the shared comparison into desktop while preserving mobile best rendering", () => {
    const grid = read("../src/components/odds-selection-grid.tsx");
    const css = read("../src/app/globals.css");

    expect(grid).toContain("groupOddsByComparableSelection(displayOdds)");
    expect(grid).toContain("getBestOdds(displayOdds)");
    expect(grid).toContain("isBest={bestOdds.has(odd)}");
    expect(grid).toContain('className="sr-only">Best available odds');
    expect(grid).toContain("const best = prices[0]");
    expect(grid).toContain("Best: {price(best.americanOdds)}");
    expect(css).toContain(".odd.best-odds");
    expect(css).toContain("background: #e8f1f6");
  });
});
