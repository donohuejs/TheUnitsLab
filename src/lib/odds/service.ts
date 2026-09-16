import { effectiveTtlSeconds, mayRefresh, quotaState } from "./quota";
import { canonicalRequestKey, createOddsRequest, type CanonicalOddsRequest } from "./request";
import type { CompetitionId, OddsDataset, OddsResult, QuotaMetadata } from "./types";

export type CacheRow = {
  cacheKey: string;
  dataset: OddsDataset;
  fetchedAt: string;
  expiresAt: string;
  refreshNotBefore: string;
};

export interface OddsStore {
  read(key: string): Promise<CacheRow | null>;
  acquireLease(key: string, token: string): Promise<boolean>;
  releaseLease(key: string, token: string): Promise<void>;
  write(row: CacheRow, request: CanonicalOddsRequest): Promise<void>;
  latestUsed(): Promise<number | null>;
  record(
    request: CanonicalOddsRequest,
    purpose: "page_load" | "manual_refresh",
    key: string,
    quota: QuotaMetadata,
    status: number,
  ): Promise<void>;
}

export type ProviderFetch = (request: CanonicalOddsRequest) => Promise<{
  events: OddsDataset["events"];
  quota: QuotaMetadata;
  status: number;
}>;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function getOdds(
  dependencies: { store: OddsStore; provider: ProviderFetch; now?: () => Date; allowance?: number },
  competitionId: CompetitionId,
  options: { manual?: boolean } = {},
): Promise<OddsResult> {
  return getOddsForRequest(dependencies, createOddsRequest(competitionId), competitionId, options);
}

export async function getOddsForRequest(
  dependencies: { store: OddsStore; provider: ProviderFetch; now?: () => Date; allowance?: number },
  request: CanonicalOddsRequest,
  competitionId: CompetitionId,
  options: { manual?: boolean } = {},
): Promise<OddsResult> {
  const now = dependencies.now?.() ?? new Date();
  const key = canonicalRequestKey(request);
  const cached = await dependencies.store.read(key);
  const used = await dependencies.store.latestUsed();
  const state = quotaState(used, dependencies.allowance ?? 500);
  const manual = options.manual === true;
  const fresh = cached && new Date(cached.expiresAt) > now;
  const cooldown = cached && new Date(cached.refreshNotBefore) > now;
  if (fresh || (manual && cooldown)) {
    return {
      dataset: cached.dataset,
      cacheStatus: "hit",
      expiresAt: cached.expiresAt,
      quotaState: state,
    };
  }
  if (!mayRefresh(state, manual)) {
    if (cached)
      return {
        dataset: cached.dataset,
        cacheStatus: "stale",
        expiresAt: cached.expiresAt,
        quotaState: state,
      };
    throw new Error("Odds refresh is unavailable while API quota is being conserved.");
  }

  const leaseToken = crypto.randomUUID();
  const acquired = await dependencies.store.acquireLease(key, leaseToken);
  if (!acquired) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(100);
      const coalesced = await dependencies.store.read(key);
      if (coalesced && new Date(coalesced.fetchedAt) >= now) {
        return {
          dataset: coalesced.dataset,
          cacheStatus: "hit",
          expiresAt: coalesced.expiresAt,
          quotaState: state,
        };
      }
    }
    if (cached)
      return {
        dataset: cached.dataset,
        cacheStatus: "stale",
        expiresAt: cached.expiresAt,
        quotaState: state,
      };
    throw new Error("Odds refresh is already in progress. Please try again shortly.");
  }

  try {
    const rechecked = await dependencies.store.read(key);
    if (rechecked && new Date(rechecked.expiresAt) > now) {
      return {
        dataset: rechecked.dataset,
        cacheStatus: "hit",
        expiresAt: rechecked.expiresAt,
        quotaState: state,
      };
    }
    const upstream = await dependencies.provider(request);
    const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const baseTtl = 900;
    const ttl = effectiveTtlSeconds(baseTtl, state);
    const dataset: OddsDataset = { competitionId, events: upstream.events, fetchedAt };
    const row: CacheRow = {
      cacheKey: key,
      dataset,
      fetchedAt,
      expiresAt: new Date(new Date(fetchedAt).getTime() + ttl * 1000).toISOString(),
      refreshNotBefore: new Date(new Date(fetchedAt).getTime() + 300_000).toISOString(),
    };
    await dependencies.store.write(row, request);
    await dependencies.store.record(
      request,
      manual ? "manual_refresh" : "page_load",
      key,
      upstream.quota,
      upstream.status,
    );
    return {
      dataset,
      cacheStatus: cached ? "refreshed" : "miss",
      expiresAt: row.expiresAt,
      quotaState: quotaState(upstream.quota.used, dependencies.allowance ?? 500),
    };
  } catch (error) {
    if (cached)
      return {
        dataset: cached.dataset,
        cacheStatus: "stale",
        expiresAt: cached.expiresAt,
        quotaState: state,
      };
    throw error;
  } finally {
    await dependencies.store.releaseLease(key, leaseToken);
  }
}
