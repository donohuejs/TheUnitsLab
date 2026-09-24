import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { BrowseBetSlipBridge, BrowseBetSlipTarget } from "@/components/browse-bet-slip-host";
import { BrowseFilterSelect } from "@/components/browse-filter-select";
import { BrowseGameCard } from "@/components/browse-game-card";
import {
  BROWSE_MARKET_FILTERS,
  BrowseMarketBoard,
  type BrowseMarketFilter,
} from "@/components/browse-market-board";
import { BrowseScheduleControls } from "@/components/browse-schedule-controls";
import { CompetitionSwitcher } from "@/components/competition-switcher";
import { KickoffTime } from "@/components/kickoff-time";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { TeamMark } from "@/components/team-mark";
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
  filterEventsForBrowseDate,
  getDefaultBrowseDate,
  getLocalDateKey,
  getMarqueeEventIds,
  groupEventsByKickoff,
  isBrowseDateKey,
  normalizeBrowseTimeZone,
  nextBrowseDate,
  previousBrowseDate,
  sortEventsForBrowse,
} from "@/lib/browse-schedule";
import { getCompetition } from "@/lib/odds/request";
import { getCompetitionOdds, getEventAlternateOdds } from "@/lib/odds/server";
import type { CompetitionId } from "@/lib/odds/types";
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

