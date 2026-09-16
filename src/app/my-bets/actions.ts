"use server";

import { redirect } from "next/navigation";

import { getCompetition } from "@/lib/odds/request";
import type { CompetitionId } from "@/lib/odds/types";
import { runScoreAndSettlementCycle } from "@/lib/scores/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function refreshMyOpenScores() {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const { data, error } = await supabase
    .from("bets")
    .select("bet_legs(competition_key)")
    .eq("status", "open");
  if (error) redirect("/my-bets?notice=Open%20wagers%20could%20not%20be%20loaded.");
  const competitionIds = (data ?? [])
    .flatMap((ticket) => ticket.bet_legs)
    .map((leg) => leg.competition_key)
    .filter((id): id is CompetitionId => Boolean(getCompetition(id)));
  try {
    await runScoreAndSettlementCycle(competitionIds, "active_view");
    redirect("/my-bets?notice=Shared%20scores%20and%20settlements%20were%20checked.");
  } catch {
    redirect(
      "/my-bets?notice=Cached%20scores%20remain%20available%3B%20refresh%20was%20not%20completed.",
    );
  }
}
