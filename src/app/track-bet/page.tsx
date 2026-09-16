import Link from "next/link";
import { redirect } from "next/navigation";

import { sportsProviderConfiguration } from "@/config/sports";
import { summarizeExternalWagers } from "@/lib/external-wagers/calculations";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";
import { ExternalParlayForm } from "@/components/external-parlay-form";
import { ExternalParlayResultForm } from "@/components/external-parlay-result-form";
import { MarketBadge, SourceBadge, StatusBadge, TicketTypeBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";

import { createExternalWager, setExternalWagerResult } from "./actions";

type Props = { searchParams: Promise<{ view?: string; notice?: string }> };
type Group = { id: string; name: string };
type ExternalWager = {
  id: string;
  source: "external";
  ticket_type: "straight" | "parlay";
  leg_count: number;
  sportsbook_name: string;
  competition_name: string;
  event_description: string;
  event_date: string;
  selection: string;
  market_type: "moneyline" | "spread" | "total";
  line: number | null;
  american_odds: number;
  decimal_odds: number;
  stake_units: number;
  status: "open" | "won" | "lost" | "push" | "void";
  profit_loss_units: number;
  wager_date: string;
  screenshot_path: string | null;
  verification_status: "unverified" | "user_attested";
  user_notes: string | null;
  effective_settlement_decimal_odds: number | null;
  effective_settlement_american_odds: number | null;
  settled_return_units: number | null;
  external_wager_legs: {
    id: string;
    leg_number: number;
    competition_name: string;
    event_description: string;
    event_date: string;
    selection: string;
    market_type: "moneyline" | "spread" | "total";
    line: number | null;
    american_odds: number;
    decimal_odds: number;
    result: "open" | "won" | "lost" | "push" | "void";
  }[];
};

const price = (value: number) => (value > 0 ? `+${value}` : String(value));
const units = (value: number | string) => Number(value).toFixed(2);

export default async function TrackBetPage({ searchParams }: Props) {
  if (!hasPublicEnvironment(process.env)) redirect("/auth");
  const query = await searchParams;
  const view = query.view === "history" ? "history" : "open";
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/auth");

  let wagerQuery = supabase
    .from("external_wagers")
    .select(
      "id,source,ticket_type,leg_count,sportsbook_name,competition_name,event_description,event_date,selection,market_type,line,american_odds,decimal_odds,stake_units,status,profit_loss_units,wager_date,screenshot_path,verification_status,user_notes,effective_settlement_decimal_odds,effective_settlement_american_odds,settled_return_units,external_wager_legs(*)",
    )
    .eq("user_id", authData.user.id)
    .order("wager_date", { ascending: false });
  wagerQuery = view === "open" ? wagerQuery.eq("status", "open") : wagerQuery.neq("status", "open");

  const [{ data: wagers, error: wagerError }, { data: groups, error: groupError }, summaryResult] =
    await Promise.all([
      wagerQuery,
      supabase.from("groups").select("id,name").order("name"),
      supabase
        .from("external_wagers")
        .select("status,stake_units,profit_loss_units")
        .eq("user_id", authData.user.id),
    ]);
  const records = (wagers ?? []) as ExternalWager[];
  const summary = summarizeExternalWagers(
    (summaryResult.data ?? []).map((record) => ({
      status: record.status,
      stakeUnits: record.stake_units,
      profitLossUnits: record.profit_loss_units,
    })),
  );
  const nowLocal = new Date().toISOString().slice(0, 16);
  const coreCompetitions = sportsProviderConfiguration.competitions.filter(
    (competition) => competition.enabled,
  );

  return (
    <main className="shell">
      <AppNav active="track-bet" userId={authData.user.id} />
      <header className="page-header">
        <p className="eyebrow">IRL / external — statistics only</p>
        <h1>Track IRL bet</h1>
        <p className="muted">
          Record a wager you placed elsewhere in units. This app never places the wager and IRL
          results never affect your virtual bankroll.
        </p>
      </header>
      {query.notice ? (
        <p className="notice" role="status" aria-live="polite">
          {query.notice}
        </p>
      ) : null}
      {wagerError || groupError || summaryResult.error ? (
        <p className="notice error" role="alert">
          Some external-wager data is temporarily unavailable. Your external records were not
          changed.
        </p>
      ) : null}

      <section className="stats-grid irl-stats" aria-label="IRL performance summary">
        <div className="card">
          <small>Settled IRL wagers</small>
          <strong>{summary.totalSettled}</strong>
        </div>
        <div className="card">
          <small>Record</small>
          <strong>
            {summary.wins}-{summary.losses}-{summary.pushes}
          </strong>
        </div>
        <div className="card">
          <small>Units wagered</small>
          <strong>{summary.unitsWagered}</strong>
        </div>
        <div className="card">
          <small>Net units</small>
          <strong>{summary.netUnits}</strong>
        </div>
        <div className="card">
          <small>ROI</small>
          <strong>{summary.roiPercent}%</strong>
        </div>
      </section>

      <section className="card track-form-card">
        <h2>Record an external straight wager</h2>
        <form action={createExternalWager} className="form-stack" encType="multipart/form-data">
          <div className="form-grid">
            <label>
              Sportsbook
              <select name="sportsbookId" defaultValue="fanduel">
                <option value="fanduel">FanDuel</option>
                <option value="draftkings">DraftKings</option>
                <option value="betmgm">BetMGM</option>
                <option value="caesars">Caesars</option>
                <option value="other">Other sportsbook</option>
              </select>
            </label>
            <label>
              Other sportsbook name
              <input
                name="otherSportsbookName"
                maxLength={80}
                placeholder="Only when Other is selected"
              />
            </label>
            <label>
              Competition
              <select name="competitionKey" defaultValue="epl">
                {coreCompetitions.map((competition) => (
                  <option key={competition.id} value={competition.id}>
                    {competition.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sport
              <select name="sportKey" defaultValue="soccer">
                <option value="soccer">Soccer</option>
                <option value="football">Football</option>
                <option value="basketball">Basketball</option>
                <option value="hockey">Hockey</option>
              </select>
            </label>
            <label className="form-wide">
              Event or matchup
              <input
                name="eventDescription"
                minLength={2}
                maxLength={200}
                placeholder="Chelsea at Arsenal"
                required
              />
            </label>
            <label>
              Event date
              <input name="eventDate" type="datetime-local" required />
            </label>
            <label>
              Wager date
              <input name="wagerDate" type="datetime-local" defaultValue={nowLocal} required />
            </label>
            <label>
              Selection
              <input name="selection" maxLength={120} placeholder="Arsenal" required />
            </label>
            <label>
              Market
              <select name="marketType" defaultValue="moneyline">
                <option value="moneyline">Moneyline</option>
                <option value="spread">Spread</option>
                <option value="total">Total</option>
              </select>
            </label>
            <label>
              Line
              <input
                name="line"
                type="number"
                step="0.0001"
                placeholder="Required for spread or total"
              />
            </label>
            <label>
              American odds
              <input name="americanOdds" type="number" step="1" placeholder="-110" required />
            </label>
            <label>
              Stake in units
              <input name="stake" inputMode="decimal" placeholder="1.00" required />
            </label>
            <label>
              Initial result
              <select name="status" defaultValue="open">
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="push">Push</option>
                <option value="void">Void</option>
              </select>
            </label>
            <label>
              Verification
              <select name="verificationStatus" defaultValue="unverified">
                <option value="unverified">Unverified</option>
                <option value="user_attested">User attested</option>
              </select>
            </label>
            <label>
              Optional group
              <select name="groupId" defaultValue="">
                <option value="">Private — only me</option>
                {((groups ?? []) as Group[]).map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Optional screenshot
              <input name="screenshot" type="file" accept="image/jpeg,image/png,image/webp" />
            </label>
            <label className="form-wide">
              Notes
              <textarea name="userNotes" maxLength={2000} rows={3} />
            </label>
          </div>
          <small className="muted">
            Screenshots are private, limited to JPEG, PNG, or WebP, and capped at 5 MB. No OCR or
            image interpretation is performed.
          </small>
          <SubmitButton pendingLabel="Saving external wager…">Save external wager</SubmitButton>
        </form>
      </section>

      <section className="card track-form-card">
        <h2>Record an external parlay</h2>
        <p className="muted">
          Capture the accepted combined price and each normalized leg. Push and void adjustments use
          the surviving leg prices.
        </p>
        <ExternalParlayForm
          groups={(groups ?? []) as Group[]}
          competitions={coreCompetitions.map((competition) => ({
            id: competition.id,
            name: competition.name,
            sport: competition.sport,
          }))}
          nowLocal={nowLocal}
        />
      </section>

      <section className="section-break">
        <div className="view-tabs">
          <Link className={view === "open" ? "pill active" : "pill"} href="/track-bet">
            Open IRL wagers
          </Link>
          <Link
            className={view === "history" ? "pill active" : "pill"}
            href="/track-bet?view=history"
          >
            Settled IRL history
          </Link>
        </div>
        <div className="ticket-list">
          {records.map((wager) => (
            <article className="card ticket-card" key={wager.id}>
              <div className="event-heading">
                <div>
                  <div className="ticket-meta">
                    <SourceBadge source="external" />
                    <TicketTypeBadge ticketType={wager.ticket_type} />
                  </div>
                  <h2>
                    {wager.ticket_type === "parlay"
                      ? `${wager.leg_count}-leg parlay`
                      : wager.event_description}
                  </h2>
                  <time dateTime={wager.event_date}>
                    {new Date(wager.event_date).toLocaleString()}
                  </time>
                </div>
                <StatusBadge status={wager.status} />
              </div>
              {wager.ticket_type === "parlay" ? (
                <div className="parlay-ticket-legs">
                  {wager.external_wager_legs
                    .sort((left, right) => left.leg_number - right.leg_number)
                    .map((leg) => (
                      <section className="parlay-ticket-leg" key={leg.id}>
                        <div className="section-heading">
                          <h3>
                            Leg {leg.leg_number}: {leg.event_description}
                          </h3>
                          <StatusBadge status={leg.result} />
                        </div>
                        <p>
                          {leg.competition_name} · {leg.selection}
                          {leg.line === null ? "" : ` ${leg.line > 0 ? "+" : ""}${leg.line}`} ·{" "}
                          <MarketBadge market={leg.market_type} /> · {price(leg.american_odds)} (
                          {Number(leg.decimal_odds).toFixed(4)})
                        </p>
                        <time dateTime={leg.event_date}>
                          {new Date(leg.event_date).toLocaleString()}
                        </time>
                      </section>
                    ))}
                </div>
              ) : null}
              <dl className="ticket-details compact">
                <div>
                  <dt>Selection</dt>
                  <dd>
                    {wager.selection}
                    {wager.line === null ? "" : ` ${wager.line > 0 ? "+" : ""}${wager.line}`}
                  </dd>
                </div>
                <div>
                  <dt>Market</dt>
                  <dd>
                    <MarketBadge market={wager.market_type} />
                  </dd>
                </div>
                <div>
                  <dt>Sportsbook</dt>
                  <dd>{wager.sportsbook_name}</dd>
                </div>
                <div>
                  <dt>{wager.ticket_type === "parlay" ? "Original combined odds" : "Odds"}</dt>
                  <dd>
                    {price(wager.american_odds)} ({Number(wager.decimal_odds).toFixed(4)})
                  </dd>
                </div>
                <div>
                  <dt>Stake</dt>
                  <dd>{units(wager.stake_units)} units</dd>
                </div>
                <div>
                  <dt>Profit / loss</dt>
                  <dd>{units(wager.profit_loss_units)} units</dd>
                </div>
                <div>
                  <dt>Effective settlement odds</dt>
                  <dd>
                    {wager.effective_settlement_decimal_odds === null
                      ? "—"
                      : wager.effective_settlement_american_odds === null
                        ? Number(wager.effective_settlement_decimal_odds).toFixed(4)
                        : `${price(wager.effective_settlement_american_odds)} (${Number(wager.effective_settlement_decimal_odds).toFixed(4)})`}
                  </dd>
                </div>
                <div>
                  <dt>Final return</dt>
                  <dd>
                    {wager.settled_return_units === null
                      ? "—"
                      : `${units(wager.settled_return_units)} units`}
                  </dd>
                </div>
                <div>
                  <dt>Verification</dt>
                  <dd>{wager.verification_status.replace("_", " ")}</dd>
                </div>
                <div>
                  <dt>Wager date</dt>
                  <dd>{new Date(wager.wager_date).toLocaleString()}</dd>
                </div>
              </dl>
              {wager.user_notes ? <p>{wager.user_notes}</p> : null}
              {wager.screenshot_path ? (
                <p>
                  <Link href={`/track-bet/screenshot/${wager.id}`} target="_blank">
                    View private screenshot
                  </Link>
                </p>
              ) : null}
              {wager.ticket_type === "parlay" ? (
                <ExternalParlayResultForm
                  wagerId={wager.id}
                  status={wager.status}
                  legs={wager.external_wager_legs.map((leg) => ({
                    legNumber: leg.leg_number,
                    result: leg.result,
                  }))}
                />
              ) : (
                <form action={setExternalWagerResult} className="result-form">
                  <input type="hidden" name="wagerId" value={wager.id} />
                  <label>
                    Result
                    <select name="status" defaultValue={wager.status}>
                      <option value="open">Open</option>
                      <option value="won">Won</option>
                      <option value="lost">Lost</option>
                      <option value="push">Push</option>
                      <option value="void">Void</option>
                    </select>
                  </label>
                  <SubmitButton className="button secondary" pendingLabel="Updating result…">
                    Update result
                  </SubmitButton>
                </form>
              )}
            </article>
          ))}
          {!records.length ? (
            <p className="empty-state">
              No {view === "open" ? "open" : "settled"} external wagers yet.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
