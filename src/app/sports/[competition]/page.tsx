import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { BetSlip } from "@/components/bet-slip";
import { BrowseGameCard } from "@/components/browse-game-card";
import { BrowseScheduleControls } from "@/components/browse-schedule-controls";
import { CompetitionSwitcher } from "@/components/competition-switcher";
import { LocalDateTime } from "@/components/local-date-time";
import { OddsSelectionGrid } from "@/components/odds-selection-grid";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import {
  getActiveRankingSnapshot,
  getCollegeTeamContext,
  getLeagueStandingsSnapshot,
  getTeamRanking,
} from "@/config/sport-context";
import { hasPublicEnvironment } from "@/config/env.public";
import { sportsProviderConfiguration } from "@/config/sports";
import {
  availableBrowseDates,
  formatBrowseDate,
  formatBrowseTime,
  getDefaultBrowseDate,
  getLocalDateKey,
  getMarqueeEventIds,
  groupEventsByKickoff,
  isBrowseDateKey,
  nextBrowseDate,
  previousBrowseDate,
  sortEventsForBrowse,
} from "@/lib/browse-schedule";
import { normalizeAnalyticsTimeZone } from "@/lib/analytics/calculations";
import { hasSelectableOdds } from "@/lib/odds/display";
import { getCompetition } from "@/lib/odds/request";
import { getCompetitionOdds, getEventAlternateOdds } from "@/lib/odds/server";
import type { CompetitionId, NormalizedEvent } from "@/lib/odds/types";
import { findStraightSelection } from "@/lib/wagers/selection";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveWatchesForUser } from "@/lib/watchlist/server";

import { refreshOdds } from "../actions";

type Props = {
  params: Promise<{ competition: string }>;
  searchParams: Promise<{
    bookmaker?: string;
    marketFilter?: string;
    notice?: string;
    date?: string;
    event?: string;
    market?: string;
    selection?: string;
    point?: string;
    alternates?: string;
    book?: string;
    mobileSheet?: string;
  }>;
};

const marketGroups = [
  ["moneyline", "Moneyline"],
  ["spread", "Point spread / handicap"],
  ["total", "Total"],
  ["other", "Props / Other"],
] as const;

const marketFilters = [
  ["all", "All"],
  ["moneyline", "Moneyline"],
  ["spread", "Spread / Handicap"],
  ["total", "Total"],
  ["other", "Props / Other"],
] as const;

type MarketFilter = (typeof marketFilters)[number][0];

function selectedMarketFilter(value: string | undefined): MarketFilter {
  return marketFilters.some(([candidate]) => candidate === value) ? (value as MarketFilter) : "all";
}

function recordLabel(teamName: string) {
  const record = getCollegeTeamContext(teamName)?.record;
  if (!record) return null;
  return (
    String(record.wins) +
    "-" +
    String(record.losses) +
    (record.ties === undefined ? "" : "-" + String(record.ties))
  );
}

function rankedTeamLabel(teamName: string, snapshot: ReturnType<typeof getActiveRankingSnapshot>) {
  const ranking = getTeamRanking(teamName, snapshot);
  return (ranking ? "#" + String(ranking.rank) + " " : "") + teamName;
}

function hasBrowseOdds(
  event: NormalizedEvent,
  selectedBookmaker: string,
  marketFilter: MarketFilter,
) {
  if (event.status === "completed") return false;
  if (event.status === "live") return event.odds.length > 0;
  if (marketFilter === "other") return event.odds.length > 0;
  return hasSelectableOdds(event, selectedBookmaker, marketFilter);
}

function queryStringForFilters(
  selectedBookmaker: string,
  marketFilter: MarketFilter,
  date: string,
  eventId?: string,
) {
  const params = new URLSearchParams();
  if (selectedBookmaker !== "all") params.set("bookmaker", selectedBookmaker);
  if (marketFilter !== "all") params.set("marketFilter", marketFilter);
  if (date) params.set("date", date);
  if (eventId) params.set("event", eventId);
  return params.toString();
}

