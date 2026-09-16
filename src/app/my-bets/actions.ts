"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getCompetition } from "@/lib/odds/request";
import type { CompetitionId } from "@/lib/odds/types";
import { runScoreAndSettlementCycle } from "@/lib/scores/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const betIdSchema = z.uuid();

export async function cancelSimulatedBet(formData: FormData) {
  const betId = formData.get("betId");
  const parsed = betIdSchema.safeParse(typeof betId === "string" ? betId : "");
  if (!parsed.success) redirect("/my-bets?notice=The%20cancellation%20request%20is%20invalid.");

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const { data, error } = await supabase.rpc("cancel_simulated_bet", {
    p_bet_id: parsed.data,
  });
  if (error || data === "failed") {
    const message = (error?.message ?? "").includes("EVENT_ALREADY_STARTED")
      ? "This simulated wager can no longer be cancelled because an event has started."
      : "This simulated wager could not be cancelled. It may already be settled.";
    redirect(`/my-bets?notice=${encodeURIComponent(message)}`);
  }
  if (data === "already_settled") {
    redirect("/my-bets?notice=This simulated wager was already settled or cancelled.");
  }
  redirect("/my-bets?notice=Simulated wager cancelled; the original Vial stake was refunded once.");
}

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
