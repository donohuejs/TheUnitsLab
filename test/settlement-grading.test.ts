import { describe, expect, it } from "vitest";

import { gradeStraightLeg, liveWagerState } from "../src/lib/settlement/grading";

const grade = (
  sportKey: string,
  marketType: "moneyline" | "spread" | "total",
  selection: "home" | "away" | "draw" | "over" | "under",
  line: number | null,
  homeScore: number,
  awayScore: number,
) => gradeStraightLeg({ sportKey, marketType, selection, line }, { homeScore, awayScore });

describe("deterministic straight-wager grading", () => {
  it("grades home and away two-way moneylines and a losing selection", () => {
    expect(grade("football", "moneyline", "home", null, 28, 21)).toBe("won");
    expect(grade("basketball", "moneyline", "away", null, 70, 74)).toBe("won");
    expect(grade("football", "moneyline", "home", null, 14, 21)).toBe("lost");
  });

  it("distinguishes every soccer three-way result and makes a side lose on a draw", () => {
    expect(grade("soccer", "moneyline", "home", null, 2, 1)).toBe("won");
    expect(grade("soccer", "moneyline", "draw", null, 1, 1)).toBe("won");
    expect(grade("soccer", "moneyline", "away", null, 0, 1)).toBe("won");
    expect(grade("soccer", "moneyline", "home", null, 1, 1)).toBe("lost");
  });

  it("grades favorite, underdog, push, and both spread signs", () => {
    expect(grade("football", "spread", "home", -7.5, 31, 17)).toBe("won");
    expect(grade("football", "spread", "home", -7.5, 24, 20)).toBe("lost");
    expect(grade("basketball", "spread", "away", 6.5, 80, 76)).toBe("won");
    expect(grade("football", "spread", "home", -7, 28, 21)).toBe("push");
    expect(grade("football", "spread", "away", 7, 28, 21)).toBe("push");
  });

  it("grades over, under, losses, and total pushes", () => {
    expect(grade("basketball", "total", "over", 140.5, 75, 70)).toBe("won");
    expect(grade("football", "total", "under", 51.5, 24, 21)).toBe("won");
    expect(grade("football", "total", "over", 51.5, 24, 21)).toBe("lost");
    expect(grade("basketball", "total", "under", 140.5, 75, 70)).toBe("lost");
    expect(grade("football", "total", "over", 45, 24, 21)).toBe("push");
  });

  it("derives informational live positions without grading", () => {
    expect(
      liveWagerState(
        { sportKey: "football", marketType: "spread", selection: "home", line: -7.5 },
        { homeScore: 31, awayScore: 17 },
      ),
    ).toContain("Covering by 6.5");
    expect(
      liveWagerState(
        { sportKey: "football", marketType: "total", selection: "over", line: 51.5 },
        { homeScore: 24, awayScore: 24 },
      ),
    ).toContain("Current total 48");
    expect(
      liveWagerState(
        { sportKey: "soccer", marketType: "moneyline", selection: "draw", line: null },
        { homeScore: 1, awayScore: 1 },
      ),
    ).toBe("Draw is currently hitting");
  });
});
