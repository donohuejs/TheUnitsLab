import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { LeaderboardControls, ManageGroupDialog } from "@/components/leaderboard-controls";
import { createGroup, joinGroup } from "@/app/actions";
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

// ManageGroupDialog owns the InviteForm so invite controls stay behind the compact drawer.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
type Group = { id: string; name: string; owner_user_id: string };
type Membership = { group_id: string; role: "owner" | "admin" | "member" };
type MemberRow = { user_id: string; display_name: string };
type InviteRow = {
  invite_id: string;
  invite_expires_at: string;
  invite_max_uses: number | null;
  invite_use_count: number;
  invite_revoked_at: string | null;
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
  const [{ data: groupsData }, { data: profile }, { data: membershipData }] = await Promise.all([
    supabase.from("groups").select("id,name,owner_user_id").order("name"),
    supabase.from("profiles").select("time_zone").eq("user_id", authData.user.id).single(),
    supabase.from("group_members").select("group_id,role").eq("user_id", authData.user.id),
  ]);
  const groups = (groupsData ?? []) as Group[];
  const memberships = (membershipData ?? []) as Membership[];
  const invite = one(query.invite) ?? "";
  const requestedGroup = one(query.group);
  const selectedGroup = groups.find((group) => group.id === requestedGroup) ?? groups[0];
  const source = sourceValue(one(query.source));
  const period = periodValue(one(query.period));
  const category = categoryValue(one(query.category));

  const [wagerResult, memberResult, inviteResult] = selectedGroup
    ? await Promise.all([
        supabase.rpc("get_group_analytics_wagers", { p_group_id: selectedGroup.id }),
        supabase.rpc("get_group_leaderboard_members", { p_group_id: selectedGroup.id }),
        supabase.rpc("list_group_invites", { target_group_id: selectedGroup.id }),
      ])
    : [
        { data: [], error: null },
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
  const invites = (inviteResult.data ?? []) as InviteRow[];
  const currentIso = new Date().toISOString();

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
      {one(query.notice) ? (
        <p className="notice" role="status" aria-live="polite">
          {one(query.notice)}
        </p>
      ) : null}

      <LeaderboardControls
        groups={groups}
        selectedGroupId={selectedGroup?.id ?? ""}
        category={category}
        categoryLabel={
          categories.find((option) => option.value === category)?.label ?? "Most Vials won"
        }
        source={source}
        period={period}
        categories={categories}
      />

      {!groups.length ? (
        <p className="empty-state">
          <strong>No group selected</strong>
          Join or create a group to see leaderboards.
        </p>
      ) : null}
      {wagerResult.error || memberResult.error || inviteResult.error ? (
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
          <div className="leaderboard-mobile-cards" aria-label="Ranked participant cards">
            {rows.map((row) => (
              <article
                className={
                  row.eligible
                    ? "leaderboard-player-card"
                    : "leaderboard-player-card ineligible-row"
                }
                key={row.userId}
              >
                <div className="leaderboard-player-heading">
                  <span className="leaderboard-rank">#{row.rank ?? "—"}</span>
                  <h3>{row.displayName}</h3>
                  {!row.eligible ? (
                    <small>
                      Needs {row.neededForEligibility} more eligible wager
                      {row.neededForEligibility === 1 ? "" : "s"}
                    </small>
                  ) : null}
                </div>
                <strong className="leaderboard-primary-value">
                  {row.summary.unitsWonLost} Vials
                </strong>
                <dl>
                  <div>
                    <dt>ROI</dt>
                    <dd>{row.summary.roiPercent}%</dd>
                  </div>
                  <div>
                    <dt>Record</dt>
                    <dd>
                      {row.summary.wins}-{row.summary.losses}-{row.summary.pushes}
                    </dd>
                  </div>
                  <div>
                    <dt>Bets</dt>
                    <dd>{row.summary.totalBets}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          {!rows.length ? (
            <p className="empty-state">
              <strong>No qualifying leaderboard rows yet</strong>
              Wagers will appear after members record activity that matches these filters.
            </p>
          ) : null}
        </section>
      ) : null}
      <ManageGroupDialog
        selectedGroup={selectedGroup}
        memberships={memberships}
        invites={invites}
        inviteToken={invite}
        nowIso={currentIso}
        createGroupAction={createGroup}
        joinGroupAction={joinGroup}
      />
    </main>
  );
}
