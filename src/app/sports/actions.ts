"use server";

import { redirect } from "next/navigation";
import { getCompetition } from "@/lib/odds/request";
import { getCompetitionOdds } from "@/lib/odds/server";
import type { CompetitionId } from "@/lib/odds/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function refreshOdds(formData: FormData) {
  const id = String(formData.get("competitionId") ?? "");
  const competition = getCompetition(id);
  if (!competition) redirect("/sports");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth");
  try {
    await getCompetitionOdds(competition.id as CompetitionId, true);
    redirect(`/sports/${competition.id}?notice=Refresh+request+completed`);
  } catch {
    redirect(
      `/sports/${competition.id}?notice=${encodeURIComponent("Odds refresh could not be completed. Cached data remains unchanged.")}`,
    );
  }
}
