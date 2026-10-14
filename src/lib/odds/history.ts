export type HistoricalQuote = {
  line: number | null;
  americanOdds: number;
  decimalOdds: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isPregame?: boolean;
};

function before(value: string, boundary: string) {
  return Date.parse(value) < Date.parse(boundary);
}

export function firstObservedQuote(quotes: readonly HistoricalQuote[]) {
  return (
    [...quotes].sort(
      (left, right) => Date.parse(left.firstSeenAt) - Date.parse(right.firstSeenAt),
    )[0] ?? null
  );
}

export function quoteAtWagerTime(quotes: readonly HistoricalQuote[], wagerCreatedAt: string) {
  const eligible = quotes.filter(
    (quote) =>
      Date.parse(quote.firstSeenAt) <= Date.parse(wagerCreatedAt) &&
      Date.parse(quote.lastSeenAt) >= Date.parse(wagerCreatedAt),
  );
  return (
    [...eligible].sort(
      (left, right) => Date.parse(right.firstSeenAt) - Date.parse(left.firstSeenAt),
    )[0] ?? null
  );
}

export function latestPregameQuote(quotes: readonly HistoricalQuote[], scheduledStart: string) {
  const eligible = quotes.filter(
    (quote) =>
      quote.isPregame !== false &&
      before(quote.firstSeenAt, scheduledStart) &&
      before(quote.lastSeenAt, scheduledStart),
  );
  return (
    [...eligible].sort(
      (left, right) => Date.parse(right.firstSeenAt) - Date.parse(left.firstSeenAt),
    )[0] ?? null
  );
}
