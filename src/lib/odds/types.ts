import type { TeamResolution } from "../teams/logos";

export type OddsProviderId = "the_odds_api_v4";
export type MarketScope = "game" | "team" | "player";
export type MarketPeriod =
  "full_game" | "first_half" | "second_half" | "quarter" | "period" | "soccer_half";
export type MarketVariant = "main" | "alternate";

export type CompetitionId =
  "epl" | "ucl" | "uel" | "laliga" | "ncaaf" | "ncaab" | "nfl" | "nba" | "nhl";
export type MarketType = "moneyline" | "spread" | "total";
export type SelectionType = "home" | "away" | "draw" | "over" | "under";

export type NormalizedOdds = {
  bookmakerId: string;
  bookmakerName: string;
  providerBookmakerKey?: string;
  providerMarketKey?: string;
  providerSelectionName?: string;
  marketType: MarketType;
  marketScope?: MarketScope;
  marketPeriod?: MarketPeriod;
  marketVariant?: MarketVariant;
  participantId?: string | null;
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
  provider?: OddsProviderId;
  providerEventId: string;
  sport: "soccer" | "football" | "basketball" | "hockey";
  competitionId: CompetitionId;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamIdentity?: TeamResolution;
  awayTeamIdentity?: TeamResolution;
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
