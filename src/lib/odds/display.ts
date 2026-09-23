import type { NormalizedEvent } from "./types";

export function hasSelectableOdds(
  event: NormalizedEvent,
  selectedBookmaker: string,
  marketFilter: string,
) {
  if (event.status === "live" || event.status === "completed") return false;
  return event.odds.some(
    (odd) =>
      (selectedBookmaker === "all" || odd.bookmakerId === selectedBookmaker) &&
      (marketFilter === "all" || odd.marketType === marketFilter),
  );
}
