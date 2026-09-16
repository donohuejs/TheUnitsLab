import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { MarketBadge, SourceBadge, StatusBadge, TicketTypeBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { SlipPlacementCleanup } from "@/components/slip-placement-cleanup";
import { TeamMark } from "@/components/team-mark";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { liveWagerState } from "@/lib/settlement/grading";

import { refreshMyOpenScores } from "./actions";

type Filter = "all" | "open" | "settled" | "simulated" | "imported";
type Props = {
  searchParams: Promise<{ filter?: string; view?: string; notice?: string; slip?: string }>;
};
type Leg = {
  id: string;
  leg_number: number;
  provider_event_id: string;
  sport_key: string;
  competition_name: string;
  bookmaker_name: string;
  home_team: string;
  away_team: string;
  market_type: "moneyline" | "spread" | "total";
  selection: "home" | "away" | "draw" | "over" | "under";
  selection_name: string;
  line: number | null;
  american_odds: number;
  decimal_odds: number;
  result: "open" | "won" | "lost" | "push" | "void";
};
type Ticket = {
  id: string;
  ticket_type: "straight" | "parlay";
  leg_count: number;
  stake_units: number;
  decimal_equivalent_odds: number;
  potential_profit_units: number;
  potential_return_units: number;
  american_odds: number;
  status: "open" | "won" | "lost" | "push" | "void";
  settled_profit_units: number | null;
  settled_return_units: number | null;
  created_at: string;
  bet_legs: Leg[];
};
type ImportedWager = {
  id: string;
  sportsbook_name: string;
  ticket_type: "straight" | "parlay";
  leg_count: number;
  event_description: string;
  event_date: string;
  selection: string;
  market_type: "moneyline" | "spread" | "total";
  line: number | null;
  american_odds: number;
  decimal_odds: number;
  stake_units: number;
  raw_stake_dollars: number | null;
  raw_return_dollars: number | null;
  status: "open" | "won" | "lost" | "push" | "void";
  profit_loss_units: number;
  match_state: "matched" | "partially_matched" | "unmatched" | "needs_review";
  match_reason: string | null;
  settlement_method: "automatic" | "manual";
  external_wager_legs: {
    id: string;
    leg_number: number;
    event_description: string;
    selection: string;
    result: string;
  }[];
};
type Score = {
  provider_event_id: string;
  status_text: string;
  home_score: number | null;
  away_score: number | null;
  clock_text: string | null;
  period_text: string | null;
};

const price = (value: number) => (value > 0 ? `+${value}` : String(value));
const vials = (value: number) => Number(value).toFixed(2);
const filters: [Filter, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["settled", "Settled"],
  ["simulated", "Simulated"],
  ["imported", "Imported"],
];

function selectedFilter(query: { filter?: string; view?: string }): Filter {
  if (filters.some(([value]) => value === query.filter)) return query.filter as Filter;
  if (query.view === "history") return "settled";
  if (query.view === "open") return "open";
  return "all";
}

export default async function MyBetsPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const filter = selectedFilter(query);
  const slipKeys = query.slip?.split(",").filter(Boolean).slice(0, 12) ?? [];
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  const [ticketResult, importedResult, ledgerResult] = await Promise.all([
    supabase
      .from("bets")
      .select(
        "id,ticket_type,leg_count,stake_units,decimal_equivalent_odds,potential_profit_units,potential_return_units,american_odds,status,settled_profit_units,settled_return_units,created_at,bet_legs(*)",
      )
      .eq("is_synthetic", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("external_wagers")
      .select(
        "id,sportsbook_name,ticket_type,leg_count,event_description,event_date,selection,market_type,line,american_odds,decimal_odds,stake_units,raw_stake_dollars,raw_return_dollars,status,profit_loss_units,match_state,match_reason,settlement_method,external_wager_legs(*)",
      )
      .eq("user_id", authData.user.id)
      .order("wager_date", { ascending: false }),
    supabase.from("bankroll_ledger").select("amount_units"),
  ]);
  const allTickets = (ticketResult.data ?? []) as Ticket[];
  const allImported = (importedResult.data ?? []) as ImportedWager[];
  const records = allTickets.filter(
    (ticket) =>
      filter !== "imported" &&
      (filter === "all" ||
        filter === "simulated" ||
        (filter === "open" && ticket.status === "open") ||
        (filter === "settled" && ticket.status !== "open")),
  );
  const importedRecords = allImported.filter(
    (wager) =>
      filter !== "simulated" &&
      (filter === "all" ||
        filter === "imported" ||
        (filter === "open" && wager.status === "open") ||
        (filter === "settled" && wager.status !== "open")),
  );
  const balance = (ledgerResult.data ?? []).reduce((sum, row) => sum + Number(row.amount_units), 0);
  const eventIds = records.flatMap((ticket) => ticket.bet_legs.map((leg) => leg.provider_event_id));
  const { data: scoreRows, error: scoreError } = eventIds.length
    ? await supabase
        .from("event_scores")
        .select("provider_event_id,status_text,home_score,away_score,clock_text,period_text")
        .in("provider_event_id", eventIds)
    : { data: [], error: null };
  const scores = new Map((scoreRows as Score[]).map((score) => [score.provider_event_id, score]));

  return (
    <main className="shell">
      <SlipPlacementCleanup slipKeys={slipKeys} />
      <AppNav active="my-bets" userId={authData.user.id} />
      <header className="account-header">
        <div>
          <p className="eyebrow">Canonical wager ledger</p>
          <h1>My Bets</h1>
          <p className="muted">
            Simulated tickets and imported sportsbook records, each with an explicit source.
          </p>
        </div>
        <div className="balance-card">
          <small>Available simulated Vials</small>
          <strong>{ledgerResult.error ? "—" : `${vials(balance)} Vials`}</strong>
        </div>
      </header>
      {query.notice ? (
        <p className="notice" role="status" aria-live="polite">
          {query.notice}
        </p>
      ) : null}
      {ticketResult.error || importedResult.error || ledgerResult.error ? (
        <p className="notice error" role="alert">
          Wager records are temporarily unavailable. Your stored wagers were not changed.
        </p>
      ) : null}
      <div className="view-tabs" aria-label="My Bets filters">
        {filters.map(([value, label]) => (
          <Link
            className={filter === value ? "pill active" : "pill"}
            href={`/my-bets?filter=${value}`}
            key={value}
          >
            {label}
          </Link>
        ))}
      </div>
      {filter === "open" || filter === "all" ? (
        <form action={refreshMyOpenScores} className="score-refresh">
          <SubmitButton className="button secondary" pendingLabel="Refreshing scores…">
            Refresh shared scores
          </SubmitButton>
          <small>
            Refreshes only competitions tied to your open simulated wagers and safely retries
            settlement.
          </small>
        </form>
      ) : null}
      {scoreError ? (
        <p className="notice error" role="alert">
          Score records are temporarily unavailable. Cached ticket details remain available.
        </p>
      ) : null}

      <div className="ticket-list">
        {records.map((ticket) => {
          const firstLeg = ticket.bet_legs[0];
          if (!firstLeg) return null;
          return (
            <article className="card ticket-card" key={ticket.id}>
              <div className="event-heading">
                <div>
                  <div className="ticket-meta">
                    <SourceBadge source="simulated" />
                    <TicketTypeBadge ticketType={ticket.ticket_type} />
                  </div>
                  <h2>
                    {ticket.ticket_type === "parlay" ? (
                      `${ticket.leg_count}-leg simulated parlay`
                    ) : (
                      <span className="team-pair">
                        <TeamMark teamName={firstLeg.away_team} sport={firstLeg.sport_key} />
                        {firstLeg.away_team} at{" "}
                        <TeamMark teamName={firstLeg.home_team} sport={firstLeg.sport_key} />
                        {firstLeg.home_team}
                      </span>
                    )}
                  </h2>
                  <time dateTime={ticket.created_at}>
                    {new Date(ticket.created_at).toLocaleString()}
                  </time>
                </div>
                <StatusBadge status={ticket.status} />
              </div>
              <div className="parlay-ticket-legs">
                {ticket.bet_legs
                  .sort((left, right) => left.leg_number - right.leg_number)
                  .map((leg, index) => {
                    const score = scores.get(leg.provider_event_id);
                    const hasScore = score?.home_score !== null && score?.away_score !== null;
                    return (
                      <section className="parlay-ticket-leg" key={leg.id}>
                        <div className="section-heading">
                          <h3>
                            Leg {index + 1}:{" "}
                            <span className="team-pair">
                              <TeamMark teamName={leg.away_team} sport={leg.sport_key} />
                              {leg.away_team} at{" "}
                              <TeamMark teamName={leg.home_team} sport={leg.sport_key} />
                              {leg.home_team}
                            </span>
                          </h3>
                          <StatusBadge status={leg.result} />
                        </div>
                        <p>
                          {leg.selection_name}
                          {leg.line === null ? "" : ` ${leg.line > 0 ? "+" : ""}${leg.line}`} ·{" "}
                          <MarketBadge market={leg.market_type} /> · {leg.bookmaker_name} ·{" "}
                          {price(leg.american_odds)} ({Number(leg.decimal_odds).toFixed(4)})
                        </p>
                        {score ? (
                          <div className="live-score compact-score">
                            <p>
                              <strong>
                                {score.away_score ?? "–"}–{score.home_score ?? "–"}
                              </strong>{" "}
                              {score.status_text}{" "}
                              {[score.period_text, score.clock_text].filter(Boolean).join(" · ")}
                            </p>
                            {hasScore ? (
                              <p className="live-position">
                                {liveWagerState(
                                  {
                                    sportKey: leg.sport_key,
                                    marketType: leg.market_type,
                                    selection: leg.selection,
                                    line: leg.line,
                                  },
                                  { homeScore: score.home_score!, awayScore: score.away_score! },
                                )}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <small className="muted">No shared score recorded.</small>
                        )}
                      </section>
                    );
                  })}
              </div>
              <dl className="ticket-details compact">
                <div>
                  <dt>Original combined odds</dt>
                  <dd>
                    {price(ticket.american_odds)} (
                    {Number(ticket.decimal_equivalent_odds).toFixed(4)})
                  </dd>
                </div>
                <div>
                  <dt>Stake</dt>
                  <dd>{vials(ticket.stake_units)} Vials</dd>
                </div>
                <div>
                  <dt>Potential profit</dt>
                  <dd>{vials(ticket.potential_profit_units)} Vials</dd>
                </div>
                <div>
                  <dt>Potential return</dt>
                  <dd>{vials(ticket.potential_return_units)} Vials</dd>
                </div>
                <div>
                  <dt>Final profit</dt>
                  <dd>
                    {ticket.settled_profit_units === null
                      ? "—"
                      : `${vials(ticket.settled_profit_units)} Vials`}
                  </dd>
                </div>
                <div>
                  <dt>Final return</dt>
                  <dd>
                    {ticket.settled_return_units === null
                      ? "—"
                      : `${vials(ticket.settled_return_units)} Vials`}
                  </dd>
                </div>
                <div>
                  <dt>Bookmaker</dt>
                  <dd>{firstLeg.bookmaker_name}</dd>
                </div>
              </dl>
            </article>
          );
        })}
        {importedRecords.map((wager) => (
          <article className="card ticket-card" key={wager.id}>
            <div className="event-heading">
              <div>
                <div className="ticket-meta">
                  <SourceBadge source="external" sportsbookName={wager.sportsbook_name} />
                  <TicketTypeBadge ticketType={wager.ticket_type} />
                </div>
                <h2>
                  {wager.ticket_type === "parlay"
                    ? `${wager.leg_count}-leg imported parlay`
                    : wager.event_description}
                </h2>
                <time dateTime={wager.event_date}>
                  {new Date(wager.event_date).toLocaleString()}
                </time>
              </div>
              <StatusBadge status={wager.status} />
            </div>
            <p>
              {wager.selection}
              {wager.line === null ? "" : ` ${wager.line > 0 ? "+" : ""}${wager.line}`} ·{" "}
              <MarketBadge market={wager.market_type} /> · {price(wager.american_odds)} (
              {Number(wager.decimal_odds).toFixed(4)})
            </p>
            {wager.ticket_type === "parlay" ? (
              <div className="parlay-ticket-legs">
                {wager.external_wager_legs
                  .sort((left, right) => left.leg_number - right.leg_number)
                  .map((leg) => (
                    <p className="parlay-ticket-leg" key={leg.id}>
                      Leg {leg.leg_number}: {leg.event_description} · {leg.selection} · {leg.result}
                    </p>
                  ))}
              </div>
            ) : null}
            <dl className="ticket-details compact">
              <div>
                <dt>Stake</dt>
                <dd>
                  {vials(wager.stake_units)} Vials
                  {wager.raw_stake_dollars === null
                    ? ""
                    : ` · $${vials(wager.raw_stake_dollars)} source`}
                </dd>
              </div>
              <div>
                <dt>Return / payout</dt>
                <dd>
                  {wager.raw_return_dollars === null
                    ? "—"
                    : `$${vials(wager.raw_return_dollars)} source`}
                </dd>
              </div>
              <div>
                <dt>Vial profit / loss</dt>
                <dd>{vials(wager.profit_loss_units)} Vials</dd>
              </div>
              <div>
                <dt>Event matching</dt>
                <dd>{wager.match_state.replace("_", " ")}</dd>
              </div>
              <div>
                <dt>Settlement</dt>
                <dd>
                  {wager.settlement_method}
                  {wager.match_reason ? ` · ${wager.match_reason}` : ""}
                </dd>
              </div>
            </dl>
          </article>
        ))}
        {!records.length && !importedRecords.length ? (
          <p className="empty-state">
            <strong>No wagers match this filter yet</strong>Build a simulated ticket from Browse
            Odds or import a betslip after review.
          </p>
        ) : null}
      </div>
    </main>
  );
}
