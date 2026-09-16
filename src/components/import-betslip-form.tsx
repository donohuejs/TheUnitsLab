"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { SubmitButton } from "@/components/submit-button";
import { createImportedWager } from "@/app/track-bet/actions";
import { toDateTimeLocalValue } from "@/lib/time";

type Group = { id: string; name: string };
type Competition = { id: string; name: string; sport: string };
type ImportMethod = "screenshot" | "paste" | "entry";
type Duplicate = {
  wager_id: string;
  sportsbook_name: string;
  wager_date: string;
  duplicate_signal: string;
};

type Draft = {
  sportsbookId: string;
  otherSportsbookName: string;
  sportKey: string;
  competitionKey: string;
  eventDescription: string;
  eventDate: string;
  wagerDate: string;
  selection: string;
  selectionKey: string;
  marketType: string;
  line: string;
  americanOdds: string;
  stakeDollars: string;
  returnDollars: string;
  sportsbookBetId: string;
  providerEventId: string;
  groupId: string;
  userNotes: string;
  rawText: string;
};

const inputClass = "form-wide";
const subscribeToClock = () => () => {};
const getBrowserNow = () => toDateTimeLocalValue(new Date());

export function ImportBetslipForm({
  groups,
  competitions,
  nowLocal,
}: {
  groups: Group[];
  competitions: Competition[];
  nowLocal: string;
}) {
  const [method, setMethod] = useState<ImportMethod>("entry");
  const [reviewing, setReviewing] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [screenshotName, setScreenshotName] = useState("");
  const [draft, setDraft] = useState<Draft>({
    sportsbookId: "fanduel",
    otherSportsbookName: "",
    sportKey: "soccer",
    competitionKey: competitions[0]?.id ?? "epl",
    eventDescription: "",
    eventDate: "",
    wagerDate: nowLocal,
    selection: "",
    selectionKey: "",
    marketType: "moneyline",
    line: "",
    americanOdds: "",
    stakeDollars: "",
    returnDollars: "",
    sportsbookBetId: "",
    providerEventId: "",
    groupId: "",
    userNotes: "",
    rawText: "",
  });

  const browserNowSnapshot = useMemo(() => getBrowserNow, []);
  const browserNow = useSyncExternalStore(subscribeToClock, browserNowSnapshot, () => nowLocal);
  const effectiveWagerDate = draft.wagerDate === nowLocal ? browserNow : draft.wagerDate;

  const set = (field: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  async function reviewDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckingDuplicates(true);
    try {
      const response = await fetch("/api/import-betslip/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sportsbookId: draft.sportsbookId,
          sportsbookBetId: draft.sportsbookBetId,
          wagerDate: effectiveWagerDate,
          stakeDollars: draft.stakeDollars,
          americanOdds: draft.americanOdds,
          eventDescription: draft.eventDescription,
        }),
      });
      const payload = (await response.json()) as { duplicates?: Duplicate[] };
      setDuplicates(payload.duplicates ?? []);
    } catch {
      setDuplicates([]);
    } finally {
      setCheckingDuplicates(false);
      setReviewing(true);
    }
  }

  const competitionOptions = competitions.filter(
    (competition) => competition.sport === draft.sportKey,
  );

  return (
    <form
      action={createImportedWager}
      className="form-stack import-betslip-form"
      encType="multipart/form-data"
      onSubmit={reviewing ? undefined : reviewDraft}
    >
      <input type="hidden" name="confirmed" value={reviewing ? "true" : "false"} />
      <input type="hidden" name="importMethod" value={method} />
      <input
        type="hidden"
        name="eventDateUtc"
        value={toDateTimeLocalValue(draft.eventDate) ? new Date(draft.eventDate).toISOString() : ""}
      />
      <input
        type="hidden"
        name="wagerDateUtc"
        value={
          toDateTimeLocalValue(effectiveWagerDate) ? new Date(effectiveWagerDate).toISOString() : ""
        }
      />
      <div className="import-methods" aria-label="Import entry path">
        {(
          [
            ["screenshot", "Upload Screenshot"],
            ["paste", "Paste Bet Text"],
            ["entry", "Enter Manually"],
          ] as const
        ).map(([value, label]) => (
          <button
            className={method === value ? "pill active" : "pill"}
            key={value}
            type="button"
            onClick={() => {
              setMethod(value);
              setReviewing(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {method === "screenshot" ? (
        <div className="notice">
          <strong>Private screenshot review</strong>
          <p>
            The image stays in the private screenshot bucket. Automated extraction is intentionally
            not guessed; review and edit the draft fields below before saving.
          </p>
          <label>
            Betslip screenshot
            <input
              name="screenshot"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required={!reviewing}
              onChange={(event) => setScreenshotName(event.target.files?.[0]?.name ?? "")}
            />
          </label>
          {screenshotName ? (
            <p className="screenshot-ready" role="status">
              Screenshot attached: {screenshotName}. It will stay private and be associated with the
              imported wager after confirmation.
            </p>
          ) : (
            <p className="muted">Choose an image to attach it to the editable review draft.</p>
          )}
        </div>
      ) : null}
      {method === "paste" ? (
        <label className={inputClass}>
          Bet text draft
          <textarea
            name="rawText"
            value={draft.rawText}
            onChange={(event) => set("rawText", event.target.value)}
            rows={5}
            placeholder="Paste the betslip text here, then review the normalized fields below."
          />
        </label>
      ) : null}

      <div className="form-grid">
        <label>
          Sportsbook
          <select
            name="sportsbookId"
            value={draft.sportsbookId}
            onChange={(event) => set("sportsbookId", event.target.value)}
          >
            <option value="fanduel">FanDuel</option>
            <option value="draftkings">DraftKings</option>
            <option value="betmgm">BetMGM</option>
            <option value="caesars">Caesars</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Other sportsbook name
          <input
            name="otherSportsbookName"
            value={draft.otherSportsbookName}
            onChange={(event) => set("otherSportsbookName", event.target.value)}
          />
        </label>
        <label>
          Sport
          <select
            name="sportKey"
            value={draft.sportKey}
            onChange={(event) => {
              set("sportKey", event.target.value);
              set(
                "competitionKey",
                competitions.find((item) => item.sport === event.target.value)?.id ?? "",
              );
            }}
          >
            <option value="soccer">Soccer</option>
            <option value="football">Football</option>
            <option value="basketball">Basketball</option>
            <option value="hockey">Hockey</option>
          </select>
        </label>
        <label>
          Competition
          <select
            name="competitionKey"
            value={draft.competitionKey}
            onChange={(event) => set("competitionKey", event.target.value)}
          >
            {competitionOptions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
              </option>
            ))}
          </select>
        </label>
        <label className={inputClass}>
          Event or teams
          <input
            name="eventDescription"
            value={draft.eventDescription}
            onChange={(event) => set("eventDescription", event.target.value)}
            required
          />
        </label>
        <label>
          Event date and time
          <input
            name="eventDate"
            type="datetime-local"
            value={draft.eventDate}
            onChange={(event) => set("eventDate", event.target.value)}
            required
          />
        </label>
        <label>
          Canonical event ID (optional)
          <input
            name="providerEventId"
            value={draft.providerEventId}
            onChange={(event) => set("providerEventId", event.target.value)}
            maxLength={160}
            placeholder="Use the provider event ID when known"
          />
          <small className="muted">A matched canonical event can settle automatically.</small>
        </label>
        <label>
          Wager date and time
          <input
            name="wagerDate"
            type="datetime-local"
            value={effectiveWagerDate}
            onChange={(event) => set("wagerDate", event.target.value)}
            required
          />
        </label>
        <label>
          Market
          <select
            name="marketType"
            value={draft.marketType}
            onChange={(event) => set("marketType", event.target.value)}
          >
            <option value="moneyline">Moneyline</option>
            <option value="spread">Spread</option>
            <option value="total">Total</option>
          </select>
        </label>
        <label>
          Selection
          <input
            name="selection"
            value={draft.selection}
            onChange={(event) => set("selection", event.target.value)}
            required
          />
        </label>
        <label>
          Grading side
          <select
            name="selectionKey"
            value={draft.selectionKey}
            onChange={(event) => set("selectionKey", event.target.value)}
          >
            <option value="">Needs review</option>
            <option value="home">Home</option>
            <option value="away">Away</option>
            <option value="draw">Draw</option>
            <option value="over">Over</option>
            <option value="under">Under</option>
          </select>
        </label>
        <label>
          Line
          <input
            name="line"
            type="number"
            step="0.0001"
            value={draft.line}
            onChange={(event) => set("line", event.target.value)}
            placeholder="Required for spread/total"
          />
        </label>
        <label>
          Odds (American)
          <input
            name="americanOdds"
            type="number"
            step="1"
            value={draft.americanOdds}
            onChange={(event) => set("americanOdds", event.target.value)}
            required
          />
        </label>
        <label>
          Stake (USD)
          <input
            name="stakeDollars"
            inputMode="decimal"
            value={draft.stakeDollars}
            onChange={(event) => set("stakeDollars", event.target.value)}
            required
          />
        </label>
        <label>
          Return / payout (USD)
          <input
            name="returnDollars"
            inputMode="decimal"
            value={draft.returnDollars}
            onChange={(event) => set("returnDollars", event.target.value)}
            placeholder="Optional source value"
          />
        </label>
        <label>
          Sportsbook bet ID
          <input
            name="sportsbookBetId"
            value={draft.sportsbookBetId}
            onChange={(event) => set("sportsbookBetId", event.target.value)}
          />
        </label>
        <label>
          Initial status
          <select name="status" defaultValue="open">
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="push">Push</option>
            <option value="void">Void</option>
          </select>
        </label>
        <label>
          Optional group
          <select
            name="groupId"
            value={draft.groupId}
            onChange={(event) => set("groupId", event.target.value)}
          >
            <option value="">Private — only me</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label className={inputClass}>
          Notes
          <textarea
            name="userNotes"
            value={draft.userNotes}
            onChange={(event) => set("userNotes", event.target.value)}
            rows={3}
            maxLength={2000}
          />
        </label>
      </div>

      <p className="muted import-normalization-note">
        Normalization preview: {draft.stakeDollars || "0.00"} USD = {draft.stakeDollars || "0.00"}{" "}
        Vials. Source-dollar values remain attached to the imported record for audit and display.
      </p>

      {reviewing ? (
        <section className="notice review-panel" aria-label="Review imported betslip">
          <h3>Review draft before saving</h3>
          <p>
            Nothing has been saved yet. Confirm the editable fields above, then choose the final
            action.
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
        <SubmitButton pendingLabel="Preparing review…">Review draft</SubmitButton>
      )}
    </form>
  );
}
