import {
  adaptiveOddsFreshness,
  cacheExpiry,
  cacheIsHardExpired,
  cacheStaleUntil,
} from "./freshness";
import { effectiveTtlSeconds, mayRefresh, quotaState } from "./quota";
import { canonicalRequestKey, createOddsRequest, type CanonicalOddsRequest } from "./request";
import type { CompetitionId, OddsDataset, OddsResult, QuotaMetadata } from "./types";

export type CacheRow = {
  cacheKey: string;
  dataset: OddsDataset;
  fetchedAt: string;
  expiresAt: string;
  refreshNotBefore: string;
  /** Optional for compatibility with pre-v0.16 rows; those rows fail closed at expiry. */
  staleUntil?: string | null;
};

export type RefreshReason =
  "cache_miss" | "cache_expired" | "stale_while_revalidate" | "manual_refresh" | "event_discovery";

export type UsageRecordMetadata = {
  refreshReason: RefreshReason;
  cacheState: "miss" | "stale" | "manual" | "event_discovery";
  refreshLeaseAcquired: boolean;
  attempts: number;
  responseTimeMs: number | null;
  success: boolean;
  errorCode?: string | null;
  errorDetail?: string | null;
};

export interface OddsStore {
  read(key: string): Promise<CacheRow | null>;
  acquireLease(key: string, token: string): Promise<boolean>;
  releaseLease(key: string, token: string): Promise<void>;
  write(row: CacheRow, request: CanonicalOddsRequest): Promise<void>;
  recordHistory?(row: CacheRow, request: CanonicalOddsRequest): Promise<void>;
  latestUsed(): Promise<number | null>;
  record(
    request: CanonicalOddsRequest,
    purpose: "page_load" | "manual_refresh" | "event_discovery",
    key: string,
    quota: QuotaMetadata,
    status: number,
    metadata: UsageRecordMetadata,
  ): Promise<void>;
}

export type ProviderFetchResult = {
  events: OddsDataset["events"];
  quota: QuotaMetadata;
  status: number;
  attempts?: number;
  responseTimeMs?: number | null;
};

export type ProviderFetch = (request: CanonicalOddsRequest) => Promise<ProviderFetchResult>;
export type ScheduleRefresh = (work: () => Promise<void>) => void;

const scheduledRefreshes = new WeakMap<object, Set<string>>();

function claimScheduledRefresh(store: OddsStore, key: string) {
  const active = scheduledRefreshes.get(store) ?? new Set<string>();
  if (active.has(key)) return false;
  active.add(key);
  scheduledRefreshes.set(store, active);
  return true;
}

function releaseScheduledRefresh(store: OddsStore, key: string) {
  const active = scheduledRefreshes.get(store);
  active?.delete(key);
  if (active?.size === 0) scheduledRefreshes.delete(store);
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorMetadata(error: unknown) {
  const value = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    quota?: QuotaMetadata;
    telemetry?: { attempts?: unknown; responseTimeMs?: unknown };
  };
  return {
    quota: value?.quota ?? { used: null, remaining: null, lastRequestCost: null },
    status:
      typeof value?.status === "number" && Number.isInteger(value.status) ? value.status : 599,
    attempts:
      typeof value?.telemetry?.attempts === "number" && value.telemetry.attempts > 0
        ? value.telemetry.attempts
        : 1,
    responseTimeMs:
      typeof value?.telemetry?.responseTimeMs === "number" ? value.telemetry.responseTimeMs : null,
    errorCode: typeof value?.code === "string" ? value.code : "provider_request_failed",
    errorDetail:
      typeof value?.message === "string" ? value.message.slice(0, 240) : "Provider request failed",
  };
}

function safeStaleUntil(row: CacheRow) {
  return row.staleUntil ?? row.expiresAt;
}

function resultFromCache(
  row: CacheRow,
  cacheStatus: OddsResult["cacheStatus"],
  quotaStateValue: OddsResult["quotaState"],
): OddsResult {
  return {
    dataset: row.dataset,
    cacheStatus,
    expiresAt: row.expiresAt,
    quotaState: quotaStateValue,
  };
}

function scheduleDefault(work: () => Promise<void>) {
  void work();
}

