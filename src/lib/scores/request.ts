import { createHash } from "node:crypto";

import { getCompetition } from "../odds/request";
import type { CompetitionId } from "../odds/types";

export type CanonicalScoreRequest = {
  provider: "the_odds_api_v4";
  endpoint: "scores";
  competitionId: CompetitionId;
  providerSportKey: string;
  daysFrom: 3;
  dateFormat: "iso";
};

export function createScoreRequest(competitionId: CompetitionId): CanonicalScoreRequest {
  const competition = getCompetition(competitionId);
  if (!competition) throw new Error("Unsupported competition");
  return {
    provider: "the_odds_api_v4",
    endpoint: "scores",
    competitionId,
    providerSportKey: competition.providerSportKey,
    daysFrom: 3,
    dateFormat: "iso",
  };
}

export function canonicalScoreRequestKey(request: CanonicalScoreRequest) {
  return `scores:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`;
}
