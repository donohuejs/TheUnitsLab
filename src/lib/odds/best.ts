export type ComparableOdds = {
  marketType: string;
  selection: string;
  point: number | null;
  americanOdds: number;
};

export type ComparableOddsGroup<T> = {
  key: string;
  prices: T[];
};

/**
 * Keep comparisons scoped to the same market, selection, and line. The browse
 * board already renders one market at a time, but retaining the market in the
 * key keeps this helper safe if it is reused with a mixed collection later.
 */
export function comparableOddsKey(odd: ComparableOdds) {
  return `${odd.marketType}|${odd.selection}|${odd.point ?? ""}`;
}

export function sortOddsByBestPrice<T extends ComparableOdds>(prices: readonly T[]) {
  return [...prices].sort((left, right) => right.americanOdds - left.americanOdds);
}

export function groupOddsByComparableSelection<T extends ComparableOdds>(odds: readonly T[]) {
  const bySelection = new Map<string, T[]>();
  for (const odd of odds) {
    const key = comparableOddsKey(odd);
    const current = bySelection.get(key) ?? [];
    current.push(odd);
    bySelection.set(key, current);
  }

  return [...bySelection.entries()].map(([key, prices]): ComparableOddsGroup<T> => ({
    key,
    prices: sortOddsByBestPrice(prices),
  }));
}

/** Returns every tied best price, preserving each original object identity. */
export function getBestOdds<T extends ComparableOdds>(odds: readonly T[]) {
  const bestByKey = new Map<string, number>();
  for (const odd of odds) {
    const key = comparableOddsKey(odd);
    const currentBest = bestByKey.get(key);
    if (currentBest === undefined || odd.americanOdds > currentBest) {
      bestByKey.set(key, odd.americanOdds);
    }
  }

  return new Set(odds.filter((odd) => bestByKey.get(comparableOddsKey(odd)) === odd.americanOdds));
}
