export const VISION_MODEL = "gpt-5.6-luna";
export const VISION_DEFAULT_BUDGET_USD = 5;
export const VISION_RESERVATION_USD = 0.05;
export const VISION_HIGH_USAGE_AVERAGE_USD = 0.01;

export type VisionThreshold = "normal" | "warning" | "high" | "critical" | "limit";

/** GPT-5.6 Luna pricing, expressed as fixed-point dollars for application accounting. */
export function calculateVisionCostUsd(inputTokens: number, outputTokens: number) {
  if (!Number.isInteger(inputTokens) || inputTokens < 0)
    throw new Error("Invalid input token count");
  if (!Number.isInteger(outputTokens) || outputTokens < 0)
    throw new Error("Invalid output token count");
  return Math.round(((inputTokens * 0.2 + outputTokens * 1.2) / 1_000_000) * 1_000_000) / 1_000_000;
}

export function visionThreshold(
  spendUsd: number,
  budgetUsd = VISION_DEFAULT_BUDGET_USD,
): VisionThreshold {
  if (spendUsd >= budgetUsd) return "limit";
  if (spendUsd >= 4.75) return "critical";
  if (spendUsd >= 4.25) return "high";
  if (spendUsd >= 3.5) return "warning";
  return "normal";
}

export function visionRemainingUsd(spendUsd: number, budgetUsd = VISION_DEFAULT_BUDGET_USD) {
  return Math.max(0, Math.round((budgetUsd - spendUsd) * 1_000_000) / 1_000_000);
}
