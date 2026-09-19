import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { VISION_MODEL, calculateVisionCostUsd } from "./vision-accounting";
import type { VisionBetslipDraft } from "./extraction";

const visionResponseSchema = z.object({
  ticketType: z.enum(["straight", "parlay"]),
  sportsbook: z.string().nullable(),
  sportsbookBetId: z.string().nullable(),
  wagerDateText: z.string().nullable(),
  stake: z.string().nullable(),
  totalReturn: z.string().nullable(),
  combinedAmericanOdds: z.string().nullable(),
  legs: z.array(
    z.object({
      eventText: z.string().nullable(),
      eventDateText: z.string().nullable(),
      sportText: z.string().nullable().optional(),
      competitionText: z.string().nullable().optional(),
      market: z.enum(["moneyline", "spread", "total"]).nullable(),
      selectionText: z.string().nullable(),
      line: z.string().nullable(),
      americanOdds: z.string().nullable(),
    }),
  ),
});

const visionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ticketType: { type: "string", enum: ["straight", "parlay"] },
    sportsbook: { type: ["string", "null"] },
    sportsbookBetId: { type: ["string", "null"] },
    wagerDateText: { type: ["string", "null"] },
    stake: { type: ["string", "null"] },
    totalReturn: { type: ["string", "null"] },
    combinedAmericanOdds: { type: ["string", "null"] },
    legs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          eventText: { type: ["string", "null"] },
          eventDateText: { type: ["string", "null"] },
          sportText: { type: ["string", "null"] },
          competitionText: { type: ["string", "null"] },
          market: { type: ["string", "null"], enum: ["moneyline", "spread", "total", null] },
          selectionText: { type: ["string", "null"] },
          line: { type: ["string", "null"] },
          americanOdds: { type: ["string", "null"] },
        },
        required: [
          "eventText",
          "eventDateText",
          "sportText",
          "competitionText",
          "market",
          "selectionText",
          "line",
          "americanOdds",
        ],
      },
    },
  },
  required: [
    "ticketType",
    "sportsbook",
    "sportsbookBetId",
    "wagerDateText",
    "stake",
    "totalReturn",
    "combinedAmericanOdds",
    "legs",
  ],
} as const;

export type VisionCallResult = {
  draft: VisionBetslipDraft;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  responseId: string | null;
  providerStatus: number;
  usageAvailable: boolean;
};

export class VisionMalformedResponseError extends Error {
  constructor() {
    super("Vision response was not valid structured betslip data.");
    this.name = "VisionMalformedResponseError";
  }
}

function responseText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  const output = response.output;
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { text?: unknown }).text === "string"
      ) {
        return (entry as { text: string }).text;
      }
    }
  }
  return "";
}

function safetyIdentifier(userId: string) {
  return createHash("sha256").update(userId).digest("hex").slice(0, 64);
}