function filterHref(
  id: string,
  selectedBookmaker: string,
  marketFilter: MarketFilter,
  date: string,
) {
  const query = queryStringForFilters(selectedBookmaker, marketFilter, date);
  return "/sports/" + id + (query ? "?" + query : "");
}

export default async function CompetitionPage({ params, searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const { competition: id } = await params;
  const query = await searchParams;
  const competition = getCompetition(id);
  if (!competition) redirect("/sports");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth");

  const [{ data: groupRows }, { data: profile }] = await Promise.all([
    supabase.from("groups").select("id,name").order("name", { ascending: true }),
    supabase.from("profiles").select("time_zone").eq("user_id", data.user.id).maybeSingle(),
  ]);
  const groups = (groupRows ?? []) as { id: string; name: string }[];
  const timeZone = normalizeAnalyticsTimeZone(profile?.time_zone ?? "UTC");
  const books = sportsProviderConfiguration.bookmakers.filter((book) => book.enabled);
  const selected = books.some((book) => book.id === query.bookmaker) ? query.bookmaker! : "all";
  const marketFilter = selectedMarketFilter(query.marketFilter);

  let result: Awaited<ReturnType<typeof getCompetitionOdds>> | null = null;
  let error: string | null = null;
  try {
    result = await getCompetitionOdds(id as CompetitionId);
  } catch {
    error = "Odds are temporarily unavailable. Try again later.";
  }

  const rawEvents = result?.dataset.events ?? [];
  const browseDatasetEvents = rawEvents;
  const selectedDate =
    isBrowseDateKey(query.date) && query.date
      ? query.date
      : getDefaultBrowseDate(browseDatasetEvents, timeZone);
  const rankingSnapshot = competition.id === "ncaaf" ? getActiveRankingSnapshot(new Date()) : null;
  const standingsSnapshot = getLeagueStandingsSnapshot(competition.id as CompetitionId);
  const priorityContext = { rankingSnapshot, standingsSnapshot };
  const availableDates = availableBrowseDates(browseDatasetEvents, timeZone);
  const visibleEvents = browseDatasetEvents.filter(
    (event) => getLocalDateKey(event.scheduledStart, timeZone) === selectedDate,
  );
  const orderedEvents = sortEventsForBrowse(visibleEvents, timeZone, priorityContext);
  const requestedActiveEvent = orderedEvents.find((event) => event.id === query.event) ?? null;
  const activeEvent =
    requestedActiveEvent ??
    orderedEvents.find((event) => hasBrowseOdds(event, selected, marketFilter)) ??
    orderedEvents[0] ??
    null;
  const shouldScrollToActiveEvent = Boolean(query.event && requestedActiveEvent);

  const baseEvent = rawEvents.find((event) => event.id === activeEvent?.id) ?? null;
  const loadAlternates = Boolean(
    baseEvent && query.event === activeEvent?.id && query.alternates === "1",
  );
  let alternateResult: Awaited<ReturnType<typeof getEventAlternateOdds>> | null = null;
  if (loadAlternates && baseEvent) {
    try {
      alternateResult = await getEventAlternateOdds(id as CompetitionId, baseEvent.providerEventId);
    } catch {
      alternateResult = null;
    }
  }
  const dataset = result
    ? {
        ...result.dataset,
        events: result.dataset.events.map((event) =>
          alternateResult?.dataset.events.find((alternate) => alternate.id === event.id)
            ? {
                ...event,
                odds: [
                  ...event.odds,
                  ...alternateResult.dataset.events.find((alternate) => alternate.id === event.id)!
                    .odds,
                ],
              }
            : event,
        ),
      }
    : null;
  const selectedEvent =
    dataset?.events.find((event) => event.id === activeEvent?.id) ?? activeEvent;
  const selectedEventStarted =
    selectedEvent?.status === "live" || selectedEvent?.status === "completed";

  const activeWatches = dataset
    ? await getActiveWatchesForUser(dataset.events.map((event) => event.providerEventId))
    : [];
  const watchesBySelection = new Map(
    activeWatches.map((watch) => [
      [watch.providerEventId, watch.bookmakerId, watch.marketType, watch.selection].join("|"),
      watch,
    ]),
  );
  const chosen =
    dataset && selectedEvent && !selectedEventStarted && query.event === selectedEvent.id
      ? findStraightSelection(dataset, {
          eventId: selectedEvent.id,
          bookmakerId: query.book ?? "",
          marketType: query.market ?? "",
          selection: query.selection ?? "",
          point: query.point,
        })
      : null;
  const slipSelection = chosen
    ? {
        competitionKey: id,
        eventId: chosen.event.id,
        sport: chosen.event.sport,
        competition: chosen.event.competitionName,
        event: chosen.event.awayTeam + " at " + chosen.event.homeTeam,
        scheduledStart: chosen.event.scheduledStart,
        homeTeam: chosen.event.homeTeam,
        awayTeam: chosen.event.awayTeam,
        bookmakerId: chosen.odds.bookmakerId,
        bookmaker: chosen.odds.bookmakerName,
        marketType: chosen.odds.marketType,
        selection: chosen.odds.selection,
        selectionName: chosen.odds.selectionName,
        line: chosen.odds.point,
        americanOdds: chosen.odds.americanOdds,
        decimalOdds: chosen.odds.decimalOdds,
        pricingSource: "provider" as const,
        anchorProviderLine: chosen.odds.marketType === "spread" ? chosen.odds.point : null,
        anchorProviderAmericanOdds:
          chosen.odds.marketType === "spread" ? chosen.odds.americanOdds : null,
      }
    : null;

  const dateOptions = availableDates.map((date) => ({
    value: date,
    label: formatBrowseDate(date, timeZone),
  }));
  const previousDate = previousBrowseDate(selectedDate, availableDates);
  const nextDate = nextBrowseDate(selectedDate, availableDates);
  const eventOptions = orderedEvents.map((event) => ({
    id: event.id,
    label:
      rankedTeamLabel(event.awayTeam, rankingSnapshot) +
      " at " +
      rankedTeamLabel(event.homeTeam, rankingSnapshot) +
      " — " +
      formatBrowseTime(event.scheduledStart, timeZone),
  }));
  const marqueeEventIds = getMarqueeEventIds(orderedEvents, priorityContext);
  const controlsQuery = queryStringForFilters(
    selected,
    marketFilter,
    selectedDate,
    activeEvent?.id,
  );

  return (
    <main className="shell">
      <AppNav active="sports" userId={data.user.id} />
      <CompetitionSwitcher currentCompetition={id} />
      <header className="account-header">
        <div>
          <p className="eyebrow">{competition.sport}</p>
          <h1>{competition.name}</h1>
          {result ? (
            <p className="muted">
              Last refreshed <LocalDateTime value={result.dataset.fetchedAt} /> ·{" "}
              {result.cacheStatus} · quota {result.quotaState}
            </p>
          ) : null}
        </div>
        <form action={refreshOdds}>
          <input type="hidden" name="competitionId" value={id} />
          <input type="hidden" name="returnTo" value={"/sports/" + id + "?" + controlsQuery} />
          <SubmitButton pendingLabel="Refreshing odds…">Refresh odds</SubmitButton>
        </form>
      </header>
      {query.notice ? (
        <p className="notice" role="status" aria-live="polite">
          {query.notice}
        </p>
      ) : null}
      {error ? (
        <p className="notice error" role="alert">
          {error} If this is a new environment, an administrator must configure the server-only
          provider credentials.
        </p>
      ) : null}
      {result ? (
        <p className="refresh-meta">
          <StatusBadge status={result.cacheStatus} />
          <span>Shared data · quota state {result.quotaState}</span>
        </p>
      ) : null}
      <section className="book-filter">
        <strong>Bookmaker</strong>
        <Link
          className={selected === "all" ? "pill active" : "pill"}
          href={filterHref(id, "all", marketFilter, selectedDate)}
        >
          All
        </Link>
        {books.map((book) => (
          <Link
            className={selected === book.id ? "pill active" : "pill"}
            href={filterHref(id, book.id, marketFilter, selectedDate)}
            key={book.id}
          >
            {book.name}
          </Link>
        ))}
      </section>
      <section className="market-filter" aria-label="Market type filters">
        <span className="market-filter-label">Market</span>
        {marketFilters.map(([value, label]) => (
          <Link
            className={marketFilter === value ? "pill active" : "pill"}
            href={filterHref(id, selected, value, selectedDate)}
            key={value}
          >
            {label}
          </Link>
        ))}
      </section>
      <p className="muted odds-pricing-note">
        Provider-priced alternate lines are preferred when available. The Bet Slip’s Adjust line
        control is a separate simulated estimate and is never presented as bookmaker pricing.
      </p>
      {rankingSnapshot ? (
        <p className="browse-context-note">
          Rankings: {rankingSnapshot.label} · updated{" "}
          {formatBrowseDate(getLocalDateKey(rankingSnapshot.updatedAt, timeZone) ?? "", timeZone)}
        </p>
      ) : null}
      {standingsSnapshot ? (
        <p className="browse-context-note">
          Standings: {standingsSnapshot.label} · updated{" "}
          {formatBrowseDate(getLocalDateKey(standingsSnapshot.updatedAt, timeZone) ?? "", timeZone)}
        </p>
      ) : null}
      <BrowseScheduleControls
        pathname={"/sports/" + id}
        baseQuery={controlsQuery}
        competitionId={id}
        selectedDate={selectedDate}
        dateOptions={dateOptions}
        previousDate={previousDate}
        nextDate={nextDate}
        eventOptions={eventOptions}
        activeEventId={activeEvent?.id ?? null}
        shouldScrollToActiveEvent={shouldScrollToActiveEvent}
      />
      <div className="sportsbook-layout">
        <div className="event-list browse-event-list">
          {orderedEvents.length ? (
            groupEventsByKickoff(orderedEvents, timeZone, priorityContext).map((group) => (
              <section className="kickoff-group" key={group.key}>
                <h2 className="kickoff-group-heading">
                  <span>{group.label}</span>
                  <span>
                    {group.events.length} {group.events.length === 1 ? "game" : "games"}
                  </span>
                </h2>
                <div className="kickoff-group-games">
                  {group.events.map((event) => {
                    const isActive = event.id === activeEvent?.id;
                    const renderEvent =
                      isActive && selectedEvent?.id === event.id ? selectedEvent : event;
                    const eventStarted =
                      renderEvent.status === "live" || renderEvent.status === "completed";
                    const odds = renderEvent.odds.filter(
                      (odd) =>
                        (selected === "all" || odd.bookmakerId === selected) &&
                        (marketFilter === "all" || odd.marketType === marketFilter),
                    );
                    const visibleGroups = marketGroups.filter(
                      ([marketType]) => marketFilter === "all" || marketType === marketFilter,
                    );
                    const eventHrefParams = new URLSearchParams();
                    if (selected !== "all") eventHrefParams.set("bookmaker", selected);
                    if (marketFilter !== "all") eventHrefParams.set("marketFilter", marketFilter);
                    eventHrefParams.set("date", selectedDate);
                    eventHrefParams.set("event", event.id);
                    const eventHref = "/sports/" + id + "?" + eventHrefParams.toString();
                    return (
                      <BrowseGameCard
                        key={event.id}
                        event={renderEvent}
                        href={eventHref}
                        active={isActive}
                        marquee={marqueeEventIds.has(event.id)}
                        away={{
                          name: event.awayTeam,
                          rank: getTeamRanking(event.awayTeam, rankingSnapshot)?.rank ?? null,
                          record: recordLabel(event.awayTeam),
                          sport: event.sport,
                        }}
                        home={{
                          name: event.homeTeam,
                          rank: getTeamRanking(event.homeTeam, rankingSnapshot)?.rank ?? null,
                          record: recordLabel(event.homeTeam),
                          sport: event.sport,
                        }}
                      >
                        {odds.length || marketFilter === "other" ? (
                          <div className="market-groups">
                            {visibleGroups.map(([marketType, label]) => {
                              const marketOdds =
                                marketType === "other"
                                  ? []
                                  : odds.filter((odd) => odd.marketType === marketType);
                              return (
                                <section className="market-group" key={marketType}>
                                  <h3>{label}</h3>
                                  {marketOdds.length ? (
                                    <OddsSelectionGrid
                                      odds={marketOdds.map((odd) => ({
                                        ...odd,
                                        providerEventId: renderEvent.providerEventId,
                                        competitionKey: id,
                                        eventId: renderEvent.id,
                                        watch:
                                          watchesBySelection.get(
                                            [
                                              renderEvent.providerEventId,
                                              odd.bookmakerId,
                                              odd.marketType,
                                              odd.selection,
                                            ].join("|"),
                                          ) ?? null,
                                        href:
                                          "/sports/" +
                                          id +
                                          "?" +
                                          new URLSearchParams({
                                            ...(selected === "all" ? {} : { bookmaker: selected }),
                                            date: selectedDate,
                                            event: renderEvent.id,
                                            book: odd.bookmakerId,
                                            market: odd.marketType,
                                            selection: odd.selection,
                                            ...(odd.point === null
                                              ? {}
                                              : { point: String(odd.point) }),
                                            ...(marketFilter === "all" ? {} : { marketFilter }),
                                          }).toString(),
                                        isSelected:
                                          chosen?.event.id === renderEvent.id &&
                                          chosen.odds.bookmakerId === odd.bookmakerId &&
                                          chosen.odds.marketType === odd.marketType &&
                                          chosen.odds.selection === odd.selection &&
                                          chosen.odds.point === odd.point,
                                        eventStarted,
                                      }))}
                                    />
                                  ) : marketType === "other" ? (
                                    <p className="muted">
                                      No props or other markets are returned by the configured
                                      provider feed.
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
                        {competition.alternateMarkets.length && !eventStarted ? (
                          <p className="alternate-lines-link">
                            <Link
                              href={
                                "/sports/" +
                                id +
                                "?" +
                                new URLSearchParams({
                                  ...(selected === "all" ? {} : { bookmaker: selected }),
                                  date: selectedDate,
                                  event: renderEvent.id,
                                  alternates: "1",
                                  ...(marketFilter === "all" ? {} : { marketFilter }),
                                }).toString()
                              }
                            >
                              {loadAlternates && baseEvent?.id === renderEvent.id
                                ? alternateResult?.dataset.events.some(
                                    (candidate) => candidate.odds.length,
                                  )
                                  ? "Provider-priced alternate lines loaded"
                                  : "No alternate lines returned by the provider"
                                : "Load provider-priced alternate lines"}
                            </Link>
                            <small>
                              {loadAlternates &&
                              baseEvent?.id === renderEvent.id &&
                              !alternateResult
                                ? "Alternate pricing is unavailable right now."
                                : "Separate on-demand provider pricing; no line interpolation."}
                            </small>
                          </p>
                        ) : null}
                      </BrowseGameCard>
                    );
                  })}
                </div>
              </section>
            ))
          ) : result ? (
            <p className="empty-state">
              <strong>
                No games with supported odds on {formatBrowseDate(selectedDate, timeZone)}.
              </strong>
              Choose another date or refresh the shared odds cache.
            </p>
          ) : null}
          {!result && !error ? (
            <p className="empty-state">
              Odds are loading. The page will update when the shared cache responds.
            </p>
          ) : null}
        </div>
        <BetSlip
          selection={slipSelection}
          groups={groups}
          initialMobileSheetOpen={query.mobileSheet === "1"}
        />
      </div>
    </main>
  );
}
