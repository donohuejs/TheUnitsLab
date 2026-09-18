import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { readServerEnvironment } from "@/config/env.server";
import { hasPublicEnvironment } from "@/config/env.public";
import { quotaState } from "@/lib/odds/quota";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";

import { increaseVisionBudget } from "./actions";
import {
  VISION_DEFAULT_BUDGET_USD,
  VISION_HIGH_USAGE_AVERAGE_USD,
  visionRemainingUsd,
  visionThreshold,
} from "@/lib/betslip/vision-accounting";

type Ledger = {
  requested_at: string;
  endpoint: string;
  sport: string;
  credits_consumed: number | null;
  credits_used: number | null;
  credits_remaining: number | null;
};

type VisionLedger = {
  user_id: string;
  requested_at: string;
  model: string;
  purpose: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  reserved_cost_usd: number;
  actual_cost_usd: number;
  local_ocr_outcome: string;
  vision_status: string;
};

type VisionOcrAttempt = {
  local_ocr_outcome: string;
  fallback_requested: boolean;
};

type VisionDiagnostic = {
  requested_at: string;
  model: string;
  api_key_configured: boolean;
  internal_budget_available: boolean | null;
  monthly_budget_usd: number | null;
  monthly_spend_usd: number | null;
  provider_status: number | null;
  provider_error_category: string | null;
  extraction_result: string;
  ledger_write_status: string;
};

type Props = { searchParams: Promise<{ notice?: string }> };

