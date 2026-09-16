"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getCompetition } from "@/lib/odds/request";
import { parseStakeToMinorUnits, formatUnits } from "@/lib/wagers/calculations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const placementSchema = z.object({
  competitionKey: z.string().trim().min(1).max(40),
  eventId: z.string().trim().min(1).max(300),
  bookmakerId: z.string().trim().min(1).max(80),
  marketType: z.enum(["moneyline", "spread", "total"]),
  selection: z.enum(["home", "away", "draw", "over", "under"]),
  expectedAmericanOdds: z.coerce
    .number()
    .int()
    .refine((odds) => odds >= 100 || odds <= -100),
  expectedLine: z.union([z.literal(""), z.coerce.number().finite()]),
  stake: z.string().trim(),
  groupId: z.union([z.literal(""), z.uuid()]),
});

const parlayLegSchema = z.object({
  competitionKey: z.string().trim().min(1).max(40),
  eventId: z.string().trim().min(1).max(300),
  bookmakerId: z.string().trim().min(1).max(80),
  marketType: z.enum(["moneyline", "spread", "total"]),
  selection: z.enum(["home", "away", "draw", "over", "under"]),
  expectedAmericanOdds: z
    .number()
    .int()
    .refine((odds) => odds >= 100 || odds <= -100),
  expectedLine: z.number().finite().nullable(),
});

const parlayPlacementSchema = z.object({
  legs: z.array(parlayLegSchema).min(2).max(12),
  stake: z.string().trim(),
  groupId: z.union([z.literal(""), z.uuid()]),
});

function formValue(formData: FormData, field: string) {
  const candidate = formData.get(field);
  return typeof candidate === "string" ? candidate : "";
}

function notice(path: string, message: string): never {
  redirect(`${path}?notice=${encodeURIComponent(message)}`);
}

function placementMessage(message: string) {
  if (message.includes("ODDS_CHANGED")) {
    return "The line or odds changed. Review and select the current price before placing the wager.";
  }
  if (message.includes("FRESH_ODDS_REQUIRED")) {
    return "The displayed odds expired. Refresh the competition and review the current price.";
  }
  if (message.includes("INSUFFICIENT_BANKROLL")) return "Insufficient virtual bankroll.";
  if (message.includes("EVENT_ALREADY_STARTED")) return "This event has already started.";
  if (message.includes("INVALID_GROUP_ASSOCIATION"))
    return "That group association is not authorized.";
  if (message.includes("OUTCOME_NOT_AVAILABLE") || message.includes("EVENT_NOT_AVAILABLE")) {
    return "That market selection is no longer available.";
  }
  return "The simulated wager could not be placed. Review the selection and try again.";
}

export async function placeStraightBet(formData: FormData) {
  const parsed = placementSchema.safeParse({
    competitionKey: formValue(formData, "competitionKey"),
    eventId: formValue(formData, "eventId"),
    bookmakerId: formValue(formData, "bookmakerId"),
    marketType: formValue(formData, "marketType"),
    selection: formValue(formData, "selection"),
    expectedAmericanOdds: formValue(formData, "expectedAmericanOdds"),
    expectedLine: formValue(formData, "expectedLine"),
    stake: formValue(formData, "stake"),
    groupId: formValue(formData, "groupId"),
  });
  if (!parsed.success || !getCompetition(parsed.data?.competitionKey ?? "")) {
    notice("/sports", "The simulated wager request is invalid.");
  }

  let stake: string;
  try {
    stake = formatUnits(parseStakeToMinorUnits(parsed.data.stake));
  } catch {
    notice(
      `/sports/${parsed.data.competitionKey}`,
      "Enter a positive stake using at most two decimals.",
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) notice("/auth", "Please sign in to continue.");

  const { data, error } = await supabase.rpc("place_simulated_straight_bet", {
    p_competition_key: parsed.data.competitionKey,
    p_event_id: parsed.data.eventId,
    p_bookmaker_id: parsed.data.bookmakerId,
    p_market_type: parsed.data.marketType,
    p_selection: parsed.data.selection,
    p_expected_american_odds: parsed.data.expectedAmericanOdds,
    p_expected_line: parsed.data.expectedLine === "" ? null : parsed.data.expectedLine,
    p_stake_units: stake,
    p_group_id: parsed.data.groupId || null,
  });
  if (error || !data) {
    notice(`/sports/${parsed.data.competitionKey}`, placementMessage(error?.message ?? ""));
  }

  notice("/my-bets", "Simulated straight wager placed and stake debited once.");
}

export async function placeParlayBet(formData: FormData) {
  let submittedLegs: unknown;
  try {
    submittedLegs = JSON.parse(formValue(formData, "legs"));
  } catch {
    notice("/sports", "The parlay leg list is invalid.");
  }
  const parsed = parlayPlacementSchema.safeParse({
    legs: submittedLegs,
    stake: formValue(formData, "stake"),
    groupId: formValue(formData, "groupId"),
  });
  if (!parsed.success || parsed.data.legs.some((leg) => !getCompetition(leg.competitionKey))) {
    notice("/sports", "A parlay requires 2–12 supported selections.");
  }
  let stake: string;
  try {
    stake = formatUnits(parseStakeToMinorUnits(parsed.data.stake));
  } catch {
    notice("/sports", "Enter a positive parlay stake using at most two decimals.");
  }
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) notice("/auth", "Please sign in to continue.");
  const { data, error } = await supabase.rpc("place_simulated_parlay_bet", {
    p_legs: parsed.data.legs,
    p_stake_units: stake,
    p_group_id: parsed.data.groupId || null,
  });
  if (error || !data) {
    const message = error?.message ?? "";
    if (message.includes("SAME_EVENT_PARLAY_NOT_SUPPORTED")) {
      notice(
        "/sports",
        "Same-game parlay (SGP) pricing is not currently supported; choose a different event.",
      );
    }
    if (message.includes("PARLAY_REQUIRES_ONE_BOOKMAKER")) {
      notice("/sports", "All simulated parlay legs must use the same bookmaker.");
    }
    notice("/sports", placementMessage(message));
  }
  notice("/my-bets", "Simulated parlay placed atomically and its stake was debited once.");
}
