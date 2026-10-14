import { describe, expect, it } from "vitest";

import { shouldRefreshScoreTargets } from "../src/lib/scores/priority";
import type { NormalizedScore } from "../src/lib/scores/types";

const now = new Date("2026-09-28T15:00:00Z");
const target = {
  competitionId: "epl" as const,
  providerEventId: "event-open",
  scheduledStart: "2026-09-28T14:00:00Z",
};
const future = {
  competitionId: "epl" as const,
  providerEventId: "event-future",
  scheduledStart: "2026-09-29T14:00:00Z",
};
const score = (overrides: Partial<NormalizedScore> = {}): NormalizedScore => ({
  providerEventId: target.providerEventId,
  sport: "soccer",
  competitionId: "epl",
  providerSportKey: "soccer_epl",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  scheduledStart: target.scheduledStart,
  state: "live",
  statusText: "Live",
  homeScore: 1,
  awayScore: 0,
  isLive: true,
  isFinal: false,
  clockText: null,
  periodText: null,
  providerLastUpdate: null,
  refreshedAt: now.toISOString(),
  ...overrides,
});

describe("score refresh priority", () => {
  it("refreshes an open wager event after kickoff", () => {
    expect(shouldRefreshScoreTargets([], [target], now)).toBe(true);
  });

  it("does not poll an irrelevant future event", () => {
    expect(shouldRefreshScoreTargets([], [future], now)).toBe(false);
  });

  it("does not refresh a target whose durable score is already final", () => {
    expect(
      shouldRefreshScoreTargets(
        [score({ state: "final", isLive: false, isFinal: true })],
        [target],
        now,
      ),
    ).toBe(false);
  });

  it("keeps the existing broad behavior when no target list is supplied", () => {
    expect(shouldRefreshScoreTargets([], [], now)).toBe(true);
  });
});
