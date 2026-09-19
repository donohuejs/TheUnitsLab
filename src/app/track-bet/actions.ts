"use server";

import { createHash, randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
import { z } from "zod";

import { sportsProviderConfiguration } from "@/config/sports";
import {
  calculateImportedEconomics,
  parseNonNegativeMoneyToMinorUnits,
} from "@/lib/external-wagers/calculations";
import { formatUnits, parseStakeToMinorUnits } from "@/lib/wagers/calculations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const screenshotExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const wagerSchema = z.object({
  groupId: z.union([z.literal(""), z.uuid()]),
  sportsbookId: z.enum(["", "fanduel", "draftkings", "betmgm", "caesars", "other"]),
  otherSportsbookName: z.string().trim().max(80),
  sportKey: z.enum(["soccer", "football", "basketball", "hockey"]),
  competitionKey: z.string().trim().min(1).max(40),
  eventDescription: z.string().trim().min(2).max(200),
  eventDate: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  selection: z.string().trim().min(1).max(120),
  marketType: z.enum(["moneyline", "spread", "total"]),
  line: z.union([z.literal(""), z.coerce.number().finite()]),
  americanOdds: z.coerce
    .number()
    .int()
    .refine((odds) => (odds >= 100 && odds <= 1_000_000) || (odds <= -100 && odds >= -1_000_000)),
  stake: z.string().trim(),
  wagerDate: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  status: z.enum(["open", "won", "lost", "push", "void"]),
  verificationStatus: z.enum(["unverified", "user_attested"]),
  userNotes: z.string().max(2000),
});

function value(formData: FormData, name: string) {
  const candidate = formData.get(name);
  return typeof candidate === "string" ? candidate : "";
}

