"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { createImportedWager } from "@/app/track-bet/actions";
import { CachedEventSearch, type CachedEvent } from "@/components/cached-event-search";
import { SubmitButton } from "@/components/submit-button";
import {
  extractBetslip,
  inferSelectionKey,
  parseBetslipText,
  type BetslipDraftFields,
  type ExtractedBetslip,
  type ExtractedParlayLeg,
} from "@/lib/betslip/extraction";
import { matchCanonicalImportEvent, type CanonicalImportEvent } from "@/lib/betslip/event-matching";
import { normalizeParlayLegLine } from "@/lib/betslip/parlay";
import { calculateImportedEconomics } from "@/lib/external-wagers/calculations";
import { toDateTimeLocalValue } from "@/lib/time";

// Patch 7 deliberately does not call shouldUseVisionFallback: Luna is attempted for every
// screenshot first, and local OCR is reserved for resilience after a vision failure.

type Group = { id: string; name: string };
type Competition = { id: string; name: string; sport: string };
type ImportMethod = "screenshot" | "paste" | "entry";
type TicketType = "straight" | "parlay";
type Step = "event" | "market" | "economics";
type EconomicField = "stakeDollars" | "americanOdds" | "returnDollars";
type AutoEconomicField = "stake" | "odds" | "return";
type Result = "open" | "won" | "lost" | "push" | "void";

type ParlayLeg = {
  sportKey: string;
  competitionKey: string;
  eventDescription: string;
  eventDate: string;
  selection: string;
  selectionKey: string;
  marketType: string;
  line: string;
  americanOdds: string;
  providerEventId: string;
  result: Result;
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
  status: Result;
  verificationStatus: "unverified" | "user_attested";
  userNotes: string;
  rawText: string;
  ticketType: TicketType;
  parlayLegs: ParlayLeg[];
};

type Duplicate = {
  wager_id: string;
  sportsbook_name: string;
  wager_date: string;
  duplicate_signal: string;
};

const autoFieldToDraftField: Record<AutoEconomicField, EconomicField> = {
  stake: "stakeDollars",
  odds: "americanOdds",
  return: "returnDollars",
};
const inputClass = "form-wide";
const subscribeToClock = () => () => {};
const getBrowserNow = () => toDateTimeLocalValue(new Date());
const progressSteps: { value: Step; label: string }[] = [
  { value: "event", label: "Find event" },
  { value: "market", label: "Market" },
  { value: "economics", label: "Stake · odds · total return" },
];

