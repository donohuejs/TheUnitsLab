"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import { placeParlayBet, placeStraightBet } from "@/app/sports/bet-actions";
import { KickoffTime } from "@/components/kickoff-time";
import { SubmitButton } from "@/components/submit-button";
import { MarketBadge, SourceBadge, TicketTypeBadge } from "@/components/status-badge";
import { TeamMark } from "@/components/team-mark";
import { calculateParlayPotential } from "@/lib/parlays/calculations";
import {
  clearSlip,
  getEmptySlipSnapshot,
  getSlipSnapshot,
  setSlipSelections,
  slipSelectionKey,
  subscribeToSlip,
  type SlipSelection,
} from "@/lib/wagers/slip";
import { calculatePotential } from "@/lib/wagers/calculations";

type Props = {
  selection: SlipSelection | null;
  groups: { id: string; name: string }[];
};

const americanPrice = (value: number) => (value > 0 ? `+${value}` : String(value));

export function BetSlip({ selection, groups }: Props) {
  const [stake, setStake] = useState("10.00");
  const [parlayStake, setParlayStake] = useState("10.00");
  const [parlayNotice, setParlayNotice] = useState("");
  const legs = useSyncExternalStore(subscribeToSlip, getSlipSnapshot, getEmptySlipSnapshot);

  function addCurrentLeg() {
    if (!selection) {
      setParlayNotice("Select a price first, then add it to the parlay.");
      return;
    }
    if (legs.length >= 12) {
      setParlayNotice("A parlay can contain at most 12 legs.");
      return;
    }
    if (legs.some((leg) => leg.eventId === selection.eventId)) {
      setParlayNotice(
        "Same-game parlay (SGP) pricing is not currently supported; choose a different event.",
      );
      return;
    }
    if (legs.length && legs[0].bookmakerId !== selection.bookmakerId) {
      setParlayNotice("All simulated parlay legs must use the same bookmaker.");
      return;
    }
    if (legs.some((leg) => slipSelectionKey(leg) === slipSelectionKey(selection))) {
      setParlayNotice("That selection is already in the parlay.");
      return;
    }
    setSlipSelections([...legs, selection]);
    setParlayNotice("Selection added to the parlay.");
  }

  const straightPotential = useMemo(() => {
    if (!selection) return null;
    try {
      return calculatePotential(stake, selection.decimalOdds.toFixed(4));
    } catch {
      return null;
    }
  }, [selection, stake]);

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
      {selection ? (
        <section className="card bet-slip">
          <div className="ticket-meta">
            <SourceBadge source="simulated" />
            <TicketTypeBadge ticketType="straight" />
          </div>
          <h2>Straight bet — one leg</h2>
          <p className="simulation-label">Virtual Vials only. No real-money wager is placed.</p>
          <dl className="ticket-details">
            <div>
              <dt>Competition</dt>
              <dd>{selection.competition}</dd>
            </div>
            <div>
              <dt>Event</dt>
              <dd className="team-pair">
                <span>
                  <TeamMark teamName={selection.awayTeam} sport={selection.sport} />
                  {selection.awayTeam}
                </span>
                <span className="event-at">at</span>
                <span>
                  <TeamMark teamName={selection.homeTeam} sport={selection.sport} />
                  {selection.homeTeam}
                </span>
              </dd>
            </div>
            <div>
              <dt>Kickoff</dt>
              <dd>
                <KickoffTime value={selection.scheduledStart} />
              </dd>
            </div>
            <div>
              <dt>Bookmaker</dt>
              <dd>{selection.bookmaker}</dd>
            </div>
            <div>
              <dt>Market</dt>
              <dd>
                <MarketBadge market={selection.marketType} />
              </dd>
            </div>
            <div>
              <dt>Selection</dt>
              <dd>
                {selection.selectionName}
                {selection.line === null
                  ? ""
                  : ` ${selection.line > 0 ? "+" : ""}${selection.line}`}
              </dd>
            </div>
            <div>
              <dt>Odds</dt>
              <dd>
                {americanPrice(selection.americanOdds)} ({selection.decimalOdds.toFixed(4)})
              </dd>
            </div>
          </dl>
          <button className="button secondary" type="button" onClick={addCurrentLeg}>
            Add this selection to parlay
          </button>
          <form action={placeStraightBet} className="form-stack">
            <input type="hidden" name="competitionKey" value={selection.competitionKey} />
            <input type="hidden" name="eventId" value={selection.eventId} />
            <input type="hidden" name="bookmakerId" value={selection.bookmakerId} />
            <input type="hidden" name="marketType" value={selection.marketType} />
            <input type="hidden" name="selection" value={selection.selection} />
            <input type="hidden" name="expectedAmericanOdds" value={selection.americanOdds} />
            <input type="hidden" name="expectedLine" value={selection.line ?? ""} />
            <label>
              Stake in Vials
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
            {groups.length ? (
              <label>
                Group association (optional)
                <select name="groupId" defaultValue="">
                  <option value="">No group</option>
                  {groups.map((group) => (
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
                <strong>{straightPotential ? `${straightPotential.profit} Vials` : "—"}</strong>
              </span>
              <span>
                Potential return{" "}
                <strong>{straightPotential ? `${straightPotential.return} Vials` : "—"}</strong>
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
      ) : null}

      <section className="card bet-slip">
        <div className="ticket-meta">
          <SourceBadge source="simulated" />
          <TicketTypeBadge ticketType="parlay" />
        </div>
        <h2>Build a parlay — {legs.length} of 12 legs</h2>
        <p className="muted">
          Add another eligible selection from a different event to make a standard multi-game
          parlay. Same-game parlay pricing is not supported because the provider does not supply a
          valid SGP price here.
        </p>
        {parlayNotice ? <p className="notice">{parlayNotice}</p> : null}
        <ol className="parlay-leg-list">
          {legs.map((leg, index) => (
            <li key={slipSelectionKey(leg)}>
              <div className="parlay-leg-copy">
                <strong>
                  <MarketBadge market={leg.marketType} /> {leg.selectionName}
                  {leg.line === null ? "" : ` ${leg.line > 0 ? "+" : ""}${leg.line}`}
                </strong>
                <small className="parlay-leg-context">
                  <span className="team-pair">
                    <TeamMark teamName={leg.awayTeam} sport={leg.sport} />
                    {leg.awayTeam} at <TeamMark teamName={leg.homeTeam} sport={leg.sport} />
                    {leg.homeTeam}
                  </span>
                  <span>
                    {leg.competition} · <KickoffTime value={leg.scheduledStart} />
                  </span>
                  <span>
                    {leg.bookmaker} · {americanPrice(leg.americanOdds)} (
                    {leg.decimalOdds.toFixed(4)})
                  </span>
                </small>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setSlipSelections(legs.filter((_, candidate) => candidate !== index))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        {!legs.length ? (
          <p className="empty-state">
            <strong>No selections yet</strong>
            Your parlay slip stays available while you switch competitions.
          </p>
        ) : null}
        <form action={placeParlayBet} className="form-stack">
          <input type="hidden" name="legs" value={JSON.stringify(submittedLegs)} />
          <input type="hidden" name="slipKeys" value={legs.map(slipSelectionKey).join(",")} />
          <label>
            Parlay stake in Vials
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
          {groups.length ? (
            <label>
              Group association (optional)
              <select name="groupId" defaultValue="">
                <option value="">No group</option>
                {groups.map((group) => (
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
              <dd>{parlayPotential ? `${parlayPotential.profit} Vials` : "—"}</dd>
            </div>
            <div>
              <dt>Potential return</dt>
              <dd>{parlayPotential ? `${parlayPotential.return} Vials` : "—"}</dd>
            </div>
          </dl>
          <small className="muted">
            Combined odds and payout are a preview only. The server rechecks every leg, price, line,
            bookmaker, and event before accepting the ticket.
          </small>
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
                clearSlip();
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