function optionalIso(valueToParse: string) {
  if (!valueToParse.trim()) return null;
  const date = new Date(valueToParse);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finish(message: string): never {
  redirect(`/import-betslip?notice=${encodeURIComponent(message)}`);
}

function databaseMessage(message: string) {
  if (message.includes("INVALID_GROUP_ASSOCIATION"))
    return "That Study association is not authorized.";
  if (message.includes("INVALID_COMPETITION")) return "Choose a supported sport and competition.";
  if (message.includes("INVALID_SPORTSBOOK")) return "Choose a supported sportsbook.";
  if (message.includes("INVALID_LINE"))
    return "Spread and total wagers require a line; moneyline wagers do not.";
  if (message.includes("INVALID_STAKE"))
    return "Enter a positive Vial stake using at most two decimals.";
  if (message.includes("INVALID_RAW_STAKE"))
    return "Enter a positive source-dollar stake using at most two decimals.";
  if (message.includes("INVALID_RAW_RETURN")) return "Return / payout must be zero or greater.";
  if (message.includes("IMPORT_REVIEW_REQUIRED")) return "Review the editable draft before saving.";
  if (message.includes("MANUAL_SETTLEMENT_REASON_REQUIRED"))
    return "Add a reason for manual settlement.";
  if (message.includes("INVALID_ODDS"))
    return "Enter valid American odds of +100 or greater, or -100 or lower.";
  return "The external wager could not be saved. Review the entry and try again.";
}

const importedWagerSchema = z.object({
  confirmed: z.literal("true"),
  importMethod: z.enum(["screenshot", "paste", "entry"]),
  studyChoice: z.union([z.literal("personal"), z.uuid()]),
  groupId: z.union([z.literal(""), z.uuid()]),
  sportsbookId: z.enum(["", "fanduel", "draftkings", "betmgm", "caesars", "other"]),
  otherSportsbookName: z.string().trim().max(80),
  ticketType: z.enum(["straight", "parlay"]),
  sportKey: z.enum(["soccer", "football", "basketball", "hockey"]),
  competitionKey: z.string().trim().min(1).max(40),
  eventDescription: z.string().trim().min(2).max(200),
  eventDate: z.string().refine((candidate) => !Number.isNaN(Date.parse(candidate))),
  providerEventId: z.string().trim().max(160),
  wagerDate: z.union([
    z.literal(""),
    z.string().refine((candidate) => !Number.isNaN(Date.parse(candidate))),
  ]),
  selection: z.string().trim().min(1).max(120),
  selectionKey: z.enum(["", "home", "away", "draw", "over", "under"]),
  marketType: z.enum(["moneyline", "spread", "total"]),
  line: z.union([z.literal(""), z.coerce.number().finite()]),
  americanOdds: z.union([
    z.literal(""),
    z.coerce
      .number()
      .int()
      .refine((odds) => odds >= 100 || odds <= -100),
  ]),
  stakeDollars: z.string().trim(),
  returnDollars: z.string().trim(),
  sportsbookBetId: z.string().trim().max(160),
  status: z.enum(["open", "won", "lost", "push", "void"]),
  verificationStatus: z.enum(["unverified", "user_attested"]),
  userNotes: z.string().max(2000),
  rawText: z.string().max(10000),
  parlayLegs: z.string().max(100000),
});

export async function createImportedWager(formData: FormData) {
  const parsed = importedWagerSchema.safeParse({
    confirmed: value(formData, "confirmed"),
    importMethod: value(formData, "importMethod"),
    studyChoice: value(formData, "studyChoice"),
    groupId: value(formData, "groupId"),
    sportsbookId: value(formData, "sportsbookId"),
    otherSportsbookName: value(formData, "otherSportsbookName"),
    ticketType: value(formData, "ticketType"),
    sportKey: value(formData, "sportKey"),
    competitionKey: value(formData, "competitionKey"),
    eventDescription: value(formData, "eventDescription"),
    eventDate: value(formData, "eventDate"),
    providerEventId: value(formData, "providerEventId"),
    wagerDate: value(formData, "wagerDate"),
    selection: value(formData, "selection"),
    selectionKey: value(formData, "selectionKey"),
    marketType: value(formData, "marketType"),
    line: value(formData, "line"),
    americanOdds: value(formData, "americanOdds"),
    stakeDollars: value(formData, "stakeDollars"),
    returnDollars: value(formData, "returnDollars"),
    sportsbookBetId: value(formData, "sportsbookBetId"),
    status: value(formData, "status"),
    verificationStatus: value(formData, "verificationStatus") || "unverified",
    userNotes: value(formData, "userNotes"),
    rawText: value(formData, "rawText"),
    parlayLegs: value(formData, "parlayLegs"),
  });
  if (!parsed.success) finish("Review the required imported betslip fields and try again.");
  if (
    (parsed.data.studyChoice === "personal" && parsed.data.groupId) ||
    (parsed.data.studyChoice !== "personal" && parsed.data.groupId !== parsed.data.studyChoice)
  ) {
    finish("Choose exactly one Study or No Study — Personal before saving.");
  }
  if (parsed.data.sportsbookId === "other" && parsed.data.otherSportsbookName.length < 2) {
    finish("Enter the sportsbook name when choosing Other.");
  }
  if (
    (parsed.data.marketType === "moneyline" && parsed.data.line !== "") ||
    (parsed.data.marketType !== "moneyline" && parsed.data.line === "")
  ) {
    finish("Spread and total imports require a line; moneyline imports do not.");
  }
  let economics: ReturnType<typeof calculateImportedEconomics>;
  try {
    economics = calculateImportedEconomics(
      parsed.data.stakeDollars,
      parsed.data.americanOdds,
      parsed.data.returnDollars,
    );
  } catch {
    finish("Enter any two of stake, odds, or payout; the third must be mathematically valid.");
  }

  let importedParlayLegs: z.infer<typeof importedParlayLegSchema>[] = [];
  if (parsed.data.ticketType === "parlay") {
    let candidateLegs: unknown;
    try {
      candidateLegs = JSON.parse(parsed.data.parlayLegs);
    } catch {
      finish("Review the imported parlay and its 2–12 legs.");
    }
    const legsResult = z.array(importedParlayLegSchema).min(2).max(12).safeParse(candidateLegs);
    if (!legsResult.success) finish("Review the imported parlay and its 2–12 legs.");
    importedParlayLegs = legsResult.data;
    for (const leg of importedParlayLegs) {
      const competition = sportsProviderConfiguration.competitions.find(
        (candidate) =>
          candidate.id === leg.competitionKey &&
          candidate.sport === leg.sportKey &&
          candidate.enabled,
      );
      if (!competition) finish("Each parlay leg needs a supported sport and competition.");
      if (
        (leg.marketType === "moneyline" && leg.line !== null) ||
        (leg.marketType !== "moneyline" && leg.line === null)
      ) {
        finish("Each spread or total leg needs a line; moneyline legs do not.");
      }
    }
  }

  const screenshot = formData.get("screenshot");
  let screenshotExtension: string | undefined;
  if (screenshot instanceof File && screenshot.size > 0) {
    screenshotExtension = screenshotExtensions.get(screenshot.type);
    if (!screenshotExtension || screenshot.size > MAX_SCREENSHOT_BYTES) {
      finish("Screenshots must be a JPEG, PNG, or WebP file no larger than 5 MB.");
    }
  }
  const content =
    screenshot instanceof File && screenshot.size > 0
      ? Buffer.from(await screenshot.arrayBuffer())
      : Buffer.from(parsed.data.rawText || JSON.stringify(parsed.data));
  const contentHash = createHash("sha256").update(content).digest("hex");

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  if (parsed.data.ticketType === "parlay") {
    const { data, error } = await supabase.rpc("create_imported_parlay", {
      p_group_id: parsed.data.groupId || null,
      p_sportsbook_id: parsed.data.sportsbookId || null,
      p_other_sportsbook_name: parsed.data.otherSportsbookName || null,
      p_combined_american_odds: economics.americanOdds,
      p_raw_stake_dollars: economics.stakeDollars,
      p_raw_return_dollars: economics.returnDollars,
      p_wager_date: optionalIso(value(formData, "wagerDateUtc") || parsed.data.wagerDate),
      p_status: "open",
      p_verification_status: parsed.data.verificationStatus,
      p_user_notes: parsed.data.userNotes || null,
      p_import_method: parsed.data.importMethod,
      p_sportsbook_bet_id: parsed.data.sportsbookBetId || null,
      p_import_content_hash: contentHash,
      p_legs: importedParlayLegs.map((leg, index) => ({
        legNumber: index + 1,
        sportKey: leg.sportKey,
        competitionKey: leg.competitionKey,
        eventDescription: leg.eventDescription,
        eventDate: new Date(leg.eventDate).toISOString(),
        selection: leg.selection,
        selectionKey: leg.selectionKey || null,
        marketType: leg.marketType,
        line: leg.line,
        americanOdds: leg.americanOdds,
        result: "open",
        providerEventId: leg.providerEventId || null,
      })),
      p_confirmed: true,
    });
    if (error || !data) {
      console.error("Imported parlay persistence failed", {
        ticketType: "parlay",
        error: error?.message ?? "missing wager id",
      });
      finish(databaseMessage(error?.message ?? ""));
    }
    const wagerId = String(data);
    if (screenshot instanceof File && screenshot.size > 0 && screenshotExtension) {
      const objectPath = `${authData.user.id}/${wagerId}/${randomUUID()}.${screenshotExtension}`;
      const upload = await supabase.storage
        .from("external-wager-screenshots")
        .upload(objectPath, screenshot, { contentType: screenshot.type, upsert: false });
      if (upload.error) {
        console.error("Imported parlay screenshot upload failed", {
          wagerId,
          error: upload.error.message,
        });
        finish("The import was saved, but the private screenshot upload failed.");
      }
      const attachment = await supabase.rpc("attach_external_wager_screenshot", {
        p_external_wager_id: wagerId,
        p_object_path: objectPath,
      });
      if (attachment.error) {
        console.error("Imported parlay screenshot attachment failed", {
          wagerId,
          error: attachment.error.message,
        });
        finish("The import was saved, but its screenshot could not be attached.");
      }
    }
    const reconciliation = await supabase.rpc("reconcile_imported_wagers");
    if (reconciliation.error) {
      console.error("Imported parlay reconciliation failed", {
        wagerId,
        error: reconciliation.error.message,
      });
      finish(
        "The parlay was saved, but canonical matching could not be completed. Refresh My Bets to review it.",
      );
    }
    finish("Imported parlay saved to My Bets. Your simulated Vial balance was not changed.");
  }

  const { data, error } = await supabase.rpc("create_imported_wager", {
    p_group_id: parsed.data.groupId || null,
    p_sportsbook_id: parsed.data.sportsbookId || null,
    p_other_sportsbook_name: parsed.data.otherSportsbookName || null,
    p_sport_key: parsed.data.sportKey,
    p_competition_key: parsed.data.competitionKey,
    p_event_description: parsed.data.eventDescription,
    p_event_date: new Date(value(formData, "eventDateUtc") || parsed.data.eventDate).toISOString(),
    p_selection: parsed.data.selection,
    p_selection_key: parsed.data.selectionKey || null,
    p_market_type: parsed.data.marketType,
    p_line: parsed.data.line === "" ? null : parsed.data.line,
    p_american_odds: economics.americanOdds,
    p_raw_stake_dollars: economics.stakeDollars,
    p_raw_return_dollars: economics.returnDollars,
    p_wager_date: optionalIso(value(formData, "wagerDateUtc") || parsed.data.wagerDate),
    p_status: parsed.data.status,
    p_verification_status: parsed.data.verificationStatus,
    p_user_notes: parsed.data.userNotes || null,
    p_import_method: parsed.data.importMethod,
    p_sportsbook_bet_id: parsed.data.sportsbookBetId || null,
    p_import_content_hash: contentHash,
    p_provider_event_id: parsed.data.providerEventId || null,
    p_confirmed: true,
  });
  if (error || !data) {
    console.error("Imported wager persistence failed", {
      ticketType: "straight",
      error: error?.message ?? "missing wager id",
    });
    finish(databaseMessage(error?.message ?? ""));
  }

  const wagerId = String(data);
  if (screenshot instanceof File && screenshot.size > 0 && screenshotExtension) {
    const objectPath = `${authData.user.id}/${wagerId}/${randomUUID()}.${screenshotExtension}`;
    const upload = await supabase.storage
      .from("external-wager-screenshots")
      .upload(objectPath, screenshot, { contentType: screenshot.type, upsert: false });
    if (upload.error) {
      console.error("Imported screenshot upload failed", { wagerId, error: upload.error.message });
      finish("The import was saved, but the private screenshot upload failed.");
    }
    const attachment = await supabase.rpc("attach_external_wager_screenshot", {
      p_external_wager_id: wagerId,
      p_object_path: objectPath,
    });
    if (attachment.error) {
      console.error("Imported screenshot attachment failed", {
        wagerId,
        error: attachment.error.message,
      });
      finish("The import was saved, but its screenshot could not be attached.");
    }
  }
  const matchResult = await supabase.rpc("match_imported_wager", {
    p_external_wager_id: wagerId,
    p_provider_event_id: parsed.data.providerEventId || null,
  });
  if (matchResult.error) {
    console.error("Imported wager canonical matching failed", {
      wagerId,
      error: matchResult.error.message,
    });
    finish(
      "The import was saved, but canonical matching could not be completed. Refresh My Bets to review it.",
    );
  }
  finish("Imported betslip saved to My Bets. Your simulated Vial balance was not changed.");
}

export async function createExternalWager(formData: FormData) {
  const parsed = wagerSchema.safeParse({
    groupId: value(formData, "groupId"),
    sportsbookId: value(formData, "sportsbookId"),
    otherSportsbookName: value(formData, "otherSportsbookName"),
    sportKey: value(formData, "sportKey"),
    competitionKey: value(formData, "competitionKey"),
    eventDescription: value(formData, "eventDescription"),
    eventDate: value(formData, "eventDate"),
    selection: value(formData, "selection"),
    marketType: value(formData, "marketType"),
    line: value(formData, "line"),
    americanOdds: value(formData, "americanOdds"),
    stake: value(formData, "stake"),
    wagerDate: value(formData, "wagerDate"),
    status: value(formData, "status"),
    verificationStatus: value(formData, "verificationStatus"),
    userNotes: value(formData, "userNotes"),
  });
  if (!parsed.success) finish("Review the required external wager fields and try again.");

  const competition = sportsProviderConfiguration.competitions.find(
    (candidate) =>
      candidate.id === parsed.data.competitionKey &&
      candidate.sport === parsed.data.sportKey &&
      candidate.enabled,
  );
  if (!competition) finish("Choose a supported sport and competition.");
  if (parsed.data.sportsbookId === "other" && parsed.data.otherSportsbookName.length < 2) {
    finish("Enter the sportsbook name when choosing Other sportsbook.");
  }
  if (
    (parsed.data.marketType === "moneyline" && parsed.data.line !== "") ||
    (parsed.data.marketType !== "moneyline" && parsed.data.line === "")
  ) {
    finish("Spread and total wagers require a line; moneyline wagers do not.");
  }

  let stake: string;
  try {
    stake = formatUnits(parseStakeToMinorUnits(parsed.data.stake));
  } catch {
    finish("Enter a positive unit stake using at most two decimals.");
  }

  const screenshot = formData.get("screenshot");
  let screenshotExtension: string | undefined;
  if (screenshot instanceof File && screenshot.size > 0) {
    screenshotExtension = screenshotExtensions.get(screenshot.type);
    if (!screenshotExtension || screenshot.size > MAX_SCREENSHOT_BYTES) {
      finish("Screenshots must be a JPEG, PNG, or WebP file no larger than 5 MB.");
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  const { data, error } = await supabase.rpc("create_external_wager", {
    p_group_id: parsed.data.groupId || null,
    p_sportsbook_id: parsed.data.sportsbookId || null,
    p_other_sportsbook_name: parsed.data.otherSportsbookName || null,
    p_sport_key: parsed.data.sportKey,
    p_competition_key: parsed.data.competitionKey,
    p_event_description: parsed.data.eventDescription,
    p_event_date: new Date(parsed.data.eventDate).toISOString(),
    p_selection: parsed.data.selection,
    p_market_type: parsed.data.marketType,
    p_line: parsed.data.line === "" ? null : parsed.data.line,
    p_american_odds: parsed.data.americanOdds,
    p_stake_units: stake,
    p_wager_date: new Date(value(formData, "wagerDateUtc") || parsed.data.wagerDate).toISOString(),
    p_status: parsed.data.status,
    p_verification_status: parsed.data.verificationStatus,
    p_user_notes: parsed.data.userNotes || null,
  });
  if (error || !data) finish(databaseMessage(error?.message ?? ""));

  const wagerId = String(data);
  if (screenshot instanceof File && screenshot.size > 0 && screenshotExtension) {
    const objectPath = `${authData.user.id}/${wagerId}/${randomUUID()}.${screenshotExtension}`;
    const upload = await supabase.storage
      .from("external-wager-screenshots")
      .upload(objectPath, screenshot, { contentType: screenshot.type, upsert: false });
    if (upload.error) {
      finish("The wager was saved, but the screenshot upload failed. The wager remains available.");
    }
    const attachment = await supabase.rpc("attach_external_wager_screenshot", {
      p_external_wager_id: wagerId,
      p_object_path: objectPath,
    });
    if (attachment.error) {
      finish("The wager was saved, but its screenshot could not be attached.");
    }
  }

  finish("Imported wager saved to My Bets. Your simulated Vial balance was not changed.");
}

const resultSchema = z.object({
  wagerId: z.uuid(),
  status: z.enum(["open", "won", "lost", "push", "void"]),
});

export async function setExternalWagerResult(formData: FormData) {
  const parsed = resultSchema.safeParse({
    wagerId: value(formData, "wagerId"),
    status: value(formData, "status"),
  });
  if (!parsed.success) finish("The result request is invalid.");
  const manualReason = value(formData, "manualReason").trim();

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const { error } = manualReason
    ? await supabase.rpc("set_imported_manual_result", {
        p_external_wager_id: parsed.data.wagerId,
        p_status: parsed.data.status,
        p_reason: manualReason,
      })
    : await supabase.rpc("set_external_wager_result", {
        p_external_wager_id: parsed.data.wagerId,
        p_status: parsed.data.status,
      });
  if (error) finish("The external wager result could not be updated.");
  finish(
    "Imported result updated from stored odds and stake. Your simulated Vial balance was not changed.",
  );
}

const externalParlayLegSchema = z.object({
  sportKey: z.enum(["soccer", "football", "basketball", "hockey"]),
  competitionKey: z.string().trim().min(1).max(40),
  eventDescription: z.string().trim().min(2).max(200),
  eventDate: z.string().refine((candidate) => !Number.isNaN(Date.parse(candidate))),
  selection: z.string().trim().min(1).max(120),
  marketType: z.enum(["moneyline", "spread", "total"]),
  line: z.number().finite().nullable(),
  americanOdds: z
    .number()
    .int()
    .refine((odds) => (odds >= 100 && odds <= 1_000_000) || (odds <= -100 && odds >= -1_000_000)),
  result: z.enum(["open", "won", "lost", "push", "void"]),
});

const externalParlaySchema = z.object({
  groupId: z.union([z.literal(""), z.uuid()]),
  sportsbookId: z.enum(["", "fanduel", "draftkings", "betmgm", "caesars", "other"]),
  otherSportsbookName: z.string().trim().max(80),
  combinedAmericanOdds: z.coerce.number().int(),
  stake: z.string().trim(),
  wagerDate: z.string().refine((candidate) => !Number.isNaN(Date.parse(candidate))),
  status: z.enum(["open", "won", "lost", "push", "void"]),
  verificationStatus: z.enum(["unverified", "user_attested"]),
  userNotes: z.string().max(2000),
  legs: z.array(externalParlayLegSchema).min(2).max(12),
});

const importedParlayLegSchema = externalParlayLegSchema.extend({
  providerEventId: z.string().trim().max(160),
  selectionKey: z.enum(["", "home", "away", "draw", "over", "under"]),
});

const importedParlaySchema = z.object({
  confirmed: z.literal("true"),
  importMethod: z.enum(["screenshot", "paste", "entry"]),
  groupId: z.union([z.literal(""), z.uuid()]),
  sportsbookId: z.enum(["", "fanduel", "draftkings", "betmgm", "caesars", "other"]),
  otherSportsbookName: z.string().trim().max(80),
  combinedAmericanOdds: z.coerce.number().int(),
  rawStakeDollars: z.string().trim(),
  rawReturnDollars: z.string().trim(),
  wagerDate: z.string().refine((candidate) => !Number.isNaN(Date.parse(candidate))),
  sportsbookBetId: z.string().trim().max(160),
  status: z.enum(["open", "won", "lost", "push", "void"]),
  verificationStatus: z.enum(["unverified", "user_attested"]),
  userNotes: z.string().max(2000),
  rawText: z.string().max(10000),
  legs: z.array(importedParlayLegSchema).min(2).max(12),
});

export async function createImportedParlay(formData: FormData) {
  let legInput: unknown;
  try {
    legInput = JSON.parse(value(formData, "legs"));
  } catch {
    finish("The imported parlay leg list is invalid.");
  }
  const parsed = importedParlaySchema.safeParse({
    confirmed: value(formData, "confirmed"),
    importMethod: value(formData, "importMethod"),
    groupId: value(formData, "groupId"),
    sportsbookId: value(formData, "sportsbookId"),
    otherSportsbookName: value(formData, "otherSportsbookName"),
    combinedAmericanOdds: value(formData, "combinedAmericanOdds"),
    rawStakeDollars: value(formData, "rawStakeDollars"),
    rawReturnDollars: value(formData, "rawReturnDollars"),
    wagerDate: value(formData, "wagerDate"),
    sportsbookBetId: value(formData, "sportsbookBetId"),
    status: value(formData, "status"),
    verificationStatus: value(formData, "verificationStatus"),
    userNotes: value(formData, "userNotes"),
    rawText: value(formData, "rawText"),
    legs: legInput,
  });
  if (!parsed.success) finish("Review the imported parlay and its 2–12 legs.");
  if (parsed.data.sportsbookId === "other" && parsed.data.otherSportsbookName.length < 2) {
    finish("Enter the sportsbook name when choosing Other sportsbook.");
  }
  for (const leg of parsed.data.legs) {
    const competition = sportsProviderConfiguration.competitions.find(
      (candidate) =>
        candidate.id === leg.competitionKey &&
        candidate.sport === leg.sportKey &&
        candidate.enabled,
    );
    if (!competition) finish("Each parlay leg needs a supported sport and competition.");
    if (
      (leg.marketType === "moneyline" && leg.line !== null) ||
      (leg.marketType !== "moneyline" && leg.line === null)
    ) {
      finish("Each spread or total leg needs a line; moneyline legs do not.");
    }
  }
  let rawStakeDollars: string;
  try {
    rawStakeDollars = formatUnits(parseStakeToMinorUnits(parsed.data.rawStakeDollars));
  } catch {
    finish("Enter a positive source-dollar stake using at most two decimals.");
  }
  let rawReturnDollars: string | null = null;
  if (parsed.data.rawReturnDollars) {
    try {
      rawReturnDollars = formatUnits(
        parseNonNegativeMoneyToMinorUnits(parsed.data.rawReturnDollars),
      );
    } catch {
      finish("Enter a valid source-dollar return using at most two decimals.");
    }
  }

  const screenshot = formData.get("screenshot");
  let screenshotExtension: string | undefined;
  if (screenshot instanceof File && screenshot.size > 0) {
    screenshotExtension = screenshotExtensions.get(screenshot.type);
    if (!screenshotExtension || screenshot.size > MAX_SCREENSHOT_BYTES) {
      finish("Screenshots must be a JPEG, PNG, or WebP file no larger than 5 MB.");
    }
  }
  const content =
    screenshot instanceof File && screenshot.size > 0
      ? Buffer.from(await screenshot.arrayBuffer())
      : Buffer.from(parsed.data.rawText || JSON.stringify(parsed.data));
  const contentHash = createHash("sha256").update(content).digest("hex");

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const { data, error } = await supabase.rpc("create_imported_parlay", {
    p_group_id: parsed.data.groupId || null,
    p_sportsbook_id: parsed.data.sportsbookId || null,
    p_other_sportsbook_name: parsed.data.otherSportsbookName || null,
    p_combined_american_odds: parsed.data.combinedAmericanOdds,
    p_raw_stake_dollars: rawStakeDollars,
    p_raw_return_dollars: rawReturnDollars,
    p_wager_date: new Date(value(formData, "wagerDateUtc") || parsed.data.wagerDate).toISOString(),
    p_status: parsed.data.status,
    p_verification_status: parsed.data.verificationStatus,
    p_user_notes: parsed.data.userNotes || null,
    p_import_method: parsed.data.importMethod,
    p_sportsbook_bet_id: parsed.data.sportsbookBetId || null,
    p_import_content_hash: contentHash,
    p_legs: parsed.data.legs.map((leg, index) => ({
      legNumber: index + 1,
      sportKey: leg.sportKey,
      competitionKey: leg.competitionKey,
      eventDescription: leg.eventDescription,
      eventDate: new Date(leg.eventDate).toISOString(),
      selection: leg.selection,
      selectionKey: leg.selectionKey || null,
      marketType: leg.marketType,
      line: leg.line,
      americanOdds: leg.americanOdds,
      result: leg.result,
      providerEventId: leg.providerEventId || null,
    })),
    p_confirmed: true,
  });
  if (error || !data) finish(databaseMessage(error?.message ?? ""));
  const wagerId = String(data);
  if (screenshot instanceof File && screenshot.size > 0 && screenshotExtension) {
    const objectPath = `${authData.user.id}/${wagerId}/${randomUUID()}.${screenshotExtension}`;
    const upload = await supabase.storage
      .from("external-wager-screenshots")
      .upload(objectPath, screenshot, { contentType: screenshot.type, upsert: false });
    if (upload.error) finish("The import was saved, but the private screenshot upload failed.");
    const attachment = await supabase.rpc("attach_external_wager_screenshot", {
      p_external_wager_id: wagerId,
      p_object_path: objectPath,
    });
    if (attachment.error) finish("The import was saved, but its screenshot could not be attached.");
  }
  finish("Imported parlay saved to My Bets. Your simulated Vial balance was not changed.");
}

export async function createExternalParlay(formData: FormData) {
  let legInput: unknown;
  try {
    legInput = JSON.parse(value(formData, "legs"));
  } catch {
    finish("The external parlay leg list is invalid.");
  }
  const parsed = externalParlaySchema.safeParse({
    groupId: value(formData, "groupId"),
    sportsbookId: value(formData, "sportsbookId"),
    otherSportsbookName: value(formData, "otherSportsbookName"),
    combinedAmericanOdds: value(formData, "combinedAmericanOdds"),
    stake: value(formData, "stake"),
    wagerDate: value(formData, "wagerDate"),
    status: value(formData, "status"),
    verificationStatus: value(formData, "verificationStatus"),
    userNotes: value(formData, "userNotes"),
    legs: legInput,
  });
  if (!parsed.success) finish("Review the external parlay and its 2–12 legs.");
  if (parsed.data.sportsbookId === "other" && parsed.data.otherSportsbookName.length < 2) {
    finish("Enter the sportsbook name when choosing Other sportsbook.");
  }
  for (const leg of parsed.data.legs) {
    const competition = sportsProviderConfiguration.competitions.find(
      (candidate) =>
        candidate.id === leg.competitionKey &&
        candidate.sport === leg.sportKey &&
        candidate.enabled,
    );
    if (!competition) finish("Each parlay leg needs a supported sport and competition.");
    if (
      (leg.marketType === "moneyline" && leg.line !== null) ||
      (leg.marketType !== "moneyline" && leg.line === null)
    ) {
      finish("Each spread or total leg needs a line; moneyline legs do not.");
    }
  }
  let stake: string;
  try {
    stake = formatUnits(parseStakeToMinorUnits(parsed.data.stake));
  } catch {
    finish("Enter a positive parlay stake using at most two decimals.");
  }

  const screenshot = formData.get("screenshot");
  let screenshotExtension: string | undefined;
  if (screenshot instanceof File && screenshot.size > 0) {
    screenshotExtension = screenshotExtensions.get(screenshot.type);
    if (!screenshotExtension || screenshot.size > MAX_SCREENSHOT_BYTES) {
      finish("Screenshots must be a JPEG, PNG, or WebP file no larger than 5 MB.");
    }
  }
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const { data, error } = await supabase.rpc("create_external_parlay", {
    p_group_id: parsed.data.groupId || null,
    p_sportsbook_id: parsed.data.sportsbookId || null,
    p_other_sportsbook_name: parsed.data.otherSportsbookName || null,
    p_combined_american_odds: parsed.data.combinedAmericanOdds,
    p_stake_units: stake,
    p_wager_date: new Date(parsed.data.wagerDate).toISOString(),
    p_status: parsed.data.status,
    p_verification_status: parsed.data.verificationStatus,
    p_user_notes: parsed.data.userNotes || null,
    p_legs: parsed.data.legs.map((leg) => ({
      ...leg,
      eventDate: new Date(leg.eventDate).toISOString(),
    })),
  });
  if (error || !data) finish(databaseMessage(error?.message ?? ""));
  const wagerId = String(data);
  if (screenshot instanceof File && screenshot.size > 0 && screenshotExtension) {
    const objectPath = `${authData.user.id}/${wagerId}/${randomUUID()}.${screenshotExtension}`;
    const upload = await supabase.storage
      .from("external-wager-screenshots")
      .upload(objectPath, screenshot, { contentType: screenshot.type, upsert: false });
    if (upload.error) finish("The parlay was saved, but the screenshot upload failed.");
    const attachment = await supabase.rpc("attach_external_wager_screenshot", {
      p_external_wager_id: wagerId,
      p_object_path: objectPath,
    });
    if (attachment.error) finish("The parlay was saved, but its screenshot could not be attached.");
  }
  finish("Imported parlay saved to My Bets. Your simulated Vial balance was not changed.");
}

const externalParlayResultSchema = z.object({
  wagerId: z.uuid(),
  status: z.enum(["open", "won", "lost", "push", "void"]),
  legResults: z
    .array(
      z.object({
        legNumber: z.number().int().positive(),
        result: z.enum(["open", "won", "lost", "push", "void"]),
      }),
    )
    .min(2)
    .max(12),
});

export async function setExternalParlayResult(formData: FormData) {
  let legResults: unknown;
  try {
    legResults = JSON.parse(value(formData, "legResults"));
  } catch {
    finish("The external parlay result payload is invalid.");
  }
  const parsed = externalParlayResultSchema.safeParse({
    wagerId: value(formData, "wagerId"),
    status: value(formData, "status"),
    legResults,
  });
  if (!parsed.success) finish("Review the ticket and leg results.");
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const { error } = await supabase.rpc("set_external_parlay_result", {
    p_external_wager_id: parsed.data.wagerId,
    p_status: parsed.data.status,
    p_leg_results: parsed.data.legResults,
  });
  if (error) finish("The external parlay result is inconsistent or could not be updated.");
  finish(
    "Imported parlay and leg results updated with an audit record. Your simulated Vial balance was not changed.",
  );
}
