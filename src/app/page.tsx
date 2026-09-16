import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { BrandLockup } from "@/components/brand";
import { SourceBadge, StatusBadge, TicketTypeBadge } from "@/components/status-badge";
import { TeamMark } from "@/components/team-mark";
import { hasPublicEnvironment } from "@/config/env.public";
import {
  filterAnalyticsWagers,
  normalizeAnalyticsTimeZone,
  summarizeAnalytics,
  type AnalyticsWager,
} from "@/lib/analytics/calculations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PRODUCT_NAME, VIAL_LABEL, welcomeName } from "@/lib/ui";

type DashboardRpcWager = {
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

type RecentTicket = {
  id: string;
  ticket_type: "straight" | "parlay";
  stake_units: string | number;
  status: "open" | "won" | "lost" | "push" | "void";
  created_at: string;
  bet_legs: { sport_key: string; away_team: string; home_team: string; selection_name: string }[];
};

function mapWager(row: DashboardRpcWager): AnalyticsWager {
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

const vials = (value: string | number) => Number(value).toFixed(2);

export default async function HomePage() {
  const configured = hasPublicEnvironment(process.env);
  if (!configured) {
    return (
      <main className="shell hero">
        <BrandLockup />
        <p className="eyebrow">Private entertainment and statistics</p>
        <h1>{PRODUCT_NAME}</h1>
        <p className="hero-copy">
          Browse real pregame odds and place simulated wagers using Vials. The application never
          accepts or places a real-money wager.
        </p>
        <p className="notice error" role="alert">
          Supabase public configuration is required before authentication can run.
        </p>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return (
      <main className="shell hero">
        <BrandLockup />
        <p className="eyebrow">Private entertainment and statistics</p>
        <h1>{PRODUCT_NAME}</h1>
        <p className="hero-copy">
          Experiment with real pregame odds using Vials, then import wagers placed elsewhere for
          performance statistics.
        </p>
        <Link className="button link-button" href="/auth">
          Sign in or create an account
        </Link>
      </main>
    );
  }

  const [{ data: profile }, ledgerResult, openResult, recentResult, analyticsResult, groupsResult] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name,time_zone")
        .eq("user_id", authData.user.id)
        .single(),
      supabase.from("bankroll_ledger").select("amount_units"),
      supabase.from("bets").select("id").eq("status", "open").eq("is_synthetic", false),
      supabase
        .from("bets")
        .select(
          "id,ticket_type,stake_units,status,created_at,bet_legs(sport_key,away_team,home_team,selection_name)",
        )
        .neq("status", "open")
        .eq("is_synthetic", false)
        .order("created_at", { ascending: false })
        .limit(4),
      supabase.rpc("get_personal_analytics_wagers"),
      supabase.from("groups").select("id,name").order("name", { ascending: true }).limit(3),
    ]);

  const summary = analyticsResult.error
    ? null
    : summarizeAnalytics(
        ((analyticsResult.data ?? []) as DashboardRpcWager[]).map(mapWager).filter((wager) => {
          const timeZone = normalizeAnalyticsTimeZone(profile?.time_zone ?? "UTC");
          return filterAnalyticsWagers([wager], { timeZone }).length > 0;
        }),
      );
  const balance = (ledgerResult.data ?? []).reduce(
    (total, row) => total + Number(row.amount_units),
    0,
  );
  const recentTickets = (recentResult.data ?? []) as RecentTicket[];
  const dataUnavailable = Boolean(
    ledgerResult.error ||
    openResult.error ||
    recentResult.error ||
    analyticsResult.error ||
    groupsResult.error,
  );

  return (
    <main className="shell">
      <AppNav active="home" userId={authData.user.id} />
      {dataUnavailable ? (
        <p className="notice error" role="alert">
          Some dashboard data is temporarily unavailable. Your stored wagers were not changed.
        </p>
      ) : null}
      <header className="page-header dashboard-hero">
        <div>
          <p className="eyebrow">Your activity at a glance</p>
          <h1>Welcome back, {welcomeName(profile?.display_name)}</h1>
          <p className="muted">
            Review your Vial balance, recent simulated tickets, and performance across both sources.
          </p>
          <div className="dashboard-actions">
            <Link className="button" href="/sports">
              Browse odds
            </Link>
            <Link className="button secondary" href="/track-bet">
              Import Betslip
            </Link>
          </div>
        </div>
        <div className="balance-card">
          <small>Available simulated bankroll</small>
          <strong>{ledgerResult.error ? "—" : `${vials(balance)} ${VIAL_LABEL}`}</strong>
          <Link href="/my-bets">Review open bets</Link>
        </div>
      </header>

      <section className="stats-grid dashboard-stats" aria-label="Account summary">
        <div className="card">
          <small>Open simulated bets</small>
          <strong>{openResult.error ? "—" : (openResult.data ?? []).length}</strong>
          <Link href="/my-bets">View open bets</Link>
        </div>
        <div className="card">
          <small>Settled record</small>
          <strong>{summary ? `${summary.wins}-${summary.losses}-${summary.pushes}` : "—"}</strong>
          <span className="muted">W–L–P, combined analytics</span>
        </div>
        <div className="card">
          <small>Vials won / lost</small>
          <strong>{summary?.unitsWonLost ?? "—"}</strong>
          <Link href="/performance">View performance</Link>
        </div>
        <div className="card">
          <small>ROI</small>
          <strong>{summary ? `${summary.roiPercent}%` : "—"}</strong>
          <span className="muted">Canonical analytics</span>
        </div>
      </section>

      <section className="dashboard-callout" aria-label="Wager source explanation">
        <div>
          <SourceBadge source="simulated" />
          <h2>Simulated wagers</h2>
          <p>
            Use cached real-world odds and Vials. Accepted tickets debit and settle your simulated
            balance.
          </p>
          <Link href="/sports">Build a simulated ticket →</Link>
        </div>
        <div>
          <SourceBadge source="external" />
          <h2>Imported wagers</h2>
          <p>
            Import a wager placed elsewhere. It contributes to statistics only and never changes the
            simulated Vial balance.
          </p>
          <Link href="/import-betslip">Import a betslip →</Link>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="card">
          <div className="section-heading">
            <h2>Recent settled simulated bets</h2>
            <Link href="/my-bets?view=history">See history</Link>
          </div>
          {recentResult.error ? (
            <p className="empty-state">
              <strong>Recent tickets are unavailable</strong>
              Refresh the page later to load your settled simulated history.
            </p>
          ) : recentTickets.length ? (
            <ul className="dashboard-list">
              {recentTickets.map((ticket) => (
                <li key={ticket.id}>
                  <div>
                    <strong>
                      {ticket.ticket_type === "parlay" ? (
                        "Parlay"
                      ) : ticket.bet_legs[0] ? (
                        <span className="team-pair">
                          <TeamMark
                            teamName={ticket.bet_legs[0].away_team}
                            sport={ticket.bet_legs[0].sport_key}
                          />
                          {ticket.bet_legs[0].away_team} at
                          <TeamMark
                            teamName={ticket.bet_legs[0].home_team}
                            sport={ticket.bet_legs[0].sport_key}
                          />
                          {ticket.bet_legs[0].home_team}
                        </span>
                      ) : (
                        "Straight bet"
                      )}
                    </strong>
                    <div className="ticket-meta">
                      <TicketTypeBadge ticketType={ticket.ticket_type} />
                      <small>{vials(ticket.stake_units)} Vials staked</small>
                    </div>
                  </div>
                  <StatusBadge status={ticket.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">
              <strong>No settled simulated bets yet</strong>
              Place a ticket from Browse odds to start building your history.
            </p>
          )}
        </section>

        <section className="card">
          <div className="section-heading">
            <h2>Your groups</h2>
            <Link href="/account">Manage groups</Link>
          </div>
          {groupsResult.error ? (
            <p className="empty-state">
              <strong>Group information is unavailable</strong>
              Refresh the page later to load your private groups.
            </p>
          ) : (groupsResult.data ?? []).length ? (
            <ul className="dashboard-list">
              {(groupsResult.data ?? []).map((group) => (
                <li key={group.id}>
                  <strong>{group.name}</strong>
                  <Link href={`/leaderboards?group=${group.id}`}>Leaderboard</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">
              <strong>No private groups yet</strong>
              Create or join a group in Settings to compare performance privately.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
