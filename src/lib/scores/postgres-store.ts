import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompetitionId, QuotaMetadata } from "@/lib/odds/types";

import type { CanonicalScoreRequest } from "./request";
import type { ScoreRefreshRow, ScoreStore } from "./service";
import type { NormalizedScore, ScoreRefreshPurpose } from "./types";

export class PostgresScoreStore implements ScoreStore {
  constructor(private readonly client: SupabaseClient) {}

  async readScores(competitionId: CompetitionId) {
    const { data, error } = await this.client
      .from("event_scores")
      .select("*")
      .eq("competition_key", competitionId);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      providerEventId: row.provider_event_id,
      sport: row.sport,
      competitionId: row.competition_key,
      providerSportKey: row.provider_sport_key,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      scheduledStart: row.scheduled_start,
      state: row.state,
      statusText: row.status_text,
      homeScore: row.home_score,
      awayScore: row.away_score,
      isLive: row.is_live,
      isFinal: row.is_final,
      clockText: row.clock_text,
      periodText: row.period_text,
      providerLastUpdate: row.provider_last_update,
      refreshedAt: row.refreshed_at,
    })) as NormalizedScore[];
  }

  async readRefresh(key: string) {
    const { data, error } = await this.client
      .from("score_refresh_state")
      .select("*")
      .eq("cache_key", key)
      .maybeSingle();
    if (error) throw error;
    return data
      ? ({
          cacheKey: data.cache_key,
          competitionId: data.competition_key,
          fetchedAt: data.fetched_at,
          expiresAt: data.expires_at,
          refreshNotBefore: data.refresh_not_before,
        } satisfies ScoreRefreshRow)
      : null;
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

  async write(scores: NormalizedScore[], refresh: ScoreRefreshRow) {
    for (const score of scores) {
      const { error } = await this.client.rpc("record_event_score", {
        p_provider_event_id: score.providerEventId,
        p_sport: score.sport,
        p_competition_key: score.competitionId,
        p_provider_sport_key: score.providerSportKey,
        p_home_team: score.homeTeam,
        p_away_team: score.awayTeam,
        p_scheduled_start: score.scheduledStart,
        p_state: score.state,
        p_status_text: score.statusText,
        p_home_score: score.homeScore,
        p_away_score: score.awayScore,
        p_clock_text: score.clockText,
        p_period_text: score.periodText,
        p_provider_last_update: score.providerLastUpdate,
        p_refreshed_at: score.refreshedAt,
      });
      if (error) throw error;
    }
    const { error } = await this.client.from("score_refresh_state").upsert({
      cache_key: refresh.cacheKey,
      competition_key: refresh.competitionId,
      fetched_at: refresh.fetchedAt,
      expires_at: refresh.expiresAt,
      refresh_not_before: refresh.refreshNotBefore,
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
    request: CanonicalScoreRequest,
    purpose: ScoreRefreshPurpose,
    key: string,
    quota: QuotaMetadata,
    status: number,
  ) {
    const { error } = await this.client.from("api_usage_ledger").insert({
      provider: request.provider,
      endpoint: request.endpoint,
      sport: request.providerSportKey.split("_")[0],
      competition: request.competitionId,
      request_purpose: `score_${purpose}`,
      cache_key: key,
      http_status: status,
      credits_consumed: quota.lastRequestCost,
      credits_used: quota.used,
      credits_remaining: quota.remaining,
    });
    if (error) throw error;
  }
}
