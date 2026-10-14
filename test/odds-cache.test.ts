import { describe, expect, it, vi } from "vitest";
import { getOdds, type CacheRow, type OddsStore } from "../src/lib/odds/service";
import type { NormalizedEvent } from "../src/lib/odds/types";

class MemoryStore implements OddsStore {
  row: CacheRow | null = null;
  lease = false;
  records: unknown[] = [];
  historyWrites: CacheRow[] = [];
  historyFailure: unknown = null;
  writeFailure: Error | null = null;
  used: number | null = 0;
  async read() {
    return this.row;
  }
  async acquireLease() {
    if (this.lease) return false;
    this.lease = true;
    return true;
  }
  async releaseLease() {
    this.lease = false;
  }
  async write(row: CacheRow) {
    if (this.writeFailure) throw this.writeFailure;
    this.row = row;
  }
  async recordHistory(row: CacheRow) {
    if (this.historyFailure) throw this.historyFailure;
    this.historyWrites.push(row);
  }
  async latestUsed() {
    return this.used;
  }
  async record(...args: unknown[]) {
    this.records.push(args);
  }
}

const now = new Date("2026-09-12T12:00:00Z");
const providerResult = {
  events: [],
  quota: { used: 1, remaining: 499, lastRequestCost: 1 },
  status: 200,
};

const normalizedEvent: NormalizedEvent = {
  id: "epl:event-1",
  providerEventId: "event-1",
  sport: "soccer",
  competitionId: "epl",
  competitionName: "Premier League",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  scheduledStart: "2026-09-13T15:00:00.000Z",
  status: "scheduled" as const,
  providerSportKey: "soccer_epl",
  odds: [],
};

