"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { createImportedWager } from "@/app/track-bet/actions";
import { CachedEventSearch, type CachedEvent } from "@/components/cached-event-search";
import { SubmitButton } from "@/components/submit-button";
import { calculateImportedEconomics } from "@/lib/external-wagers/calculations";
import {
  extractBetslip,
  parseBetslipText,
  type BetslipDraftFields,
  type ExtractedBetslip,
} from "@/lib/betslip/extraction";
import { toDateTimeLocalValue } from "@/lib/time";

type Group = { id: string; name: string };
type Competition = { id: string; name: string; sport: string };
type CanonicalEvent = CachedEvent;
type ImportMethod = "screenshot" | "paste" | "entry";
type Step = "source" | "event" | "market" | "economics";
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
  status: string;
  userNotes: string;
  rawText: string;
};

type EconomicField = "stakeDollars" | "americanOdds" | "returnDollars";
type AutoEconomicField = "stake" | "odds" | "return";

const autoFieldToDraftField: Record<AutoEconomicField, EconomicField> = {
  stake: "stakeDollars",
  odds: "americanOdds",
  return: "returnDollars",
};

const inputClass = "form-wide";
const subscribeToClock = () => () => {};
const getBrowserNow = () => toDateTimeLocalValue(new Date());
const progressSteps: { value: Step; label: string }[] = [
  { value: "source", label: "Sportsbook" },
  { value: "event", label: "Event" },
  { value: "market", label: "Market" },
  { value: "economics", label: "Stake · odds · payout" },
];

