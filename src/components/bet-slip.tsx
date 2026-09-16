"use client";

import { useEffect, useMemo, useState } from "react";

import { placeParlayBet, placeStraightBet } from "@/app/sports/bet-actions";
import { SubmitButton } from "@/components/submit-button";
import { MarketBadge, SourceBadge, TicketTypeBadge } from "@/components/status-badge";
import { calculateParlayPotential } from "@/lib/parlays/calculations";
import { calculatePotential } from "@/lib/wagers/calculations";

type Selection = {
  competitionKey: string;
  eventId: string;
  sport: string;
  competition: string;
  event: string;
  scheduledStart: string;
  homeTeam: string;
  awayTeam: string;
  bookmakerId: string;
  bookmaker: string;
  marketType: "moneyline" | "spread" | "total";
  selection: "home" | "away" | "draw" | "over" | "under";
  selectionName: string;
  line: number | null;
  americanOdds: number;
  decimalOdds: number;
};

type Props = Selection & { groups: { id: string; name: string }[] };
type StoredLeg = Selection;

const STORAGE_KEY = "sportsbook-simulator:phase7-parlay";
const americanPrice = (value: number) => (value > 0 ? `+${value}` : String(value));

function legKey(leg: StoredLeg) {
  return `${leg.eventId}|${leg.bookmakerId}|${leg.marketType}|${leg.selection}|${leg.line ?? ""}`;
}

