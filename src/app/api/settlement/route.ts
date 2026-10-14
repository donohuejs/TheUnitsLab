import { timingSafeEqual } from "node:crypto";

import { readServerEnvironment } from "@/config/env.server";
import { getCompetition } from "@/lib/odds/request";
import type { CompetitionId } from "@/lib/odds/types";
import { runScoreAndSettlementCycle } from "@/lib/scores/server";
import type { ScoreRefreshTarget } from "@/lib/scores/priority";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function authorized(request: Request, expected: string) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: "Scheduled settlement is not configured." }, { status: 503 });
  }
  if (!authorized(request, cronSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  readServerEnvironment(process.env);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("bets")
    .select("bet_legs(provider_event_id,competition_key,scheduled_start)")
    .eq("status", "open")
    .eq("is_synthetic", false);
  if (error) return Response.json({ error: "Open wagers could not be loaded." }, { status: 500 });
  const targets = (data ?? [])
    .flatMap((ticket) => ticket.bet_legs)
    .filter(
      (
        leg,
      ): leg is { provider_event_id: string; competition_key: string; scheduled_start: string } =>
        typeof leg.provider_event_id === "string" &&
        typeof leg.competition_key === "string" &&
        typeof leg.scheduled_start === "string" &&
        Boolean(getCompetition(leg.competition_key)),
    )
    .map((leg): ScoreRefreshTarget => ({
      competitionId: leg.competition_key as CompetitionId,
      providerEventId: leg.provider_event_id,
      scheduledStart: leg.scheduled_start,
    }));
  const result = await runScoreAndSettlementCycle(targets, "settlement");
  return Response.json(result);
}

// Vercel Cron invokes configured paths with GET. Keep POST available for
// operators and make the existing protected settlement cycle scheduler-compatible.
export async function GET(request: Request) {
  return POST(request);
}
