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

type Props = { searchParams: Promise<{ view?: string; notice?: string; slip?: string }> };
type Leg = {
  id: string;
  leg_number: number;
  provider_event_id: string;
  sport_key: string;
  competition_key: string;
  competition_name: string;
  bookmaker_name: string;
  home_team: string;
  away_team: string;
  scheduled_start: string;
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
  group_id: string | null;
  ticket_type: "straight" | "parlay";
  leg_count: number;
  stake_units: number;
  decimal_equivalent_odds: number;
  potential_profit_units: number;
  potential_return_units: number;
  american_odds: number;
  status: "open" | "won" | "lost" | "push" | "void";
  effective_settlement_decimal_odds: number | null;
  effective_settlement_american_odds: number | null;
  settled_profit_units: number | null;
  settled_return_units: number | null;
  created_at: string;
  bet_legs: Leg[];
};
type Score = {
  provider_event_id: string;
  status_text: string;
  home_score: number | null;
  away_score: number | null;
  clock_text: string | null;
  period_text: string | null;
  refreshed_at: string;
};

const price = (value: number) => (value > 0 ? `+${value}` : String(value));
const units = (value: number) => Number(value).toFixed(2);

export default async function MyBetsPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const view = query.view === "history" ? "history" : "open";
  const slipKeys = query.slip?.split(",").filter(Boolean).slice(0, 12) ?? [];
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  let ticketQuery = supabase
    .from("bets")
    .select(
      "id,group_id,ticket_type,leg_count,stake_units,decimal_equivalent_odds,potential_profit_units,potential_return_units,american_odds,status,effective_settlement_decimal_odds,effective_settlement_american_odds,settled_profit_units,settled_return_units,created_at,bet_legs(*)",
    )
    .order("created_at", { ascending: false });
  if (view === "open") ticketQuery = ticketQuery.eq("status", "open");
  ticketQuery = ticketQuery.eq("is_synthetic", false);
  const [{ data: tickets, error: ticketError }, { data: ledger, error: ledgerError }] =
    await Promise.all([ticketQuery, supabase.from("bankroll_ledger").select("amount_units")]);
  const balance = (ledger ?? []).reduce((sum, row) => sum + Number(row.amount_units), 0);
  const records = (tickets ?? []) as Ticket[];
  const eventIds = records.flatMap((ticket) => ticket.bet_legs.map((leg) => leg.provider_event_id));
  const { data: scoreRows, error: scoreError } = eventIds.length
    ? await supabase
        .from("event_scores")
        .select(
          "provider_event_id,status_text,home_score,away_score,clock_text,period_text,refreshed_at",
        )
        .in("provider_event_id", eventIds)
    : { data: [], error: null };
  const scores = new Map((scoreRows as Score[]).map((score) => [score.provider_event_id, score]));

  return (
    <main className="shell">
      <SlipPlacementCleanup slipKeys={slipKeys} />
      <AppNav active="my-bets" userId={authData.user.id} />
      <header className="account-header">
        <div>
          <p className="eyebrow">Virtual units only</p>
          <h1>My bets</h1>
          <p className="muted">Tickets are reconstructed from immutable accepted snapshots.</p>
        </div>
        <div className="balance-card">
          <small>Available virtual bankroll</small>
          <strong>{units(balance)} units</strong>
        </div>
      </header>
      {query.notice ? (
        <p className="notice" role="status" aria-live="polite">
          {query.notice}
        </p>
      ) : null}
      {ticketError || ledgerError ? (
        <p className="notice error" role="alert">
          Wager records are temporarily unavailable. Your stored tickets were not changed.
        </p>
      ) : null}
      <div className="view-tabs">
        <Link className={view === "open" ? "pill active" : "pill"} href="/my-bets">
          Open bets
        </Link>
        <Link className={view === "history" ? "pill active" : "pill"} href="/my-bets?view=history">
          History
        </Link>
      </div>
      {view === "open" ? (
        <form action={refreshMyOpenScores} className="score-refresh">
          <SubmitButton className="button secondary" pendingLabel="Refreshing scores…">
            Refresh shared scores
          </SubmitButton>
          <small>
            Refreshes only competitions tied to your open wagers and safely retries settlement.
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
                      `${ticket.leg_count}-leg parlay`
                    ) : (
                      <span className="team-pair">
                        <TeamMark teamName={firstLeg.away_team} sport={firstLeg.sport_key} />
                        {firstLeg.away_team} at
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
                            <span className="team-pair">
                              Leg {index + 1}:{" "}
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
                                    line: leg.line === null ? null : Number(leg.line),
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
                  <dd>{units(ticket.stake_units)} units</dd>
                </div>
                <div>
                  <dt>Potential profit</dt>
                  <dd>{units(ticket.potential_profit_units)} units</dd>
                </div>
                <div>
                  <dt>Potential return</dt>
                  <dd>{units(ticket.potential_return_units)} units</dd>
                </div>
                <div>
                  <dt>Effective settlement odds</dt>
                  <dd>
                    {ticket.effective_settlement_decimal_odds === null
                      ? "—"
                      : ticket.effective_settlement_american_odds === null
                        ? Number(ticket.effective_settlement_decimal_odds).toFixed(4)
                        : `${price(ticket.effective_settlement_american_odds)} (${Number(ticket.effective_settlement_decimal_odds).toFixed(4)})`}
                  </dd>
                </div>
                <div>
                  <dt>Final profit</dt>
                  <dd>
                    {ticket.settled_profit_units === null
                      ? "—"
                      : `${units(ticket.settled_profit_units)} units`}
                  </dd>
                </div>
                <div>
                  <dt>Final return</dt>
                  <dd>
                    {ticket.settled_return_units === null
                      ? "—"
                      : `${units(ticket.settled_return_units)} units`}
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
        {!records.length ? (
          <p className="empty-state">
            <strong>
              No {view === "open" ? "open simulated wagers" : "simulated wager history"} yet
            </strong>
            {view === "open"
              ? "Build a ticket from Browse odds and it will appear here while it is open."
              : "Settled tickets will stay here with their accepted terms and result evidence."}
          </p>
        ) : null}
      </div>
    </main>
  );
}
