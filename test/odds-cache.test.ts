import { describe, expect, it, vi } from "vitest";
import { getOdds, type CacheRow, type OddsStore } from "../src/lib/odds/service";

class MemoryStore implements OddsStore {
  row: CacheRow | null = null;
  lease = false;
  records: unknown[] = [];
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
    this.row = row;
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

describe("shared odds cache acceptance", () => {
  it("reuses one upstream request and ledger row across equivalent users, then refreshes once after expiry", async () => {
    const store = new MemoryStore();
    const provider = vi.fn(async () => providerResult);
    const dependencies = { store, provider, now: () => now };
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

    now.setTime(new Date("2026-09-12T12:16:00Z").getTime());
    await Promise.all([getOdds(dependencies, "epl"), getOdds(dependencies, "epl")]);
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

  it("serves stale data without calling upstream in high quota state", async () => {
    const store = new MemoryStore();
    store.used = 425;
    store.row = {
      cacheKey: "x",
      dataset: { competitionId: "epl", events: [], fetchedAt: "2026-09-12T11:00:00Z" },
      fetchedAt: "2026-09-12T11:00:00Z",
      expiresAt: "2026-09-12T11:15:00Z",
      refreshNotBefore: "2026-09-12T11:05:00Z",
    };
    const provider = vi.fn(async () => providerResult);
    const result = await getOdds({ store, provider, now: () => now }, "epl");
    expect(result.cacheStatus).toBe("stale");
    expect(provider).not.toHaveBeenCalled();
  });
});
