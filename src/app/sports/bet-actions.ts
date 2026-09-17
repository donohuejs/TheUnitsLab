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
  anchorProviderLine: z.union([z.literal(""), z.coerce.number().finite()]).default(""),
  anchorProviderAmericanOdds: z.union([z.literal(""), z.coerce.number().int()]).default(""),
  pricingSource: z.enum(["provider", "simulated_alternate"]).default("provider"),
  pricingModel: z.string().trim().max(80).default(""),
  pricingModelVersion: z.string().trim().max(20).default(""),
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
  anchorProviderLine: z.number().finite().nullable().optional(),
  anchorProviderAmericanOdds: z.number().int().nullable().optional(),
  pricingSource: z.enum(["provider", "simulated_alternate"]).optional().default("provider"),
  pricingModel: z.string().trim().max(80).nullable().optional(),
  pricingModelVersion: z.string().trim().max(20).nullable().optional(),
});

const parlayPlacementSchema = z.object({
  legs: z.array(parlayLegSchema).min(2).max(12),
  stake: z.string().trim(),
  groupId: z.union([z.literal(""), z.uuid()]),
  slipKeys: z.string().trim().max(4096).optional().default(""),
});

const straightBatchSchema = z.object({
  legs: z.array(parlayLegSchema).min(1).max(12),
  stake: z.string().trim(),
  groupId: z.union([z.literal(""), z.uuid()]),
  slipKeys: z.string().trim().max(4096).optional().default(""),
});

function formValue(formData: FormData, field: string) {
  const candidate = formData.get(field);
  return typeof candidate === "string" ? candidate : "";
}

