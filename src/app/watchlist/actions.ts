"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCompetition } from "@/lib/odds/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const returnPath = z
  .string()
  .max(2048)
  .refine((path) => /^\/(sports(?:\/|\?|$)|watchlist(?:\/|\?|$))/.test(path));

const watchSchema = z.object({
  competitionKey: z.string().trim().min(1).max(40),
  eventId: z.string().trim().min(1).max(300),
  bookmakerId: z.string().trim().min(1).max(80),
  marketType: z.enum(["moneyline", "spread", "total"]),
  selection: z.enum(["home", "away", "draw", "over", "under"]),
  expectedLine: z.union([z.literal(""), z.coerce.number().finite()]),
  expectedAmericanOdds: z.coerce
    .number()
    .int()
    .refine((odds) => odds >= 100 || odds <= -100),
  returnTo: returnPath.default("/sports"),
});

const stopSchema = z.object({ watchId: z.uuid(), returnTo: returnPath.default("/watchlist") });

function field(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function notice(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(message)}`);
}

export async function watchOdds(formData: FormData) {
  const parsed = watchSchema.safeParse({
    competitionKey: field(formData, "competitionKey"),
    eventId: field(formData, "eventId"),
    bookmakerId: field(formData, "bookmakerId"),
    marketType: field(formData, "marketType"),
    selection: field(formData, "selection"),
    expectedLine: field(formData, "expectedLine"),
    expectedAmericanOdds: field(formData, "expectedAmericanOdds"),
    returnTo: field(formData, "returnTo") || "/sports",
  });
  if (!parsed.success || !getCompetition(parsed.data?.competitionKey ?? "")) {
    notice("/sports", "Choose a valid pregame market to watch.");
  }
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) notice("/auth", "Please sign in to continue.");
  const { error } = await supabase.rpc("watch_odds", {
    p_competition_key: parsed.data.competitionKey,
    p_provider_event_id: parsed.data.eventId,
    p_bookmaker_id: parsed.data.bookmakerId,
    p_market_type: parsed.data.marketType,
    p_selection: parsed.data.selection,
    p_expected_line: parsed.data.expectedLine === "" ? null : parsed.data.expectedLine,
    p_expected_american_odds: parsed.data.expectedAmericanOdds,
  });
  if (error) {
    console.error("[watchlist] Watch creation failed.", {
      competitionKey: parsed.data.competitionKey,
      errorCode: error.code,
      errorMessage: error.message,
    });
    const message = error.message.includes("WATCH_ODDS_CHANGED")
      ? "The odds moved. Review the latest price before watching."
      : "We couldn't save this watch. Current odds are still available; try again later.";
    notice(parsed.data.returnTo, message);
  }
  revalidatePath("/watchlist");
  revalidatePath(`/sports/${parsed.data.competitionKey}`);
  notice(parsed.data.returnTo, "Now watching this market.");
}

export async function stopWatching(formData: FormData) {
  const parsed = stopSchema.safeParse({
    watchId: field(formData, "watchId"),
    returnTo: field(formData, "returnTo") || "/watchlist",
  });
  if (!parsed.success) notice("/watchlist", "Choose a valid watch.");
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) notice("/auth", "Please sign in to continue.");
  const { error } = await supabase.rpc("stop_watching_odds", {
    p_watch_id: parsed.data.watchId,
  });
  if (error) {
    console.error("[watchlist] Watch clearing failed.", {
      errorCode: error.code,
      errorMessage: error.message,
    });
    notice(parsed.data.returnTo, "This watch could not be cleared. Reload to verify its status.");
  }
  revalidatePath("/watchlist");
  revalidatePath("/sports");
  notice(parsed.data.returnTo, "Watch removed from your active Watchlist.");
}