export function BetSlip(props: Props) {
  const [stake, setStake] = useState("10.00");
  const [parlayStake, setParlayStake] = useState("10.00");
  const [legs, setLegs] = useState<StoredLeg[]>([]);
  const [parlayNotice, setParlayNotice] = useState("");
  const selection: Selection = props;

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredLeg[];
        if (Array.isArray(saved)) setLegs(saved.slice(0, 12));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, []);

  function persist(next: StoredLeg[]) {
    setLegs(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function addCurrentLeg() {
    if (legs.length >= 12) return setParlayNotice("A parlay can contain at most 12 legs.");
    if (legs.some((leg) => leg.eventId === selection.eventId)) {
      return setParlayNotice("Same-event combinations are not supported in Phase 7.");
    }
    if (legs.length && legs[0].bookmakerId !== selection.bookmakerId) {
      return setParlayNotice("All simulated parlay legs must use the same bookmaker.");
    }
    if (legs.some((leg) => legKey(leg) === legKey(selection))) {
      return setParlayNotice("That selection is already in the parlay.");
    }
    persist([...legs, selection]);
    setParlayNotice("Selection added to the parlay.");
  }

  const straightPotential = useMemo(() => {
    try {
      return calculatePotential(stake, props.decimalOdds.toFixed(4));
    } catch {
      return null;
    }
  }, [props.decimalOdds, stake]);
  const parlayPotential = useMemo(() => {
    try {
      return legs.length >= 2
        ? calculateParlayPotential(
            parlayStake,
            legs.map((leg) => leg.decimalOdds.toFixed(4)),
          )
        : null;
    } catch {
      return null;
    }
  }, [legs, parlayStake]);
  const submittedLegs = legs.map((leg) => ({
    competitionKey: leg.competitionKey,
    eventId: leg.eventId,
    bookmakerId: leg.bookmakerId,
    marketType: leg.marketType,
    selection: leg.selection,
    expectedAmericanOdds: leg.americanOdds,
    expectedLine: leg.line,
  }));

  return (
    <aside className="bet-slip-stack" aria-label="Simulated bet slips">
      <section className="card bet-slip">
        <div className="ticket-meta">
          <SourceBadge source="simulated" />
          <TicketTypeBadge ticketType="straight" />
        </div>
        <h2>One straight selection</h2>
        <p className="simulation-label">Virtual units only. No real-money wager is placed.</p>
        <dl className="ticket-details">
          <div>
            <dt>Competition</dt>
            <dd>{props.competition}</dd>
          </div>
          <div>
            <dt>Event</dt>
            <dd>{props.event}</dd>
          </div>
          <div>
            <dt>Bookmaker</dt>
            <dd>{props.bookmaker}</dd>
          </div>
          <div>
            <dt>Market</dt>
            <dd>
              <MarketBadge market={props.marketType} />
            </dd>
          </div>
          <div>
            <dt>Selection</dt>
            <dd>
              {props.selectionName}
              {props.line === null ? "" : ` ${props.line > 0 ? "+" : ""}${props.line}`}
            </dd>
          </div>
          <div>
            <dt>Odds</dt>
            <dd>
              {americanPrice(props.americanOdds)} ({props.decimalOdds.toFixed(4)})
            </dd>
          </div>
        </dl>
        <button className="button secondary" type="button" onClick={addCurrentLeg}>
          Add this selection to parlay
        </button>
        <form action={placeStraightBet} className="form-stack">
          <input type="hidden" name="competitionKey" value={props.competitionKey} />
          <input type="hidden" name="eventId" value={props.eventId} />
          <input type="hidden" name="bookmakerId" value={props.bookmakerId} />
          <input type="hidden" name="marketType" value={props.marketType} />
          <input type="hidden" name="selection" value={props.selection} />
          <input type="hidden" name="expectedAmericanOdds" value={props.americanOdds} />
          <input type="hidden" name="expectedLine" value={props.line ?? ""} />
          <label>
            Stake in virtual units
            <input
              name="stake"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required
              value={stake}
              onChange={(event) => setStake(event.target.value)}
            />
          </label>
          {props.groups.length ? (
            <label>
              Group association (optional)
              <select name="groupId" defaultValue="">
                <option value="">No group</option>
                {props.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="groupId" value="" />
          )}
          <div className="potential-grid" aria-live="polite">
            <span>
              Potential profit{" "}
              <strong>{straightPotential ? `${straightPotential.profit} units` : "—"}</strong>
            </span>
            <span>
              Potential return{" "}
              <strong>{straightPotential ? `${straightPotential.return} units` : "—"}</strong>
            </span>
          </div>
          <SubmitButton
            pendingLabel="Placing straight…"
            className="button"
            disabled={!straightPotential}
          >
            Place simulated straight
          </SubmitButton>
        </form>
      </section>

      <section className="card bet-slip">
        <div className="ticket-meta">
          <SourceBadge source="simulated" />
          <TicketTypeBadge ticketType="parlay" />
        </div>
        <h2>{legs.length} of 12 legs</h2>
        <p className="muted">
          Use 2–12 distinct events from one bookmaker. Selections stay in this browser while you
          move between competitions.
        </p>
        {parlayNotice ? <p className="notice">{parlayNotice}</p> : null}
        <ol className="parlay-leg-list">
          {legs.map((leg, index) => (
            <li key={legKey(leg)}>
              <div>
                <strong>
                  {leg.selectionName}
                  {leg.line === null ? "" : ` ${leg.line > 0 ? "+" : ""}${leg.line}`}
                </strong>
                <small>
                  {leg.event} · {leg.bookmaker} · {americanPrice(leg.americanOdds)}
                </small>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => persist(legs.filter((_, candidate) => candidate !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        {!legs.length ? (
          <p className="empty-state">Add a displayed market selection to begin.</p>
        ) : null}
        <form action={placeParlayBet} className="form-stack">
          <input type="hidden" name="legs" value={JSON.stringify(submittedLegs)} />
          <label>
            Parlay stake in virtual units
            <input
              name="stake"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required
              value={parlayStake}
              onChange={(event) => setParlayStake(event.target.value)}
            />
          </label>
          {props.groups.length ? (
            <label>
              Group association (optional)
              <select name="groupId" defaultValue="">
                <option value="">No group</option>
                {props.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="groupId" value="" />
          )}
          <dl className="ticket-details compact">
            <div>
              <dt>Combined odds</dt>
              <dd>
                {parlayPotential
                  ? `${americanPrice(parlayPotential.americanOdds)} (${parlayPotential.decimalOdds})`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Potential profit</dt>
              <dd>{parlayPotential ? `${parlayPotential.profit} units` : "—"}</dd>
            </div>
            <div>
              <dt>Potential return</dt>
              <dd>{parlayPotential ? `${parlayPotential.return} units` : "—"}</dd>
            </div>
          </dl>
          <SubmitButton
            pendingLabel="Placing parlay…"
            className="button"
            disabled={!parlayPotential}
          >
            Place simulated parlay
          </SubmitButton>
          {legs.length ? (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                persist([]);
                setParlayNotice("Parlay slip cleared.");
              }}
            >
              Clear parlay
            </button>
          ) : null}
        </form>
      </section>
    </aside>
  );
}