describe("shared odds cache acceptance", () => {
  it("reuses one upstream request and ledger row across equivalent users, then refreshes once after expiry", async () => {
    const store = new MemoryStore();
    const provider = vi.fn(async () => ({ ...providerResult, events: [normalizedEvent] }));
    const scheduled: (() => Promise<void>)[] = [];
    const dependencies = {
      store,
      provider,
      now: () => now,
      scheduleRefresh: (work: () => Promise<void>) => scheduled.push(work),
    };
    const [userA, userB] = await Promise.all([
      getOdds(dependencies, "epl"),
      getOdds(dependencies, "epl"),
    ]);
    expect([userA.cacheStatus, userB.cacheStatus].sort()).toEqual(["hit", "miss"]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(store.records).toHaveLength(1);
    await getOdds(dependencies, "epl");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(store.records).toHaveLength(1);

    now.setTime(new Date("2026-09-12T18:01:00Z").getTime());
    await Promise.all([getOdds(dependencies, "epl"), getOdds(dependencies, "epl")]);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(provider).toHaveBeenCalledTimes(2);
    expect(store.records).toHaveLength(2);
  });

  it("does not let manual refresh bypass the five-minute global cooldown", async () => {
    const store = new MemoryStore();
    const provider = vi.fn(async () => providerResult);
    await getOdds({ store, provider, now: () => now }, "epl");
    await getOdds({ store, provider, now: () => new Date("2026-09-12T12:04:00Z") }, "epl", {
      manual: true,
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("propagates provider attempts and measured response time into the usage record", async () => {
    const store = new MemoryStore();
    const provider = vi.fn(async () => ({ ...providerResult, attempts: 2, responseTimeMs: 37 }));

    await getOdds({ store, provider, now: () => new Date("2026-09-12T12:00:00Z") }, "epl");

    const metadata = (store.records[0] as unknown[])[5];
    expect(metadata).toMatchObject({
      attempts: 2,
      responseTimeMs: 37,
      success: true,
    });
  });

  it("uses safe telemetry defaults when a provider response omits timing data", async () => {
    const store = new MemoryStore();
    const provider = vi.fn(async () => providerResult);

    await getOdds({ store, provider, now: () => new Date("2026-09-12T12:00:00Z") }, "epl");

    const metadata = (store.records[0] as unknown[])[5];
    expect(metadata).toMatchObject({
      attempts: 1,
      responseTimeMs: null,
      success: true,
    });
  });

  it("serves stale data without calling upstream in high quota state", async () => {
    const store = new MemoryStore();
    store.used = 425;
    store.row = {
      cacheKey: "x",
      dataset: { competitionId: "epl", events: [], fetchedAt: "2026-09-12T11:00:00Z" },
      fetchedAt: "2026-09-12T11:00:00Z",
      expiresAt: "2026-09-12T11:15:00Z",
      staleUntil: "2026-09-12T12:30:00Z",
      refreshNotBefore: "2026-09-12T11:05:00Z",
    };
    const provider = vi.fn(async () => providerResult);
    const result = await getOdds(
      { store, provider, now: () => new Date("2026-09-12T12:00:00Z") },
      "epl",
    );
    expect(result.cacheStatus).toBe("stale");
    expect(provider).not.toHaveBeenCalled();
  });

  it("serves stale-but-usable data while scheduling one lease-protected refresh", async () => {
    const store = new MemoryStore();
    store.row = {
      cacheKey: "x",
      dataset: {
        competitionId: "epl",
        events: [normalizedEvent],
        fetchedAt: "2026-09-12T12:00:00Z",
      },
      fetchedAt: "2026-09-12T12:00:00Z",
      expiresAt: "2026-09-12T14:00:00Z",
      staleUntil: "2026-09-12T18:00:00Z",
      refreshNotBefore: "2026-09-12T12:05:00Z",
    };
    const provider = vi.fn(async () => ({ ...providerResult, events: [normalizedEvent] }));
    const scheduled: (() => Promise<void>)[] = [];
    const result = await getOdds(
      {
        store,
        provider,
        now: () => new Date("2026-09-12T14:01:00Z"),
        scheduleRefresh: (work) => scheduled.push(work),
      },
      "epl",
    );
    expect(result.cacheStatus).toBe("stale");
    expect(result.dataset).toBe(store.row?.dataset);
    expect(provider).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("keeps stale data usable when a background provider refresh fails", async () => {
    const store = new MemoryStore();
    store.row = {
      cacheKey: "x",
      dataset: {
        competitionId: "epl",
        events: [normalizedEvent],
        fetchedAt: "2026-09-12T12:00:00Z",
      },
      fetchedAt: "2026-09-12T12:00:00Z",
      expiresAt: "2026-09-12T14:00:00Z",
      staleUntil: "2026-09-12T18:00:00Z",
      refreshNotBefore: "2026-09-12T12:05:00Z",
    };
    const scheduled: (() => Promise<void>)[] = [];
    const result = await getOdds(
      {
        store,
        provider: async () => {
          throw new Error("provider unavailable");
        },
        now: () => new Date("2026-09-12T14:01:00Z"),
        scheduleRefresh: (work) => scheduled.push(work),
      },
      "epl",
    );
    expect(result.cacheStatus).toBe("stale");
    await scheduled[0]();
    expect((store.records.at(-1) as unknown[])[5]).toMatchObject({ success: false });
    expect(store.row?.dataset.events).toHaveLength(1);
  });

  it("does not serve a hard-expired odds row", async () => {
    const store = new MemoryStore();
    store.row = {
      cacheKey: "x",
      dataset: {
        competitionId: "epl",
        events: [normalizedEvent],
        fetchedAt: "2026-09-12T12:00:00Z",
      },
      fetchedAt: "2026-09-12T12:00:00Z",
      expiresAt: "2026-09-12T14:00:00Z",
      staleUntil: "2026-09-12T14:30:00Z",
      refreshNotBefore: "2026-09-12T12:05:00Z",
    };
    await expect(
      getOdds(
        {
          store,
          provider: vi.fn(async () => {
            throw new Error("provider unavailable");
          }),
          now: () => new Date("2026-09-12T15:00:00Z"),
        },
        "epl",
      ),
    ).rejects.toThrow("provider unavailable");
  });

  it("returns valid current odds and records quota when optional history persistence fails", async () => {
    const store = new MemoryStore();
    store.historyFailure = {
      code: "PGRST202",
      message: "Could not find the odds history function in the schema cache",
    };
    const provider = vi.fn(async () => ({ ...providerResult, events: [normalizedEvent] }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const result = await getOdds(
        { store, provider, now: () => new Date("2026-09-12T12:00:00Z") },
        "epl",
      );

      expect(result.dataset.events).toEqual([normalizedEvent]);
      expect(store.row?.dataset.events).toEqual([normalizedEvent]);
      expect(store.historyWrites).toHaveLength(0);
      expect(store.records).toHaveLength(1);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining("[odds-history]"),
        expect.objectContaining({ competitionId: "epl", endpoint: "odds", errorCode: "PGRST202" }),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it("records history on a successful refresh and does not repeat it for a cache hit", async () => {
    const store = new MemoryStore();
    const provider = vi.fn(async () => ({ ...providerResult, events: [normalizedEvent] }));
    const dependencies = {
      store,
      provider,
      now: () => new Date("2026-09-12T12:00:00Z"),
    };

    const refreshed = await getOdds(dependencies, "epl");
    const hit = await getOdds(dependencies, "epl");

    expect(refreshed.dataset.events).toEqual([normalizedEvent]);
    expect(hit.cacheStatus).toBe("hit");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(store.historyWrites).toHaveLength(1);
    expect(store.records).toHaveLength(1);
  });

  it("still fails when provider or primary cache persistence prevents valid odds", async () => {
    const providerStore = new MemoryStore();
    const providerFailure = new Error("provider unavailable");
    await expect(
      getOdds(
        {
          store: providerStore,
          provider: async () => {
            throw providerFailure;
          },
          now: () => new Date("2026-09-12T12:00:00Z"),
        },
        "epl",
      ),
    ).rejects.toBe(providerFailure);
    expect(providerStore.historyWrites).toHaveLength(0);

    const cacheStore = new MemoryStore();
    const cacheFailure = new Error("primary cache unavailable");
    cacheStore.writeFailure = cacheFailure;
    await expect(
      getOdds(
        {
          store: cacheStore,
          provider: async () => ({ ...providerResult, events: [normalizedEvent] }),
          now: () => new Date("2026-09-12T12:00:00Z"),
        },
        "epl",
      ),
    ).rejects.toBe(cacheFailure);
    expect(cacheStore.historyWrites).toHaveLength(0);
    expect(cacheStore.records).toHaveLength(1);
  });
});
