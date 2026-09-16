import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { hasPublicEnvironment } from "@/config/env.public";
import {
  filterAnalyticsWagers,
  normalizeAnalyticsTimeZone,
  rankLeaderboard,
  RATE_LEADERBOARD_MINIMUM_WAGERS,
  type AnalyticsPeriod,
  type AnalyticsWager,
  type LeaderboardCategory,
  type SourceFilter,
} from "@/lib/analytics/calculations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type Group = { id: string; name: string };
type MemberRow = { user_id: string; display_name: string };
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

const categories: { value: LeaderboardCategory; label: string }[] = [
  { value: "units", label: "Most Vials won" },
  { value: "roi", label: "Best ROI" },
  { value: "win_percentage", label: "Best win percentage" },
  { value: "total_wagers", label: "Total wagers" },
  { value: "soccer", label: "Best soccer bettor" },
  { value: "college_football", label: "Best college football bettor" },
  { value: "college_basketball", label: "Best college basketball bettor" },
];

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const sourceValue = (value: string | undefined): SourceFilter =>
  value === "simulated" || value === "irl" ? value : "combined";
const periodValue = (value: string | undefined): AnalyticsPeriod =>
  value === "week" || value === "month" || value === "season" ? value : "all";
const categoryValue = (value: string | undefined): LeaderboardCategory =>
  categories.some((option) => option.value === value) ? (value as LeaderboardCategory) : "units";

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

export default async function LeaderboardsPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const [{ data: groupsData }, { data: profile }] = await Promise.all([
    supabase.from("groups").select("id,name").order("name"),
    supabase.from("profiles").select("time_zone").eq("user_id", authData.user.id).single(),
  ]);
  const groups = (groupsData ?? []) as Group[];
  const requestedGroup = one(query.group);
  const selectedGroup = groups.find((group) => group.id === requestedGroup) ?? groups[0];
  const source = sourceValue(one(query.source));
  const period = periodValue(one(query.period));
  const category = categoryValue(one(query.category));

  const [wagerResult, memberResult] = selectedGroup
    ? await Promise.all([
        supabase.rpc("get_group_analytics_wagers", { p_group_id: selectedGroup.id }),
        supabase.rpc("get_group_leaderboard_members", { p_group_id: selectedGroup.id }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const timeZone = normalizeAnalyticsTimeZone(profile?.time_zone ?? "UTC");
  const filtered = filterAnalyticsWagers(((wagerResult.data ?? []) as RpcWager[]).map(mapWager), {
    source,
    period,
    timeZone,
  });
  const rows = rankLeaderboard(
    ((memberResult.data ?? []) as MemberRow[]).map((member) => ({
      userId: member.user_id,
      displayName: member.display_name,
    })),
    filtered,
    category,
  );
  const rateCategory = category === "roi" || category === "win_percentage";

  return (
    <main className="shell">
      <AppNav active="leaderboards" userId={authData.user.id} />
      <header className="page-header">
        <p className="eyebrow">Private groups</p>
        <h1>Leaderboards</h1>
        <p className="muted">
          Vials Won is the default ranking. ROI is shown beside every participant.
        </p>
      </header>

      <form className="card filter-bar leaderboard-filters" method="get">
        <label>
          Group
          <select name="group" defaultValue={selectedGroup?.id ?? ""} disabled={!groups.length}>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select name="category" defaultValue={category}>
            {categories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select name="source" defaultValue={source}>
            <option value="combined">All</option>
            <option value="simulated">Simulated</option>
            <option value="irl">Imported</option>
          </select>
        </label>
        <label>
          Period
          <select name="period" defaultValue={period}>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="season">Season</option>
            <option value="all">All-time</option>
          </select>
        </label>
        <button className="button secondary" type="submit">
          Apply filters
        </button>
      </form>

      {!groups.length ? (
        <p className="empty-state">
          <strong>No group selected</strong>
          Join or create a group to see leaderboards.
        </p>
      ) : null}
      {wagerResult.error || memberResult.error ? (
        <p className="notice error" role="alert">
          This group leaderboard is unavailable or you are not authorized to view it.
        </p>
      ) : null}
      {rateCategory ? (
        <p className="muted eligibility-note">
          Rate rankings require {RATE_LEADERBOARD_MINIMUM_WAGERS} settled, non-void wagers after
          filters.
        </p>
      ) : null}

      {selectedGroup ? (
        <section className="card leaderboard-card" aria-label={`${selectedGroup.name} leaderboard`}>
          <div className="section-heading">
            <h2>{selectedGroup.name}</h2>
            <span className="pill">
              {categories.find((option) => option.value === category)?.label}
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">{selectedGroup.name} leaderboard rankings</caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Participant</th>
                  <th scope="col">Vials won/lost</th>
                  <th scope="col">ROI</th>
                  <th scope="col">Record</th>
                  <th scope="col">Bets</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId} className={row.eligible ? undefined : "ineligible-row"}>
                    <td>{row.rank ?? "—"}</td>
                    <th scope="row">
                      {row.displayName}
                      {!row.eligible ? (
                        <small className="eligibility-cell">
                          Needs {row.neededForEligibility} more eligible wager
                          {row.neededForEligibility === 1 ? "" : "s"}
                        </small>
                      ) : null}
                    </th>
                    <td>{row.summary.unitsWonLost}</td>
                    <td>{row.summary.roiPercent}%</td>
                    <td>
                      {row.summary.wins}-{row.summary.losses}-{row.summary.pushes}
                    </td>
                    <td>{row.summary.totalBets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length ? (
            <p className="empty-state">
              <strong>No qualifying leaderboard rows yet</strong>
              Wagers will appear after members record activity that matches these filters.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
