export type ParlayMarketType = "moneyline" | "spread" | "total";

/** Moneyline legs never carry a line, even when a stale form value is present. */
export function normalizeParlayLegLine(
  marketType: ParlayMarketType,
  line: number | string | null | undefined,
) {
  if (marketType === "moneyline") return null;
  if (line === null || line === undefined || line === "") return null;
  const numeric = typeof line === "number" ? line : Number(line);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parlayLegLineError(
  marketType: ParlayMarketType,
  line: number | string | null | undefined,
) {
  return marketType !== "moneyline" && normalizeParlayLegLine(marketType, line) === null;
}
