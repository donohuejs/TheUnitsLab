"use client";

import { useState } from "react";

import { createExternalParlay } from "@/app/track-bet/actions";
import { SubmitButton } from "@/components/submit-button";

type Competition = { id: string; name: string; sport: "soccer" | "football" | "basketball" };
type Group = { id: string; name: string };
type Leg = {
  competitionKey: string;
  eventDescription: string;
  eventDate: string;
  selection: string;
  marketType: "moneyline" | "spread" | "total";
  line: string;
  americanOdds: string;
  result: "open" | "won" | "lost" | "push" | "void";
};

const emptyLeg = (competitionKey: string): Leg => ({
  competitionKey,
  eventDescription: "",
  eventDate: "",
  selection: "",
  marketType: "moneyline",
  line: "",
  americanOdds: "",
  result: "open",
});

export function ExternalParlayForm({
  groups,
  competitions,
  nowLocal,
}: {
  groups: Group[];
  competitions: Competition[];
  nowLocal: string;
}) {
  const [legs, setLegs] = useState<Leg[]>([
    emptyLeg(competitions[0]?.id ?? "epl"),
    emptyLeg(competitions[0]?.id ?? "epl"),
  ]);
  function update(index: number, patch: Partial<Leg>) {
    setLegs((current) =>
      current.map((leg, candidate) => (candidate === index ? { ...leg, ...patch } : leg)),
    );
  }
  const payload = legs.map((leg) => {
    const competition = competitions.find((candidate) => candidate.id === leg.competitionKey)!;
    return {
      sportKey: competition?.sport,
      competitionKey: leg.competitionKey,
      eventDescription: leg.eventDescription,
      eventDate: leg.eventDate,
      selection: leg.selection,
      marketType: leg.marketType,
      line: leg.line === "" ? null : Number(leg.line),
      americanOdds: Number(leg.americanOdds),
      result: leg.result,
    };
  });
  return (
    <form action={createExternalParlay} className="form-stack" encType="multipart/form-data">
      <input type="hidden" name="legs" value={JSON.stringify(payload)} />
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
          Accepted combined American odds
          <input name="combinedAmericanOdds" type="number" step="1" placeholder="+450" required />
        </label>
        <label>
          Stake in units
          <input name="stake" inputMode="decimal" placeholder="1.00" required />
        </label>
        <label>
          Wager date
          <input name="wagerDate" type="datetime-local" defaultValue={nowLocal} required />
        </label>
        <label>
          Ticket result
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
            {groups.map((group) => (
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
      <div className="external-leg-editor">
        {legs.map((leg, index) => (
          <fieldset className="parlay-leg-fieldset" key={index}>
            <legend>Leg {index + 1}</legend>
            <div className="form-grid">
              <label>
                Competition
                <select
                  value={leg.competitionKey}
                  onChange={(event) => update(index, { competitionKey: event.target.value })}
                >
                  {competitions.map((competition) => (
                    <option key={competition.id} value={competition.id}>
                      {competition.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Event or matchup
                <input
                  value={leg.eventDescription}
                  onChange={(event) => update(index, { eventDescription: event.target.value })}
                  minLength={2}
                  maxLength={200}
                  required
                />
              </label>
              <label>
                Event date
                <input
                  type="datetime-local"
                  value={leg.eventDate}
                  onChange={(event) => update(index, { eventDate: event.target.value })}
                  required
                />
              </label>
              <label>
                Selection
                <input
                  value={leg.selection}
                  onChange={(event) => update(index, { selection: event.target.value })}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Market
                <select
                  value={leg.marketType}
                  onChange={(event) =>
                    update(index, {
                      marketType: event.target.value as Leg["marketType"],
                      line: event.target.value === "moneyline" ? "" : leg.line,
                    })
                  }
                >
                  <option value="moneyline">Moneyline</option>
                  <option value="spread">Spread</option>
                  <option value="total">Total</option>
                </select>
              </label>
              <label>
                Line
                <input
                  type="number"
                  step="0.0001"
                  value={leg.line}
                  onChange={(event) => update(index, { line: event.target.value })}
                  placeholder="Spread/total only"
                />
              </label>
              <label>
                American odds
                <input
                  type="number"
                  step="1"
                  value={leg.americanOdds}
                  onChange={(event) => update(index, { americanOdds: event.target.value })}
                  placeholder="-110"
                  required
                />
              </label>
              <label>
                Leg result
                <select
                  value={leg.result}
                  onChange={(event) =>
                    update(index, { result: event.target.value as Leg["result"] })
                  }
                >
                  <option value="open">Open</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="push">Push</option>
                  <option value="void">Void</option>
                </select>
              </label>
            </div>
            {legs.length > 2 ? (
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setLegs((current) => current.filter((_, candidate) => candidate !== index))
                }
              >
                Remove leg
              </button>
            ) : null}
          </fieldset>
        ))}
      </div>
      <div className="inline-actions">
        <button
          className="button secondary"
          type="button"
          disabled={legs.length >= 12}
          onClick={() => setLegs((current) => [...current, emptyLeg(competitions[0]?.id ?? "epl")])}
        >
          Add leg
        </button>
        <SubmitButton pendingLabel="Saving external parlay…">Save external parlay</SubmitButton>
      </div>
      <small className="muted">
        The app records a wager placed elsewhere. It never submits it to a sportsbook or changes the
        virtual bankroll.
      </small>
    </form>
  );
}