function notice(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}notice=${encodeURIComponent(message)}`);
}

function placementMessage(message: string) {
  if (message.includes("ODDS_CHANGED")) {
    return "The line or odds changed. Review and select the current price before placing the wager.";
  }
  if (message.includes("FRESH_ODDS_REQUIRED")) {
    return "The displayed odds expired. Refresh the competition and review the current price.";
  }
  if (message.includes("INSUFFICIENT_BANKROLL")) return "Insufficient Vial balance.";
  if (message.includes("EVENT_ALREADY_STARTED")) return "This event has already started.";
  if (message.includes("INVALID_SIMULATED_ALTERNATE")) {
    return "The simulated alternate line is invalid or its provider anchor changed. Review it and try again.";
  }
  if (message.includes("INVALID_GROUP_ASSOCIATION"))
    return "That Study association is not authorized.";
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
    anchorProviderLine: formValue(formData, "anchorProviderLine"),
    anchorProviderAmericanOdds: formValue(formData, "anchorProviderAmericanOdds"),
    pricingSource: formValue(formData, "pricingSource") || "provider",
    pricingModel: formValue(formData, "pricingModel"),
    pricingModelVersion: formValue(formData, "pricingModelVersion"),
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

  const adjusted = parsed.data.pricingSource === "simulated_alternate";
  const { data, error } = await supabase.rpc(
    adjusted ? "place_simulated_adjusted_spread_bet" : "place_simulated_straight_bet",
    adjusted
      ? {
          p_competition_key: parsed.data.competitionKey,
          p_event_id: parsed.data.eventId,
          p_bookmaker_id: parsed.data.bookmakerId,
          p_market_type: parsed.data.marketType,
          p_selection: parsed.data.selection,
          p_anchor_provider_line:
            parsed.data.anchorProviderLine === "" ? null : parsed.data.anchorProviderLine,
          p_anchor_provider_american_odds:
            parsed.data.anchorProviderAmericanOdds === ""
              ? null
              : parsed.data.anchorProviderAmericanOdds,
          p_adjusted_line: parsed.data.expectedLine === "" ? null : parsed.data.expectedLine,
          p_expected_american_odds: parsed.data.expectedAmericanOdds,
          p_stake_units: stake,
          p_group_id: parsed.data.groupId || null,
        }
      : {
          p_competition_key: parsed.data.competitionKey,
          p_event_id: parsed.data.eventId,
          p_bookmaker_id: parsed.data.bookmakerId,
          p_market_type: parsed.data.marketType,
          p_selection: parsed.data.selection,
          p_expected_american_odds: parsed.data.expectedAmericanOdds,
          p_expected_line: parsed.data.expectedLine === "" ? null : parsed.data.expectedLine,
          p_stake_units: stake,
          p_group_id: parsed.data.groupId || null,
        },
  );
  if (error || !data) {
    notice(`/sports/${parsed.data.competitionKey}`, placementMessage(error?.message ?? ""));
  }

  notice("/my-bets", "Simulated straight wager placed and stake debited once.");
}

export async function placeStraightBets(formData: FormData) {
  let submittedLegs: unknown;
  try {
    submittedLegs = JSON.parse(formValue(formData, "legs"));
  } catch {
    notice("/sports", "The straight-bet list is invalid.");
  }
  const parsed = straightBatchSchema.safeParse({
    legs: submittedLegs,
    stake: formValue(formData, "stake"),
    groupId: formValue(formData, "groupId"),
    slipKeys: formValue(formData, "slipKeys"),
  });
  if (!parsed.success || parsed.data.legs.some((leg) => !getCompetition(leg.competitionKey))) {
    notice("/sports", "The straight-bet list is invalid.");
  }
  let stake: string;
  try {
    stake = formatUnits(parseStakeToMinorUnits(parsed.data.stake));
  } catch {
    notice("/sports", "Enter a positive straight-bet stake using at most two decimals.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) notice("/auth", "Please sign in to continue.");

  let placed = 0;
  let firstError = "";
  const submittedSlipKeys = parsed.data.slipKeys.split(",").filter(Boolean);
  const placedSlipKeys: string[] = [];
  for (const [index, leg] of parsed.data.legs.entries()) {
    const adjusted = leg.pricingSource === "simulated_alternate";
    const { data, error } = await supabase.rpc(
      adjusted ? "place_simulated_adjusted_spread_bet" : "place_simulated_straight_bet",
      adjusted
        ? {
            p_competition_key: leg.competitionKey,
            p_event_id: leg.eventId,
            p_bookmaker_id: leg.bookmakerId,
            p_market_type: leg.marketType,
            p_selection: leg.selection,
            p_anchor_provider_line: leg.anchorProviderLine ?? null,
            p_anchor_provider_american_odds: leg.anchorProviderAmericanOdds ?? null,
            p_adjusted_line: leg.expectedLine,
            p_expected_american_odds: leg.expectedAmericanOdds,
            p_stake_units: stake,
            p_group_id: parsed.data.groupId || null,
          }
        : {
            p_competition_key: leg.competitionKey,
            p_event_id: leg.eventId,
            p_bookmaker_id: leg.bookmakerId,
            p_market_type: leg.marketType,
            p_selection: leg.selection,
            p_expected_american_odds: leg.expectedAmericanOdds,
            p_expected_line: leg.expectedLine,
            p_stake_units: stake,
            p_group_id: parsed.data.groupId || null,
          },
    );
    if (error || !data) {
      firstError ||= error?.message ?? "";
      continue;
    }
    placed += 1;
    if (submittedSlipKeys[index]) placedSlipKeys.push(submittedSlipKeys[index]);
  }

  if (!placed) notice("/sports", placementMessage(firstError));
  const path = placedSlipKeys.length
    ? `/my-bets?straight=${encodeURIComponent(placedSlipKeys.join(","))}`
    : "/my-bets";
  const partial = placed < parsed.data.legs.length ? " Some selections could not be placed." : "";
  notice(
    path,
    `Placed ${placed} independent straight wager${placed === 1 ? "" : "s"}; each is recorded separately.${partial}`,
  );
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
    slipKeys: formValue(formData, "slipKeys"),
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
  const cleanupQuery = parsed.data.slipKeys
    ? `?slip=${encodeURIComponent(parsed.data.slipKeys)}`
    : "";
  notice(
    `/my-bets${cleanupQuery}`,
    "Simulated parlay placed atomically and its stake was debited once.",
  );
}