export async function getOdds(
  dependencies: {
    store: OddsStore;
    provider: ProviderFetch;
    now?: () => Date;
    allowance?: number;
    scheduleRefresh?: ScheduleRefresh;
  },
  competitionId: CompetitionId,
  options: {
    manual?: boolean;
    cacheTtlSeconds?: number;
    purpose?: "page_load" | "manual_refresh" | "event_discovery";
    quotaExempt?: boolean;
  } = {},
): Promise<OddsResult> {
  return getOddsForRequest(dependencies, createOddsRequest(competitionId), competitionId, options);
}

export async function getOddsForRequest(
  dependencies: {
    store: OddsStore;
    provider: ProviderFetch;
    now?: () => Date;
    allowance?: number;
    scheduleRefresh?: ScheduleRefresh;
  },
  request: CanonicalOddsRequest,
  competitionId: CompetitionId,
  options: {
    manual?: boolean;
    cacheTtlSeconds?: number;
    purpose?: "page_load" | "manual_refresh" | "event_discovery";
    quotaExempt?: boolean;
    background?: boolean;
  } = {},
): Promise<OddsResult> {
  const now = dependencies.now?.() ?? new Date();
  const key = canonicalRequestKey(request);
  const cached = await dependencies.store.read(key);
  const used = await dependencies.store.latestUsed();
  const state = quotaState(used, dependencies.allowance ?? 500);
  const manual = options.manual === true;
  const background = options.background === true;
  const quotaExempt = options.quotaExempt === true || request.endpoint === "events";
  const adaptive = request.endpoint !== "events";
  const decision = adaptive ? adaptiveOddsFreshness(cached?.dataset.events ?? [], now) : null;
  const fresh = cached && new Date(cached.expiresAt) > now;
  const cooldown = cached && new Date(cached.refreshNotBefore) > now;
  const hardExpired =
    cached &&
    (adaptive
      ? cacheIsHardExpired(cached.fetchedAt, safeStaleUntil(cached), decision!, now)
      : now.getTime() >= Date.parse(safeStaleUntil(cached)));
  const staleUsable = Boolean(cached && !fresh && !hardExpired);

  if (fresh || (manual && cooldown)) {
    return resultFromCache(cached!, "hit", state);
  }

  if (cached && !manual && !background && staleUsable && decision?.refreshAllowed !== false) {
    if (quotaExempt || mayRefresh(state, false)) {
      if (claimScheduledRefresh(dependencies.store, key)) {
        const schedule = dependencies.scheduleRefresh ?? scheduleDefault;
        try {
          schedule(async () => {
            try {
              await getOddsForRequest(dependencies, request, competitionId, {
                ...options,
                manual: false,
                background: true,
              });
            } catch (error) {
              console.error("[odds-refresh] stale-while-revalidate failed", {
                competitionId,
                endpoint: request.endpoint,
                error: error instanceof Error ? error.message : String(error),
              });
            } finally {
              releaseScheduledRefresh(dependencies.store, key);
            }
          });
        } catch (error) {
          releaseScheduledRefresh(dependencies.store, key);
          throw error;
        }
      }
    }
    return resultFromCache(cached, "stale", state);
  }

  if (cached && decision?.refreshAllowed === false) {
    if (staleUsable) return resultFromCache(cached, "stale", state);
    throw new Error("Pregame odds are no longer refreshable after event start.");
  }

  if (!quotaExempt && !mayRefresh(state, manual)) {
    if (staleUsable) return resultFromCache(cached!, "stale", state);
    throw new Error("Odds refresh is unavailable while API quota is being conserved.");
  }

  const leaseToken = crypto.randomUUID();
  const acquired = await dependencies.store.acquireLease(key, leaseToken);
  if (!acquired) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(100);
      const coalesced = await dependencies.store.read(key);
      if (coalesced && new Date(coalesced.fetchedAt) >= now) {
        return resultFromCache(coalesced, "hit", state);
      }
    }
    if (staleUsable && cached) return resultFromCache(cached, "stale", state);
    throw new Error("Odds refresh is already in progress. Please try again shortly.");
  }

  let providerAttempted = false;
  let upstream: ProviderFetchResult | null = null;
  let failure: ReturnType<typeof errorMetadata> | null = null;
  const refreshReason: RefreshReason = background
    ? "stale_while_revalidate"
    : request.endpoint === "events"
      ? "event_discovery"
      : manual
        ? "manual_refresh"
        : cached
          ? "cache_expired"
          : "cache_miss";
  const cacheState: UsageRecordMetadata["cacheState"] =
    request.endpoint === "events"
      ? "event_discovery"
      : manual
        ? "manual"
        : cached
          ? "stale"
          : "miss";

  try {
    const rechecked = await dependencies.store.read(key);
    if (rechecked && new Date(rechecked.expiresAt) > now) {
      return resultFromCache(rechecked, "hit", state);
    }
    providerAttempted = true;
    upstream = await dependencies.provider(request);
    const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const upstreamState = quotaState(upstream.quota.used, dependencies.allowance ?? 500);
    const upstreamDecision = adaptive
      ? adaptiveOddsFreshness(upstream.events, new Date(fetchedAt))
      : null;
    const baseTtl = options.cacheTtlSeconds ?? 21_600;
    const ttl = adaptive
      ? effectiveTtlSeconds(upstreamDecision!.targetFreshnessSeconds, upstreamState)
      : effectiveTtlSeconds(baseTtl, upstreamState);
    const dataset: OddsDataset = { competitionId, events: upstream.events, fetchedAt };
    const row: CacheRow = {
      cacheKey: key,
      dataset,
      fetchedAt,
      expiresAt: adaptive
        ? cacheExpiry(fetchedAt, upstreamDecision!, ttl)
        : new Date(Date.parse(fetchedAt) + ttl * 1000).toISOString(),
      staleUntil: adaptive
        ? cacheStaleUntil(fetchedAt, upstreamDecision!)
        : new Date(Date.parse(fetchedAt) + ttl * 2 * 1000).toISOString(),
      refreshNotBefore: new Date(Date.parse(fetchedAt) + 300_000).toISOString(),
    };
    await dependencies.store.write(row, request);
    if (dependencies.store.recordHistory) {
      try {
        await dependencies.store.recordHistory(row, request);
      } catch (error) {
        const historyFailure = error as { code?: unknown; message?: unknown };
        console.error(
          "[odds-history] Movement history could not be recorded; the current odds cache was saved.",
          {
            competitionId,
            endpoint: request.endpoint,
            errorCode: typeof historyFailure?.code === "string" ? historyFailure.code : undefined,
            errorMessage:
              typeof historyFailure?.message === "string"
                ? historyFailure.message
                : error instanceof Error
                  ? error.message
                  : String(error),
          },
        );
      }
    }
    return {
      dataset,
      cacheStatus: cached ? "refreshed" : "miss",
      expiresAt: row.expiresAt,
      quotaState: upstreamState,
    };
  } catch (error) {
    failure = errorMetadata(error);
    if (staleUsable && cached) {
      return resultFromCache(cached, "stale", state);
    }
    throw error;
  } finally {
    if (providerAttempted) {
      const metadata: UsageRecordMetadata = {
        refreshReason,
        cacheState,
        refreshLeaseAcquired: true,
        attempts: upstream?.attempts ?? failure?.attempts ?? 1,
        responseTimeMs: upstream?.responseTimeMs ?? failure?.responseTimeMs ?? null,
        success: upstream !== null && failure === null,
        errorCode: failure?.errorCode ?? null,
        errorDetail: failure?.errorDetail ?? null,
      };
      try {
        await dependencies.store.record(
          request,
          options.purpose ?? (manual ? "manual_refresh" : "page_load"),
          key,
          upstream?.quota ??
            failure?.quota ?? {
              used: null,
              remaining: null,
              lastRequestCost: null,
            },
          upstream?.status ?? failure?.status ?? 599,
          metadata,
        );
      } catch (recordError) {
        console.error("[odds-telemetry] Provider usage could not be recorded", {
          competitionId,
          endpoint: request.endpoint,
          error: recordError instanceof Error ? recordError.message : String(recordError),
        });
      }
    }
    await dependencies.store.releaseLease(key, leaseToken);
  }
}
