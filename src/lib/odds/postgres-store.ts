import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CanonicalOddsRequest } from "./request";
import type { CacheRow, OddsStore } from "./service";
import { oddsObservations } from "@/lib/watchlist/observations";

export class PostgresOddsStore implements OddsStore {
  constructor(private readonly client: SupabaseClient) {}

  async read(key: string) {
    const { data, error } = await this.client
      .from("odds_cache")
      .select("*")
      .eq("cache_key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      cacheKey: data.cache_key,
      dataset: data.normalized_payload,
      fetchedAt: data.fetched_at,
      expiresAt: data.expires_at,
      refreshNotBefore: data.refresh_not_before,
    } as CacheRow;
  }

  async acquireLease(key: string, token: string) {
    const { data, error } = await this.client.rpc("try_acquire_odds_refresh_lease", {
      requested_cache_key: key,
      requested_lease_token: token,
      lease_seconds: 20,
    });
    if (error) throw error;
    return data === true;
  }

  async releaseLease(key: string, token: string) {
    const { error } = await this.client.rpc("release_odds_refresh_lease", {
      requested_cache_key: key,
      requested_lease_token: token,
    });
    if (error) throw error;
  }

  async write(row: CacheRow, request: CanonicalOddsRequest) {
    const { error } = await this.client.from("odds_cache").upsert({
      cache_key: row.cacheKey,
      provider: request.provider,
      endpoint: request.endpoint,
      sport: request.providerSportKey.split("_")[0],
      competition: request.competitionId,
      request_parameters: request,
      normalized_payload: row.dataset,
      fetched_at: row.fetchedAt,
      expires_at: row.expiresAt,
      refresh_not_before: row.refreshNotBefore,
      updated_at: row.fetchedAt,
    });
    if (error) throw error;
  }

  async recordHistory(row: CacheRow, request: CanonicalOddsRequest) {
    const { observations, seenEventIds } = oddsObservations(row.dataset);
    const { error } = await this.client.rpc("record_odds_cache_snapshot", {
      p_cache: {
        cache_key: row.cacheKey,
        provider: request.provider,
        endpoint: request.endpoint,
        sport: request.providerSportKey.split("_")[0],
        competition: request.competitionId,
        request_parameters: request,
        normalized_payload: row.dataset,
        fetched_at: row.fetchedAt,
        expires_at: row.expiresAt,
        refresh_not_before: row.refreshNotBefore,
      },
      p_observations: observations,
      p_seen_event_ids: seenEventIds,
    });
    if (error) throw error;
  }

  async latestUsed() {
    const { data, error } = await this.client
      .from("api_usage_ledger")
      .select("credits_used")
      .not("credits_used", "is", null)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.credits_used ?? null;
  }

  async record(
    request: CanonicalOddsRequest,
    purpose: "page_load" | "manual_refresh" | "event_discovery",
    key: string,
    quota: { used: number | null; remaining: number | null; lastRequestCost: number | null },
    status: number,
  ) {
    const { error } = await this.client.from("api_usage_ledger").insert({
      provider: request.provider,
      endpoint: request.endpoint,
      sport: request.providerSportKey.split("_")[0],
      competition: request.competitionId,
      request_purpose: purpose,
      cache_key: key,
      http_status: status,
      credits_consumed: quota.lastRequestCost,
      credits_used: quota.used,
      credits_remaining: quota.remaining,
    });
    if (error) throw error;
  }
}
