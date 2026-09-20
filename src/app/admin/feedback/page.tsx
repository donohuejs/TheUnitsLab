import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { LocalDateTime } from "@/components/local-date-time";
import { SubmitButton } from "@/components/submit-button";
import { hasPublicEnvironment } from "@/config/env.public";
import { APP_VERSION_LABEL } from "@/config/version";
import { isAdministrator } from "@/lib/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { updateFeedbackStatus } from "./actions";

const statuses = ["new", "reviewing", "planned", "resolved"] as const;
const categories = ["bug", "usability", "feature_request", "other"] as const;
type FeedbackStatus = (typeof statuses)[number];
type FeedbackCategory = (typeof categories)[number];

type Props = {
  searchParams: Promise<{ status?: string; category?: string; notice?: string }>;
};

type Feedback = {
  id: string;
  user_id: string;
  category: FeedbackCategory;
  title: string;
  description: string;
  steps_to_reproduce: string | null;
  page_path: string | null;
  app_version: string;
  user_agent: string | null;
  status: FeedbackStatus;
  created_at: string;
  updated_at: string;
};

const readable = (value: string) => value.replaceAll("_", " ");

export default async function AdminFeedbackPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const auth = await createSupabaseServerClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) redirect("/auth");
  if (!isAdministrator(data.user.id)) redirect("/sports");

  const query = await searchParams;
  const status = statuses.includes(query.status as FeedbackStatus)
    ? (query.status as FeedbackStatus)
    : undefined;
  const category = categories.includes(query.category as FeedbackCategory)
    ? (query.category as FeedbackCategory)
    : undefined;
  let feedbackQuery = createSupabaseAdminClient()
    .from("beta_feedback")
    .select(
      "id,user_id,category,title,description,steps_to_reproduce,page_path,app_version,user_agent,status,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) feedbackQuery = feedbackQuery.eq("status", status);
  if (category) feedbackQuery = feedbackQuery.eq("category", category);
  const { data: rows, error } = await feedbackQuery;
  const feedback = (rows ?? []) as Feedback[];
  const profiles = feedback.length
    ? await createSupabaseAdminClient()
        .from("profiles")
        .select("user_id,display_name")
        .in("user_id", [...new Set(feedback.map((entry) => entry.user_id))])
    : { data: [], error: null };
  const displayNames = new Map(
    (profiles.data ?? []).map((profile) => [profile.user_id, profile.display_name]),
  );

  return (
    <main className="shell">
      <AppNav active="admin" userId={data.user.id} />
      <header className="page-header">
        <p className="eyebrow">Application administrator · {APP_VERSION_LABEL}</p>
        <h1>Beta feedback</h1>
        <p className="muted">
          Review private-beta reports and move them through the small release feedback queue. User
          identifiers are application UUIDs; email addresses are not shown here.
        </p>
        <div className="inline-actions">
          <Link className="button secondary" href="/admin/settlement-tests">
            Settlement test harness
          </Link>
          <Link className="button secondary" href="/admin/api-usage">
            API quota
          </Link>
        </div>
      </header>
      {query.notice ? (
        <p className="notice" role="status">
          {query.notice}
        </p>
      ) : null}
      {error || profiles.error ? (
        <p className="notice error" role="alert">
          Feedback is temporarily unavailable.
        </p>
      ) : null}
      <form className="feedback-filters" method="get">
        <label>
          Status
          <select name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {statuses.map((option) => (
              <option key={option} value={option}>
                {readable(option)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select name="category" defaultValue={category ?? ""}>
            <option value="">All categories</option>
            {categories.map((option) => (
              <option key={option} value={option}>
                {readable(option)}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" type="submit">
          Filter feedback
        </button>
      </form>
      <section className="feedback-admin-list" aria-label="Beta feedback reports">
        {feedback.map((entry) => (
          <article className="card feedback-admin-card" key={entry.id}>
            <div className="event-heading">
              <div>
                <div className="ticket-meta">
                  <span className="pill">{readable(entry.category)}</span>
                  <span className="pill">{readable(entry.status)}</span>
                </div>
                <h2>{entry.title}</h2>
                <small>
                  <LocalDateTime value={entry.created_at} /> ·{" "}
                  {displayNames.get(entry.user_id) ?? "Private user"} · {entry.user_id}
                </small>
              </div>
              <strong>
                {entry.app_version === APP_VERSION_LABEL.slice(1)
                  ? APP_VERSION_LABEL
                  : `v${entry.app_version}`}
              </strong>
            </div>
            <p>{entry.description}</p>
            {entry.steps_to_reproduce ? (
              <details>
                <summary>Steps to reproduce</summary>
                <p>{entry.steps_to_reproduce}</p>
              </details>
            ) : null}
            {entry.user_agent ? (
              <details>
                <summary>Browser context</summary>
                <p>{entry.user_agent}</p>
              </details>
            ) : null}
            <dl className="ticket-details compact">
              <div>
                <dt>Originating page</dt>
                <dd>{entry.page_path ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>
                  <LocalDateTime value={entry.updated_at} />
                </dd>
              </div>
            </dl>
            <form action={updateFeedbackStatus} className="result-form">
              <input type="hidden" name="feedbackId" value={entry.id} />
              <label>
                Status
                <select name="status" defaultValue={entry.status}>
                  {statuses.map((option) => (
                    <option key={option} value={option}>
                      {readable(option)}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton className="button secondary" pendingLabel="Updating…">
                Update status
              </SubmitButton>
            </form>
          </article>
        ))}
        {!feedback.length ? (
          <p className="empty-state">No feedback matches these filters.</p>
        ) : null}
      </section>
    </main>
  );
}
