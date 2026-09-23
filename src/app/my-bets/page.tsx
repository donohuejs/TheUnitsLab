import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { ExternalParlayResultForm } from "@/components/external-parlay-result-form";
import { KickoffTime } from "@/components/kickoff-time";
import { LocalDateTime } from "@/components/local-date-time";
import { MarketBadge, SourceBadge, StatusBadge, TicketTypeBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { SlipPlacementCleanup } from "@/components/slip-placement-cleanup";
import { TeamMark } from "@/components/team-mark";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { liveWagerState } from "@/lib/settlement/grading";
import { slipSelectionKey } from "@/lib/wagers/slip";

import {
  assignWagerStudy,
  cancelSimulatedBet,
  refreshMyOpenScores,
  setImportedStraightResult,
} from "./actions";

type Filter = "all" | "open" | "settled" | "simulated" | "imported" | "cancelled";
type Props = {
  searchParams: Promise<{
    filter?: string;
    view?: string;
    notice?: string;
    slip?: string;
    straight?: string;
    pending?: string;
  }>;
};
type Leg = {
  id: string;
  leg_number: number;
  provider_event_id: string;
  sport_key: string;
  competition_key: string;
  competition_name: string;
  bookmaker_name: string;
  bookmaker_id: string;
  home_team: string;
  away_team: string;
  scheduled_start: string;
  market_type: "moneyline" | "spread" | "total";
  selection: "home" | "away" | "draw" | "over" | "under";
  selection_name: string;
  line: number | null;
  american_odds: number;
  decimal_odds: number;
  pricing_source: "provider" | "simulated_alternate";
  anchor_provider_line: number | null;
  anchor_provider_american_odds: number | null;
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
  settled_profit_units: number | null;
  settled_return_units: number | null;
  created_at: string;
  bet_legs: Leg[];
};
type ImportedWager = {
  id: string;
  group_id: string | null;
  sportsbook_name: string;
  sport_key: string;
  competition_name: string;
  ticket_type: "straight" | "parlay";
  leg_count: number;
  event_description: string;
  event_date: string;
  wager_date: string | null;
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
  screenshot_path: string | null;
  user_notes: string | null;
  effective_settlement_decimal_odds: number | null;
  effective_settlement_american_odds: number | null;
  settled_return_units: number | null;
  match_state: "matched" | "partially_matched" | "unmatched" | "needs_review";
  match_reason: string | null;
  settlement_method: "automatic" | "manual";
  auto_settlement_ready: boolean;
  external_wager_legs: {
    id: string;
    leg_number: number;
    competition_name: string;
    event_description: string;
    event_date: string;
    selection: string;
    market_type: "moneyline" | "spread" | "total";
    line: number | null;
    american_odds: number;
    decimal_odds: number;
    result: "open" | "won" | "lost" | "push" | "void";
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
  ["open", "Open"],
  ["all", "All"],
  ["settled", "Settled"],
  ["simulated", "Simulated"],
  ["imported", "Imported"],
  ["cancelled", "Cancelled / Void"],
];

function selectedFilter(query: { filter?: string; view?: string }): Filter {
  if (filters.some(([value]) => value === query.filter)) return query.filter as Filter;
  if (query.view === "history") return "settled";
  if (query.view === "open") return "open";
  return "open";
}

export default async function MyBetsPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const filter = selectedFilter(query);
  const slipKeys = query.slip?.split(",").filter(Boolean).slice(0, 12) ?? [];
  const straightSlipKeys = query.straight?.split(",").filter(Boolean).slice(0, 12) ?? [];
  const pendingSlipKeys = query.pending?.split(",").filter(Boolean).slice(0, 12) ?? [];
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const reconciliationResult = await supabase.rpc("reconcile_imported_wagers");

  const [ticketResult, importedResult, ledgerResult, groupsResult] = await Promise.all([
    supabase
      .from("bets")
      .select(
        "id,group_id,ticket_type,leg_count,stake_units,decimal_equivalent_odds,potential_profit_units,potential_return_units,american_odds,status,settled_profit_units,settled_return_units,created_at,bet_legs(*)",
      )
      .eq("user_id", authData.user.id)
      .eq("is_synthetic", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("external_wagers")
      .select(
        "id,group_id,sportsbook_name,sport_key,competition_name,ticket_type,leg_count,event_description,event_date,wager_date,selection,market_type,line,american_odds,decimal_odds,stake_units,raw_stake_dollars,raw_return_dollars,status,profit_loss_units,screenshot_path,user_notes,effective_settlement_decimal_odds,effective_settlement_american_odds,settled_return_units,match_state,match_reason,settlement_method,auto_settlement_ready,external_wager_legs(*)",
      )
      .eq("user_id", authData.user.id)
      .order("wager_date", { ascending: false }),
    supabase.from("bankroll_ledger").select("amount_units").eq("user_id", authData.user.id),
    supabase.from("groups").select("id,name").order("name"),
  ]);
  const failedReads = [
    ["simulated wagers", ticketResult.error],
    ["imported wagers", importedResult.error],
    ["bankroll ledger", ledgerResult.error],
    ["Study selector", groupsResult.error],
    ["imported reconciliation", reconciliationResult.error],
  ].filter(([, error]) => error);
  if (failedReads.length > 0) {
    console.error("My Bets read failed", {
      failures: failedReads.map(([operation, error]) => ({
        operation,
        code: typeof error === "string" ? null : (error?.code ?? null),
        message:
          typeof error === "string" ? error : (error?.message ?? "Unknown database read error"),
      })),
    });
  }
  const allTickets = (ticketResult.data ?? []) as Ticket[];
  const allImported = (importedResult.data ?? []) as ImportedWager[];
  const voidedSlipKeys = allTickets
    .filter((ticket) => ticket.status === "void")
    .flatMap((ticket) =>
      ticket.bet_legs.map((leg) =>
        slipSelectionKey({
          eventId: `${leg.competition_key}:${leg.provider_event_id}`,
          bookmakerId: leg.bookmaker_id,
          marketType: leg.market_type,
          selection: leg.selection,
          line: leg.line,
        }),
      ),
    );
  const records = allTickets.filter(
    (ticket) =>
      filter !== "imported" &&
      (filter === "all" ||
        filter === "simulated" ||
        (filter === "open" && ticket.status === "open") ||
        (filter === "settled" && ticket.status !== "open" && ticket.status !== "void") ||
        (filter === "cancelled" && ticket.status === "void")),
  );
  const importedRecords = allImported.filter(
    (wager) =>
      filter !== "simulated" &&
      (filter === "all" ||
        filter === "imported" ||
        (filter === "open" && wager.status === "open") ||
        (filter === "settled" && wager.status !== "open" && wager.status !== "void") ||
        (filter === "cancelled" && wager.status === "void")),
  );
  const groups = (groupsResult.data ?? []) as { id: string; name: string }[];
  const nowMs = new Date().getTime();
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
      <SlipPlacementCleanup
        slipKeys={slipKeys}
        straightSlipKeys={straightSlipKeys}
        pendingSlipKeys={pendingSlipKeys}
        voidedSlipKeys={voidedSlipKeys}
      />
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
      {ticketResult.error ||
      importedResult.error ||
      ledgerResult.error ||
      reconciliationResult.error ? (
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
          const canCancel =
            ticket.status === "open" &&
            ticket.bet_legs.every((leg) => new Date(leg.scheduled_start).getTime() > nowMs);
          return (
            <article
              className={`card ticket-card${ticket.status === "void" ? " ticket-cancelled" : ""}`}
              key={ticket.id}
            >
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
                  <p className="ticket-time-meta">
                    Placed <LocalDateTime value={ticket.created_at} />
                  </p>
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
                        {leg.pricing_source === "simulated_alternate" ? (
                          <small className="simulated-label">Simulated alternate line</small>
                        ) : null}
                        <p className="ticket-time-meta">
                          Kickoff <KickoffTime value={leg.scheduled_start} />
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
              {canCancel ? (
                <form action={cancelSimulatedBet} className="cancel-form">
                  <input type="hidden" name="betId" value={ticket.id} />
                  <SubmitButton className="button secondary" pendingLabel="Cancelling…">
                    Cancel Bet
                  </SubmitButton>
                  <small className="muted">Available until the event kickoff.</small>
                </form>
              ) : null}
              {ticket.status === "open" &&
              groups.length &&
              ticket.bet_legs.every(
                (leg) => new Date(leg.scheduled_start).getTime() > Date.now(),
              ) ? (
                <StudyAssignmentForm
                  wagerId={ticket.id}
                  source="simulated"
                  groupId={ticket.group_id}
                  groups={groups}
                />
              ) : null}
            </article>
          );
        })}
        {importedRecords.map((wager) => (
          <article
            className={`card ticket-card${wager.status === "void" ? " ticket-cancelled" : ""}`}
            key={wager.id}
          >
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
                <p className="ticket-time-meta">
                  Kickoff <LocalDateTime value={wager.event_date} /> · Placed{" "}
                  {wager.wager_date ? <LocalDateTime value={wager.wager_date} /> : "Unknown"}
                </p>
                <p className="ticket-time-meta">
                  {wager.sport_key} · {wager.competition_name} · {wager.sportsbook_name}
                </p>
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
              <details className="imported-ticket-more">
                <summary>View {wager.leg_count} legs</summary>
                <div className="parlay-ticket-legs">
                  {wager.external_wager_legs
                    .sort((left, right) => left.leg_number - right.leg_number)
                    .map((leg) => (
                      <section className="parlay-ticket-leg" key={leg.id}>
                        <div className="section-heading">
                          <h3>
                            Leg {leg.leg_number}: {leg.event_description}
                          </h3>
                          <StatusBadge status={leg.result} />
                        </div>
                        <p>
                          {leg.competition_name} · {leg.selection}
                          {leg.line === null ? "" : ` ${leg.line > 0 ? "+" : ""}${leg.line}`} ·{" "}
                          <MarketBadge market={leg.market_type} /> · {price(leg.american_odds)} (
                          {Number(leg.decimal_odds).toFixed(4)})
                        </p>
                        <p className="ticket-time-meta">
                          Kickoff <LocalDateTime value={leg.event_date} />
                        </p>
                      </section>
                    ))}
                </div>
              </details>
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
                <dt>{wager.status === "open" ? "Current profit / loss" : "Final profit / loss"}</dt>
                <dd>{wager.status === "open" ? "—" : `${vials(wager.profit_loss_units)} Vials`}</dd>
              </div>
              <div>
                <dt>Final return</dt>
                <dd>
                  {wager.settled_return_units === null
                    ? "—"
                    : `${vials(wager.settled_return_units)} Vials`}
                </dd>
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
            {wager.screenshot_path ? (
              <p className="ticket-time-meta">
                <Link
                  href={`/track-bet/screenshot/${wager.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View private screenshot
                </Link>
              </p>
            ) : null}
            {wager.user_notes ? <p className="muted">Note: {wager.user_notes}</p> : null}
            {wager.effective_settlement_decimal_odds !== null ? (
              <p className="ticket-time-meta">
                Effective settlement odds:{" "}
                {wager.effective_settlement_american_odds === null
                  ? Number(wager.effective_settlement_decimal_odds).toFixed(4)
                  : `${price(wager.effective_settlement_american_odds)} (${Number(wager.effective_settlement_decimal_odds).toFixed(4)})`}
              </p>
            ) : null}
            {wager.auto_settlement_ready && wager.status === "open" ? (
              <p className="notice compact-notice" role="status">
                Auto settlement ready — the canonical final score will settle this imported record
                automatically.
              </p>
            ) : wager.status === "open" ? (
              <p className="muted">
                Manual settlement required{wager.match_reason ? `: ${wager.match_reason}` : "."}
              </p>
            ) : null}
            <details className="imported-result-management">
              <summary>
                {wager.status === "open" ? "Settle imported wager" : "Correct imported result"}
              </summary>
              {wager.ticket_type === "parlay" ? (
                <ExternalParlayResultForm
                  wagerId={wager.id}
                  status={wager.status}
                  legs={wager.external_wager_legs.map((leg) => ({
                    legNumber: leg.leg_number,
                    result: leg.result,
                  }))}
                />
              ) : (
                <form action={setImportedStraightResult} className="result-form">
                  <input type="hidden" name="wagerId" value={wager.id} />
                  <label>
                    Result
                    <select name="status" defaultValue={wager.status}>
                      <option value="open">Open</option>
                      <option value="won">Won</option>
                      <option value="lost">Lost</option>
                      <option value="push">Push</option>
                      <option value="void">Void</option>
                    </select>
                  </label>
                  <label>
                    Manual settlement reason
                    <input
                      name="manualReason"
                      minLength={3}
                      maxLength={500}
                      required
                      placeholder="Why this result needs manual entry"
                    />
                  </label>
                  <SubmitButton className="button secondary" pendingLabel="Saving result…">
                    Save imported result
                  </SubmitButton>
                </form>
              )}
            </details>
            {wager.status === "open" &&
            groups.length &&
            new Date(wager.event_date).getTime() > nowMs ? (
              <StudyAssignmentForm
                wagerId={wager.id}
                source="imported"
                groupId={wager.group_id}
                groups={groups}
              />
            ) : null}
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

function StudyAssignmentForm({
  wagerId,
  source,
  groupId,
  groups,
}: {
  wagerId: string;
  source: "simulated" | "imported";
  groupId: string | null;
  groups: { id: string; name: string }[];
}) {
  return (
    <form action={assignWagerStudy} className="study-assignment-form">
      <input type="hidden" name="wagerId" value={wagerId} />
      <input type="hidden" name="source" value={source} />
      <label>
        {groupId ? "Change Study" : "Assign to Study"}
        <select name="groupId" defaultValue={groupId ?? ""}>
          <option value="">Private — no Study</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <SubmitButton className="button secondary" pendingLabel="Saving Study…">
        Save Study
      </SubmitButton>
    </form>
  );
}
