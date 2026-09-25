import Link from "next/link";

import { OddsSelectionGrid } from "@/components/odds-selection-grid";
import type { NormalizedEvent, NormalizedOdds } from "@/lib/odds/types";

export const BROWSE_MARKET_FILTERS = [
  ["all", "All"],
  ["moneyline", "Moneyline"],
  ["spread", "Spread / Handicap"],
  ["total", "Total"],
  ["other", "Props / Other"],
] as const;

export type BrowseMarketFilter = (typeof BROWSE_MARKET_FILTERS)[number][0];

const marketGroups = [
  ["moneyline", "Moneyline"],
  ["spread", "Point spread / handicap"],
  ["total", "Total"],
  ["other", "Props / Other"],
] as const;

type ChosenSelection = { event: NormalizedEvent; odds: NormalizedOdds } | null;

type ActiveWatch = {
  initialLine: number | null;
  initialAmericanOdds: number;
};

export function BrowseMarketBoard({
  event,
  competitionId,
  selectedBookmaker,
  marketFilter,
  selectedDate,
  chosen,
  watchesBySelection,
  alternateMarketsAvailable,
  alternateLoaded,
  alternateEvents,
  watchlistAvailable,
}: {
  event: NormalizedEvent;
  competitionId: string;
  selectedBookmaker: string;
  marketFilter: BrowseMarketFilter;
  selectedDate: string;
  chosen: ChosenSelection;
  watchesBySelection: Map<string, ActiveWatch>;
  alternateMarketsAvailable: boolean;
  alternateLoaded: boolean;
  alternateEvents: readonly NormalizedEvent[];
  watchlistAvailable: boolean;
}) {
  const eventStarted = event.status === "live" || event.status === "completed";
  const odds = event.odds.filter(
    (odd) =>
      (selectedBookmaker === "all" || odd.bookmakerId === selectedBookmaker) &&
      (marketFilter === "all" || odd.marketType === marketFilter),
  );
  const visibleGroups = marketGroups.filter(
    ([marketType]) => marketFilter === "all" || marketType === marketFilter,
  );
  const basePath = "/sports/" + competitionId;
  const eventHref = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (selectedBookmaker !== "all") params.set("bookmaker", selectedBookmaker);
    params.set("date", selectedDate);
    params.set("event", event.id);
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
    }
    return basePath + "?" + params.toString();
  };

  return (
    <div className="browse-market-board">
      {odds.length || marketFilter === "other" ? (
        <div className="market-groups">
          {visibleGroups.map(([marketType, label]) => {
            const marketOdds =
              marketType === "other" ? [] : odds.filter((odd) => odd.marketType === marketType);
            return (
              <section className="market-group" key={marketType}>
                <h3>{label}</h3>
                {marketOdds.length ? (
                  <OddsSelectionGrid
                    watchlistAvailable={watchlistAvailable}
                    odds={marketOdds.map((odd) => ({
                      ...odd,
                      providerEventId: event.providerEventId,
                      competitionKey: competitionId,
                      eventId: event.id,
                      watch:
                        watchesBySelection.get(
                          [
                            event.providerEventId,
                            odd.bookmakerId,
                            odd.marketType,
                            odd.selection,
                          ].join("|"),
                        ) ?? null,
                      href: eventHref({
                        book: odd.bookmakerId,
                        market: odd.marketType,
                        selection: odd.selection,
                        ...(odd.point === null ? {} : { point: String(odd.point) }),
                        ...(marketFilter === "all" ? {} : { marketFilter }),
                      }),
                      isSelected:
                        chosen?.event.id === event.id &&
                        chosen.odds.bookmakerId === odd.bookmakerId &&
                        chosen.odds.marketType === odd.marketType &&
                        chosen.odds.selection === odd.selection &&
                        chosen.odds.point === odd.point,
                      eventStarted,
                      eventStatus: event.status,
                    }))}
                  />
                ) : marketType === "other" ? (
                  <p className="muted">
                    No props or other markets are returned by the configured provider feed.
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="empty-state">
          {eventStarted
            ? "This game has started; its pregame prices are locked."
            : "No supported odds from the selected bookmaker."}
        </p>
      )}
      {alternateMarketsAvailable && !eventStarted ? (
        <p className="alternate-lines-link">
          <Link href={eventHref({ alternates: "1" })}>
            {alternateLoaded
              ? alternateEvents.some((candidate) => candidate.odds.length)
                ? "Provider-priced alternate lines loaded"
                : "No alternate lines returned by the provider"
              : "Load provider-priced alternate lines"}
          </Link>
          <small>
            {alternateLoaded && !alternateEvents.length
              ? "Alternate pricing is unavailable right now."
              : "Separate on-demand provider pricing; no line interpolation."}
          </small>
        </p>
      ) : null}
    </div>
  );
}
