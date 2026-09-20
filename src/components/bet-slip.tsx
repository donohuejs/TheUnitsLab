"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { placeParlayBet, placeStraightBet, placeStraightBets } from "@/app/sports/bet-actions";
import { KickoffTime } from "@/components/kickoff-time";
import { SubmitButton } from "@/components/submit-button";
import { MarketBadge, SourceBadge, TicketTypeBadge } from "@/components/status-badge";
import { TeamMark } from "@/components/team-mark";
import { calculateParlayPotential } from "@/lib/parlays/calculations";
import {
  alternateSpreadLines,
  simulateAlternateSpreadPrice,
} from "@/lib/wagers/simulated-alternate";
import {
  clearSlip,
  clearStraightSlip,
  assessParlayAvailability,
  getEmptyStraightSlipSnapshot,
  getEmptySlipSnapshot,
  getEmptyPendingSlipSnapshot,
  getPendingSlipSnapshot,
  getClientSelectionId,
  getStraightSlipSnapshot,
  getSlipSnapshot,
  removePendingSlipSelectionIdsAndPersist,
  removeSlipSelectionIdsAndPersist,
  removeStraightSlipSelectionIdsAndPersist,
  replaceMutuallyExclusiveSelection,
  setPendingSlipSelections,
  setStraightSlipSelections,
  setSlipSelections,
  subscribeToStraightSlip,
  slipSelectionKey,
  subscribeToSlip,
  type SlipSelection,
} from "@/lib/wagers/slip";
import { calculatePotential } from "@/lib/wagers/calculations";

type Props = {
  selection: SlipSelection | null;
  groups: { id: string; name: string }[];
  initialMobileSheetOpen?: boolean;
};

const americanPrice = (value: number) => (value > 0 ? `+${value}` : String(value));

function selectionLabel(selection: SlipSelection) {
  return `${selection.selectionName}${
    selection.line === null ? "" : ` ${selection.line > 0 ? "+" : ""}${selection.line}`
  }`;
}

