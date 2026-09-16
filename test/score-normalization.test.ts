import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { normalizeScoreResponse } from "../src/lib/scores/normalize";
import { canonicalScoreRequestKey, createScoreRequest } from "../src/lib/scores/request";

const fixture = JSON.parse(
  await readFile(new URL("fixtures/scores-epl.json", import.meta.url), "utf8"),
);

describe("score normalization", () => {
  it("maps provider IDs, team-oriented scores, live/final state, and timestamps", () => {
    const scores = normalizeScoreResponse(fixture, "epl", "2026-09-13T15:05:00Z");
    expect(scores[0]).toMatchObject({
      providerEventId: "event-1",
      competitionId: "epl",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      homeScore: 1,
      awayScore: 2,
      state: "live",
      isLive: true,
      isFinal: false,
      clockText: null,
    });
    expect(scores[1]).toMatchObject({
      providerEventId: "event-2",
      state: "final",
      homeScore: 3,
      awayScore: 0,
    });
  });

  it("creates one stable configured score request per competition", () => {
    const requests = (["epl", "ucl", "ncaaf", "ncaab"] as const).map(createScoreRequest);
    expect(new Set(requests.map(canonicalScoreRequestKey))).toHaveLength(4);
    expect(requests[2]).toMatchObject({
      endpoint: "scores",
      providerSportKey: "americanfootball_ncaaf",
      daysFrom: 3,
    });
  });

  it("rejects a completed result without both team scores", () => {
    expect(() =>
      normalizeScoreResponse([{ ...fixture[1], scores: null }], "epl", "2026-09-13T15:05:00Z"),
    ).toThrow(/both team scores/);
  });
});
