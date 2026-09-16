import "server-only";

import { readServerEnvironment } from "@/config/env.server";
import type { CompetitionId } from "@/lib/odds/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { normalizeScoreResponse } from "./normalize";
import { PostgresScoreStore } from "./postgres-store";
import { fetchScoreProvider } from "./provider";
import { getScores } from "./service";
import type { ScoreRefreshPurpose } from "./types";

export async function refreshCompetitionScores(
  competitionId: CompetitionId,
  purpose: ScoreRefreshPurpose,
) {
  const environment = readServerEnvironment(process.env);
  const store = new PostgresScoreStore(createSupabaseAdminClient());
  return getScores(
    {
      store,
      allowance: environment.ODDS_API_MONTHLY_ALLOWANCE,
      provider: async (request) => {
        const response = await fetchScoreProvider(request, environment.THE_ODDS_API_KEY);
        const refreshedAt = new Date().toISOString();
        return {
          scores: normalizeScoreResponse(response.body, competitionId, refreshedAt),
          quota: response.quota,
          status: response.status,
        };
      },
    },
    competitionId,
    purpose,
  );
}

export async function runScoreAndSettlementCycle(
  competitionIds: CompetitionId[],
  purpose: ScoreRefreshPurpose,
) {
  const unique = [...new Set(competitionIds)];
  const refreshes = [];
  for (const competitionId of unique) {
    try {
      refreshes.push({
        competitionId,
        ...(await refreshCompetitionScores(competitionId, purpose)),
      });
    } catch (error) {
      refreshes.push({
        competitionId,
        error: error instanceof Error ? error.message : "Score refresh failed",
      });
    }
  }
  const admin = createSupabaseAdminClient();
  const { data: settlement, error } = await admin.rpc("settle_open_simulated_bets");
  if (error) throw error;
  return { refreshes, settlement };
}
