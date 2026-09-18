import { NextResponse } from "next/server";

import { parseNonNegativeMoneyToMinorUnits } from "@/lib/external-wagers/calculations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ duplicates: [] }, { status: 401 });
  const input = (await request.json()) as Record<string, unknown>;
  let stakeDollars: number | null = null;
  try {
    const rawStake = String(input.stakeDollars ?? "").trim();
    stakeDollars = rawStake ? Number(parseNonNegativeMoneyToMinorUnits(rawStake)) / 100 : null;
  } catch {
    stakeDollars = null;
  }
  const { data, error } = await supabase.rpc("find_import_duplicates_v2", {
    p_sportsbook_id: String(input.sportsbookId ?? "") || null,
    p_sportsbook_bet_id: String(input.sportsbookBetId ?? "") || null,
    p_import_content_hash: null,
    p_wager_date: input.wagerDate ? new Date(String(input.wagerDate)).toISOString() : null,
    p_stake_dollars: stakeDollars,
    p_american_odds: input.americanOdds ? Number(input.americanOdds) : null,
    p_ticket_type: String(input.ticketType ?? "straight"),
    p_market_type: String(input.marketType ?? "moneyline"),
    p_selection: String(input.selection ?? ""),
    p_line: input.line === "" || input.line === null ? null : Number(input.line),
    p_event_description: String(input.eventDescription ?? ""),
    p_parlay_legs: Array.isArray(input.parlayLegs) ? input.parlayLegs : null,
  });
  return NextResponse.json({ duplicates: error ? [] : (data ?? []) });
}
