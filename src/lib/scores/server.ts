import "server-only";

import { readServerEnvironment } from "@/config/env.server";
import type { CompetitionId } from "@/lib/odds/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { normalizeScoreResponse } from "./normalize";
import { PostgresScoreStore } from "./postgres-store";
import { fetchScoreProvider } from "./provider";
import { getScores } from "./service";
import type { ScoreRefreshPurpose } from "./types";
import { uniqueScoreTargets, type ScoreRefreshTarget } from "./priority";

export async function refreshCompetitionScores(
  competitionId: CompetitionId,
  purpose: ScoreRefreshPurpose,
  targets?: readonly ScoreRefreshTarget[],
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
          attempts: response.attempts,
          responseTimeMs: response.responseTimeMs,
        };
      },
    },
    competitionId,
    purpose,
    targets,
  );
}

export async function runScoreAndSettlementCycle(
  targetsOrCompetitions: CompetitionId[] | ScoreRefreshTarget[],
  purpose: ScoreRefreshPurpose,
) {
  const isTarget = (value: CompetitionId | ScoreRefreshTarget): value is ScoreRefreshTarget =>
    typeof value === "object";
  const targets = targetsOrCompetitions.filter(isTarget);
  const competitionIds = isTarget(targetsOrCompetitions[0] as CompetitionId | ScoreRefreshTarget)
    ? [...new Set(targets.map((target) => target.competitionId))]
    : [...new Set(targetsOrCompetitions as CompetitionId[])];
  const unique = competitionIds;
  const refreshes = [];
  for (const competitionId of unique) {
    try {
      refreshes.push({
        competitionId,
        ...(await refreshCompetitionScores(
          competitionId,
          purpose,
          targets.length
            ? uniqueScoreTargets(targets.filter((target) => target.competitionId === competitionId))
            : undefined,
        )),
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