function isoOrEmpty(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function ImportBetslipForm({
  groups,
  competitions,
  canonicalEvents = [],
  nowLocal,
  nowIso,
}: {
  groups: Group[];
  competitions: Competition[];
  canonicalEvents?: CanonicalEvent[];
  nowLocal: string;
  nowIso: string;
}) {
  const [method, setMethod] = useState<ImportMethod>("entry");
  const [step, setStep] = useState<Step>("source");
  const [reviewing, setReviewing] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [processingScreenshot, setProcessingScreenshot] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [screenshotName, setScreenshotName] = useState("");
  const [extractionMessage, setExtractionMessage] = useState("");
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [extractedTicketType, setExtractedTicketType] = useState<"straight" | "parlay" | null>(
    null,
  );
  const [stepError, setStepError] = useState("");
  const [autoEconomicField, setAutoEconomicField] = useState<AutoEconomicField | null>(null);
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
    status: "open",
    userNotes: "",
    rawText: "",
  });

  const browserNowSnapshot = useMemo(() => getBrowserNow, []);
  const browserNow = useSyncExternalStore(subscribeToClock, browserNowSnapshot, () => nowLocal);
  const effectiveWagerDate = draft.wagerDate === nowLocal ? browserNow : draft.wagerDate;
  const selectedCanonicalEvent = canonicalEvents.find(
    (event) => event.providerEventId === draft.providerEventId,
  );
  const competitionOptions = competitions.filter(
    (competition) => competition.sport === draft.sportKey,
  );
  const economics = useMemo(() => {
    try {
      return {
        value: calculateImportedEconomics(
          draft.stakeDollars,
          draft.americanOdds,
          draft.returnDollars,
        ),
        error: "",
      };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "Enter any two values.",
      };
    }
  }, [draft.stakeDollars, draft.americanOdds, draft.returnDollars]);

  const set = (field: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  function setEconomicField(field: EconomicField, value: string) {
    const nextDraft = { ...draft, [field]: value };
    if (autoEconomicField && autoFieldToDraftField[autoEconomicField] !== field) {
      nextDraft[autoFieldToDraftField[autoEconomicField]] = "";
    }
    let nextAutoField: AutoEconomicField | null = null;
    try {
      const calculated = calculateImportedEconomics(
        nextDraft.stakeDollars,
        nextDraft.americanOdds,
        nextDraft.returnDollars,
      );
      if (calculated.calculatedField) {
        nextAutoField = calculated.calculatedField;
        nextDraft[autoFieldToDraftField[calculated.calculatedField]] =
          calculated.calculatedField === "stake"
            ? calculated.stakeDollars
            : calculated.calculatedField === "odds"
              ? String(calculated.americanOdds)
              : calculated.returnDollars;
      }
    } catch {
      // The preview below reports the validation error while the user finishes the pair.
    }
    setDraft(nextDraft);
    setAutoEconomicField(nextAutoField);
  }

  function chooseMethod(nextMethod: ImportMethod) {
    setMethod(nextMethod);
    setStep("source");
    setReviewing(false);
    setStepError("");
  }

  function applyExtractedFields(extraction: ExtractedBetslip) {
    const fields: BetslipDraftFields = extraction.fields;
    setDraft((current) => ({
      ...current,
      sportsbookId: fields.sportsbookId ?? current.sportsbookId,
      otherSportsbookName: fields.otherSportsbookName ?? current.otherSportsbookName,
      eventDescription: fields.eventDescription ?? current.eventDescription,
      eventDate: fields.eventDate ? toDateTimeLocalValue(fields.eventDate) : current.eventDate,
      wagerDate: fields.wagerDate ? toDateTimeLocalValue(fields.wagerDate) : current.wagerDate,
      selection: fields.selection ?? current.selection,
      selectionKey: fields.selectionKey ?? current.selectionKey,
      marketType: fields.marketType ?? current.marketType,
      line: fields.line ?? current.line,
      americanOdds: fields.americanOdds ?? current.americanOdds,
      stakeDollars: fields.stakeDollars ?? current.stakeDollars,
      returnDollars: fields.returnDollars ?? current.returnDollars,
      sportsbookBetId: fields.sportsbookBetId ?? current.sportsbookBetId,
      rawText: extraction.rawText,
    }));
    setAutoEconomicField(null);
    setExtractedTicketType(extraction.ticketType);
    setExtractionWarnings(extraction.warnings);
  }

  async function handleScreenshot(file: File | undefined) {
    setScreenshotName(file?.name ?? "");
    setExtractionMessage("");
    setExtractionWarnings([]);
    setExtractedTicketType(null);
    if (!file) return;
    setProcessingScreenshot(true);
    setProcessingProgress(0);
    setStep("event");
    try {
      const extraction = await extractBetslip(file, (progress, status) => {
        setProcessingProgress(progress);
        setExtractionMessage(`${status} locally${progress ? ` · ${progress}%` : "…"}`);
      });
      applyExtractedFields(extraction);
      setExtractionMessage(
        extraction.warnings.length
          ? `OCR finished locally. ${extraction.confidence} confidence — review the flagged fields below.`
          : "OCR finished locally. Review the extracted fields before continuing.",
      );
    } catch {
      setExtractionMessage(
        "Local OCR could not read this image. Your private screenshot is attached; continue with the short guided draft.",
      );
      setExtractionWarnings(["No fields were extracted. Enter the missing values manually."]);
    } finally {
      setProcessingScreenshot(false);
    }
  }

  function chooseCanonicalEvent(providerEventId: string) {
    const event = canonicalEvents.find(
      (candidate) => candidate.providerEventId === providerEventId,
    );
    if (!event) {
      set("providerEventId", "");
      return;
    }
    setDraft((current) => ({
      ...current,
      providerEventId: event.providerEventId,
      sportKey: event.sportKey,
      competitionKey: event.competitionKey,
      eventDescription: `${event.awayTeam} at ${event.homeTeam}`,
      eventDate: toDateTimeLocalValue(event.scheduledStart),
    }));
  }

  function nextStep() {
    setStepError("");
    if (step === "source") {
      if (method === "screenshot" && !screenshotName) {
        setStepError("Attach a screenshot to continue.");
        return;
      }
      setStep("event");
      return;
    }
    if (step === "event") {
      if (!draft.eventDescription.trim() || !draft.eventDate) {
        setStepError("Choose a canonical event or enter the event and kickoff.");
        return;
      }
      setStep("market");
      return;
    }
    if (step === "market") {
      if (!draft.selection.trim() || (draft.marketType !== "moneyline" && !draft.line)) {
        setStepError("Enter a selection and line when the market needs one.");
        return;
      }
      setStep("economics");
    }
  }

  function previousStep() {
    setStepError("");
    setStep(step === "economics" ? "market" : step === "market" ? "event" : "source");
  }

  async function reviewDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== "economics") {
      nextStep();
      return;
    }
    if (!economics.value) {
      setStepError(
        "Enter any two of stake, odds, or payout; the third is calculated automatically.",
      );
      return;
    }
    setDraft((current) => ({
      ...current,
      stakeDollars: economics.value!.stakeDollars,
      americanOdds: String(economics.value!.americanOdds),
      returnDollars: economics.value!.returnDollars,
    }));
    setAutoEconomicField(null);
    setCheckingDuplicates(true);
    try {
      const response = await fetch("/api/import-betslip/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sportsbookId: draft.sportsbookId,
          sportsbookBetId: draft.sportsbookBetId,
          wagerDate: effectiveWagerDate,
          stakeDollars: economics.value.stakeDollars,
          americanOdds: economics.value.americanOdds,
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

  return (
    <form
      action={createImportedWager}
      className="form-stack import-betslip-form"
      onSubmit={reviewing ? undefined : reviewDraft}
    >
      <input type="hidden" name="confirmed" value={reviewing ? "true" : "false"} />
      <input type="hidden" name="importMethod" value={method} />
      <input type="hidden" name="eventDateUtc" value={isoOrEmpty(draft.eventDate)} />
      <input type="hidden" name="wagerDateUtc" value={isoOrEmpty(effectiveWagerDate)} />
      <input type="hidden" name="canonicalEventId" value={draft.providerEventId} />
      {step !== "source" ? (
        <>
          <input type="hidden" name="sportsbookId" value={draft.sportsbookId} />
          <input type="hidden" name="otherSportsbookName" value={draft.otherSportsbookName} />
          <input type="hidden" name="sportsbookBetId" value={draft.sportsbookBetId} />
        </>
      ) : null}
      {step !== "event" ? (
        <>
          <input type="hidden" name="sportKey" value={draft.sportKey} />
          <input type="hidden" name="competitionKey" value={draft.competitionKey} />
          <input type="hidden" name="eventDescription" value={draft.eventDescription} />
          <input type="hidden" name="eventDate" value={draft.eventDate} />
          <input type="hidden" name="providerEventId" value={draft.providerEventId} />
        </>
      ) : null}
      {step !== "market" ? (
        <>
          <input type="hidden" name="marketType" value={draft.marketType} />
          <input type="hidden" name="selection" value={draft.selection} />
          <input type="hidden" name="selectionKey" value={draft.selectionKey} />
          <input type="hidden" name="line" value={draft.line} />
        </>
      ) : null}

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
            onClick={() => chooseMethod(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="import-progress" aria-label="Import progress">
        <strong>
          {processingScreenshot
            ? "Processing screenshot…"
            : reviewing
              ? "Review draft"
              : progressSteps.find((candidate) => candidate.value === step)?.label}
        </strong>
        <ol>
          {progressSteps.map((item) => (
            <li className={item.value === step ? "current" : undefined} key={item.value}>
              {item.label}
            </li>
          ))}
        </ol>
      </div>

      {method === "screenshot" ? (
        <div className="notice">
          <strong>Private screenshot review</strong>
          <p>
            Upload screenshot → local OCR → editable review draft → confirm. OCR runs in your
            browser with open-source tooling; the image is not sent to a paid OCR or vision API.
          </p>
          <label>
            Betslip screenshot
            <input
              name="screenshot"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required={!reviewing}
              onChange={(event) => void handleScreenshot(event.target.files?.[0])}
            />
          </label>
          {screenshotName ? (
            <p className="screenshot-ready" role="status">
              Screenshot attached: {screenshotName}. It stays private and will be associated with
              the imported wager after confirmation.
            </p>
          ) : (
            <p className="muted">Choose an image to start the guided review.</p>
          )}
          {processingScreenshot ? (
            <p role="status">Processing screenshot locally… {processingProgress}%</p>
          ) : null}
          {extractionMessage ? <p role="status">{extractionMessage}</p> : null}
          {extractedTicketType === "parlay" ? (
            <p className="notice warning" role="status">
              A parlay was detected. Review each leg in the parlay importer below before saving.
            </p>
          ) : null}
          {extractionWarnings.length ? (
            <ul className="extraction-warnings">
              {extractionWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {method === "paste" ? (
        <div className="paste-import">
          <label className={inputClass}>
            Bet text draft
            <textarea
              name="rawText"
              value={draft.rawText}
              onChange={(event) => set("rawText", event.target.value)}
              rows={4}
              placeholder="Paste the betslip text here; use the guided fields to verify it."
            />
          </label>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              const extraction = parseBetslipText(draft.rawText);
              applyExtractedFields(extraction);
              setExtractionMessage(
                extraction.warnings.length
                  ? "Text parsed locally. Review the flagged fields before continuing."
                  : "Text parsed locally. Review the extracted fields before continuing.",
              );
              setStep("event");
            }}
          >
            Parse pasted text locally
          </button>
        </div>
      ) : null}

      {step === "source" ? (
        <section className="guided-step" aria-label="Sportsbook step">
          <h3>1. Sportsbook</h3>
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
          {draft.sportsbookId === "other" ? (
            <label>
              Other sportsbook name
              <input
                name="otherSportsbookName"
                value={draft.otherSportsbookName}
                onChange={(event) => set("otherSportsbookName", event.target.value)}
              />
            </label>
          ) : (
            <input type="hidden" name="otherSportsbookName" value="" />
          )}
          <label>
            Sportsbook bet ID (optional)
            <input
              name="sportsbookBetId"
              value={draft.sportsbookBetId}
              onChange={(event) => set("sportsbookBetId", event.target.value)}
            />
          </label>
        </section>
      ) : null}

      {step === "event" ? (
        <section className="guided-step" aria-label="Event step">
          <h3>2. Find the event</h3>
          <CachedEventSearch
            events={canonicalEvents}
            selectedEventId={draft.providerEventId}
            nowIso={nowIso}
            onSelect={chooseCanonicalEvent}
          />
          {selectedCanonicalEvent ? (
            <div className="canonical-event-summary">
              <strong>Canonical event selected</strong>
              <span>
                {selectedCanonicalEvent.awayTeam} at {selectedCanonicalEvent.homeTeam} ·{" "}
                {selectedCanonicalEvent.competitionName}
              </span>
              <small>Event ID: {selectedCanonicalEvent.providerEventId}</small>
            </div>
          ) : null}
          <details className="fallback-event" open={!draft.providerEventId}>
            <summary>Can&apos;t find my event</summary>
            <div className="form-grid">
              <label>
                Sport
                <select
                  name="sportKey"
                  value={draft.sportKey}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      sportKey: event.target.value,
                      competitionKey:
                        competitions.find((item) => item.sport === event.target.value)?.id ?? "",
                    }));
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
                Kickoff
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
                />
                <small className="muted">
                  Matched supported events become Auto settlement ready.
                </small>
              </label>
            </div>
          </details>
        </section>
      ) : null}

      {step === "market" ? (
        <section className="guided-step" aria-label="Market step">
          <h3>3. Market and selection</h3>
          <div className="form-grid">
            <label>
              Market
              <select
                name="marketType"
                value={draft.marketType}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    marketType: event.target.value,
                    line: event.target.value === "moneyline" ? "" : current.line,
                  }));
                }}
              >
                <option value="moneyline">Moneyline</option>
                <option value="spread">Spread / Handicap</option>
                <option value="total">Total</option>
              </select>
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
              Selection as shown
              <input
                name="selection"
                value={draft.selection}
                onChange={(event) => set("selection", event.target.value)}
                required
              />
            </label>
            <label>
              Line {draft.marketType === "moneyline" ? "(not used)" : ""}
              <input
                name="line"
                type="number"
                step="0.0001"
                value={draft.line}
                onChange={(event) => set("line", event.target.value)}
                placeholder="Required for spread/total"
                required={draft.marketType !== "moneyline"}
              />
            </label>
          </div>
        </section>
      ) : null}

      {step === "economics" ? (
        <section className="guided-step" aria-label="Wager economics step">
          <h3>4. Enter any TWO values</h3>
          <p className="muted">
            Stake, American odds, or payout/return. The third is calculated exactly.
          </p>
          <div className="form-grid">
            <label>
              Stake (USD)
              <input
                name="stakeDollars"
                inputMode="decimal"
                value={draft.stakeDollars}
                onChange={(event) => setEconomicField("stakeDollars", event.target.value)}
                placeholder="e.g. 25.00"
              />
            </label>
            <label>
              Odds (American)
              <input
                name="americanOdds"
                type="number"
                step="1"
                value={draft.americanOdds}
                onChange={(event) => setEconomicField("americanOdds", event.target.value)}
                placeholder="e.g. -110"
              />
            </label>
            <label>
              Payout / return (USD)
              <input
                name="returnDollars"
                inputMode="decimal"
                value={draft.returnDollars}
                onChange={(event) => setEconomicField("returnDollars", event.target.value)}
                placeholder="e.g. 47.73"
              />
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
              Initial status
              <select
                name="status"
                value={draft.status}
                onChange={(event) => set("status", event.target.value)}
              >
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
          </div>
          {economics.value ? (
            <div className="economics-preview" aria-live="polite">
              <strong>
                {economics.value.stakeDollars} USD = {economics.value.stakeDollars} Vials
              </strong>
              <span>
                {economics.value.americanOdds > 0 ? "+" : ""}
                {economics.value.americanOdds} odds · {economics.value.returnDollars} USD payout
              </span>
              {economics.value.calculatedField ? (
                <small>Calculated: {economics.value.calculatedField}</small>
              ) : null}
            </div>
          ) : (
            <p className="muted" aria-live="polite">
              {economics.error || "Enter any two values to preview the calculated third."}
            </p>
          )}
          <label className={inputClass}>
            Notes (optional)
            <textarea
              name="userNotes"
              value={draft.userNotes}
              onChange={(event) => set("userNotes", event.target.value)}
              rows={2}
              maxLength={2000}
            />
          </label>
        </section>
      ) : null}

      {stepError ? (
        <p className="notice error" role="alert">
          {stepError}
        </p>
      ) : null}

      <p className="muted import-normalization-note">
        Normalization: $1 USD = 1 Vial. Imported source dollars never debit or credit the simulated
        bankroll.
      </p>

      {!reviewing ? (
        <div className="guided-step-actions">
          {step !== "source" ? (
            <button className="button secondary" type="button" onClick={previousStep}>
              Back
            </button>
          ) : null}
          <SubmitButton pendingLabel="Preparing review…">
            {step === "economics" ? "Review draft" : "Continue"}
          </SubmitButton>
        </div>
      ) : (
        <section className="notice review-panel" aria-label="Review imported betslip">
          <h3>Review draft before saving</h3>
          <p>
            Nothing has been saved yet. Confirm the editable fields above, then choose the final
            action.
          </p>
          <p>
            {draft.eventDescription} · {draft.selection} · {draft.stakeDollars} USD ·{" "}
            {draft.americanOdds} · {draft.returnDollars} USD payout
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
              <div className="guided-step-actions">
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
            <div className="guided-step-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setReviewing(false)}
              >
                Edit draft
              </button>
              <SubmitButton pendingLabel="Importing…">Confirm and save to My Bets</SubmitButton>
            </div>
          )}
        </section>
      )}
    </form>
  );
}