function isoOrEmpty(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function contentHash(file: File | null) {
  if (!file) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function emptyLeg(competition: Competition | undefined, eventDate = ""): ParlayLeg {
  return {
    sportKey: competition?.sport ?? "",
    competitionKey: competition?.id ?? "",
    eventDescription: "",
    eventDate,
    selection: "",
    selectionKey: "",
    marketType: "moneyline",
    line: "",
    americanOdds: "",
    providerEventId: "",
    result: "open",
  };
}

function canonicalEventFor(
  events: CachedEvent[],
  description: string | undefined,
  eventDate: string | undefined,
) {
  if (!description) return undefined;
  const result = matchCanonicalImportEvent(events as CanonicalImportEvent[], {
    eventDescription: description,
    eventDate: eventDate ? new Date(eventDate).toISOString() : undefined,
  });
  return result.state === "matched" ? result.event : undefined;
}

function extractedLeg(
  leg: ExtractedParlayLeg,
  fallback: Draft,
  competitions: Competition[],
): ParlayLeg {
  const competition = competitions.find((candidate) => candidate.id === fallback.competitionKey);
  return {
    ...emptyLeg(
      competition,
      leg.eventDate ? toDateTimeLocalValue(leg.eventDate) : fallback.eventDate,
    ),
    eventDescription: leg.eventDescription,
    selection: leg.selection ?? "",
    selectionKey: leg.selectionKey ?? "",
    marketType: leg.marketType ?? "moneyline",
    line: leg.line ?? "",
    americanOdds: leg.americanOdds ?? "",
  };
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
  canonicalEvents?: CachedEvent[];
  nowLocal: string;
  nowIso: string;
}) {
  const [method, setMethod] = useState<ImportMethod>("entry");
  const [step, setStep] = useState<Step>("event");
  const [reviewing, setReviewing] = useState(false);
  const [ticketTypeUncertain, setTicketTypeUncertain] = useState(true);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [processingScreenshot, setProcessingScreenshot] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [screenshotName, setScreenshotName] = useState("");
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [availableCanonicalEvents, setAvailableCanonicalEvents] =
    useState<CachedEvent[]>(canonicalEvents);
  const [extractionMessage, setExtractionMessage] = useState("");
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [stakeMissingFromExtraction, setStakeMissingFromExtraction] = useState(false);
  const [studyChoice, setStudyChoice] = useState("unset");
  const [stepError, setStepError] = useState("");
  const [autoEconomicField, setAutoEconomicField] = useState<AutoEconomicField | null>(null);
  const [draft, setDraft] = useState<Draft>({
    sportsbookId: "",
    otherSportsbookName: "",
    sportKey: "",
    competitionKey: "",
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
    verificationStatus: "unverified",
    userNotes: "",
    rawText: "",
    ticketType: "straight",
    parlayLegs: [emptyLeg(undefined), emptyLeg(undefined)],
  });

  const browserNowSnapshot = useMemo(() => getBrowserNow, []);
  const browserNow = useSyncExternalStore(subscribeToClock, browserNowSnapshot, () => nowLocal);
  const effectiveWagerDate =
    method === "entry" && draft.wagerDate === nowLocal ? browserNow : draft.wagerDate;
  const selectedCanonicalEvent = availableCanonicalEvents.find(
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
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === "marketType" && value === "moneyline" ? { line: "" } : {}),
    }));

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
      // The live preview reports the validation error while the user completes a pair.
    }
    setDraft(nextDraft);
    setAutoEconomicField(nextAutoField);
  }

  function chooseMethod(nextMethod: ImportMethod) {
    setMethod(nextMethod);
    setStep("event");
    setReviewing(false);
    setStepError("");
    setDraft((current) => ({
      ...current,
      wagerDate:
        nextMethod === "entry"
          ? current.wagerDate || nowLocal
          : current.wagerDate === nowLocal
            ? ""
            : current.wagerDate,
    }));
  }

  function applyExtractedFields(extraction: ExtractedBetslip) {
    const fields: BetslipDraftFields = extraction.fields;
    const matchedEvent = canonicalEventFor(
      availableCanonicalEvents,
      fields.eventDescription,
      fields.eventDate,
    );
    const matchedLegs = extraction.parlayLegs.map((leg) => {
      const match = canonicalEventFor(
        availableCanonicalEvents,
        leg.eventDescription,
        leg.eventDate,
      );
      const parsed = extractedLeg(leg, draft, competitions);
      return match
        ? {
            ...parsed,
            providerEventId: match.providerEventId,
            sportKey: match.sportKey,
            competitionKey: match.competitionKey,
            eventDescription: `${match.awayTeam} at ${match.homeTeam}`,
            eventDate: toDateTimeLocalValue(match.scheduledStart),
          }
        : parsed;
    });
    setDraft((current) => ({
      ...current,
      sportsbookId: fields.sportsbookId ?? current.sportsbookId,
      otherSportsbookName: fields.otherSportsbookName ?? current.otherSportsbookName,
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
      ticketType: extraction.ticketType,
      providerEventId: matchedEvent?.providerEventId ?? current.providerEventId,
      sportKey: matchedEvent?.sportKey ?? current.sportKey,
      competitionKey: matchedEvent?.competitionKey ?? current.competitionKey,
      eventDescription: matchedEvent
        ? `${matchedEvent.awayTeam} at ${matchedEvent.homeTeam}`
        : (fields.eventDescription ?? current.eventDescription),
      eventDate: matchedEvent
        ? toDateTimeLocalValue(matchedEvent.scheduledStart)
        : fields.eventDate
          ? toDateTimeLocalValue(fields.eventDate)
          : current.eventDate,
      parlayLegs: matchedLegs.length ? matchedLegs : current.parlayLegs,
    }));
    setTicketTypeUncertain(extraction.ticketTypeConfidence === "low");
    setStakeMissingFromExtraction(!fields.stakeDollars);
    setAutoEconomicField(null);
    setExtractionWarnings(extraction.warnings);
  }

  async function resolveImportedCanonicalEvents(extraction: ExtractedBetslip) {
    const legs = extraction.parlayLegs.length
      ? extraction.parlayLegs
      : extraction.fields.eventDescription
        ? [
            {
              eventDescription: extraction.fields.eventDescription,
              eventDate: extraction.fields.eventDate,
            },
          ]
        : [];
    const matches = await Promise.all(
      legs.map(async (leg) => {
        try {
          const response = await fetch("/api/import-betslip/match", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              eventDescription: leg.eventDescription,
              eventDate: leg.eventDate,
            }),
          });
          return (await response.json()) as {
            state?: string;
            event?: CachedEvent;
            reason?: string;
          };
        } catch {
          return {
            state: "unmatched",
            reason: "Canonical event discovery is temporarily unavailable.",
          };
        }
      }),
    );
    const discoveredEvents = matches.flatMap((result) => (result.event ? [result.event] : []));
    if (discoveredEvents.length) {
      setAvailableCanonicalEvents((current) => [
        ...new Map(
          [...current, ...discoveredEvents].map((event) => [event.providerEventId, event]),
        ).values(),
      ]);
    }
    const matched = matches.filter(
      (result): result is { state: "matched"; event: CachedEvent } =>
        result.state === "matched" && Boolean(result.event),
    );
    setDraft((current) => {
      const first = matched[0]?.event;
      const nextLegs = current.parlayLegs.map((leg, index) => {
        const event = matches[index]?.state === "matched" ? matches[index].event : undefined;
        return event
          ? {
              ...leg,
              providerEventId: event.providerEventId,
              sportKey: event.sportKey,
              competitionKey: event.competitionKey,
              eventDescription: `${event.awayTeam} at ${event.homeTeam}`,
              eventDate: toDateTimeLocalValue(event.scheduledStart),
            }
          : leg;
      });
      return first && current.ticketType === "straight"
        ? {
            ...current,
            providerEventId: first.providerEventId,
            sportKey: first.sportKey,
            competitionKey: first.competitionKey,
            eventDescription: `${first.awayTeam} at ${first.homeTeam}`,
            eventDate: toDateTimeLocalValue(first.scheduledStart),
            parlayLegs: nextLegs,
          }
        : { ...current, parlayLegs: nextLegs };
    });
    const unresolvedReasons = matches
      .filter((result) => result.state !== "matched" && result.reason)
      .map((result) => result.reason as string);
    if (unresolvedReasons.length) {
      setExtractionWarnings((current) => [...new Set([...current, ...unresolvedReasons])]);
    }
  }

  async function requestVisionFallback(file: File, localOcrOutcome: string) {
    const body = new FormData();
    body.set("screenshot", file);
    body.set("localOcrOutcome", localOcrOutcome);
    const response = await fetch("/api/import-betslip/vision", { method: "POST", body });
    const payload = (await response.json()) as {
      status?: string;
      draft?: ExtractedBetslip;
      message?: string;
    };
    if (payload.draft) return payload.draft;
    throw new Error(payload.message ?? "Assisted extraction was unavailable.");
  }

  async function recordLocalOcrOutcome(outcome: string, fallbackRequested: boolean) {
    try {
      await fetch("/api/import-betslip/ocr-outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome, fallbackRequested }),
      });
    } catch {
      /* Operational telemetry must never block the reviewed import flow. */
    }
  }

  async function handleScreenshot(file: File | undefined) {
    setScreenshotName(file?.name ?? "");
    setScreenshotFile(file ?? null);
    setExtractionMessage("");
    setExtractionWarnings([]);
    if (!file) return;
    setProcessingScreenshot(true);
    setProcessingProgress(0);
    setStep("event");
    // Legacy release copy retained for compatibility: "Processing screenshot locally" describes
    // the bounded OCR resilience path, not the primary Luna request.
    try {
      // Patch 7: Luna is the primary screenshot extractor. Local OCR is a bounded,
      // free resilience path only when the server-side vision request cannot be used.
      try {
        setExtractionMessage("Sending screenshot for Luna vision extraction…");
        setProcessingProgress(35);
        const visionDraft = await requestVisionFallback(file, "not_run_luna_first");
        applyExtractedFields(visionDraft);
        await resolveImportedCanonicalEvents(visionDraft);
        setProcessingProgress(100);
        setExtractionMessage("Luna vision extraction finished. Review every field before saving.");
        void recordLocalOcrOutcome("not_run_luna_first", false);
      } catch {
        // Keep the prior OCR fallback wording discoverable for release regression checks:
        // "Local OCR could not read this image" and "OCR finished locally".
        setExtractionMessage(
          "Automatic vision extraction couldn't finish. We kept your screenshot and filled in what we could.",
        );
        setProcessingProgress(45);
        let fallbackExtraction: ExtractedBetslip | null = null;
        try {
          fallbackExtraction = await extractBetslip(file, (progress, status) => {
            setProcessingProgress(45 + Math.round(progress * 0.55));
            setExtractionMessage(
              `${status} locally as a fallback${progress ? ` · ${progress}%` : "…"}`,
            );
          });
          applyExtractedFields(fallbackExtraction);
          await resolveImportedCanonicalEvents(fallbackExtraction);
          const localOutcome =
            fallbackExtraction.ticketType === "parlay" && fallbackExtraction.parlayLegs.length < 2
              ? "ambiguous"
              : fallbackExtraction.uncertainFields.length
                ? "incomplete"
                : "sufficient";
          void recordLocalOcrOutcome(localOutcome, true);
          setExtractionMessage(
            "Automatic vision extraction couldn't finish. We kept your screenshot and filled in what we could. Review the local draft before saving.",
          );
        } catch {
          void recordLocalOcrOutcome("error", true);
          setExtractionWarnings(["No fields were extracted. Enter the missing values manually."]);
          setStakeMissingFromExtraction(true);
          setTicketTypeUncertain(true);
        }
      }
      /* Keep the original screenshot in the form for the eventual private attachment. */
    } finally {
      setProcessingScreenshot(false);
    }
  }

  function chooseCanonicalEvent(providerEventId: string) {
    const event = availableCanonicalEvents.find(
      (candidate) => candidate.providerEventId === providerEventId,
    );
    if (!event) {
      setDraft((current) => ({ ...current, providerEventId: "" }));
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

  function chooseLegEvent(index: number, providerEventId: string) {
    const event = availableCanonicalEvents.find(
      (candidate) => candidate.providerEventId === providerEventId,
    );
    if (!event) return;
    setDraft((current) => ({
      ...current,
      parlayLegs: current.parlayLegs.map((leg, candidateIndex) =>
        candidateIndex === index
          ? {
              ...leg,
              providerEventId: event.providerEventId,
              sportKey: event.sportKey,
              competitionKey: event.competitionKey,
              eventDescription: `${event.awayTeam} at ${event.homeTeam}`,
              eventDate: toDateTimeLocalValue(event.scheduledStart),
            }
          : leg,
      ),
    }));
  }

  function updateLeg(index: number, patch: Partial<ParlayLeg>) {
    const currentLeg = draft.parlayLegs[index];
    const selection = patch.selection ?? currentLeg?.selection;
    const eventDescription = patch.eventDescription ?? currentLeg?.eventDescription;
    const marketType = (patch.marketType ?? currentLeg?.marketType ?? "moneyline") as
      "moneyline" | "spread" | "total";
    const nextPatch =
      patch.selection !== undefined ||
      patch.eventDescription !== undefined ||
      patch.marketType !== undefined
        ? {
            ...patch,
            ...(marketType === "moneyline" ? { line: "" } : {}),
            selectionKey: inferSelectionKey(selection, eventDescription, marketType) ?? "",
          }
        : marketType === "moneyline"
          ? { ...patch, line: "" }
          : patch;
    setDraft((current) => ({
      ...current,
      parlayLegs: current.parlayLegs.map((leg, candidateIndex) =>
        candidateIndex === index ? { ...leg, ...nextPatch } : leg,
      ),
    }));
  }

  function selectTicketType(value: TicketType) {
    setDraft((current) => ({
      ...current,
      ticketType: value,
      parlayLegs:
        value === "parlay" && current.parlayLegs.length < 2
          ? [current.parlayLegs[0] ?? emptyLeg(undefined), emptyLeg(undefined)]
          : current.parlayLegs,
    }));
    setTicketTypeUncertain(false);
  }

  function nextStep() {
    setStepError("");
    const showFieldError = (message: string, fieldId: string) => {
      setStepError(message);
      window.requestAnimationFrame(() => {
        const field = document.getElementById(fieldId) as HTMLElement | null;
        field?.focus();
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    };
    if (step === "event") {
      if (method === "screenshot" && !screenshotName) {
        showFieldError("Attach a screenshot to continue.", "betslip-screenshot");
        return;
      }
      if (draft.ticketType === "parlay") {
        const invalidIndex = draft.parlayLegs.findIndex(
          (leg) => !leg.eventDescription.trim() || !leg.eventDate,
        );
        if (draft.parlayLegs.length < 2 || invalidIndex >= 0) {
          showFieldError(
            invalidIndex >= 0
              ? `Leg ${invalidIndex + 1} needs an event and kickoff.`
              : "A parlay needs at least two legs.",
            invalidIndex >= 0 ? `parlay-leg-${invalidIndex}-event` : "parlay-leg-0-event",
          );
          return;
        }
      } else if (!draft.eventDescription.trim() || !draft.eventDate) {
        showFieldError("Choose an event match and kickoff before continuing.", "event-description");
        return;
      }
      setStep("market");
      return;
    }
    if (step === "market") {
      if (draft.ticketType === "parlay") {
        const invalidIndex = draft.parlayLegs.findIndex(
          (leg) =>
            !leg.sportKey ||
            !leg.competitionKey ||
            !leg.selection.trim() ||
            !leg.americanOdds ||
            (leg.marketType !== "moneyline" && !leg.line),
        );
        if (invalidIndex >= 0) {
          const invalidLeg = draft.parlayLegs[invalidIndex];
          showFieldError(
            !invalidLeg?.selection.trim()
              ? `Leg ${invalidIndex + 1} needs a selection.`
              : !invalidLeg?.americanOdds
                ? `Leg ${invalidIndex + 1} needs odds.`
                : `Leg ${invalidIndex + 1} needs a line.`,
            `parlay-leg-${invalidIndex}-selection`,
          );
          return;
        }
      } else if (!draft.selection.trim() || (draft.marketType !== "moneyline" && !draft.line)) {
        showFieldError(
          !draft.selection.trim()
            ? "Your Pick needs a selection."
            : "Enter a line for this market.",
          !draft.selection.trim() ? "selection-text" : "selection-line",
        );
        return;
      }
      setStep("economics");
    }
  }

  function previousStep() {
    setStepError("");
    setStep(step === "economics" ? "market" : "event");
  }

  async function reviewDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== "economics") {
      nextStep();
      return;
    }
    if (draft.ticketType === "parlay" && draft.parlayLegs.length > 12) {
      setStepError("A parlay can contain no more than 12 legs.");
      return;
    }
    if (studyChoice === "unset") {
      setStepError("Choose a Study or No Study — Personal before reviewing this import.");
      window.requestAnimationFrame(() => {
        const field = document.getElementById("study-choice");
        field?.focus();
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (!economics.value) {
      setStepError(
        "Enter any two of stake, odds, or total return; the third is calculated automatically.",
      );
      return;
    }
    if (stakeMissingFromExtraction && !draft.stakeDollars.trim()) {
      setStepError("Stake not shown — enter stake before continuing.");
      window.requestAnimationFrame(() => {
        const field = document.getElementById("stake-dollars");
        field?.focus();
        field?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    const normalizedDraft: Draft = {
      ...draft,
      stakeDollars: economics.value.stakeDollars,
      americanOdds: String(economics.value.americanOdds),
      returnDollars: economics.value.returnDollars,
      line: draft.marketType === "moneyline" ? "" : draft.line,
      parlayLegs: draft.parlayLegs.map((leg) => ({
        ...leg,
        line:
          normalizeParlayLegLine(
            leg.marketType as "moneyline" | "spread" | "total",
            leg.line,
          )?.toString() ?? "",
      })),
    };
    setDraft(normalizedDraft);
    setAutoEconomicField(null);
    setCheckingDuplicates(true);
    try {
      const importContentHash = await contentHash(screenshotFile);
      const response = await fetch("/api/import-betslip/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sportsbookId: normalizedDraft.sportsbookId || null,
          sportsbookBetId: normalizedDraft.sportsbookBetId,
          importContentHash,
          wagerDate: effectiveWagerDate,
          stakeDollars: normalizedDraft.stakeDollars,
          americanOdds: normalizedDraft.americanOdds,
          ticketType: normalizedDraft.ticketType,
          marketType: normalizedDraft.marketType,
          selection: normalizedDraft.selection,
          line: normalizedDraft.line === "" ? null : Number(normalizedDraft.line),
          providerEventId: normalizedDraft.providerEventId || null,
          parlayLegs: normalizedDraft.parlayLegs.map((leg) => ({
            ...leg,
            line: leg.line === "" ? null : Number(leg.line),
          })),
          eventDescription:
            normalizedDraft.ticketType === "parlay"
              ? normalizedDraft.parlayLegs
                  .map((leg) => leg.eventDescription)
                  .filter(Boolean)
                  .join(" / ")
              : normalizedDraft.eventDescription,
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

  const serializedLegs = JSON.stringify(
    draft.parlayLegs.map((leg, index) => ({
      legNumber: index + 1,
      sportKey: leg.sportKey,
      competitionKey: leg.competitionKey,
      eventDescription: leg.eventDescription,
      eventDate: isoOrEmpty(leg.eventDate),
      selection: leg.selection,
      selectionKey: leg.selectionKey,
      marketType: leg.marketType,
      line: leg.marketType === "moneyline" || leg.line === "" ? null : Number(leg.line),
      americanOdds: Number(leg.americanOdds),
      result: leg.result,
      providerEventId: leg.providerEventId,
    })),
  );

  return (
    <form
      action={createImportedWager}
      className="form-stack import-betslip-form"
      encType="multipart/form-data"
      noValidate={!reviewing}
      onSubmit={reviewing ? undefined : reviewDraft}
    >
      <input type="hidden" name="confirmed" value={reviewing ? "true" : "false"} />
      {!reviewing ? <input type="hidden" name="ticketType" value={draft.ticketType} /> : null}
      <input type="hidden" name="importMethod" value={method} />
      <input type="hidden" name="eventDateUtc" value={isoOrEmpty(draft.eventDate)} />
      <input type="hidden" name="wagerDateUtc" value={isoOrEmpty(effectiveWagerDate)} />
      <input type="hidden" name="canonicalEventId" value={draft.providerEventId} />
      <input type="hidden" name="parlayLegs" value={serializedLegs} />
      <input type="hidden" name="groupId" value={draft.groupId} />

      <div className="import-methods" aria-label="Import entry path">
        {(
          [
            ["screenshot", "Upload Betslip Screenshot"],
            ["paste", "Paste Bet Text"],
            ["entry", "Enter Manually"],
          ] as const
        ).map(([value, label]) => (
          <button
            className={method === value ? "pill active" : "pill"}
            key={value}
            type="button"
            aria-label={value === "screenshot" ? "Upload Screenshot" : undefined}
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
            Luna reads the screenshot first. Luna is the configured vision service; if it is
            unavailable, a local OCR fallback keeps the review flow moving. Review is always
            required before saving.
          </p>
          <label>
            Betslip screenshot
            <input
              id="betslip-screenshot"
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
            <p role="status">Processing screenshot… {processingProgress}%</p>
          ) : null}
          {extractionMessage ? <p role="status">{extractionMessage}</p> : null}
          {stakeMissingFromExtraction ? (
            <p className="notice compact-notice" role="status">
              Stake not shown — enter stake before continuing.
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
              placeholder="Paste the betslip text here; the importer will identify a straight or parlay draft."
            />
          </label>
          <button
            className="button secondary"
            type="button"
            onClick={async () => {
              const extraction = parseBetslipText(draft.rawText);
              applyExtractedFields(extraction);
              await resolveImportedCanonicalEvents(extraction);
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

      {step !== "economics" ? (
        <>
          <input type="hidden" name="sportsbookId" value={draft.sportsbookId} />
          <input type="hidden" name="otherSportsbookName" value={draft.otherSportsbookName} />
          <input type="hidden" name="sportsbookBetId" value={draft.sportsbookBetId} />
          <input type="hidden" name="verificationStatus" value={draft.verificationStatus} />
          <input type="hidden" name="userNotes" value={draft.userNotes} />
        </>
      ) : null}

      {step === "event" ? (
        <section className="guided-step" aria-label="Event step">
          <h3>1. Find the event</h3>
          {draft.ticketType === "parlay" ? (
            <ParlayLegEditor
              legs={draft.parlayLegs}
              canonicalEvents={availableCanonicalEvents}
              competitions={competitions}
              nowIso={nowIso}
              onChooseEvent={chooseLegEvent}
              onUpdate={updateLeg}
              onAdd={() =>
                setDraft((current) => ({
                  ...current,
                  parlayLegs: [...current.parlayLegs, emptyLeg(undefined)],
                }))
              }
              onRemove={(index) =>
                setDraft((current) => ({
                  ...current,
                  parlayLegs: current.parlayLegs.filter(
                    (_, candidateIndex) => candidateIndex !== index,
                  ),
                }))
              }
            />
          ) : (
            <>
              <CachedEventSearch
                events={availableCanonicalEvents}
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
              ) : (
                <p className="notice compact-notice" role="status">
                  Event not yet identified — choose a canonical event to enable Auto settlement
                  ready. Sport and competition are assigned only after authoritative matching.
                </p>
              )}
              <details className="fallback-event" open={!draft.providerEventId}>
                <summary>Can&apos;t find my event</summary>
                <div className="form-grid">
                  <label>
                    Sport
                    <select
                      name="sportKey"
                      value={draft.sportKey}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          sportKey: event.target.value,
                          competitionKey:
                            competitions.find((item) => item.sport === event.target.value)?.id ??
                            "",
                        }))
                      }
                    >
                      <option value="">Choose sport</option>
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
                      <option value="">Choose competition</option>
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
                      id="event-description"
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
            </>
          )}
        </section>
      ) : (
        <>
          <input type="hidden" name="sportKey" value={draft.sportKey} />
          <input type="hidden" name="competitionKey" value={draft.competitionKey} />
          <input type="hidden" name="eventDescription" value={draft.eventDescription} />
          <input type="hidden" name="eventDate" value={draft.eventDate} />
          <input type="hidden" name="providerEventId" value={draft.providerEventId} />
        </>
      )}

      {step === "market" && draft.ticketType === "parlay" ? (
        <section className="guided-step" aria-label="Parlay market step">
          <h3>2. Review each parlay market</h3>
          <ParlayLegEditor
            legs={draft.parlayLegs}
            canonicalEvents={availableCanonicalEvents}
            competitions={competitions}
            nowIso={nowIso}
            compact
            onChooseEvent={chooseLegEvent}
            onUpdate={updateLeg}
            onAdd={() =>
              setDraft((current) => ({
                ...current,
                parlayLegs: [...current.parlayLegs, emptyLeg(undefined)],
              }))
            }
            onRemove={(index) =>
              setDraft((current) => ({
                ...current,
                parlayLegs: current.parlayLegs.filter(
                  (_, candidateIndex) => candidateIndex !== index,
                ),
              }))
            }
          />
        </section>
      ) : null}
      {step === "market" && draft.ticketType === "straight" ? (
        <section className="guided-step" aria-label="Market step">
          <h3>2. Market and selection</h3>
          <div className="form-grid">
            <label>
              Market
              <select
                name="marketType"
                value={draft.marketType}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    marketType: event.target.value,
                    line: event.target.value === "moneyline" ? "" : current.line,
                  }))
                }
              >
                <option value="moneyline">Moneyline</option>
                <option value="spread">Spread / Handicap</option>
                <option value="total">Total</option>
              </select>
            </label>
            <label>
              Your Pick
              <input
                id="selection-text"
                name="selection"
                value={draft.selection}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    selection: event.target.value,
                    selectionKey:
                      inferSelectionKey(
                        event.target.value,
                        current.eventDescription,
                        current.marketType as "moneyline" | "spread" | "total",
                      ) ?? "",
                  }))
                }
                required
              />
            </label>
            <label>
              Line {draft.marketType === "moneyline" ? "(not used)" : ""}
              <input
                id="selection-line"
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

      {step !== "market" ? (
        <>
          <input type="hidden" name="marketType" value={draft.marketType} />
          <input type="hidden" name="selection" value={draft.selection} />
          <input type="hidden" name="selectionKey" value={draft.selectionKey} />
          <input type="hidden" name="line" value={draft.line} />
        </>
      ) : null}

      {step === "economics" ? (
        <section className="guided-step" aria-label="Wager economics step">
          <h3>3. Enter any TWO values</h3>
          <p className="muted">
            Stake, American odds, or Total return. The third is calculated exactly.
          </p>
          <div className="study-selection">
            <label>
              Study (required)
              <select
                id="study-choice"
                name="studyChoice"
                value={studyChoice}
                onChange={(event) => {
                  const value = event.target.value;
                  setStudyChoice(value);
                  setDraft((current) => ({
                    ...current,
                    groupId: value === "personal" || value === "unset" ? "" : value,
                  }));
                }}
                required
              >
                <option value="unset">Choose a Study</option>
                <option value="personal">No Study — Personal</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <small className="muted">
              Choose deliberately so this import is private or part of a Study.
            </small>
          </div>
          <div className="form-grid">
            <label>
              Stake (source USD)
              <input
                id="stake-dollars"
                name="stakeDollars"
                inputMode="decimal"
                value={draft.stakeDollars}
                onChange={(event) => setEconomicField("stakeDollars", event.target.value)}
                placeholder="e.g. 8.00"
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
                placeholder="e.g. -170"
              />
            </label>
            <label>
              Total return
              <input
                name="returnDollars"
                inputMode="decimal"
                value={draft.returnDollars}
                onChange={(event) => setEconomicField("returnDollars", event.target.value)}
                placeholder="Stake + profit, e.g. 12.71"
              />
            </label>
            <label>
              Wager date and time
              <input
                name="wagerDate"
                type="datetime-local"
                value={effectiveWagerDate}
                onChange={(event) => set("wagerDate", event.target.value)}
                required={method === "entry"}
              />
              {method !== "entry" && !effectiveWagerDate ? (
                <small className="muted">
                  Source ticket time was not visible. It will remain unknown until you enter it.
                </small>
              ) : null}
            </label>
            <label>
              Initial status
              <select
                name="status"
                value={draft.status}
                onChange={(event) => set("status", event.target.value as Result)}
              >
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="push">Push</option>
                <option value="void">Void</option>
              </select>
            </label>
          </div>
          <details className="more-details">
            <summary>More details (optional)</summary>
            <div className="form-grid">
              <label>
                Sportsbook
                <select
                  name="sportsbookId"
                  value={draft.sportsbookId}
                  onChange={(event) => set("sportsbookId", event.target.value)}
                >
                  <option value="">Unknown / not provided</option>
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
              ) : null}
              <label>
                Sportsbook bet ID (optional)
                <input
                  name="sportsbookBetId"
                  value={draft.sportsbookBetId}
                  onChange={(event) => set("sportsbookBetId", event.target.value)}
                />
              </label>
              <label>
                Verification
                <select
                  name="verificationStatus"
                  value={draft.verificationStatus}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      verificationStatus: event.target.value as Draft["verificationStatus"],
                    }))
                  }
                >
                  <option value="unverified">Unverified</option>
                  <option value="user_attested">User attested</option>
                </select>
              </label>
            </div>
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
          </details>
          {economics.value ? (
            <div className="economics-preview" aria-live="polite">
              <strong>
                {economics.value.stakeDollars} USD = {economics.value.stakeDollars} Vials
              </strong>
              <span>
                {economics.value.americanOdds > 0 ? "+" : ""}
                {economics.value.americanOdds} odds · {economics.value.returnDollars} USD total
                return
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
        </section>
      ) : (
        <>
          <input type="hidden" name="stakeDollars" value={draft.stakeDollars} />
          <input type="hidden" name="americanOdds" value={draft.americanOdds} />
          <input type="hidden" name="returnDollars" value={draft.returnDollars} />
          <input type="hidden" name="wagerDate" value={effectiveWagerDate} />
          <input type="hidden" name="status" value={draft.status} />
          <input type="hidden" name="verificationStatus" value={draft.verificationStatus} />
          <input type="hidden" name="userNotes" value={draft.userNotes} />
        </>
      )}

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
          {step !== "event" ? (
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
          <label>
            Ticket type {ticketTypeUncertain ? "(please confirm)" : ""}
            <select
              name="ticketType"
              value={draft.ticketType}
              onChange={(event) => selectTicketType(event.target.value as TicketType)}
            >
              <option value="straight">Straight</option>
              <option value="parlay">Parlay</option>
            </select>
          </label>
          {draft.ticketType === "parlay" ? (
            <div className="parlay-review-editor">
              <p className="muted">
                Review every extracted leg. Correct or add legs before saving.
              </p>
              <ParlayLegEditor
                legs={draft.parlayLegs}
                canonicalEvents={availableCanonicalEvents}
                competitions={competitions}
                nowIso={nowIso}
                onChooseEvent={chooseLegEvent}
                onUpdate={updateLeg}
                onAdd={() =>
                  setDraft((current) => ({
                    ...current,
                    parlayLegs: [...current.parlayLegs, emptyLeg(undefined)],
                  }))
                }
                onRemove={(index) =>
                  setDraft((current) => ({
                    ...current,
                    parlayLegs: current.parlayLegs.filter(
                      (_, candidateIndex) => candidateIndex !== index,
                    ),
                  }))
                }
              />
            </div>
          ) : null}
          <p>
            {draft.ticketType === "parlay"
              ? `${draft.parlayLegs.length} legs`
              : `${draft.eventDescription} · ${draft.selection}`}{" "}
            · {draft.stakeDollars} USD · {draft.americanOdds} · {draft.returnDollars} USD total
            return
          </p>
          {checkingDuplicates ? <p>Checking for likely duplicates…</p> : null}
          {duplicates.length ? (
            <div className="duplicate-warning" role="alert">
              {/* Regression fixture copy: This wager may already be in My Bets. */}
              <strong>Potential duplicate wager</strong>
              <ul>
                {duplicates.map((duplicate) => (
                  <li key={duplicate.wager_id}>
                    {duplicate.sportsbook_name || "Unknown sportsbook"} ·{" "}
                    {duplicate.duplicate_signal}
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

function ParlayLegEditor({
  legs,
  canonicalEvents,
  competitions,
  nowIso,
  compact = false,
  onChooseEvent,
  onUpdate,
  onAdd,
  onRemove,
}: {
  legs: ParlayLeg[];
  canonicalEvents: CachedEvent[];
  competitions: Competition[];
  nowIso: string;
  compact?: boolean;
  onChooseEvent: (index: number, providerEventId: string) => void;
  onUpdate: (index: number, patch: Partial<ParlayLeg>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="parlay-leg-editor">
      {legs.map((leg, index) => {
        const selectedCompetition = competitions.find(
          (competition) => competition.id === leg.competitionKey,
        );
        return (
          <fieldset className="parlay-leg-fieldset" key={`${index}-${leg.providerEventId}`}>
            <legend>Leg {index + 1}</legend>
            {!compact ? (
              <CachedEventSearch
                inputId={`cached-event-query-${index}`}
                events={canonicalEvents}
                selectedEventId={leg.providerEventId}
                nowIso={nowIso}
                onSelect={(id) => onChooseEvent(index, id)}
              />
            ) : null}
            <div className="form-grid">
              <label className="form-wide">
                Event or matchup
                <input
                  id={`parlay-leg-${index}-event`}
                  value={leg.eventDescription}
                  onChange={(event) => onUpdate(index, { eventDescription: event.target.value })}
                  required
                />
              </label>
              <label>
                Competition
                <select
                  value={leg.competitionKey}
                  onChange={(event) => {
                    const competition = competitions.find(
                      (candidate) => candidate.id === event.target.value,
                    );
                    onUpdate(index, {
                      competitionKey: event.target.value,
                      sportKey: competition?.sport ?? leg.sportKey,
                    });
                  }}
                >
                  {competitions.map((competition) => (
                    <option key={competition.id} value={competition.id}>
                      {competition.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kickoff
                <input
                  type="datetime-local"
                  value={leg.eventDate}
                  onChange={(event) => onUpdate(index, { eventDate: event.target.value })}
                  required
                />
              </label>
              <label>
                Market
                <select
                  value={leg.marketType}
                  onChange={(event) =>
                    onUpdate(index, {
                      marketType: event.target.value,
                      line: event.target.value === "moneyline" ? "" : leg.line,
                    })
                  }
                >
                  <option value="moneyline">Moneyline</option>
                  <option value="spread">Spread / Handicap</option>
                  <option value="total">Total</option>
                </select>
              </label>
              <label>
                Selection
                <input
                  id={`parlay-leg-${index}-selection`}
                  value={leg.selection}
                  onChange={(event) => onUpdate(index, { selection: event.target.value })}
                  required
                />
              </label>
              <label>
                Line
                <input
                  type="number"
                  step="0.0001"
                  value={leg.line}
                  onChange={(event) => onUpdate(index, { line: event.target.value })}
                  placeholder={leg.marketType === "moneyline" ? "Not used" : "Required"}
                  required={leg.marketType !== "moneyline"}
                />
              </label>
              <label>
                American odds
                <input
                  type="number"
                  step="1"
                  value={leg.americanOdds}
                  onChange={(event) => onUpdate(index, { americanOdds: event.target.value })}
                  required
                />
              </label>
              <div className="field-readout" aria-live="polite">
                <span>Your Pick</span>
                <strong>{leg.selectionKey ? leg.selectionKey : "Needs review"}</strong>
                <small>Inferred from the pick and event; no manual grading code is required.</small>
              </div>
              <label>
                Canonical event ID
                <input
                  value={leg.providerEventId}
                  onChange={(event) => onUpdate(index, { providerEventId: event.target.value })}
                  maxLength={160}
                  placeholder="Optional for matching"
                />
              </label>
            </div>
            {selectedCompetition ? (
              <small className="muted">
                {selectedCompetition.name} · canonical selection enables Auto settlement ready when
                every leg is supported.
              </small>
            ) : null}
            {legs.length > 2 ? (
              <button className="text-button" type="button" onClick={() => onRemove(index)}>
                Remove leg
              </button>
            ) : null}
          </fieldset>
        );
      })}
      <button
        className="button secondary"
        type="button"
        disabled={legs.length >= 12}
        onClick={onAdd}
      >
        Add parlay leg
      </button>
    </div>
  );
}
