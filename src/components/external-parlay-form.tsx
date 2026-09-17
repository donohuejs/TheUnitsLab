"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { createImportedParlay } from "@/app/track-bet/actions";
import { SubmitButton } from "@/components/submit-button";
import { toDateTimeLocalValue } from "@/lib/time";

type Competition = {
  id: string;
  name: string;
  sport: "soccer" | "football" | "basketball" | "hockey";
};
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
  providerEventId: string;
  selectionKey: "" | "home" | "away" | "draw" | "over" | "under";
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
  providerEventId: "",
  selectionKey: "",
});

const subscribeToClock = () => () => {};
const getBrowserNow = () => toDateTimeLocalValue(new Date());

function inferLegSelectionKey(
  leg: Pick<Leg, "selection" | "eventDescription" | "marketType">,
): Leg["selectionKey"] {
  const value = `${leg.selection} ${leg.eventDescription}`.toLowerCase();
  if (leg.marketType === "total") {
    if (/\bover\b/.test(value)) return "over";
    if (/\bunder\b/.test(value)) return "under";
  }
  if (/\bdraw\b|\btie\b/.test(value)) return "draw";
  const matchup = /(.+?)\s+at\s+(.+)/i.exec(leg.eventDescription);
  if (matchup) {
    const selection = leg.selection.trim().toLowerCase();
    if (selection === matchup[1].trim().toLowerCase()) return "away";
    if (selection === matchup[2].trim().toLowerCase()) return "home";
  }
  return "";
}

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
  const [reviewing, setReviewing] = useState(false);
  const [duplicates, setDuplicates] = useState<
    { wager_id: string; sportsbook_name: string; duplicate_signal: string }[]
  >([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [wagerDate, setWagerDate] = useState(nowLocal);
  const browserNowSnapshot = useMemo(() => getBrowserNow, []);
  const browserNow = useSyncExternalStore(subscribeToClock, browserNowSnapshot, () => nowLocal);
  const effectiveWagerDate = wagerDate === nowLocal ? browserNow : wagerDate;
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
      eventDate: toDateTimeLocalValue(leg.eventDate)
        ? new Date(leg.eventDate).toISOString()
        : leg.eventDate,
      selection: leg.selection,
      marketType: leg.marketType,
      line: leg.line === "" ? null : Number(leg.line),
      americanOdds: Number(leg.americanOdds),
      result: leg.result,
      providerEventId: leg.providerEventId,
      selectionKey: inferLegSelectionKey(leg),
    };
  });
  async function reviewDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setCheckingDuplicates(true);
    try {
      const response = await fetch("/api/import-betslip/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sportsbookId: formData.get("sportsbookId"),
          sportsbookBetId: formData.get("sportsbookBetId"),
          wagerDate: formData.get("wagerDate"),
          stakeDollars: formData.get("rawStakeDollars"),
          americanOdds: formData.get("combinedAmericanOdds"),
          eventDescription: legs
            .map((leg) => leg.eventDescription)
            .filter(Boolean)
            .join(" / "),
        }),
      });
      const responseBody = (await response.json()) as {
        duplicates?: { wager_id: string; sportsbook_name: string; duplicate_signal: string }[];
      };
      setDuplicates(responseBody.duplicates ?? []);
    } catch {
      setDuplicates([]);
    } finally {
      setCheckingDuplicates(false);
      setReviewing(true);
    }
  }
  return (
    <form
      action={createImportedParlay}
      className="form-stack"
      encType="multipart/form-data"
      onSubmit={reviewing ? undefined : reviewDraft}
    >
      <input type="hidden" name="confirmed" value={reviewing ? "true" : "false"} />
      <label>
        Import path
        <select name="importMethod" defaultValue="entry">
          <option value="screenshot">Upload Screenshot</option>
          <option value="paste">Paste Bet Text</option>
          <option value="entry">Enter Manually</option>
        </select>
      </label>
      <input type="hidden" name="legs" value={JSON.stringify(payload)} />
      <input
        type="hidden"
        name="wagerDateUtc"
        value={effectiveWagerDate ? new Date(effectiveWagerDate).toISOString() : ""}
      />
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
          Source stake (USD)
          <input name="rawStakeDollars" inputMode="decimal" placeholder="1.00" required />
        </label>
        <label>
          Source return / payout (USD)
          <input name="rawReturnDollars" inputMode="decimal" placeholder="Optional" />
        </label>
        <label>
          Wager date
          <input
            name="wagerDate"
            type="datetime-local"
            value={effectiveWagerDate}
            onChange={(event) => setWagerDate(event.target.value)}
            required
          />
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
          Sportsbook bet ID
          <input name="sportsbookBetId" maxLength={160} placeholder="Optional" />
        </label>
        <label>
          Optional Study
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
          Private screenshot
          <input name="screenshot" type="file" accept="image/jpeg,image/png,image/webp" />
        </label>
        <label className="form-wide">
          Pasted bet text
          <textarea name="rawText" maxLength={10000} rows={3} placeholder="Optional source text" />
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
              <label>
                Canonical event ID
                <input
                  value={leg.providerEventId}
                  onChange={(event) => update(index, { providerEventId: event.target.value })}
                  maxLength={160}
                  placeholder="Optional for matching"
                />
              </label>
              <div className="field-readout">
                <span>Your Pick</span>
                <strong>{inferLegSelectionKey(leg) || "Needs review"}</strong>
                <small>Inferred from the pick text and matchup.</small>
              </div>
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
        {reviewing ? (
          <section className="notice review-panel" aria-label="Review imported parlay">
            <h3>Review parlay draft before saving</h3>
            <p>
              Nothing has been saved yet. Confirm the editable ticket and legs, then choose the
              final action.
            </p>
            {checkingDuplicates ? <p>Checking for likely duplicates…</p> : null}
            {duplicates.length ? (
              <div className="duplicate-warning" role="alert">
                <strong>Likely duplicate import</strong>
                <ul>
                  {duplicates.map((duplicate) => (
                    <li key={duplicate.wager_id}>
                      {duplicate.sportsbook_name} · {duplicate.duplicate_signal}
                    </li>
                  ))}
                </ul>
                <div className="inline-actions">
                  <a className="button secondary" href="/my-bets?filter=imported">
                    View existing
                  </a>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setReviewing(false);
                      setDuplicates([]);
                    }}
                  >
                    Cancel
                  </button>
                  <SubmitButton pendingLabel="Importing…">Import anyway</SubmitButton>
                </div>
              </div>
            ) : (
              <SubmitButton pendingLabel="Importing…">Confirm and save to My Bets</SubmitButton>
            )}
          </section>
        ) : (
          <SubmitButton pendingLabel="Preparing review…">Review parlay draft</SubmitButton>
        )}
      </div>
      <small className="muted">
        Source-dollar values remain attached to the imported record. Screenshots stay private, and
        imported bets never change the simulated Vial balance.
      </small>
    </form>
  );
}