export default async function ApiUsagePage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const queryNotice = query.notice;
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
  const admin = createSupabaseAdminClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const monthKey = monthStart.toISOString().slice(0, 10);
  const [
    { data: visionRows },
    { data: ocrRows },
    { data: budgetRow },
    { data: budgetAudits },
    { data: diagnosticRows },
  ] = await Promise.all([
    admin
      .from("vision_usage_ledger")
      .select(
        "user_id,requested_at,model,purpose,input_tokens,output_tokens,total_tokens,reserved_cost_usd,actual_cost_usd,local_ocr_outcome,vision_status",
      )
      .eq("month_start", monthKey)
      .order("requested_at", { ascending: false }),
    admin
      .from("vision_ocr_attempts")
      .select("local_ocr_outcome,fallback_requested")
      .eq("month_start", monthKey),
    admin
      .from("vision_budget_monthly")
      .select("approved_limit_usd")
      .eq("month_start", monthKey)
      .maybeSingle(),
    admin
      .from("vision_budget_audits")
      .select("changed_at,previous_limit_usd,amount_added_usd,new_limit_usd,reason")
      .order("changed_at", { ascending: false })
      .limit(8),
    admin
      .from("vision_diagnostics")
      .select(
        "requested_at,model,api_key_configured,internal_budget_available,monthly_budget_usd,monthly_spend_usd,provider_status,provider_error_category,extraction_result,ledger_write_status",
      )
      .order("requested_at", { ascending: false })
      .limit(50),
  ]);
  const visionLedger = (visionRows ?? []) as VisionLedger[];
  const ocrAttempts = (ocrRows ?? []) as VisionOcrAttempt[];
  const diagnostics = (diagnosticRows ?? []) as VisionDiagnostic[];
  const visionUserIds = [...new Set(visionLedger.map((row) => row.user_id))];
  const { data: visionProfiles } = visionUserIds.length
    ? await admin.from("profiles").select("user_id,display_name").in("user_id", visionUserIds)
    : { data: [] };
  const displayNames = new Map(
    (visionProfiles ?? []).map((profile) => [profile.user_id, profile.display_name]),
  );
  const visionBudget = Number(budgetRow?.approved_limit_usd ?? VISION_DEFAULT_BUDGET_USD);
  const apiKeyConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const visionSpend = visionLedger.reduce(
    (sum, row) =>
      sum + Number(row.vision_status === "reserved" ? row.reserved_cost_usd : row.actual_cost_usd),
    0,
  );
  const visionCalls = visionLedger.filter((row) => row.vision_status !== "reserved");
  const latestDiagnostic = diagnostics[0];
  const latestSuccessfulDiagnostic = diagnostics.find(
    (diagnostic) => diagnostic.extraction_result === "succeeded",
  );
  const localOcrSuccesses = ocrAttempts.filter(
    (attempt) => attempt.local_ocr_outcome === "sufficient",
  ).length;
  const localOcrFallbacks = ocrAttempts.filter((attempt) => attempt.fallback_requested).length;
  const userUsage = Object.entries(
    visionLedger.reduce<Record<string, { calls: number; spend: number }>>((totals, row) => {
      const current = totals[row.user_id] ?? { calls: 0, spend: 0 };
      current.calls += row.vision_status === "reserved" ? 0 : 1;
      current.spend += Number(
        row.vision_status === "reserved" ? row.reserved_cost_usd : row.actual_cost_usd,
      );
      totals[row.user_id] = current;
      return totals;
    }, {}),
  ).sort(([, left], [, right]) => right.spend - left.spend);
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
        <Link href="/admin/settlement-tests">Open settlement test harness</Link>
      </header>
      {queryNotice ? (
        <p className="notice" role="status">
          {queryNotice}
        </p>
      ) : null}
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
      <section className="card admin-vision-card" aria-labelledby="vision-budget-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">GPT-5.6 Luna fallback</p>
            <h2 id="vision-budget-title">Vision budget</h2>
          </div>
          <strong>{visionThreshold(visionSpend, visionBudget).toUpperCase()}</strong>
        </div>
        <div className="stats-grid">
          <div>
            <small>Current month spend</small>
            <strong>${visionSpend.toFixed(6)}</strong>
          </div>
          <div>
            <small>Approved budget</small>
            <strong>${visionBudget.toFixed(2)}</strong>
          </div>
          <div>
            <small>Remaining</small>
            <strong>${visionRemainingUsd(visionSpend, visionBudget).toFixed(6)}</strong>
          </div>
          <div>
            <small>Luna calls</small>
            <strong>{visionCalls.length}</strong>
          </div>
          <div>
            <small>Average cost / call</small>
            <strong>
              ${(visionCalls.length ? visionSpend / visionCalls.length : 0).toFixed(6)}
            </strong>
          </div>
          <div>
            <small>Local OCR fallbacks</small>
            <strong>{localOcrFallbacks}</strong>
          </div>
          <div>
            <small>Local OCR successes</small>
            <strong>{localOcrSuccesses}</strong>
          </div>
          <div>
            <small>Local OCR success rate</small>
            <strong>
              {ocrAttempts.length
                ? `${((localOcrSuccesses / ocrAttempts.length) * 100).toFixed(1)}%`
                : "—"}
            </strong>
          </div>
          <div>
            <small>Vision fallback rate</small>
            <strong>
              {ocrAttempts.length
                ? `${((localOcrFallbacks / ocrAttempts.length) * 100).toFixed(1)}%`
                : "—"}
            </strong>
          </div>
        </div>
        <p className="muted">
          Warnings: $3.50 · high: $4.25 · critical: $4.75 · limit: $5.00 or the approved override.
        </p>
        <div className="vision-diagnostics" aria-labelledby="vision-diagnostics-title">
          <h3 id="vision-diagnostics-title">Vision diagnostics</h3>
          <dl className="diagnostic-grid">
            <div>
              <dt>API key configured</dt>
              <dd>{apiKeyConfigured ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Configured model</dt>
              <dd>{latestDiagnostic?.model ?? "—"}</dd>
            </div>
            <div>
              <dt>Internal budget available</dt>
              <dd>
                {latestDiagnostic?.internal_budget_available === null
                  ? "—"
                  : latestDiagnostic?.internal_budget_available
                    ? "Yes"
                    : "No"}
              </dd>
            </div>
            <div>
              <dt>Last Luna attempt</dt>
              <dd>{latestDiagnostic?.requested_at ?? "—"}</dd>
            </div>
            <div>
              <dt>Last successful Luna call</dt>
              <dd>{latestSuccessfulDiagnostic?.requested_at ?? "—"}</dd>
            </div>
            <div>
              <dt>Last provider status</dt>
              <dd>{latestDiagnostic?.provider_status ?? "—"}</dd>
            </div>
            <div>
              <dt>Last provider error</dt>
              <dd>{latestDiagnostic?.provider_error_category ?? "—"}</dd>
            </div>
            <div>
              <dt>Last ledger write</dt>
              <dd>{latestDiagnostic?.ledger_write_status ?? "—"}</dd>
            </div>
          </dl>
          {!diagnostics.length ? (
            <p className="empty-state">
              No screenshot vision attempts have been observed this month.
            </p>
          ) : null}
        </div>
        <form action={increaseVisionBudget} className="form-grid">
          <label>
            Increase Vision Budget
            <input
              name="amount"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              placeholder="5.00"
              required
            />
          </label>
          <label>
            Reason (optional)
            <input name="reason" maxLength={500} />
          </label>
          <button className="button secondary" type="submit">
            Increase Vision Budget
          </button>
        </form>
        <h3>Usage by user</h3>
        {userUsage.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Luna calls</th>
                  <th>Estimated spend</th>
                  <th>Share</th>
                  <th>Average / call</th>
                </tr>
              </thead>
              <tbody>
                {userUsage.map(([userId, usage]) => (
                  <tr key={userId}>
                    <th scope="row">{displayNames.get(userId) ?? userId}</th>
                    <td>{usage.calls}</td>
                    <td>${usage.spend.toFixed(6)}</td>
                    <td>{visionSpend ? ((usage.spend / visionSpend) * 100).toFixed(1) : "0.0"}%</td>
                    <td>
                      ${(usage.calls ? usage.spend / usage.calls : 0).toFixed(6)}{" "}
                      {usage.spend / Math.max(usage.calls, 1) >= VISION_HIGH_USAGE_AVERAGE_USD
                        ? "· High usage"
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">No Luna requests this month.</p>
        )}
        {budgetAudits?.length ? (
          <p className="muted">
            Latest budget override: +${Number(budgetAudits[0].amount_added_usd).toFixed(2)} on{" "}
            {budgetAudits[0].changed_at}.
          </p>
        ) : null}
      </section>
    </main>
  );
}
