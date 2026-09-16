import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { CompetitionSwitcher } from "@/components/competition-switcher";
import { sportsProviderConfiguration } from "@/config/sports";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SportsPage() {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/auth");
  const competitions = sportsProviderConfiguration.competitions.filter(
    (item) => item.enabled && item.availability === "core",
  );
  return (
    <main className="shell">
      <header className="page-header">
        <p className="eyebrow">Simulated sportsbook</p>
        <h1>Browse odds</h1>
        <p className="muted">
          Pregame markets in a shared 15-minute cache. Select a price for a straight ticket or add
          distinct events to the parlay slip.
        </p>
      </header>
      <AppNav active="sports" userId={data.user.id} />
      <CompetitionSwitcher />
      <div className="competition-grid">
        {competitions.map((item) => (
          <Link
            className="card competition-card"
            href={`/sports/${item.id}`}
            key={item.id}
            prefetch={false}
          >
            <span className="pill">{item.browseLabel}</span>
            <h2>{item.name}</h2>
            <p>{item.markets.map((market) => market.id).join(" · ")}</p>
          </Link>
        ))}
      </div>
      {!competitions.length ? (
        <p className="empty-state">
          <strong>No competitions are available</strong>
          Try again later or contact an administrator if this continues.
        </p>
      ) : null}
    </main>
  );
}
