import Link from "next/link";
import { redirect } from "next/navigation";

import { sportsProviderConfiguration } from "@/config/sports";
import { summarizeExternalWagers } from "@/lib/external-wagers/calculations";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";
import { ExternalParlayForm } from "@/components/external-parlay-form";
import { ExternalParlayResultForm } from "@/components/external-parlay-result-form";
import { ImportBetslipForm } from "@/components/import-betslip-form";
import { LocalDateTime } from "@/components/local-date-time";
import { MarketBadge, SourceBadge, StatusBadge, TicketTypeBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";

import { setExternalWagerResult } from "./actions";

type Props = { searchParams: Promise<{ view?: string; notice?: string }> };
type Group = { id: string; name: string };
type CanonicalEvent = {
  providerEventId: string;
  sportKey: string;
  competitionKey: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string;
};
type ExternalWager = {
  id: string;
  source: "external";
  ticket_type: "straight" | "parlay";
  leg_count: number;
  sportsbook_name: string;
  competition_name: string;
  event_description: string;
  event_date: string;
  selection: string;
  market_type: "moneyline" | "spread" | "total";
  line: number | null;
  american_odds: number;
  decimal_odds: number;
  stake_units: number;
  status: "open" | "won" | "lost" | "push" | "void";
  profit_loss_units: number;
  wager_date: string;
  screenshot_path: string | null;
  verification_status: "unverified" | "user_attested";
  user_notes: string | null;
  effective_settlement_decimal_odds: number | null;
  effective_settlement_american_odds: number | null;
  settled_return_units: number | null;
  raw_stake_dollars: number | null;
  raw_return_dollars: number | null;
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

const price = (value: number) => (value > 0 ? `+${value}` : String(value));
const units = (value: number | string) => Number(value).toFixed(2);

function canonicalEventsFromCache(rows: { normalized_payload: unknown }[]) {
  const events = new Map<string, CanonicalEvent>();
  for (const row of rows) {
    const payload = row.normalized_payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      !Array.isArray((payload as { events?: unknown }).events)
    ) {
      continue;
    }
    for (const candidate of (payload as { events: unknown[] }).events) {
      if (!candidate || typeof candidate !== "object") continue;
      const event = candidate as Record<string, unknown>;
      const values = [
        event.providerEventId,
        event.sport,
        event.competitionId,
        event.competitionName,
        event.homeTeam,
        event.awayTeam,
        event.scheduledStart,
      ];
      if (values.some((value) => typeof value !== "string" || !value.trim())) continue;
      const canonical: CanonicalEvent = {
        providerEventId: event.providerEventId as string,
        sportKey: event.sport as string,
        competitionKey: event.competitionId as string,
        competitionName: event.competitionName as string,
        homeTeam: event.homeTeam as string,
        awayTeam: event.awayTeam as string,
        scheduledStart: event.scheduledStart as string,
      };
      events.set(canonical.providerEventId, canonical);
    }
  }
  return [...events.values()].sort(
    (left, right) =>
      new Date(left.scheduledStart).getTime() - new Date(right.scheduledStart).getTime(),
  );
}

export default async function TrackBetPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const view = query.view === "history" ? "history" : "open";
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const coreCompetitions = sportsProviderConfiguration.competitions.filter(
    (competition) => competition.enabled,
  );

  let wagerQuery = supabase
    .from("external_wagers")
    .select(
      "id,source,ticket_type,leg_count,sportsbook_name,competition_name,event_description,event_date,selection,market_type,line,american_odds,decimal_odds,stake_units,status,profit_loss_units,wager_date,screenshot_path,verification_status,user_notes,effective_settlement_decimal_odds,effective_settlement_american_odds,settled_return_units,raw_stake_dollars,raw_return_dollars,match_state,match_reason,settlement_method,auto_settlement_ready,external_wager_legs(*)",
    )
    .eq("user_id", authData.user.id)
    .order("wager_date", { ascending: false });
  wagerQuery = view === "open" ? wagerQuery.eq("status", "open") : wagerQuery.neq("status", "open");

  const [
    { data: wagers, error: wagerError },
    { data: groups, error: groupError },
    { data: cacheRows, error: cacheError },
    summaryResult,
  ] = await Promise.all([
    wagerQuery,
    supabase.from("groups").select("id,name").order("name"),
    supabase
      .from("odds_cache")
      .select("normalized_payload")
      .in(
        "competition",
        coreCompetitions.map((competition) => competition.id),
      )
      .order("fetched_at", { ascending: false })
      .limit(32),
    supabase
      .from("external_wagers")
      .select("status,stake_units,profit_loss_units")
      .eq("user_id", authData.user.id),
  ]);
  const records = (wagers ?? []) as ExternalWager[];
  const summary = summarizeExternalWagers(
    (summaryResult.data ?? []).map((record) => ({
      status: record.status,
      stakeUnits: record.stake_units,
      profitLossUnits: record.profit_loss_units,
    })),
  );
  const nowLocal = new Date().toISOString().slice(0, 16);
  const canonicalEvents = canonicalEventsFromCache(
    (cacheRows ?? []) as { normalized_payload: unknown }[],
  );

  return (
    <main className="shell">
      <AppNav active="import-betslip" userId={authData.user.id} />
      <header className="page-header">
        <p className="eyebrow">Imported wagers — statistics only</p>
        <h1>Import Betslip</h1>
        <p className="muted">
          Bring in a wager you placed elsewhere for analysis. Review every draft before saving; no
          imported wager affects your simulated Vial balance.
        </p>
      </header>
      {query.notice ? (
        <p className="notice" role="status" aria-live="polite">
          {query.notice}
        </p>
      ) : null}
      {wagerError || groupError || cacheError || summaryResult.error ? (
        <p className="notice error" role="alert">
          Some imported-wager data is temporarily unavailable. Your imported records were not
          changed.
        </p>
      ) : null}

      <section className="stats-grid irl-stats" aria-label="Imported performance summary">
        <div className="card">
          <small>Settled imported wagers</small>
          <strong>{summary.totalSettled}</strong>
        </div>
        <div className="card">
          <small>Record</small>
          <strong>
            {summary.wins}-{summary.losses}-{summary.pushes}
          </strong>
        </div>
        <div className="card">
          <small>Vials wagered</small>
          <strong>{summary.unitsWagered}</strong>
        </div>
        <div className="card">
          <small>Net Vials</small>
          <strong>{summary.netUnits}</strong>
        </div>
        <div className="card">
          <small>ROI</small>
          <strong>{summary.roiPercent}%</strong>
        </div>
      </section>

      <section className="card track-form-card">
        <h2>Import a straight betslip</h2>
        <ImportBetslipForm
          groups={(groups ?? []) as Group[]}
          competitions={coreCompetitions.map((competition) => ({
            id: competition.id,
            name: competition.name,
            sport: competition.sport,
          }))}
          canonicalEvents={canonicalEvents}
          nowLocal={nowLocal}
        />
      </section>

      <section className="card track-form-card">
        <h2>Import a parlay betslip</h2>
        <p className="muted">
          Capture the accepted combined price and each normalized leg. Imported parlays remain
          separate from the simulated Vial balance.
        </p>
        <ExternalParlayForm
          groups={(groups ?? []) as Group[]}
          competitions={coreCompetitions.map((competition) => ({
            id: competition.id,
            name: competition.name,
            sport: competition.sport,
          }))}
          nowLocal={nowLocal}
        />
      </section>

      <section className="section-break">
        <div className="view-tabs">
          <Link className={view === "open" ? "pill active" : "pill"} href="/track-bet">
            Open imported wagers
          </Link>
          <Link
            className={view === "history" ? "pill active" : "pill"}
            href="/track-bet?view=history"
          >
            Settled imported history
          </Link>
        </div>
        <div className="ticket-list">
          {records.map((wager) => (
            <article className="card ticket-card" key={wager.id}>
              <div className="event-heading">
                <div>
                  <div className="ticket-meta">
                    <SourceBadge source="external" sportsbookName={wager.sportsbook_name} />
                    <TicketTypeBadge ticketType={wager.ticket_type} />
                  </div>
                  <h2>
                    {wager.ticket_type === "parlay"
                      ? `${wager.leg_count}-leg parlay`
                      : wager.event_description}
                  </h2>
                  <LocalDateTime value={wager.event_date} />
                </div>
                <StatusBadge status={wager.status} />
              </div>
              {wager.ticket_type === "parlay" ? (
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
                        <LocalDateTime value={leg.event_date} />
                      </section>
                    ))}
                </div>
              ) : null}
              <dl className="ticket-details compact">
                <div>
                  <dt>Selection</dt>
                  <dd>
                    {wager.selection}
                    {wager.line === null ? "" : ` ${wager.line > 0 ? "+" : ""}${wager.line}`}
                  </dd>
                </div>
                <div>
                  <dt>Market</dt>
                  <dd>
                    <MarketBadge market={wager.market_type} />
                  </dd>
                </div>
                <div>
                  <dt>Sportsbook</dt>
                  <dd>{wager.sportsbook_name}</dd>
                </div>
                <div>
                  <dt>{wager.ticket_type === "parlay" ? "Original combined odds" : "Odds"}</dt>
                  <dd>
                    {price(wager.american_odds)} ({Number(wager.decimal_odds).toFixed(4)})
                  </dd>
                </div>
                <div>
                  <dt>Stake</dt>
                  <dd>
                    {units(wager.stake_units)} Vials
                    {wager.raw_stake_dollars === null
                      ? ""
                      : ` · $${units(wager.raw_stake_dollars)} source`}
                  </dd>
                </div>
                <div>
                  <dt>Profit / loss</dt>
                  <dd>{units(wager.profit_loss_units)} Vials</dd>
                </div>
                <div>
                  <dt>Effective settlement odds</dt>
                  <dd>
                    {wager.effective_settlement_decimal_odds === null
                      ? "—"
                      : wager.effective_settlement_american_odds === null
                        ? Number(wager.effective_settlement_decimal_odds).toFixed(4)
                        : `${price(wager.effective_settlement_american_odds)} (${Number(wager.effective_settlement_decimal_odds).toFixed(4)})`}
                  </dd>
                </div>
                <div>
                  <dt>Final return</dt>
                  <dd>
                    {wager.settled_return_units === null
                      ? "—"
                      : `${units(wager.settled_return_units)} Vials`}
                  </dd>
                </div>
                <div>
                  <dt>Verification</dt>
                  <dd>{wager.verification_status.replace("_", " ")}</dd>
                </div>
                <div>
                  <dt>Wager date</dt>
                  <dd>
                    <LocalDateTime value={wager.wager_date} />
                  </dd>
                </div>
              </dl>
              {wager.user_notes ? <p>{wager.user_notes}</p> : null}
              <p className="muted">
                Event matching: {wager.match_state.replace("_", " ")} · Settlement:{" "}
                {wager.settlement_method}
                {wager.match_reason ? ` · ${wager.match_reason}` : ""}
              </p>
              {wager.auto_settlement_ready && wager.status === "open" ? (
                <p className="notice compact-notice" role="status">
                  Auto settlement ready — this matched wager will settle when a canonical final
                  score is available.
                </p>
              ) : wager.status === "open" ? (
                <p className="muted">
                  Manual settlement required until the reason above is resolved.
                </p>
              ) : null}
              {wager.screenshot_path ? (
                <p>
                  <Link href={`/track-bet/screenshot/${wager.id}`} target="_blank">
                    View private screenshot
                  </Link>
                </p>
              ) : null}
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
                <form action={setExternalWagerResult} className="result-form">
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
                    Manual settlement reason (if needed)
                    <input
                      name="manualReason"
                      placeholder="Event not confidently matched, unsupported prop, etc."
                    />
                  </label>
                  <SubmitButton className="button secondary" pendingLabel="Updating result…">
                    Update result
                  </SubmitButton>
                </form>
              )}
            </article>
          ))}
          {!records.length ? (
            <p className="empty-state">
              No {view === "open" ? "open" : "settled"} imported wagers yet.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
