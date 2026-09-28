import { describe, expect, it, vi } from "vitest";

import { createOddsRequest } from "@/lib/odds/request";
import { PostgresOddsStore } from "@/lib/odds/postgres-store";
import type { CacheRow } from "@/lib/odds/service";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

const row: CacheRow = {
  cacheKey: "odds:test-key",
  dataset: {
    competitionId: "epl",
    events: [],
    fetchedAt: "2026-09-12T12:00:00.000Z",
  },
  fetchedAt: "2026-09-12T12:00:00.000Z",
  expiresAt: "2026-09-12T12:15:00.000Z",
  refreshNotBefore: "2026-09-12T12:05:00.000Z",
};

describe("Postgres odds persistence boundaries", () => {
  it("writes the primary odds cache before calling optional history persistence", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ upsert }));
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { from, rpc } as unknown as SupabaseClient;
    const store = new PostgresOddsStore(client);
    const request = createOddsRequest("epl");

    await store.write(row, request);
    expect(from).toHaveBeenCalledWith("odds_cache");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        cache_key: row.cacheKey,
        normalized_payload: row.dataset,
        fetched_at: row.fetchedAt,
      }),
    );
    expect(rpc).not.toHaveBeenCalled();

    await store.recordHistory(row, request);
    expect(rpc).toHaveBeenCalledWith(
      "record_odds_cache_snapshot",
      expect.objectContaining({ p_observations: [], p_seen_event_ids: [] }),
    );
  });

  it("keeps primary cache failures and history failures distinguishable", async () => {
    const cacheError = { code: "XX000", message: "cache unavailable" };
    const cacheStore = new PostgresOddsStore({
      from: () => ({ upsert: vi.fn().mockResolvedValue({ error: cacheError }) }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient);
    await expect(cacheStore.write(row, createOddsRequest("epl"))).rejects.toBe(cacheError);

    const historyError = { code: "PGRST202", message: "history function unavailable" };
    const historyStore = new PostgresOddsStore({
      from: () => ({ upsert: vi.fn().mockResolvedValue({ error: null }) }),
      rpc: vi.fn().mockResolvedValue({ error: historyError }),
    } as unknown as SupabaseClient);
    await expect(historyStore.recordHistory(row, createOddsRequest("epl"))).rejects.toBe(
      historyError,
    );
  });
});
