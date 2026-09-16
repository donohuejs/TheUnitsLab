import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ duplicates: [] }, { status: 401 });
  const input = (await request.json()) as Record<string, unknown>;
  const { data, error } = await supabase.rpc("find_import_duplicates", {
    p_sportsbook_id: String(input.sportsbookId ?? ""),
    p_sportsbook_bet_id: String(input.sportsbookBetId ?? "") || null,
    p_import_content_hash: null,
    p_wager_date: input.wagerDate ? new Date(String(input.wagerDate)).toISOString() : null,
    p_stake_dollars: input.stakeDollars ? Number(input.stakeDollars) : null,
    p_american_odds: input.americanOdds ? Number(input.americanOdds) : null,
    p_event_description: String(input.eventDescription ?? ""),
  });
  return NextResponse.json({ duplicates: error ? [] : (data ?? []) });
}