export async function extractBetslipWithVision(
  image: Blob,
  options: {
    apiKey: string;
    userId: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  },
): Promise<VisionCallResult> {
  const bytes = Buffer.from(await image.arrayBuffer());
  const mimeType = image.type || "image/png";
  const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: options.signal ?? AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      store: false,
      safety_identifier: safetyIdentifier(options.userId),
      instructions:
        "Extract only text visibly present in this sportsbook receipt. Never infer sport, competition, team identity, canonical event IDs, or settlement outcomes. Keep each wager atomic: event, selection, market, line, and American odds belong to the same leg. Treat the signed American price attached to the selected wager as ticket-critical. A spread or total line such as -2.5 is not American odds; a signed price such as -170 is American odds. Preserve the literal visible values, including signs, and use null when a value is not visible. sportText and competitionText are literal hints only; they are not canonical IDs. This is an editable draft and requires human review.",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Read this betslip into the requested structured draft." },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${bytes.toString("base64")}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "betslip_extraction",
          strict: true,
          schema: visionSchema,
        },
      },
      max_output_tokens: 900,
    }),
  });
  if (!response.ok) throw new Error(`Vision request failed with HTTP ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const text = responseText(body);
  if (!text) throw new VisionMalformedResponseError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VisionMalformedResponseError();
  }
  let draft: VisionBetslipDraft;
  try {
    draft = visionResponseSchema.parse(parsed) satisfies VisionBetslipDraft;
  } catch {
    throw new VisionMalformedResponseError();
  }
  const usage = body.usage && typeof body.usage === "object" ? body.usage : {};
  const rawInput = (usage as { input_tokens?: unknown }).input_tokens;
  const rawOutput = (usage as { output_tokens?: unknown }).output_tokens;
  const rawTotal = (usage as { total_tokens?: unknown }).total_tokens;
  const inputTokens =
    Number.isInteger(Number(rawInput)) && Number(rawInput) >= 0 ? Number(rawInput) : 0;
  const outputTokens =
    Number.isInteger(Number(rawOutput)) && Number(rawOutput) >= 0 ? Number(rawOutput) : 0;
  const totalTokens =
    Number.isInteger(Number(rawTotal)) && Number(rawTotal) >= 0
      ? Number(rawTotal)
      : inputTokens + outputTokens;
  const usageAvailable =
    rawInput !== undefined &&
    rawInput !== null &&
    rawOutput !== undefined &&
    rawOutput !== null &&
    Number.isInteger(Number(rawInput)) &&
    Number.isInteger(Number(rawOutput));
  if (usageAvailable) calculateVisionCostUsd(inputTokens, outputTokens);
  return {
    draft,
    inputTokens,
    outputTokens,
    totalTokens,
    responseId: typeof body.id === "string" ? body.id : null,
    providerStatus: response.status,
    usageAvailable,
  };
}

const visionOddsRecoverySchema = z.object({
  combinedAmericanOdds: z.string().nullable().optional(),
  legs: z
    .array(z.object({ americanOdds: z.string().nullable().optional() }))
    .optional()
    .default([]),
});

const visionOddsRecoveryJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    combinedAmericanOdds: { type: ["string", "null"] },
    legs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { americanOdds: { type: ["string", "null"] } },
        required: ["americanOdds"],
      },
    },
  },
  required: ["combinedAmericanOdds", "legs"],
} as const;

export type VisionOddsRecoveryResult = {
  combinedAmericanOdds: string | null;
  legs: Array<{ americanOdds: string | null }>;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  providerStatus: number;
  usageAvailable: boolean;
};

function parseUsage(body: Record<string, unknown>) {
  const usage = body.usage && typeof body.usage === "object" ? body.usage : {};
  const rawInput = (usage as { input_tokens?: unknown }).input_tokens;
  const rawOutput = (usage as { output_tokens?: unknown }).output_tokens;
  const rawTotal = (usage as { total_tokens?: unknown }).total_tokens;
  const inputTokens =
    Number.isInteger(Number(rawInput)) && Number(rawInput) >= 0 ? Number(rawInput) : 0;
  const outputTokens =
    Number.isInteger(Number(rawOutput)) && Number(rawOutput) >= 0 ? Number(rawOutput) : 0;
  const totalTokens =
    Number.isInteger(Number(rawTotal)) && Number(rawTotal) >= 0
      ? Number(rawTotal)
      : inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    usageAvailable:
      rawInput !== undefined &&
      rawInput !== null &&
      rawOutput !== undefined &&
      rawOutput !== null &&
      Number.isInteger(Number(rawInput)) &&
      Number.isInteger(Number(rawOutput)),
  };
}

export async function recoverMissingAmericanOddsWithVision(
  image: Blob,
  options: {
    apiKey: string;
    userId: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  },
): Promise<VisionOddsRecoveryResult> {
  const bytes = Buffer.from(await image.arrayBuffer());
  const mimeType = image.type || "image/png";
  const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: options.signal ?? AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      store: false,
      safety_identifier: safetyIdentifier(options.userId),
      instructions:
        "Read only missing signed American odds from this sportsbook receipt. Return the literal visible price attached to each selected wager in leg order. Do not return spread or total lines such as -2.5. Do not infer or calculate odds from stake or return. Use null when the signed American price is not visibly readable. Do not change event, selection, market, line, stake, or return.",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "Recover only the missing American price field(s)." },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${bytes.toString("base64")}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "betslip_american_odds_recovery",
          strict: true,
          schema: visionOddsRecoveryJsonSchema,
        },
      },
      max_output_tokens: 180,
    }),
  });
  if (!response.ok) throw new Error(`Vision request failed with HTTP ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const text = responseText(body);
  if (!text) throw new VisionMalformedResponseError();
  let parsed: z.infer<typeof visionOddsRecoverySchema>;
  try {
    parsed = visionOddsRecoverySchema.parse(JSON.parse(text));
  } catch {
    throw new VisionMalformedResponseError();
  }
  return {
    combinedAmericanOdds: parsed.combinedAmericanOdds ?? null,
    legs: (parsed.legs ?? []).map((leg) => ({ americanOdds: leg.americanOdds ?? null })),
    ...parseUsage(body),
    providerStatus: response.status,
  };
}
