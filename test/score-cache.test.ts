import { describe, expect, it, vi } from "vitest";

import { getScores, type ScoreRefreshRow, type ScoreStore } from "../src/lib/scores/service";
import type { NormalizedScore } from "../src/lib/scores/types";

class MemoryScoreStore implements ScoreStore {
  scores: NormalizedScore[] = [];
  refresh: ScoreRefreshRow | null = null;
  lease = false;
  used: number | null = 0;
  records = 0;
  async readScores() {
    return this.scores;
  }
  async readRefresh() {
    return this.refresh;
  }
  async acquireLease() {
    if (this.lease) return false;
    this.lease = true;
    return true;
  }
  async releaseLease() {
    this.lease = false;
  }
  async write(scores: NormalizedScore[], refresh: ScoreRefreshRow) {
    this.scores = scores;
    this.refresh = refresh;
  }
  async latestUsed() {
    return this.used;
  }
  async record() {
    this.records += 1;
  }
}

const now = new Date("2026-09-13T15:05:00Z");
const live: NormalizedScore = {
  providerEventId: "event-1",
  sport: "soccer",
  competitionId: "epl",
  providerSportKey: "soccer_epl",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  scheduledStart: "2026-09-13T14:00:00Z",
  state: "live",
  statusText: "Live",
  homeScore: 1,
  awayScore: 2,
  isLive: true,
  isFinal: false,
  clockText: null,
  periodText: null,
  providerLastUpdate: "2026-09-13T15:04:00Z",
  refreshedAt: now.toISOString(),
};
const providerResult = {
  scores: [live],
  quota: { used: 1, remaining: 499, lastRequestCost: 1 },
  status: 200,
};

describe("shared quota-aware score cache", () => {
  it("coalesces equivalent users onto one upstream refresh and ledger entry", async () => {
    const store = new MemoryScoreStore();
    const provider = vi.fn(async () => providerResult);
    await Promise.all([
      getScores({ store, provider, now: () => now }, "epl", "active_view"),
      getScores({ store, provider, now: () => now }, "epl", "active_view"),
    ]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(store.records).toBe(1);
  });

  it("blocks active-view calls at High but preserves settlement-critical refresh", async () => {
    const store = new MemoryScoreStore();
    store.used = 425;
    const provider = vi.fn(async () => providerResult);
    expect(
      (await getScores({ store, provider, now: () => now }, "epl", "active_view")).cacheStatus,
    ).toBe("stale");
    await getScores({ store, provider, now: () => now }, "epl", "settlement");
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("uses rapid bounded live TTL and durable final TTL", async () => {
    const store = new MemoryScoreStore();
    const provider = vi.fn(async () => providerResult);
    await getScores({ store, provider, now: () => now }, "epl", "open_wagers");
    expect(new Date(store.refresh!.expiresAt).getTime() - now.getTime()).toBe(60_000);
    provider.mockResolvedValueOnce({
      ...providerResult,
      scores: [{ ...live, state: "final", statusText: "Final", isLive: false, isFinal: true }],
    });
    now.setTime(now.getTime() + 61_000);
    await getScores({ store, provider, now: () => now }, "epl", "settlement");
    expect(new Date(store.refresh!.expiresAt).getTime() - now.getTime()).toBe(86_400_000);
  });
});
