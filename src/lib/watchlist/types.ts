import type { MarketType, SelectionType } from "@/lib/odds/types";

export type OddsHistoryPoint = {
  line: number | null;
  americanOdds: number;
  decimalOdds: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type ActiveWatch = {
  id: string;
  providerEventId: string;
  sportKey: string;
  competitionKey: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string;
  bookmakerId: string;
  bookmakerName: string;
  marketType: MarketType;
  selection: SelectionType;
  selectionName: string;
  initialLine: number | null;
  initialAmericanOdds: number;
  initialDecimalOdds: number;
  createdAt: string;
  currentLine: number | null;
  currentAmericanOdds: number | null;
  currentDecimalOdds: number | null;
  currentObservedAt: string | null;
  currentAvailable: boolean;
  history: OddsHistoryPoint[];
};