function selectedMarketFilter(value: string | undefined): BrowseMarketFilter {
  return BROWSE_MARKET_FILTERS.some(([candidate]) => candidate === value)
    ? (value as BrowseMarketFilter)
    : "all";
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

function queryStringForFilters(
  selectedBookmaker: string,
  marketFilter: BrowseMarketFilter,
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
  marketFilter: BrowseMarketFilter,
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
  const timeZone = normalizeBrowseTimeZone(profile?.time_zone);
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
  const visibleEvents = filterEventsForBrowseDate(browseDatasetEvents, selectedDate, timeZone);
  const orderedEvents = sortEventsForBrowse(visibleEvents, timeZone, priorityContext);
  const requestedActiveEvent = orderedEvents.find((event) => event.id === query.event) ?? null;
  const activeEvent = requestedActiveEvent;
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

  let activeWatches: Awaited<ReturnType<typeof getActiveWatchesForUser>> = [];
  let watchlistUnavailable = false;
  if (dataset) {
    try {
      activeWatches = await getActiveWatchesForUser(
        dataset.events.map((event) => event.providerEventId),
      );
    } catch (watchlistError) {
      watchlistUnavailable = true;
      const failure = watchlistError as { code?: unknown; message?: unknown };
      console.error(
        "[sports-watchlist] Watch state could not be loaded; continuing to render current odds.",
        {
          competitionId: id,
          errorCode: typeof failure?.code === "string" ? failure.code : undefined,
          errorMessage:
            typeof failure?.message === "string"
              ? failure.message
              : watchlistError instanceof Error
                ? watchlistError.message
                : String(watchlistError),
        },
      );
    }
  }
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

  const activeMarketBoard = selectedEvent ? (
    <BrowseMarketBoard
      event={selectedEvent}
      competitionId={id}
      selectedBookmaker={selected}
      marketFilter={marketFilter}
      selectedDate={selectedDate}
      chosen={chosen}
      watchesBySelection={watchesBySelection}
      alternateMarketsAvailable={competition.alternateMarkets.length > 0}
      alternateLoaded={loadAlternates}
      alternateEvents={alternateResult?.dataset.events ?? []}
      watchlistAvailable={!watchlistUnavailable}
    />
  ) : null;

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
  const bookmakerFilterOptions = [
    {
      value: "all",
      label: "All bookmakers",
      href: filterHref(id, "all", marketFilter, selectedDate),
    },
    ...books.map((book) => ({
      value: book.id,
      label: book.name,
      href: filterHref(id, book.id, marketFilter, selectedDate),
    })),
  ];
  const marketFilterOptions = BROWSE_MARKET_FILTERS.map(([value, label]) => ({
    value,
    label,
    href: filterHref(id, selected, value, selectedDate),
  }));
  const controlsQuery = queryStringForFilters(
    selected,
    marketFilter,
    selectedDate,
    activeEvent?.id,
  );

  return (
    <main className="shell browse-shell">
      <AppNav active="sports" userId={data.user.id} />
      <CompetitionSwitcher currentCompetition={id} />
      <header className="account-header">
        <div>
          <p className="eyebrow">{competition.sport}</p>
          <h1>{competition.name}</h1>
        </div>
      </header>
      {query.notice ? (
        <p className="notice" role="status" aria-live="polite">
          {query.notice}
        </p>
      ) : null}
      {watchlistUnavailable ? (
        <p className="notice error" role="status">
          Watchlist status is temporarily unavailable. Current odds are still shown.
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
      <div className="browse-filter-bar">
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
        <div className="browse-filter-group browse-bookmaker-control desktop-browse-filter-control">
          <BrowseFilterSelect
            id={`browse-bookmaker-${id}`}
            label="Bookmaker"
            value={selected}
            options={bookmakerFilterOptions}
          />
        </div>
        <div className="browse-filter-group browse-bookmaker-control mobile-browse-filter-control">
          <span className="browse-filter-label">Bookmaker</span>
          <div className="browse-filter-options">
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
          </div>
        </div>
        <div className="browse-filter-group browse-market-control desktop-browse-filter-control">
          <BrowseFilterSelect
            id={`browse-market-${id}`}
            label="Market"
            value={marketFilter}
            options={marketFilterOptions}
          />
        </div>
        <div className="browse-filter-group browse-market-control mobile-browse-filter-control">
          <span className="browse-filter-label">Market</span>
          <div className="browse-filter-options">
            {BROWSE_MARKET_FILTERS.map(([value, label]) => (
              <Link
                className={marketFilter === value ? "pill active" : "pill"}
                href={filterHref(id, selected, value, selectedDate)}
                key={value}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="browse-refresh-control">
          <form action={refreshOdds}>
            <input type="hidden" name="competitionId" value={id} />
            <input type="hidden" name="returnTo" value={"/sports/" + id + "?" + controlsQuery} />
            <SubmitButton pendingLabel="Refreshing odds…">Refresh odds</SubmitButton>
          </form>
          {result ? (
            <small>
              Last refreshed <LocalDateTime value={result.dataset.fetchedAt} /> ·{" "}
              {result.cacheStatus}
            </small>
          ) : null}
        </div>
      </div>
      <div className="browse-supporting-context">
        <p className="muted odds-pricing-note">
          Provider-priced alternate lines are preferred when available. The Bet Slip’s Adjust line
          control is a separate simulated estimate.
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
            {formatBrowseDate(
              getLocalDateKey(standingsSnapshot.updatedAt, timeZone) ?? "",
              timeZone,
            )}
          </p>
        ) : null}
      </div>
      <div className="sportsbook-layout browse-master-detail-layout">
        <aside className="browse-games-rail" aria-label="Games navigator">
          <header className="browse-games-rail-header">
            <div>
              <p className="eyebrow">Games</p>
              <h2>{formatBrowseDate(selectedDate, timeZone)}</h2>
            </div>
            <span className="browse-games-count">
              {orderedEvents.length} {orderedEvents.length === 1 ? "game" : "games"}
            </span>
          </header>
          <div className="event-list browse-event-list">
            {orderedEvents.length ? (
              groupEventsByKickoff(orderedEvents, timeZone, priorityContext).map((group) => (
                <section className="kickoff-group" key={group.key}>
                  <h3 className="kickoff-group-heading">
                    <span>{group.label}</span>
                    <span>{group.events.length}</span>
                  </h3>
                  <div className="kickoff-group-games">
                    {group.events.map((event) => {
                      const isActive = event.id === activeEvent?.id;
                      const eventHrefParams = new URLSearchParams();
                      if (selected !== "all") eventHrefParams.set("bookmaker", selected);
                      if (marketFilter !== "all") eventHrefParams.set("marketFilter", marketFilter);
                      eventHrefParams.set("date", selectedDate);
                      eventHrefParams.set("event", event.id);
                      return (
                        <BrowseGameCard
                          key={event.id}
                          event={event}
                          href={"/sports/" + id + "?" + eventHrefParams.toString()}
                          active={isActive}
                          timeZone={timeZone}
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
                          {isActive ? activeMarketBoard : null}
                        </BrowseGameCard>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : result ? (
              <p className="empty-state">
                <strong>No games on {formatBrowseDate(selectedDate, timeZone)}.</strong>
                Choose another date or refresh the shared odds cache.
              </p>
            ) : null}
            {!result && !error ? (
              <p className="empty-state">
                Odds are loading. The page will update when the shared cache responds.
              </p>
            ) : null}
          </div>
        </aside>
        <section
          className="browse-market-detail"
          aria-label="Selected game markets"
          aria-live="polite"
        >
          {selectedEvent ? (
            <>
              <header className="browse-market-detail-header">
                <p className="eyebrow">Selected game</p>
                <h2>
                  <span>
                    <TeamMark teamName={selectedEvent.awayTeam} sport={selectedEvent.sport} />
                    {getTeamRanking(selectedEvent.awayTeam, rankingSnapshot)?.rank
                      ? `#${getTeamRanking(selectedEvent.awayTeam, rankingSnapshot)?.rank} `
                      : ""}
                    {selectedEvent.awayTeam}
                  </span>
                  <span className="event-at">at</span>
                  <span>
                    <TeamMark teamName={selectedEvent.homeTeam} sport={selectedEvent.sport} />
                    {getTeamRanking(selectedEvent.homeTeam, rankingSnapshot)?.rank
                      ? `#${getTeamRanking(selectedEvent.homeTeam, rankingSnapshot)?.rank} `
                      : ""}
                    {selectedEvent.homeTeam}
                  </span>
                </h2>
                <p className="browse-detail-meta">
                  <KickoffTime value={selectedEvent.scheduledStart} timeZone={timeZone} /> ·{" "}
                  <StatusBadge status={selectedEvent.status} />
                </p>
              </header>
              {activeMarketBoard}
            </>
          ) : (
            <div className="browse-selection-empty">
              <span className="browse-selection-empty-icon" aria-hidden="true">
                ◎
              </span>
              <h2>Select a game to view markets.</h2>
              <p>Choose a matchup from the Games list or Jump to Game above.</p>
            </div>
          )}
        </section>
        <BrowseBetSlipBridge
          selection={slipSelection}
          groups={groups}
          initialMobileSheetOpen={query.mobileSheet === "1"}
        />
        <BrowseBetSlipTarget />
      </div>
    </main>
  );
}
