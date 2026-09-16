import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { BetSlip } from "@/components/bet-slip";
import { CompetitionSwitcher } from "@/components/competition-switcher";
import { KickoffTime } from "@/components/kickoff-time";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { TeamMark } from "@/components/team-mark";
import { sportsProviderConfiguration } from "@/config/sports";
import { hasPublicEnvironment } from "@/config/env.public";
import { getCompetition } from "@/lib/odds/request";
import { getCompetitionOdds, getEventAlternateOdds } from "@/lib/odds/server";
import type { CompetitionId } from "@/lib/odds/types";
import { findStraightSelection } from "@/lib/wagers/selection";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { refreshOdds } from "../actions";

type Props = {
  params: Promise<{ competition: string }>;
  searchParams: Promise<{
    bookmaker?: string;
    notice?: string;
    event?: string;
    market?: string;
    selection?: string;
    point?: string;
    alternates?: string;
    book?: string;
  }>;
};
const price = (value: number) => (value > 0 ? `+${value}` : String(value));

const marketGroups = [
  ["moneyline", "Moneyline"],
  ["spread", "Point spread / handicap"],
  ["total", "Total"],
  ["other", "Props / Other"],
] as const;

export default async function CompetitionPage({ params, searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const { competition: id } = await params;
  const query = await searchParams;
  const competition = getCompetition(id);
  if (!competition) redirect("/sports");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth");
  const { data: groupRows } = await supabase
    .from("groups")
    .select("id,name")
    .order("name", { ascending: true });
  const groups = (groupRows ?? []) as { id: string; name: string }[];
  const books = sportsProviderConfiguration.bookmakers.filter((book) => book.enabled);
  const selected = books.some((book) => book.id === query.bookmaker) ? query.bookmaker : "all";
  let result;
  let error: string | null = null;
  try {
    result = await getCompetitionOdds(id as CompetitionId);
  } catch {
    error = "Odds are temporarily unavailable. Try again later.";
  }
  const baseEvent = result?.dataset.events.find((event) => event.id === query.event);
  const loadAlternates = Boolean(baseEvent && query.alternates === "1");
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
  const selectedEvent = dataset?.events.find((event) => event.id === query.event);
  const selectedEventStarted = selectedEvent?.status === "live";
  const chosen =
    dataset && !selectedEventStarted
      ? findStraightSelection(dataset, {
          eventId: query.event ?? "",
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
        event: `${chosen.event.awayTeam} at ${chosen.event.homeTeam}`,
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
      }
    : null;
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
        <Link className={selected === "all" ? "pill active" : "pill"} href={`/sports/${id}`}>
          All
        </Link>
        {books.map((book) => (
          <Link
            className={selected === book.id ? "pill active" : "pill"}
            href={`/sports/${id}?bookmaker=${book.id}`}
            key={book.id}
          >
            {book.name}
          </Link>
        ))}
      </section>
      <div className="sportsbook-layout">
        <div className="event-list">
          {dataset?.events.map((event) => {
            const eventStarted = event.status === "live";
            const odds = event.odds.filter(
              (odd) => selected === "all" || odd.bookmakerId === selected,
            );
            return (
              <article className="card event-card" key={event.id}>
                <div className="event-heading">
                  <div className="event-heading-main">
                    <h2 className="event-teams">
                      <span>
                        <TeamMark teamName={event.awayTeam} sport={event.sport} />
                        {event.awayTeam}
                      </span>
                      <span className="event-at">at</span>
                      <span>
                        <TeamMark teamName={event.homeTeam} sport={event.sport} />
                        {event.homeTeam}
                      </span>
                    </h2>
                    <div className="event-kickoff">
                      <span className="sr-only">Kickoff </span>
                      <KickoffTime value={event.scheduledStart} />
                    </div>
                  </div>
                  <StatusBadge status={event.status} />
                </div>
                {odds.length ? (
                  <div className="market-groups">
                    {marketGroups.map(([marketType, label]) => {
                      const marketOdds =
                        marketType === "other"
                          ? []
                          : odds.filter((odd) => odd.marketType === marketType);
                      return (
                        <section className="market-group" key={marketType}>
                          <h3>{label}</h3>
                          {marketOdds.length ? (
                            <div className="odds-grid">
                              {marketOdds.map((odd, index) => {
                                const isSelected =
                                  chosen?.event.id === event.id &&
                                  chosen.odds.bookmakerId === odd.bookmakerId &&
                                  chosen.odds.marketType === odd.marketType &&
                                  chosen.odds.selection === odd.selection &&
                                  chosen.odds.point === odd.point;
                                const content = (
                                  <>
                                    <small>
                                      {odd.bookmakerName} ·{" "}
                                      {eventStarted
                                        ? odd.isAlternate
                                          ? "LIVE · provider-priced alternate locked"
                                          : "LIVE · pregame price locked"
                                        : odd.isAlternate
                                          ? `provider-priced alternate ${odd.marketType}`
                                          : "pregame price"}
                                    </small>
                                    <strong>
                                      {odd.selectionName}
                                      {odd.point === null
                                        ? ""
                                        : ` ${odd.point > 0 ? "+" : ""}${odd.point}`}
                                    </strong>
                                    <span>
                                      {price(odd.americanOdds)}{" "}
                                      <small>({odd.decimalOdds.toFixed(2)})</small>
                                    </span>
                                    <small>
                                      {isSelected
                                        ? "Selected for simulated slip"
                                        : eventStarted
                                          ? "LIVE · pregame wagering locked"
                                          : "Select for simulated slip"}
                                    </small>
                                  </>
                                );
                                const key = `${odd.bookmakerId}-${odd.marketType}-${odd.selection}-${odd.point}-${index}`;
                                return eventStarted ? (
                                  <div className="odd locked" key={key} aria-disabled="true">
                                    {content}
                                  </div>
                                ) : (
                                  <Link
                                    className={isSelected ? "odd selected" : "odd"}
                                    href={`/sports/${id}?${new URLSearchParams({
                                      ...(selected === "all" ? {} : { bookmaker: selected }),
                                      event: event.id,
                                      book: odd.bookmakerId,
                                      market: odd.marketType,
                                      selection: odd.selection,
                                      ...(odd.point === null ? {} : { point: String(odd.point) }),
                                    }).toString()}`}
                                    key={key}
                                    aria-current={isSelected ? "true" : undefined}
                                  >
                                    {content}
                                  </Link>
                                );
                              })}
                            </div>
                          ) : marketType === "other" ? (
                            <p className="muted">
                              No props or other markets are returned by the configured provider
                              feed.
                            </p>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <p className="empty-state">No supported odds from the selected bookmaker.</p>
                )}
                {competition.alternateMarkets.length ? (
                  <p className="alternate-lines-link">
                    <Link
                      href={`/sports/${id}?${new URLSearchParams({
                        ...(selected === "all" ? {} : { bookmaker: selected }),
                        event: event.id,
                        alternates: "1",
                      }).toString()}`}
                    >
                      {loadAlternates && baseEvent?.id === event.id
                        ? alternateResult?.dataset.events.some((candidate) => candidate.odds.length)
                          ? "Provider-priced alternate lines loaded"
                          : "No alternate lines returned by the provider"
                        : "Load provider-priced alternate lines"}
                    </Link>
                    <small>
                      {loadAlternates && baseEvent?.id === event.id && !alternateResult
                        ? "Alternate pricing is unavailable right now."
                        : "Separate on-demand provider pricing; no line interpolation."}
                    </small>
                  </p>
                ) : null}
              </article>
            );
          })}
          {dataset && dataset.events.length === 0 ? (
            <p className="empty-state">
              <strong>No scheduled events are currently available</strong>
              Check back later; odds refreshes are shared and quota-protected.
            </p>
          ) : null}
          {!result && !error ? (
            <p className="empty-state">
              Odds are loading. The page will update when the shared cache responds.
            </p>
          ) : null}
        </div>
        <BetSlip selection={slipSelection} groups={groups} />
      </div>
    </main>
  );
}
