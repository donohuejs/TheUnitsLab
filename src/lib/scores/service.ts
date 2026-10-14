import { quotaState } from "../odds/quota";
import type { CompetitionId, QuotaMetadata } from "../odds/types";

import { canonicalScoreRequestKey, createScoreRequest } from "./request";
import { shouldRefreshScoreTargets, type ScoreRefreshTarget } from "./priority";
import type { NormalizedScore, ScoreRefreshPurpose, ScoreRefreshResult } from "./types";

export type ScoreRefreshRow = {
  cacheKey: string;
  competitionId: CompetitionId;
  fetchedAt: string;
  expiresAt: string;
  refreshNotBefore: string;
};

export interface ScoreStore {
  readScores(competitionId: CompetitionId): Promise<NormalizedScore[]>;
  readRefresh(key: string): Promise<ScoreRefreshRow | null>;
  acquireLease(key: string, token: string): Promise<boolean>;
  releaseLease(key: string, token: string): Promise<void>;
  write(scores: NormalizedScore[], refresh: ScoreRefreshRow): Promise<void>;
  latestUsed(): Promise<number | null>;
  record(
    request: ReturnType<typeof createScoreRequest>,
    purpose: ScoreRefreshPurpose,
    key: string,
    quota: QuotaMetadata,
    status: number,
    metadata: ScoreUsageRecordMetadata,
  ): Promise<void>;
}

export type ScoreUsageRecordMetadata = {
  cacheState: "miss" | "stale";
  refreshLeaseAcquired: boolean;
  attempts: number;
  responseTimeMs: number | null;
  success: boolean;
  errorCode?: string | null;
  errorDetail?: string | null;
};

export type ScoreProviderFetch = (request: ReturnType<typeof createScoreRequest>) => Promise<{
  scores: NormalizedScore[];
  quota: QuotaMetadata;
  status: number;
  attempts?: number;
  responseTimeMs?: number | null;
}>;

function mayRefreshScores(state: ReturnType<typeof quotaState>, purpose: ScoreRefreshPurpose) {
  if (state === "critical") return purpose === "settlement";
  if (state === "high") return purpose !== "active_view";
  return true;
}

export function scoreTtlSeconds(scores: NormalizedScore[], quota: ReturnType<typeof quotaState>) {
  if (scores.some((score) => score.isLive)) {
    return quota === "normal" ? 60 : quota === "conserve" ? 120 : 300;
  }
  if (scores.length > 0 && scores.every((score) => score.isFinal)) return 86_400;
  return quota === "normal" ? 900 : 1800;
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

export async function getScores(
  dependencies: {
    store: ScoreStore;
    provider: ScoreProviderFetch;
    now?: () => Date;
    allowance?: number;
  },
  competitionId: CompetitionId,
  purpose: ScoreRefreshPurpose,
  targets?: readonly ScoreRefreshTarget[],
): Promise<ScoreRefreshResult> {
  const now = dependencies.now?.() ?? new Date();
  const request = createScoreRequest(competitionId);
  const key = canonicalScoreRequestKey(request);
  const [cachedScores, refresh, used] = await Promise.all([
    dependencies.store.readScores(competitionId),
    dependencies.store.readRefresh(key),
    dependencies.store.latestUsed(),
  ]);
  const state = quotaState(used, dependencies.allowance ?? 500);
  if (refresh && new Date(refresh.expiresAt) > now) {
    return { scores: cachedScores, cacheStatus: "hit", quotaState: state };
  }
  if (targets && !shouldRefreshScoreTargets(cachedScores, targets, now)) {
    return { scores: cachedScores, cacheStatus: "stale", quotaState: state };
  }
  if (!mayRefreshScores(state, purpose)) {
    return { scores: cachedScores, cacheStatus: "stale", quotaState: state };
  }
  const token = crypto.randomUUID();
  if (!(await dependencies.store.acquireLease(key, token))) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(100);
      const coalesced = await dependencies.store.readRefresh(key);
      if (coalesced && new Date(coalesced.fetchedAt) >= now) {
        return {
          scores: await dependencies.store.readScores(competitionId),
          cacheStatus: "hit",
          quotaState: state,
        };
      }
    }
    return { scores: cachedScores, cacheStatus: "stale", quotaState: state };
  }
  let providerAttempted = false;
  let upstream: Awaited<ReturnType<ScoreProviderFetch>> | null = null;
  let failure: ReturnType<typeof errorMetadata> | null = null;
  try {
    const rechecked = await dependencies.store.readRefresh(key);
    if (rechecked && new Date(rechecked.expiresAt) > now) {
      return {
        scores: await dependencies.store.readScores(competitionId),
        cacheStatus: "hit",
        quotaState: state,
      };
    }
    providerAttempted = true;
    upstream = await dependencies.provider(request);
    const fetchedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const upstreamState = quotaState(upstream.quota.used, dependencies.allowance ?? 500);
    const ttl = scoreTtlSeconds(upstream.scores, upstreamState);
    const row = {
      cacheKey: key,
      competitionId,
      fetchedAt,
      expiresAt: new Date(new Date(fetchedAt).getTime() + ttl * 1000).toISOString(),
      refreshNotBefore: new Date(new Date(fetchedAt).getTime() + 60_000).toISOString(),
    };
    await dependencies.store.write(upstream.scores, row);
    return {
      scores: upstream.scores,
      cacheStatus: cachedScores.length ? "refreshed" : "miss",
      quotaState: upstreamState,
    };
  } catch (error) {
    failure = errorMetadata(error);
    if (cachedScores.length)
      return { scores: cachedScores, cacheStatus: "stale", quotaState: state };
    throw error;
  } finally {
    if (providerAttempted) {
      try {
        await dependencies.store.record(
          request,
          purpose,
          key,
          upstream?.quota ??
            failure?.quota ?? {
              used: null,
              remaining: null,
              lastRequestCost: null,
            },
          upstream?.status ?? failure?.status ?? 599,
          {
            cacheState: cachedScores.length ? "stale" : "miss",
            refreshLeaseAcquired: true,
            attempts: upstream?.attempts ?? failure?.attempts ?? 1,
            responseTimeMs: upstream?.responseTimeMs ?? failure?.responseTimeMs ?? null,
            success: upstream !== null && failure === null,
            errorCode: failure?.errorCode ?? null,
            errorDetail: failure?.errorDetail ?? null,
          },
        );
      } catch (recordError) {
        console.error("[score-telemetry] Provider usage could not be recorded", {
          competitionId,
          error: recordError instanceof Error ? recordError.message : String(recordError),
        });
      }
    }
    await dependencies.store.releaseLease(key, token);
  }
}
