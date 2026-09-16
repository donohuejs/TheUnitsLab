import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { StatusBadge, TicketTypeBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { hasPublicEnvironment } from "@/config/env.public";
import { isAdministrator } from "@/lib/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createSettlementTest, settleSettlementTest } from "./actions";

type Props = { searchParams: Promise<{ notice?: string }> };
type TestTicket = {
  id: string;
  ticket_type: "straight" | "parlay";
  leg_count: number;
  stake_units: number;
  status: "open" | "won" | "lost" | "push" | "void";
  is_synthetic: boolean;
  created_at: string;
};

export default async function SettlementTestsPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const auth = await createSupabaseServerClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) redirect("/auth");
  if (!isAdministrator(data.user.id)) redirect("/sports");

  const query = await searchParams;
  const { data: rows, error } = await createSupabaseAdminClient()
    .from("bets")
    .select("id,ticket_type,leg_count,stake_units,status,is_synthetic,created_at")
    .eq("user_id", data.user.id)
    .eq("is_synthetic", true)
    .order("created_at", { ascending: false })
    .limit(30);
  const tests = (rows ?? []) as TestTicket[];

  return (
    <main className="shell">
      <AppNav active="admin" userId={data.user.id} />
      <header className="page-header">
        <p className="eyebrow">Application administrator · synthetic mode</p>
        <h1>Settlement test harness</h1>
        <p className="muted">
          Create a clearly marked test wager, set a deterministic result, and exercise the same
          settlement and payout functions used by real simulated tickets. Test rows are excluded
          from normal history, analytics, leaderboards, and score reads.
        </p>
      </header>
      {query.notice ? (
        <p className="notice" role="status">
          {query.notice}
        </p>
      ) : null}
      {error ? (
        <p className="notice error" role="alert">
          Synthetic test records are temporarily unavailable.
        </p>
      ) : null}
      <section className="card">
        <h2>Create synthetic test wager</h2>
        <p className="muted">
          Win/loss/push use final synthetic scores. Void uses the existing operator-confirmed void
          path. The stake debit and any return credit are real ledger entries for this admin test
          account, but they are marked by the synthetic ticket and do not enter normal metrics.
        </p>
        <form action={createSettlementTest} className="form-grid">
          <label>
            Ticket type
            <select name="ticketType" defaultValue="straight">
              <option value="straight">Straight</option>
              <option value="parlay">Two-leg parlay</option>
            </select>
          </label>
          <label>
            Deterministic result
            <select name="scenario" defaultValue="win">
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="push">Push</option>
              <option value="void">Void</option>
            </select>
          </label>
          <label>
            Stake in virtual units
            <input
              name="stake"
              type="number"
              min="0.01"
              max="1000"
              step="0.01"
              defaultValue="10.00"
            />
          </label>
          <div className="inline-actions">
            <SubmitButton pendingLabel="Creating test…">Create synthetic wager</SubmitButton>
            <Link className="button secondary" href="/admin/api-usage">
              Review API quota
            </Link>
          </div>
        </form>
      </section>
      <section className="section-break">
        <div className="section-heading">
          <h2>Recent synthetic wagers</h2>
          <small className="muted">Admin-only records · {tests.length} shown</small>
        </div>
        <div className="ticket-list">
          {tests.map((ticket) => (
            <article className="card ticket-card" key={ticket.id}>
              <div className="event-heading">
                <div>
                  <div className="ticket-meta">
                    <span className="source-badge">Synthetic test</span>
                    <TicketTypeBadge ticketType={ticket.ticket_type} />
                  </div>
                  <h3>
                    {ticket.ticket_type === "parlay"
                      ? `${ticket.leg_count}-leg parlay`
                      : "Straight test wager"}
                  </h3>
                  <small>
                    {ticket.id} · {Number(ticket.stake_units).toFixed(2)} units ·{" "}
                    {new Date(ticket.created_at).toLocaleString()}
                  </small>
                </div>
                <StatusBadge status={ticket.status} />
              </div>
              <form action={settleSettlementTest} className="result-form">
                <input type="hidden" name="betId" value={ticket.id} />
                <label>
                  Result control
                  <select name="scenario" defaultValue="win">
                    <option value="win">Win</option>
                    <option value="loss">Loss</option>
                    <option value="push">Push</option>
                    <option value="void">Void</option>
                  </select>
                </label>
                <SubmitButton className="button secondary" pendingLabel="Settling…">
                  {ticket.status === "open" ? "Run settlement" : "Re-run idempotency check"}
                </SubmitButton>
              </form>
            </article>
          ))}
          {!tests.length ? (
            <p className="empty-state">
              <strong>No synthetic wagers yet</strong>
              Create one above to validate settlement outcomes without waiting for a real event.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
