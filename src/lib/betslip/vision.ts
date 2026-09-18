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
          market: { type: ["string", "null"], enum: ["moneyline", "spread", "total", null] },
          selectionText: { type: ["string", "null"] },
          line: { type: ["string", "null"] },
          americanOdds: { type: ["string", "null"] },
        },
        required: ["eventText", "eventDateText", "market", "selectionText", "line", "americanOdds"],
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
        "Extract only text visibly present in this sportsbook receipt. Never infer sport, competition, team identity, canonical event IDs, or settlement outcomes. Keep each parlay leg atomic: event, selection, market, line, and odds belong to the same leg. Use null when a value is not visible. This is an editable draft and requires human review.",
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
  const inputTokens = Number((usage as { input_tokens?: unknown }).input_tokens ?? 0);
  const outputTokens = Number((usage as { output_tokens?: unknown }).output_tokens ?? 0);
  const totalTokens = Number(
    (usage as { total_tokens?: unknown }).total_tokens ?? inputTokens + outputTokens,
  );
  if (
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    !Number.isInteger(totalTokens)
  ) {
    throw new VisionMalformedResponseError();
  }
  calculateVisionCostUsd(inputTokens, outputTokens);
  return {
    draft,
    inputTokens,
    outputTokens,
    totalTokens,
    responseId: typeof body.id === "string" ? body.id : null,
    providerStatus: response.status,
  };
}