function subscribeToMobileViewport(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(max-width: 760px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getMobileViewportSnapshot() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

function getServerMobileViewportSnapshot() {
  return false;
}

function createPlacementAttemptKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function attachPlacementAttemptKey(form: HTMLFormElement, keyRef: { current: string | null }) {
  keyRef.current ??= createPlacementAttemptKey();
  const input = form.elements.namedItem("idempotencyKey");
  if (input instanceof HTMLInputElement) input.value = keyRef.current;
}

export function BetSlip({ selection, groups, initialMobileSheetOpen = false }: Props) {
  const [stake, setStake] = useState("10.00");
  const [parlayStake, setParlayStake] = useState("10.00");
  const [straightStake, setStraightStake] = useState("10.00");
  const [parlayNotice, setParlayNotice] = useState("");
  const [straightNotice, setStraightNotice] = useState("");
  const [mobileSheetOpen, setMobileSheetOpen] = useState(initialMobileSheetOpen);
  const [mobileAcknowledgement, setMobileAcknowledgement] = useState("");
  const [mobileReturnPathValue, setMobileReturnPathValue] = useState("");
  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  );
  const trayButtonRef = useRef<HTMLButtonElement>(null);
  const sheetCloseButtonRef = useRef<HTMLButtonElement>(null);
  const straightPlacementKeyRef = useRef<string | null>(null);
  const straightBatchPlacementKeyRef = useRef<string | null>(null);
  const parlayPlacementKeyRef = useRef<string | null>(null);
  const mobileReturnPath = useRef("");
  const [alternateLineState, setAlternateLineState] = useState<{
    selectionKey: string;
    line: number;
  } | null>(null);
  const legs = useSyncExternalStore(subscribeToSlip, getSlipSnapshot, getEmptySlipSnapshot);
  const straightSelections = useSyncExternalStore(
    subscribeToStraightSlip,
    getStraightSlipSnapshot,
    getEmptyStraightSlipSnapshot,
  );
  const mobileSelections = useSyncExternalStore(
    subscribeToSlip,
    getPendingSlipSnapshot,
    getEmptyPendingSlipSnapshot,
  );
  const mobileSelectionCount = mobileSelections.length;
  const mobileSheetSelection = mobileSelectionCount === 1 ? (mobileSelections[0] ?? null) : null;
  const mobileModalOpen = mobileSheetOpen && isMobileViewport && mobileSelectionCount > 0;

  useEffect(() => {
    const updateReturnPath = () => {
      const current = new URL(window.location.href);
      current.searchParams.set("mobileSheet", "1");
      mobileReturnPath.current = `${current.pathname}${current.search}`;
      setMobileReturnPathValue(mobileReturnPath.current);
    };
    updateReturnPath();
    window.addEventListener("popstate", updateReturnPath);
    return () => window.removeEventListener("popstate", updateReturnPath);
  }, [selection]);

  useEffect(() => {
    if (!selection || !isMobileViewport) return;
    const activeKey = slipSelectionKey(selection);
    const existingIndex = mobileSelections.findIndex((leg) => slipSelectionKey(leg) === activeKey);
    if (existingIndex >= 0) return;
    const replacement = replaceMutuallyExclusiveSelection(mobileSelections, selection);
    if (replacement) {
      setPendingSlipSelections(replacement);
      const timeout = window.setTimeout(() => {
        setMobileAcknowledgement(`${selectionLabel(selection)} replaced previous pick`);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (mobileSelections.length >= 12) {
      const timeout = window.setTimeout(
        () => setMobileAcknowledgement("The mobile parlay already has 12 picks."),
        0,
      );
      return () => window.clearTimeout(timeout);
    }
    setPendingSlipSelections([...mobileSelections, selection]);
    window.setTimeout(() => {
      setMobileAcknowledgement(`${selectionLabel(selection)} added`);
      window.setTimeout(() => setMobileAcknowledgement(""), 2400);
    }, 0);
  }, [isMobileViewport, mobileSelections, selection]);

  useEffect(() => {
    if (!mobileModalOpen) return;
    const scrollY = window.scrollY;
    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSheetOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => sheetCloseButtonRef.current?.focus());
    const trayButton = trayButtonRef.current;
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.width = previous.bodyWidth;
      window.scrollTo(0, scrollY);
      window.requestAnimationFrame(() => trayButton?.focus());
    };
  }, [mobileModalOpen]);

  const selectionIsInMobileSlip = Boolean(
    selection &&
    mobileSelections.some(
      (candidate) => slipSelectionKey(candidate) === slipSelectionKey(selection),
    ),
  );
  const storedMobileSelection = selection
    ? mobileSelections.find(
        (candidate) => slipSelectionKey(candidate) === slipSelectionKey(selection),
      )
    : null;
  const currentSelection = mobileModalOpen
    ? selectionIsInMobileSlip
      ? (storedMobileSelection ?? selection)
      : mobileSheetSelection
    : selection;
  const selectionKey = currentSelection ? slipSelectionKey(currentSelection) : "";
  const alternateLine =
    alternateLineState?.selectionKey === selectionKey ? alternateLineState.line : null;

  const alternatePrice = useMemo(() => {
    if (
      !currentSelection ||
      currentSelection.marketType !== "spread" ||
      currentSelection.line === null
    )
      return null;
    try {
      return simulateAlternateSpreadPrice({
        anchorProviderLine: currentSelection.line,
        anchorProviderAmericanOdds: currentSelection.americanOdds,
        adjustedLine: alternateLine ?? currentSelection.line,
      });
    } catch {
      return null;
    }
  }, [currentSelection, alternateLine]);

  const activeSelection = useMemo(
    () =>
      currentSelection &&
      alternatePrice &&
      alternateLine !== null &&
      alternateLine !== currentSelection.line
        ? {
            ...currentSelection,
            line: alternatePrice.adjustedLine,
            americanOdds: alternatePrice.simulatedAmericanOdds,
            decimalOdds: alternatePrice.simulatedDecimalOdds,
            pricingSource: alternatePrice.pricingSource,
            anchorProviderLine: alternatePrice.anchorProviderLine,
            anchorProviderAmericanOdds: alternatePrice.anchorProviderAmericanOdds,
            pricingModel: alternatePrice.pricingModel,
            pricingModelVersion: alternatePrice.pricingModelVersion,
          }
        : currentSelection,
    [currentSelection, alternatePrice, alternateLine],
  );

  useEffect(() => {
    if (!selection || !activeSelection || !window.matchMedia("(max-width: 760px)").matches) return;
    const baseKey = slipSelectionKey(selection);
    const activeKey = slipSelectionKey(activeSelection);
    if (baseKey === activeKey) return;
    const baseIndex = mobileSelections.findIndex((leg) => slipSelectionKey(leg) === baseKey);
    if (baseIndex < 0) return;
    const next = [...mobileSelections];
    next[baseIndex] = activeSelection;
    setPendingSlipSelections(next);
  }, [activeSelection, mobileSelections, selection]);

  function addCurrentLeg() {
    if (!selection || !activeSelection) {
      setParlayNotice("Select a price first, then add it to the parlay.");
      return;
    }
    const replacement = replaceMutuallyExclusiveSelection(legs, activeSelection);
    if (replacement) {
      const next = replacement;
      setSlipSelections(next);
      setParlayNotice("Opposite outcome replaced the previous selection.");
      return;
    }
    if (legs.length >= 12) {
      setParlayNotice("A parlay can contain at most 12 legs.");
      return;
    }
    if (legs.some((leg) => slipSelectionKey(leg) === slipSelectionKey(activeSelection))) {
      setParlayNotice("That selection is already in the parlay.");
      return;
    }
    setSlipSelections([...legs, activeSelection]);
    const availability = assessParlayAvailability([...legs, activeSelection]);
    setParlayNotice(
      availability.eligible
        ? "Selection added to the parlay."
        : `Selection added. ${availability.reason} It remains available as a straight bet.`,
    );
  }

  function addCurrentStraight() {
    if (!selection || !activeSelection) {
      setStraightNotice("Select a price first, then add it to the straight-bet slip.");
      return;
    }
    if (straightSelections.length >= 12) {
      setStraightNotice("The straight-bet slip can contain at most 12 selections.");
      return;
    }
    const replacement = replaceMutuallyExclusiveSelection(straightSelections, activeSelection);
    if (replacement) {
      setStraightSlipSelections(replacement);
      setStraightNotice("Opposite outcome replaced the previous straight selection.");
      return;
    }
    if (
      straightSelections.some((leg) => slipSelectionKey(leg) === slipSelectionKey(activeSelection))
    ) {
      setStraightNotice("That selection is already in the straight-bet slip.");
      return;
    }
    setStraightSlipSelections([...straightSelections, activeSelection]);
    setStraightNotice("Selection added to independent straight bets.");
  }

  const straightPotential = useMemo(() => {
    if (!activeSelection) return null;
    try {
      return calculatePotential(stake, activeSelection.decimalOdds.toFixed(4));
    } catch {
      return null;
    }
  }, [activeSelection, stake]);

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

  const straightPreviews = useMemo(
    () =>
      straightSelections.map((leg) => {
        try {
          return calculatePotential(straightStake, leg.decimalOdds.toFixed(4));
        } catch {
          return null;
        }
      }),
    [straightSelections, straightStake],
  );
  const mobileParlayAvailability = useMemo(
    () => assessParlayAvailability(mobileSelections),
    [mobileSelections],
  );
  const parlayAvailability = useMemo(() => assessParlayAvailability(legs), [legs]);

  const submittedLegs = legs.map((leg) => ({
    competitionKey: leg.competitionKey,
    eventId: leg.eventId,
    bookmakerId: leg.bookmakerId,
    marketType: leg.marketType,
    selection: leg.selection,
    expectedAmericanOdds: leg.americanOdds,
    expectedLine: leg.line,
    anchorProviderLine: leg.anchorProviderLine ?? null,
    anchorProviderAmericanOdds: leg.anchorProviderAmericanOdds ?? null,
    pricingSource: leg.pricingSource ?? "provider",
    pricingModel: leg.pricingModel ?? null,
    pricingModelVersion: leg.pricingModelVersion ?? null,
  }));
  const submittedStraightLegs = straightSelections.map((leg) => ({
    competitionKey: leg.competitionKey,
    eventId: leg.eventId,
    bookmakerId: leg.bookmakerId,
    marketType: leg.marketType,
    selection: leg.selection,
    expectedAmericanOdds: leg.americanOdds,
    expectedLine: leg.line,
    anchorProviderLine: leg.anchorProviderLine ?? null,
    anchorProviderAmericanOdds: leg.anchorProviderAmericanOdds ?? null,
    pricingSource: leg.pricingSource ?? "provider",
    pricingModel: leg.pricingModel ?? null,
    pricingModelVersion: leg.pricingModelVersion ?? null,
  }));

  const mobileParlayMode = mobileSelectionCount >= 2;
  const mobileSingleMode = mobileSelectionCount === 1;
  const mobileTrayOdds =
    mobileParlayAvailability.eligible && parlayPotential
      ? `Parlay ${americanPrice(parlayPotential.americanOdds)}`
      : "";
  const openMobileSheet = () => {
    if (mobileSelectionCount) setMobileSheetOpen(true);
  };
  const removeSelection = (
    candidate: SlipSelection | null,
    index: number,
    mode: "mobile" | "parlay" | "straight",
  ) => {
    if (!candidate) return;
    const clientSelectionId = getClientSelectionId(candidate, index);
    if (mode === "mobile") removePendingSlipSelectionIdsAndPersist([clientSelectionId]);
    else if (mode === "parlay") removeSlipSelectionIdsAndPersist([clientSelectionId]);
    else removeStraightSlipSelectionIdsAndPersist([clientSelectionId]);
    if (mode === "mobile" && mobileSelectionCount <= 1) setMobileSheetOpen(false);
  };
  const removeCurrentMobileSelection = () => {
    if (!currentSelection) return;
    const index = mobileSelections.findIndex(
      (candidate) => slipSelectionKey(candidate) === slipSelectionKey(currentSelection),
    );
    if (index >= 0) removeSelection(mobileSelections[index] ?? null, index, "mobile");
  };
  const removeParlayLeg = (leg: SlipSelection, index: number) => {
    if (!legs.some((candidate) => slipSelectionKey(candidate) === slipSelectionKey(leg))) return;
    removeSelection(leg, index, isMobileViewport ? "mobile" : "parlay");
  };

  return (
    <aside
      className={mobileSelectionCount ? "bet-slip-stack has-mobile-slip" : "bet-slip-stack"}
      aria-label="Simulated bet slips"
    >
      {mobileSelectionCount ? (
        <div className="mobile-slip-tray-wrap">
          {mobileAcknowledgement ? (
            <p className="mobile-slip-acknowledgement" role="status" aria-live="polite">
              {mobileAcknowledgement}
            </p>
          ) : null}
          <button
            ref={trayButtonRef}
            className="mobile-slip-tray"
            type="button"
            aria-label={`Open Bet Slip, ${mobileSelectionCount} ${mobileSelectionCount === 1 ? "pick" : "picks"}`}
            aria-controls="mobile-bet-slip-sheet"
            aria-expanded={mobileModalOpen}
            onClick={openMobileSheet}
          >
            <span className="mobile-slip-tray-summary">
              <span className="mobile-slip-check" aria-hidden="true">
                ✓
              </span>
              <strong>
                {mobileSelectionCount} {mobileSelectionCount === 1 ? "Pick" : "Picks"}
              </strong>
              {mobileTrayOdds ? <span>• {mobileTrayOdds}</span> : null}
            </span>
            <span className="mobile-slip-tray-action">Bet Slip ↑</span>
          </button>
        </div>
      ) : null}
      {mobileModalOpen ? (
        <button
          className="mobile-slip-backdrop"
          type="button"
          aria-label="Close Bet Slip"
          onClick={() => setMobileSheetOpen(false)}
        />
      ) : null}
      <section
        id="mobile-bet-slip-sheet"
        className={`mobile-slip-sheet${mobileModalOpen ? " is-open" : ""}${mobileParlayMode ? " mobile-parlay-mode" : ""}${mobileSingleMode ? " mobile-single-mode" : ""}`}
        role={mobileModalOpen ? "dialog" : undefined}
        aria-modal={mobileModalOpen ? "true" : undefined}
        aria-labelledby={mobileModalOpen ? "mobile-bet-slip-title" : undefined}
      >
        <div className="mobile-slip-sheet-header">
          <div>
            <p className="eyebrow">Simulated Vials only</p>
            <h2 id="mobile-bet-slip-title">Bet Slip</h2>
          </div>
          <button
            ref={sheetCloseButtonRef}
            className="button secondary mobile-slip-close"
            type="button"
            aria-label="Close Bet Slip"
            onClick={() => setMobileSheetOpen(false)}
          >
            Close
          </button>
        </div>
        <div className="mobile-slip-sheet-scroll">
          <div className="bet-slip-content">
            {currentSelection ? (
              <section className="card bet-slip mobile-current-slip">
                <div className="ticket-meta">
                  <SourceBadge source="simulated" />
                  <TicketTypeBadge ticketType="straight" />
                </div>
                <h2>Straight bet — one leg</h2>
                <p className="simulation-label">
                  Virtual Vials only. No real-money wager is placed.
                </p>
                <dl className="ticket-details">
                  <div>
                    <dt>Competition</dt>
                    <dd>{activeSelection?.competition}</dd>
                  </div>
                  <div>
                    <dt>Event</dt>
                    <dd className="team-pair">
                      <span>
                        <TeamMark
                          teamName={activeSelection?.awayTeam ?? ""}
                          sport={activeSelection?.sport ?? ""}
                        />
                        {activeSelection?.awayTeam}
                      </span>
                      <span className="event-at">at</span>
                      <span>
                        <TeamMark
                          teamName={activeSelection?.homeTeam ?? ""}
                          sport={activeSelection?.sport ?? ""}
                        />
                        {activeSelection?.homeTeam}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Kickoff</dt>
                    <dd>
                      <KickoffTime value={activeSelection?.scheduledStart ?? ""} />
                    </dd>
                  </div>
                  <div>
                    <dt>Bookmaker</dt>
                    <dd>{activeSelection?.bookmaker}</dd>
                  </div>
                  <div>
                    <dt>Market</dt>
                    <dd>
                      <MarketBadge market={activeSelection?.marketType ?? "moneyline"} />
                    </dd>
                  </div>
                  <div>
                    <dt>Selection</dt>
                    <dd>
                      {activeSelection?.selectionName}
                      {activeSelection?.line === null
                        ? ""
                        : ` ${activeSelection && activeSelection.line > 0 ? "+" : ""}${activeSelection?.line}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Odds</dt>
                    <dd>
                      {activeSelection ? americanPrice(activeSelection.americanOdds) : "—"} (
                      {activeSelection?.decimalOdds.toFixed(4)})
                    </dd>
                  </div>
                </dl>
                {currentSelection.marketType === "spread" && currentSelection.line !== null ? (
                  <section className="simulated-alternate" aria-label="Simulated alternate line">
                    <h3>Simulated alternate line</h3>
                    <p>
                      Adjust line is an explicit model estimate. It is not a DraftKings, FanDuel, or
                      other provider-offered price.
                    </p>
                    <label>
                      Adjust line
                      <select
                        value={alternateLine ?? currentSelection.line}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setAlternateLineState(
                            value === currentSelection.line ? null : { selectionKey, line: value },
                          );
                        }}
                      >
                        {alternateSpreadLines(currentSelection.line).map((line: number) => (
                          <option key={line} value={line}>
                            {line > 0 ? "+" : ""}
                            {line}
                            {line === currentSelection.line ? " · provider anchor" : " · simulated"}
                          </option>
                        ))}
                      </select>
                    </label>
                    {alternatePrice ? (
                      <dl className="ticket-details compact">
                        <div>
                          <dt>Original provider line</dt>
                          <dd>
                            {currentSelection.line > 0 ? "+" : ""}
                            {currentSelection.line}
                          </dd>
                        </div>
                        <div>
                          <dt>Original provider price</dt>
                          <dd>{americanPrice(currentSelection.americanOdds)}</dd>
                        </div>
                        <div>
                          <dt>Adjusted line</dt>
                          <dd>
                            {alternatePrice.adjustedLine > 0 ? "+" : ""}
                            {alternatePrice.adjustedLine}
                          </dd>
                        </div>
                        <div>
                          <dt>Simulated price</dt>
                          <dd>{americanPrice(alternatePrice.simulatedAmericanOdds)}</dd>
                        </div>
                        <div>
                          <dt>Updated potential return</dt>
                          <dd>
                            {alternateLine !== null && alternateLine !== currentSelection.line
                              ? (() => {
                                  try {
                                    return `${calculatePotential(stake, alternatePrice.simulatedDecimalOdds.toFixed(4)).return} Vials`;
                                  } catch {
                                    return "Enter a valid stake";
                                  }
                                })()
                              : straightPotential
                                ? `${straightPotential.return} Vials`
                                : "—"}
                          </dd>
                        </div>
                      </dl>
                    ) : null}
                  </section>
                ) : null}
                {selection ? (
                  <div className="inline-actions">
                    <button className="button secondary" type="button" onClick={addCurrentStraight}>
                      Add to straight bets
                    </button>
                    <button className="button secondary" type="button" onClick={addCurrentLeg}>
                      Add to parlay
                    </button>
                  </div>
                ) : null}
                <button
                  className="button secondary mobile-only-control"
                  type="button"
                  onClick={removeCurrentMobileSelection}
                >
                  Remove selection
                </button>
                <form
                  action={placeStraightBet}
                  className="form-stack"
                  onSubmitCapture={(event) =>
                    attachPlacementAttemptKey(event.currentTarget, straightPlacementKeyRef)
                  }
                >
                  <input type="hidden" name="idempotencyKey" defaultValue="" />
                  <input
                    type="hidden"
                    name="competitionKey"
                    value={activeSelection?.competitionKey}
                  />
                  <input type="hidden" name="eventId" value={activeSelection?.eventId} />
                  <input type="hidden" name="bookmakerId" value={activeSelection?.bookmakerId} />
                  <input type="hidden" name="marketType" value={activeSelection?.marketType} />
                  <input type="hidden" name="selection" value={activeSelection?.selection} />
                  <input
                    type="hidden"
                    name="expectedAmericanOdds"
                    value={activeSelection?.americanOdds}
                  />
                  <input type="hidden" name="expectedLine" value={activeSelection?.line ?? ""} />
                  <input
                    type="hidden"
                    name="anchorProviderLine"
                    value={activeSelection?.anchorProviderLine ?? ""}
                  />
                  <input
                    type="hidden"
                    name="anchorProviderAmericanOdds"
                    value={activeSelection?.anchorProviderAmericanOdds ?? ""}
                  />
                  <input
                    type="hidden"
                    name="pricingSource"
                    value={activeSelection?.pricingSource ?? "provider"}
                  />
                  <input
                    type="hidden"
                    name="pricingModel"
                    value={activeSelection?.pricingModel ?? ""}
                  />
                  <input
                    type="hidden"
                    name="pricingModelVersion"
                    value={activeSelection?.pricingModelVersion ?? ""}
                  />
                  <input
                    type="hidden"
                    name="slipKey"
                    value={isMobileViewport ? selectionKey : ""}
                  />
                  <input
                    type="hidden"
                    name="pendingSlipKey"
                    value={isMobileViewport ? selectionKey : ""}
                  />
                  <input
                    type="hidden"
                    name="returnTo"
                    value={isMobileViewport ? mobileReturnPathValue : ""}
                  />
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
                      Study association (optional)
                      <select name="groupId" defaultValue="">
                        <option value="">No Study</option>
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
                      <strong>
                        {straightPotential ? `${straightPotential.profit} Vials` : "—"}
                      </strong>
                    </span>
                    <span>
                      Potential return{" "}
                      <strong>
                        {straightPotential ? `${straightPotential.return} Vials` : "—"}
                      </strong>
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

            <section
              className={`card bet-slip mobile-straight-slip${straightSelections.length ? "" : " mobile-empty-slip"}`}
            >
              <div className="ticket-meta">
                <SourceBadge source="simulated" />
                <TicketTypeBadge ticketType="straight" />
              </div>
              <h2>Straights — {straightSelections.length} selections</h2>
              <p className="muted">
                Add independent bets from any competition and submit them together. Each selection
                is placed as its own simulated wager with its own ticket and ledger entry.
              </p>
              {straightNotice ? <p className="notice">{straightNotice}</p> : null}
              {straightSelections.length ? (
                <ol className="parlay-leg-list">
                  {straightSelections.map((leg, index) => (
                    <li key={getClientSelectionId(leg, index)}>
                      <div className="parlay-leg-copy">
                        <strong>
                          {index + 1}. <MarketBadge market={leg.marketType} /> {leg.selectionName}
                          {leg.line === null ? "" : ` ${leg.line > 0 ? "+" : ""}${leg.line}`}
                        </strong>
                        <small className="parlay-leg-context">
                          <span className="team-pair">
                            <TeamMark teamName={leg.awayTeam} sport={leg.sport} />
                            {leg.awayTeam} at <TeamMark teamName={leg.homeTeam} sport={leg.sport} />
                            {leg.homeTeam}
                          </span>
                          <span>
                            {leg.competition} · <KickoffTime value={leg.scheduledStart} /> ·{" "}
                            {leg.bookmaker}
                          </span>
                          <span>
                            {americanPrice(leg.americanOdds)} ({leg.decimalOdds.toFixed(4)}) ·
                            potential{" "}
                            {straightPreviews[index]
                              ? `${straightPreviews[index]!.profit} Vials profit`
                              : "—"}
                          </span>
                          {leg.pricingSource === "simulated_alternate" ? (
                            <span>Simulated alternate line · provider anchor preserved</span>
                          ) : null}
                        </small>
                      </div>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          removeSelection(leg, index, isMobileViewport ? "mobile" : "straight")
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty-state">
                  <strong>No straight bets added</strong>
                  Choose a price above and add it here. This slip persists across competition
                  navigation and refresh.
                </p>
              )}
              <form
                action={placeStraightBets}
                className="form-stack"
                onSubmitCapture={(event) =>
                  attachPlacementAttemptKey(event.currentTarget, straightBatchPlacementKeyRef)
                }
              >
                <input type="hidden" name="idempotencyKey" defaultValue="" />
                <input type="hidden" name="legs" value={JSON.stringify(submittedStraightLegs)} />
                <input
                  type="hidden"
                  name="slipKeys"
                  value={straightSelections.map(slipSelectionKey).join(",")}
                />
                <input
                  type="hidden"
                  name="pendingSlipKeys"
                  value={isMobileViewport ? straightSelections.map(slipSelectionKey).join(",") : ""}
                />
                <label>
                  Stake per straight bet in Vials
                  <input
                    name="stake"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    value={straightStake}
                    onChange={(event) => setStraightStake(event.target.value)}
                  />
                </label>
                {groups.length ? (
                  <label>
                    Study association (optional)
                    <select name="groupId" defaultValue="">
                      <option value="">No Study</option>
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
                <small className="muted">
                  The entered stake applies independently to each selected straight bet. The server
                  rechecks every event, line, and price before accepting each ticket.
                </small>
                <SubmitButton
                  pendingLabel="Placing straight bets…"
                  className="button"
                  disabled={
                    !straightSelections.length || straightPreviews.some((preview) => !preview)
                  }
                >
                  Place all straight bets
                </SubmitButton>
                {straightSelections.length ? (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      clearStraightSlip();
                      setStraightNotice("Straight-bet slip cleared.");
                    }}
                  >
                    Clear straights
                  </button>
                ) : null}
              </form>
            </section>

            <section
              className={`card bet-slip mobile-parlay-slip${mobileParlayMode ? "" : " mobile-empty-slip"}`}
            >
              <div className="ticket-meta">
                <SourceBadge source="simulated" />
                <TicketTypeBadge ticketType="parlay" />
              </div>
              <h2>Build a parlay — {legs.length} of 12 legs</h2>
              <p className="muted">
                {parlayAvailability.eligible
                  ? "These selections are eligible for a standard multi-game parlay."
                  : `Parlay unavailable — ${parlayAvailability.reason.replace(/^Parlay unavailable — /, "")}`}
              </p>
              {parlayNotice ? <p className="notice">{parlayNotice}</p> : null}
              <ol className="parlay-leg-list">
                {legs.map((leg, index) => (
                  <li key={getClientSelectionId(leg, index)}>
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
                        {leg.pricingSource === "simulated_alternate" ? (
                          <span>Simulated alternate line · provider anchor preserved</span>
                        ) : null}
                      </small>
                    </div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => removeParlayLeg(leg, index)}
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
              <form
                action={placeParlayBet}
                className="form-stack"
                onSubmitCapture={(event) =>
                  attachPlacementAttemptKey(event.currentTarget, parlayPlacementKeyRef)
                }
              >
                <input type="hidden" name="idempotencyKey" defaultValue="" />
                <input type="hidden" name="legs" value={JSON.stringify(submittedLegs)} />
                <input type="hidden" name="slipKeys" value={legs.map(slipSelectionKey).join(",")} />
                <input
                  type="hidden"
                  name="pendingSlipKeys"
                  value={isMobileViewport ? legs.map(slipSelectionKey).join(",") : ""}
                />
                <input
                  type="hidden"
                  name="returnTo"
                  value={isMobileViewport ? mobileReturnPathValue : ""}
                />
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
                    Study association (optional)
                    <select name="groupId" defaultValue="">
                      <option value="">No Study</option>
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
                  Combined odds and payout are a preview only. The server rechecks every leg, price,
                  line, bookmaker, and event before accepting the ticket.
                </small>
                <SubmitButton
                  pendingLabel="Placing parlay…"
                  className="button"
                  disabled={!parlayPotential || !parlayAvailability.eligible}
                >
                  <span className="desktop-cta-label">Place simulated parlay</span>
                  <span className="mobile-cta-label">Place {legs.length}-leg parlay</span>
                </SubmitButton>
                {legs.length ? (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      clearSlip();
                      setMobileSheetOpen(false);
                      setParlayNotice("Parlay slip cleared.");
                    }}
                  >
                    Clear parlay
                  </button>
                ) : null}
              </form>
            </section>
          </div>
        </div>
      </section>
    </aside>
  );
}
