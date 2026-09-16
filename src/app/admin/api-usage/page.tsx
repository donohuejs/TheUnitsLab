import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { readServerEnvironment } from "@/config/env.server";
import { hasPublicEnvironment } from "@/config/env.public";
import { quotaState } from "@/lib/odds/quota";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Ledger = {
  requested_at: string;
  endpoint: string;
  sport: string;
  credits_consumed: number | null;
  credits_used: number | null;
  credits_remaining: number | null;
};

export default async function ApiUsagePage() {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const auth = await createSupabaseServerClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) redirect("/auth");
  const environment = readServerEnvironment(process.env);
  if (!environment.APP_ADMIN_USER_IDS.includes(data.user.id)) redirect("/sports");
  const { data: rows, error } = await createSupabaseAdminClient()
    .from("api_usage_ledger")
    .select("requested_at,endpoint,sport,credits_consumed,credits_used,credits_remaining")
    .order("requested_at", { ascending: false });
  if (error) {
    return (
      <main className="shell">
        <AppNav active="admin" userId={data.user.id} />
        <section className="card error-state" role="alert">
          <p className="eyebrow">Application administrator</p>
          <h1>API quota is unavailable</h1>
          <p className="muted">
            The usage ledger could not be read. No provider credentials are shown here.
          </p>
        </section>
      </main>
    );
  }
  const ledger = (rows ?? []) as Ledger[];
  const latest = ledger.find((row) => row.credits_used !== null);
  const used = latest?.credits_used ?? 0;
  const remaining =
    latest?.credits_remaining ?? Math.max(0, environment.ODDS_API_MONTHLY_ALLOWANCE - used);
  const percent = (used / environment.ODDS_API_MONTHLY_ALLOWANCE) * 100;
  const sum = (key: "sport" | "endpoint") =>
    Object.entries(
      ledger.reduce<Record<string, number>>((totals, row) => {
        totals[row[key]] = (totals[row[key]] ?? 0) + (row.credits_consumed ?? 0);
        return totals;
      }, {}),
    );
  const byDay = Object.entries(
    ledger.reduce<Record<string, number>>((totals, row) => {
      const day = row.requested_at.slice(0, 10);
      totals[day] = (totals[day] ?? 0) + (row.credits_consumed ?? 0);
      return totals;
    }, {}),
  );
  return (
    <main className="shell">
      <AppNav active="admin" userId={data.user.id} />
      <header className="page-header">
        <p className="eyebrow">Application administrator</p>
        <h1>API quota</h1>
        <p className="muted">State: {quotaState(used, environment.ODDS_API_MONTHLY_ALLOWANCE)}</p>
      </header>
      <div className="stats-grid">
        <div className="card">
          <small>Monthly allowance</small>
          <strong>{environment.ODDS_API_MONTHLY_ALLOWANCE}</strong>
        </div>
        <div className="card">
          <small>Used</small>
          <strong>{used}</strong>
        </div>
        <div className="card">
          <small>Remaining</small>
          <strong>{remaining}</strong>
        </div>
        <div className="card">
          <small>Consumed</small>
          <strong>{percent.toFixed(1)}%</strong>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="card">
          <h2>Usage by sport</h2>
          {sum("sport").length ? (
            <ul>
              {sum("sport").map(([label, value]) => (
                <li key={label}>
                  {label}: {value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No provider calls have been recorded.</p>
          )}
        </section>
        <section className="card">
          <h2>Usage by endpoint</h2>
          {sum("endpoint").length ? (
            <ul>
              {sum("endpoint").map(([label, value]) => (
                <li key={label}>
                  {label}: {value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No provider calls have been recorded.</p>
          )}
        </section>
        <section className="card">
          <h2>Usage by day</h2>
          {byDay.length ? (
            <ul>
              {byDay.map(([label, value]) => (
                <li key={label}>
                  {label}: {value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No provider calls have been recorded.</p>
          )}
        </section>
      </div>
    </main>
  );
}
