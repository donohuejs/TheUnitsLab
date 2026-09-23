import Link from "next/link";
import { redirect } from "next/navigation";

import { sportsProviderConfiguration } from "@/config/sports";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";
import { ImportBetslipForm } from "@/components/import-betslip-form";
import { ImportTutorial } from "@/components/import-tutorial";

type Props = { searchParams: Promise<{ notice?: string }> };
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

function canonicalEventsFromScores(
  rows: {
    provider_event_id: string;
    sport: string;
    competition_key: string;
    home_team: string;
    away_team: string;
    scheduled_start: string;
  }[],
) {
  return rows.map((row): CanonicalEvent => ({
    providerEventId: row.provider_event_id,
    sportKey: row.sport,
    competitionKey: row.competition_key,
    competitionName: row.competition_key,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    scheduledStart: row.scheduled_start,
  }));
}

function mergeCanonicalEvents(...sources: CanonicalEvent[][]) {
  const events = new Map<string, CanonicalEvent>();
  for (const source of sources) {
    for (const event of source) events.set(event.providerEventId, event);
  }
  return [...events.values()].sort(
    (left, right) =>
      new Date(left.scheduledStart).getTime() - new Date(right.scheduledStart).getTime(),
  );
}

export default async function TrackBetPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");
  const coreCompetitions = sportsProviderConfiguration.competitions.filter(
    (competition) => competition.enabled,
  );

  const [
    { data: groups, error: groupError },
    { data: cacheRows, error: cacheError },
    { data: scoreRows, error: scoreError },
  ] = await Promise.all([
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
      .from("event_scores")
      .select("provider_event_id,sport,competition_key,home_team,away_team,scheduled_start")
      .eq("is_synthetic", false)
      .order("scheduled_start", { ascending: false })
      .limit(500),
  ]);
  const nowLocal = new Date().toISOString().slice(0, 16);
  const canonicalEvents = mergeCanonicalEvents(
    canonicalEventsFromCache((cacheRows ?? []) as { normalized_payload: unknown }[]),
    canonicalEventsFromScores(
      (scoreRows ?? []) as {
        provider_event_id: string;
        sport: string;
        competition_key: string;
        home_team: string;
        away_team: string;
        scheduled_start: string;
      }[],
    ),
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
      <ImportTutorial />
      {query.notice ? (
        <p className="notice" role="status" aria-live="polite">
          {query.notice}
        </p>
      ) : null}
      {groupError || cacheError || scoreError ? (
        <p className="notice error" role="alert">
          Some import options are temporarily unavailable. Your stored wagers were not changed.
        </p>
      ) : null}

      <section className="card track-form-card">
        <h2>Upload Betslip Screenshot or Enter Bet</h2>
        <ImportBetslipForm
          groups={(groups ?? []) as Group[]}
          competitions={coreCompetitions.map((competition) => ({
            id: competition.id,
            name: competition.name,
            sport: competition.sport,
          }))}
          canonicalEvents={canonicalEvents}
          nowLocal={nowLocal}
          nowIso={new Date().toISOString()}
        />
      </section>

      <p className="muted">
        After import, manage results and view private screenshots from{" "}
        <Link href="/my-bets?filter=imported">My Bets</Link>.
      </p>
    </main>
  );
}
