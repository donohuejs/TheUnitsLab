export function americanPrice(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function marketLabel(marketType: string) {
  if (marketType === "moneyline") return "Moneyline";
  if (marketType === "spread") return "Spread / handicap";
  if (marketType === "total") return "Total";
  return marketType;
}

export function lineLabel(line: number | null) {
  if (line === null) return "—";
  return line > 0 ? `+${line}` : String(line);
}

export function movementSummary<T>(
  started: T,
  current: T | undefined,
  format: (value: T) => string,
) {
  if (current === undefined) return "Current price unavailable";
  if (started === current) return "No change";
  return `${format(started)} → ${format(current)}`;
}
