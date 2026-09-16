import "server-only";

import { readServerEnvironment } from "@/config/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { normalizeOddsResponse } from "./normalize";
import { PostgresOddsStore } from "./postgres-store";
import { fetchOddsProvider } from "./provider";
import { getOdds } from "./service";
import type { CompetitionId } from "./types";

export async function getCompetitionOdds(competitionId: CompetitionId, manual = false) {
  const environment = readServerEnvironment(process.env);
  const store = new PostgresOddsStore(createSupabaseAdminClient());
  return getOdds(
    {
      store,
      allowance: environment.ODDS_API_MONTHLY_ALLOWANCE,
      provider: async (request) => {
        const response = await fetchOddsProvider(request, environment.THE_ODDS_API_KEY);
        const fetchedAt = new Date().toISOString();
        return {
          events: normalizeOddsResponse(response.body, competitionId, fetchedAt),
          quota: response.quota,
          status: response.status,
        };
      },
    },
    competitionId,
    { manual },
  );
}
