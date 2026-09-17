import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { hasPublicEnvironment } from "@/config/env.public";
import {
  buildBreakdown,
  filterAnalyticsWagers,
  normalizeAnalyticsTimeZone,
  summarizeAnalytics,
  type AnalyticsBreakdown,
  type AnalyticsPeriod,
  type AnalyticsWager,
  type SourceFilter,
} from "@/lib/analytics/calculations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = {
  searchParams: Promise<{ source?: string; period?: string }>;
};

type RpcWager = {
  wager_id: string;
  user_id: string;
  source: "simulated" | "external";
  ticket_type: "straight" | "parlay";
  status: "open" | "won" | "lost" | "push" | "void";
  stake_units: string | number;
  profit_loss_units: string | number;
  decimal_odds: string | number;
  wagered_at: string;
  sport_key: string;
  competition_key: string;
  competition_name: string;
  market_type: string;
  sportsbook_id: string;
  sportsbook_name: string;
};

const sourceOptions: { value: SourceFilter; label: string }[] = [
  { value: "combined", label: "All" },
  { value: "simulated", label: "Simulated" },
  { value: "irl", label: "Imported" },
];
const periodOptions: { value: AnalyticsPeriod; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All-time" },
];

function asSource(value: string | undefined): SourceFilter {
  return value === "simulated" || value === "irl" ? value : "combined";
}

function asPeriod(value: string | undefined): AnalyticsPeriod {
  return value === "week" || value === "month" ? value : "all";
}

function mapWager(row: RpcWager): AnalyticsWager {
  return {
    wagerId: row.wager_id,
    userId: row.user_id,
    source: row.source,
    ticketType: row.ticket_type,
    status: row.status,
    stakeUnits: row.stake_units,
    profitLossUnits: row.profit_loss_units,
    decimalOdds: row.decimal_odds,
    wageredAt: row.wagered_at,
    sportKey: row.sport_key,
    competitionKey: row.competition_key,
    competitionName: row.competition_name,
    marketType: row.market_type,
    sportsbookId: row.sportsbook_id,
    sportsbookName: row.sportsbook_name,
  };
}

function BreakdownTable({ title, rows }: { title: string; rows: AnalyticsBreakdown[] }) {
  return (
    <section className="card analytics-breakdown">
      <h2>{title}</h2>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">{title} analytics</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Bets</th>
                <th scope="col">Record</th>
                <th scope="col">Vials</th>
                <th scope="col">ROI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.summary.totalBets}</td>
                  <td>
                    {row.summary.wins}-{row.summary.losses}-{row.summary.pushes}
                  </td>
                  <td>{row.summary.unitsWonLost}</td>
                  <td>{row.summary.roiPercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">No wagers match these filters.</p>
      )}
    </section>
  );
}

export default async function PerformancePage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const source = asSource(query.source);
  const period = asPeriod(query.period);
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  const [{ data: profile }, wagerResult] = await Promise.all([
    supabase.from("profiles").select("time_zone").eq("user_id", authData.user.id).single(),
    supabase.rpc("get_personal_analytics_wagers"),
  ]);
  const timeZone = normalizeAnalyticsTimeZone(profile?.time_zone ?? "UTC");
  const records = filterAnalyticsWagers(((wagerResult.data ?? []) as RpcWager[]).map(mapWager), {
    source,
    period,
    timeZone,
  });
  const summary = summarizeAnalytics(records);

  return (
    <main className="shell">
      <AppNav active="performance" userId={authData.user.id} />
      <header className="page-header">
        <p className="eyebrow">Authoritative wager history</p>
        <h1>Analysis</h1>
        <p className="muted">Analyze your results and improve your process.</p>
      </header>

      <form className="card filter-bar" method="get">
        <label>
          Source
          <select name="source" defaultValue={source}>
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select name="period" defaultValue={period}>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" type="submit">
          Apply filters
        </button>
        <small>Period boundaries use {timeZone}.</small>
      </form>

      {wagerResult.error ? (
        <>
          <p className="notice error" role="alert">
            Analysis data is temporarily unavailable. Your stored wagers were not changed.
          </p>
          <p className="empty-state">
            <strong>Metrics are unavailable right now</strong>
            Refresh the page later to view the canonical analytics projection.
          </p>
        </>
      ) : null}

      {!wagerResult.error ? (
        <section className="profit-grid" aria-label="Primary profitability summary">
          <div className="card primary-metric">
            <small>Vials won / lost</small>
            <strong>{summary.unitsWonLost}</strong>
            <span>Vials</span>
          </div>
          <div className="card primary-metric">
            <small>Return on investment</small>
            <strong>{summary.roiPercent}%</strong>
            <span>on {summary.unitsWagered} settled Vials</span>
          </div>
        </section>
      ) : null}

      {!wagerResult.error ? (
        <section className="stats-grid analytics-stats" aria-label="Analysis metrics">
          <div className="card">
            <small>Total bets</small>
            <strong>{summary.totalBets}</strong>
          </div>
          <div className="card">
            <small>Win-loss-push</small>
            <strong>
              {summary.wins}-{summary.losses}-{summary.pushes}
            </strong>
          </div>
          <div className="card">
            <small>Win percentage</small>
            <strong>{summary.winPercentage}%</strong>
          </div>
          <div className="card">
            <small>Average decimal odds</small>
            <strong>{summary.averageDecimalOdds}</strong>
          </div>
          <div className="card">
            <small>Current streak</small>
            <strong>{summary.currentStreak}</strong>
          </div>
          <div className="card">
            <small>Best win streak</small>
            <strong>W{summary.bestStreak}</strong>
          </div>
        </section>
      ) : null}

      {!wagerResult.error ? (
        <div className="analytics-grid">
          <BreakdownTable
            title="By ticket type"
            rows={buildBreakdown(records, (row) => row.ticketType)}
          />
          <BreakdownTable title="By sport" rows={buildBreakdown(records, (row) => row.sportKey)} />
          <BreakdownTable
            title="By competition"
            rows={buildBreakdown(
              records,
              (row) => row.competitionKey,
              (row) => row.competitionName,
            )}
          />
          <BreakdownTable
            title="By market"
            rows={buildBreakdown(records, (row) => row.marketType)}
          />
          <BreakdownTable
            title="By sportsbook"
            rows={buildBreakdown(
              records,
              (row) => row.sportsbookId,
              (row) => row.sportsbookName,
            )}
          />
        </div>
      ) : null}
    </main>
  );
}
