import { notFound } from "next/navigation";

import { BrowseBetSlipBridge, BrowseBetSlipProvider } from "@/components/browse-bet-slip-host";
import { BrowseGameCard } from "@/components/browse-game-card";
import { BrowseGamesPane } from "@/components/browse-games-pane";
import { BrowseMarketBoard } from "@/components/browse-market-board";
import { BrowseMarketPane } from "@/components/browse-market-pane";
import { BrowseOddsDialog } from "@/components/browse-odds-dialog";
import { BrowseScheduleControls } from "@/components/browse-schedule-controls";
import type { NormalizedEvent } from "@/lib/odds/types";
import { findStraightSelection } from "@/lib/wagers/selection";

// Local, credential-free interaction fixture. Never available in a production build.
export default async function BrowsePreview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const date = "2099-09-26";
  const matchups = [
    ["Texas Longhorns", "Tennessee Volunteers"],
    ["Iowa Hawkeyes", "Michigan Wolverines"],
    ["Oklahoma Sooners", "Georgia Bulldogs"],
    ["Ole Miss Rebels", "Florida Gators"],
    ["Oregon Ducks", "USC Trojans"],
    ["Texas A&M Aggies", "LSU Tigers"],
    ["Wisconsin Badgers", "Penn State Nittany Lions"],
    ["Nebraska Cornhuskers", "Michigan State Spartans"],
    ["Rice Owls", "Fresno State Bulldogs"],
    ["Georgia Tech Yellow Jackets", "Stanford Cardinal"],
    ["Air Force Falcons", "Nevada Wolf Pack"],
    ["Minnesota Golden Gophers", "Washington Huskies"],
  ];
  const events: NormalizedEvent[] = Array.from({ length: 36 }, (_, index) => {
    const [awayTeam, homeTeam] = matchups[index % matchups.length]!;
    const scheduledStart = `${date}T${String(16 + Math.floor(index / 6)).padStart(2, "0")}:00:00Z`;
    return {
      id: `preview-${index}`,
      providerEventId: `preview-${index}`,
      sport: "football",
      competitionId: "ncaaf",
      competitionName: "NCAA Football",
      providerSportKey: "preview",
      awayTeam: awayTeam!,
      homeTeam: homeTeam!,
      scheduledStart,
      status: "scheduled",
      odds: ["fanduel", "draftkings", "betmgm"].flatMap((bookmakerId) => [
        {
          bookmakerId,
          bookmakerName:
            bookmakerId === "fanduel"
              ? "FanDuel"
              : bookmakerId === "draftkings"
                ? "DraftKings"
                : "BetMGM",
          marketType: "moneyline" as const,
          selection: "away" as const,
          selectionName: awayTeam!,
          point: null,
          americanOdds: 120,
          decimalOdds: 2.2,
          fetchedAt: scheduledStart,
          providerUpdatedAt: scheduledStart,
        },
        {
          bookmakerId,
          bookmakerName:
            bookmakerId === "fanduel"
              ? "FanDuel"
              : bookmakerId === "draftkings"
                ? "DraftKings"
                : "BetMGM",
          marketType: "moneyline" as const,
          selection: "home" as const,
          selectionName: homeTeam!,
          point: null,
          americanOdds: -140,
          decimalOdds: 1.7143,
          fetchedAt: scheduledStart,
          providerUpdatedAt: scheduledStart,
        },
        {
          bookmakerId,
          bookmakerName:
            bookmakerId === "fanduel"
              ? "FanDuel"
              : bookmakerId === "draftkings"
                ? "DraftKings"
                : "BetMGM",
          marketType: "spread" as const,
          selection: "away" as const,
          selectionName: awayTeam!,
          point: 3.5,
          americanOdds: -110,
          decimalOdds: 1.9091,
          fetchedAt: scheduledStart,
          providerUpdatedAt: scheduledStart,
        },
        {
          bookmakerId,
          bookmakerName:
            bookmakerId === "fanduel"
              ? "FanDuel"
              : bookmakerId === "draftkings"
                ? "DraftKings"
                : "BetMGM",
          marketType: "spread" as const,
          selection: "home" as const,
          selectionName: homeTeam!,
          point: -3.5,
          americanOdds: -110,
          decimalOdds: 1.9091,
          fetchedAt: scheduledStart,
          providerUpdatedAt: scheduledStart,
        },
      ]),
    };
  });
  const active = events.find((event) => event.id === query.event) ?? null;
  const chosen = findStraightSelection(
    { competitionId: "ncaaf", events, fetchedAt: `${date}T12:00:00Z` },
    {
      eventId: active?.id ?? "",
      bookmakerId: query.book ?? "",
      marketType: query.market ?? "",
      selection: query.selection ?? "",
      point: query.point,
    },
  );
  const selection = chosen
    ? {
        competitionKey: "ncaaf",
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
      }
    : null;
  return (
    <BrowseBetSlipProvider placementEnabled={false}>
      <main className="shell browse-shell">
        <header className="account-header">
          <div>
            <p className="eyebrow">Layout preview</p>
            <h1>NCAA Football</h1>
          </div>
        </header>
        <p className="notice">
          Sample scheduled games and prices for local UI testing. No live games, provider requests,
          or wager placement.
        </p>
        <div className="browse-filter-bar">
          <BrowseScheduleControls
            pathname="/browse-preview"
            baseQuery={`date=${date}`}
            competitionId="preview"
            selectedDate={date}
            dateOptions={[{ value: date, label: "Sample game day" }]}
            previousDate={null}
            nextDate={null}
            eventOptions={events.map((event) => ({
              id: event.id,
              label: event.awayTeam + " at " + event.homeTeam,
            }))}
            activeEventId={active?.id ?? null}
          />
        </div>
        <BrowseGamesPane>
          <header className="browse-games-header">
            <h2>Choose a game</h2>
            <span className="browse-games-count">36 sample games</span>
          </header>
          <div className="browse-game-grid">
            {events.map((event) => (
              <BrowseGameCard
                key={event.id}
                event={event}
                href={`/browse-preview?event=${event.id}`}
                active={event.id === active?.id}
                timeZone="America/New_York"
                away={{
                  name: event.awayTeam,
                  rank: null,
                  record: null,
                  sport: event.sport,
                  competitionId: "ncaaf",
                }}
                home={{
                  name: event.homeTeam,
                  rank: null,
                  record: null,
                  sport: event.sport,
                  competitionId: "ncaaf",
                }}
              />
            ))}
          </div>
        </BrowseGamesPane>
        <BrowseOddsDialog
          activeEventId={active?.id ?? null}
          closeHref="/browse-preview"
          openSlip={query.mobileSheet === "1"}
          notice={query.notice}
        >
          <BrowseMarketPane activeEventId={active?.id ?? null}>
            {active ? (
              <>
                <header className="browse-market-detail-header">
                  <h2>
                    {active.awayTeam} at {active.homeTeam}
                  </h2>
                  <p className="muted">Sample pregame odds · not live prices</p>
                </header>
                <BrowseMarketBoard
                  event={active}
                  competitionId="ncaaf"
                  pathname="/browse-preview"
                  selectedBookmaker="all"
                  marketFilter="all"
                  selectedDate={date}
                  chosen={chosen}
                  watchesBySelection={new Map()}
                  alternateMarketsAvailable={false}
                  alternateLoaded={false}
                  alternateEvents={[]}
                  watchlistAvailable={false}
                />
              </>
            ) : null}
          </BrowseMarketPane>
        </BrowseOddsDialog>
        <BrowseBetSlipBridge selection={selection} groups={[]} initialMobileSheetOpen={false} />
      </main>
    </BrowseBetSlipProvider>
  );
}
