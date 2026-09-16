import { timingSafeEqual } from "node:crypto";

import { readServerEnvironment } from "@/config/env.server";
import { getCompetition } from "@/lib/odds/request";
import type { CompetitionId } from "@/lib/odds/types";
import { runScoreAndSettlementCycle } from "@/lib/scores/server";
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
    .select("bet_legs(competition_key)")
    .eq("status", "open")
    .eq("source", "simulated")
    .eq("is_synthetic", false);
  if (error) return Response.json({ error: "Open wagers could not be loaded." }, { status: 500 });
  const competitionIds = (data ?? [])
    .flatMap((ticket) => ticket.bet_legs)
    .map((leg) => leg.competition_key)
    .filter((id): id is CompetitionId => Boolean(getCompetition(id)));
  const result = await runScoreAndSettlementCycle(competitionIds, "settlement");
  return Response.json(result);
}

// Vercel Cron invokes configured paths with GET. Keep POST available for
// operators and make the existing protected settlement cycle scheduler-compatible.
export async function GET(request: Request) {
  return POST(request);
}
