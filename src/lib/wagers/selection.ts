import type { NormalizedEvent, NormalizedOdds, OddsDataset } from "@/lib/odds/types";

export type SelectionIdentifiers = {
  eventId: string;
  bookmakerId: string;
  marketType: string;
  selection: string;
};

export function isSupportedStraightSelection(event: NormalizedEvent, odds: NormalizedOdds) {
  if (odds.marketType === "moneyline") {
    return (
      odds.point === null &&
      (odds.selection === "home" ||
        odds.selection === "away" ||
        (event.sport === "soccer" && odds.selection === "draw"))
    );
  }
  if (odds.marketType === "spread") {
    return odds.point !== null && (odds.selection === "home" || odds.selection === "away");
  }
  return odds.point !== null && (odds.selection === "over" || odds.selection === "under");
}

export function findStraightSelection(dataset: OddsDataset, identifiers: SelectionIdentifiers) {
  const event = dataset.events.find((candidate) => candidate.id === identifiers.eventId);
  if (!event) return null;
  const odds = event.odds.find(
    (candidate) =>
      candidate.bookmakerId === identifiers.bookmakerId &&
      candidate.marketType === identifiers.marketType &&
      candidate.selection === identifiers.selection,
  );
  if (!odds || !isSupportedStraightSelection(event, odds)) return null;
  return { event, odds };
}
