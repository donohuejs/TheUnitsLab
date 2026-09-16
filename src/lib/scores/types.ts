import type { CompetitionId, QuotaState } from "../odds/types";

export type ScoreState = "scheduled" | "live" | "final";

export type NormalizedScore = {
  providerEventId: string;
  sport: "soccer" | "football" | "basketball";
  competitionId: CompetitionId;
  providerSportKey: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string;
  state: ScoreState;
  statusText: string;
  homeScore: number | null;
  awayScore: number | null;
  isLive: boolean;
  isFinal: boolean;
  clockText: string | null;
  periodText: string | null;
  providerLastUpdate: string | null;
  refreshedAt: string;
};

export type ScoreRefreshPurpose = "active_view" | "open_wagers" | "settlement";

export type ScoreRefreshResult = {
  scores: NormalizedScore[];
  cacheStatus: "hit" | "miss" | "refreshed" | "stale";
  quotaState: QuotaState;
};
