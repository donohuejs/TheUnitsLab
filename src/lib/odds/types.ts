export type CompetitionId =
  "epl" | "ucl" | "uel" | "laliga" | "ncaaf" | "ncaab" | "nfl" | "nba" | "nhl";
export type MarketType = "moneyline" | "spread" | "total";
export type SelectionType = "home" | "away" | "draw" | "over" | "under";

export type NormalizedOdds = {
  bookmakerId: string;
  bookmakerName: string;
  marketType: MarketType;
  selection: SelectionType;
  selectionName: string;
  point: number | null;
  americanOdds: number;
  decimalOdds: number;
  isAlternate?: boolean;
  providerUpdatedAt: string;
  fetchedAt: string;
};

export type NormalizedEvent = {
  id: string;
  providerEventId: string;
  sport: "soccer" | "football" | "basketball" | "hockey";
  competitionId: CompetitionId;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string;
  status: "scheduled" | "live" | "completed";
  providerSportKey: string;
  odds: NormalizedOdds[];
};

export type OddsDataset = {
  competitionId: CompetitionId;
  events: NormalizedEvent[];
  fetchedAt: string;
};

export type QuotaMetadata = {
  used: number | null;
  remaining: number | null;
  lastRequestCost: number | null;
};

export type CacheStatus = "hit" | "miss" | "refreshed" | "stale";

export type OddsResult = {
  dataset: OddsDataset;
  cacheStatus: CacheStatus;
  expiresAt: string;
  quotaState: QuotaState;
};

export type QuotaState = "normal" | "conserve" | "high" | "critical";
