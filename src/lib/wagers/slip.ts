import type { MarketType, SelectionType } from "@/lib/odds/types";

export type SlipSelection = {
  /** Stable UI identity. It is persisted with the slip and is not a market key. */
  clientSelectionId?: string;
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
  marketType: MarketType;
  selection: SelectionType;
  selectionName: string;
  line: number | null;
  americanOdds: number;
  decimalOdds: number;
  pricingSource?: "provider" | "simulated_alternate";
  anchorProviderLine?: number | null;
  anchorProviderAmericanOdds?: number | null;
  pricingModel?: string | null;
  pricingModelVersion?: string | null;
};

/** One durable cart now owns both the straight and parlay views. */
export const SLIP_STORAGE_KEY = "sportsbook-simulator:pending-slip";
/** Kept as an export for callers from the previous patch; it aliases the unified cart. */
export const STRAIGHT_SLIP_STORAGE_KEY = SLIP_STORAGE_KEY;

const LEGACY_PARLAY_STORAGE_KEY = "sportsbook-simulator:phase7-parlay";
const LEGACY_STRAIGHT_STORAGE_KEY = "sportsbook-simulator:release-candidate-straights";

type StoredSlip = {
  version: 1;
  selections: SlipSelection[];
  parlayKeys: string[];
  straightKeys: string[];
};

export type SlipDiagnosticAction =
  | "ADD"
  | "REMOVE"
  | "CLEAR"
  | "REPLACE"
  | "SET"
  | "RECONCILE"
  | "INITIALIZE"
  | "HYDRATE"
  | "SUBMIT_CLEAR";

export type SlipDiagnosticSelection = {
  id: string;
  eventId: string;
};

export type SlipDiagnosticMutation = {
  timestamp: string;
  action: SlipDiagnosticAction;
  beforeCount: number;
  afterCount: number;
  beforeSelectionIds: string[];
  afterSelectionIds: string[];
  beforeEventIds: string[];
  afterEventIds: string[];
  reason: string;
};

export type SlipDiagnosticSnapshot = {
  enabled: boolean;
  storeInstanceId: string;
  mountCount: number;
  durableStraight: SlipDiagnosticSelection[];
  recentMutations: SlipDiagnosticMutation[];
};

const EMPTY_SLIP: SlipSelection[] = [];
const EMPTY_STATE: StoredSlip = { version: 1, selections: [], parlayKeys: [], straightKeys: [] };
const MAX_PENDING_SELECTIONS = 24;
const MAX_SLIP_DIAGNOSTIC_MUTATIONS = 20;
const slipStoreInstanceId = `store-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function isSlipSelection(value: unknown): value is SlipSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SlipSelection>;
  return (
    typeof candidate.competitionKey === "string" &&
    typeof candidate.eventId === "string" &&
    typeof candidate.sport === "string" &&
    typeof candidate.competition === "string" &&
    typeof candidate.event === "string" &&
    typeof candidate.scheduledStart === "string" &&
    typeof candidate.homeTeam === "string" &&
    typeof candidate.awayTeam === "string" &&
    typeof candidate.bookmakerId === "string" &&
    typeof candidate.bookmaker === "string" &&
    (candidate.marketType === "moneyline" ||
      candidate.marketType === "spread" ||
      candidate.marketType === "total") &&
    (candidate.selection === "home" ||
      candidate.selection === "away" ||
      candidate.selection === "draw" ||
      candidate.selection === "over" ||
      candidate.selection === "under") &&
    typeof candidate.selectionName === "string" &&
    (candidate.line === null || typeof candidate.line === "number") &&
    typeof candidate.americanOdds === "number" &&
    typeof candidate.decimalOdds === "number"
  );
}

export function createClientSelectionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `slip-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function legacyClientSelectionId(selection: SlipSelection, index: number) {
  return `legacy-${encodeURIComponent(slipSelectionKey(selection))}-${index}`;
}

export function getClientSelectionId(selection: SlipSelection, index = 0) {
  return selection.clientSelectionId || legacyClientSelectionId(selection, index);
}

function withClientSelectionId(selection: SlipSelection, index: number, fallback?: string) {
  return {
    ...selection,
    clientSelectionId: selection.clientSelectionId || fallback || createClientSelectionId(),
  };
}

function uniqueKeys(keys: string[]) {
  return [...new Set(keys)].slice(0, 12);
}

function stateFromSelections(
  selections: SlipSelection[],
  parlayKeys: string[] = [],
  straightKeys: string[] = [],
): StoredSlip {
  const validSelections = selections
    .filter(isSlipSelection)
    .map((selection, index) =>
      withClientSelectionId(selection, index, legacyClientSelectionId(selection, index)),
    )
    .reduce<SlipSelection[]>((unique, selection) => {
      const existingIndex = unique.findIndex(
        (candidate) => slipSelectionKey(candidate) === slipSelectionKey(selection),
      );
      if (existingIndex >= 0) unique[existingIndex] = selection;
      else if (unique.length < MAX_PENDING_SELECTIONS) unique.push(selection);
      return unique;
    }, []);
  const parlaySelectionKeys = uniqueKeys(parlayKeys);
  const straightSelectionKeys = uniqueKeys(straightKeys);
  const available = new Set([...parlaySelectionKeys, ...straightSelectionKeys]);
  return {
    version: 1,
    selections: validSelections.filter((selection) => available.has(slipSelectionKey(selection))),
    parlayKeys: parlaySelectionKeys.filter((key) => available.has(key)),
    straightKeys: straightSelectionKeys.filter((key) => available.has(key)),
  };
}

function parseStoredSlip(serialized: string | null): StoredSlip {
  if (!serialized) return EMPTY_STATE;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (Array.isArray(parsed)) {
      const selections = parsed.filter(isSlipSelection).slice(0, MAX_PENDING_SELECTIONS);
      return stateFromSelections(selections, selections.map(slipSelectionKey), []);
    }
    if (!parsed || typeof parsed !== "object") return EMPTY_STATE;
    const candidate = parsed as Partial<StoredSlip>;
    if (!Array.isArray(candidate.selections)) return EMPTY_STATE;
    return stateFromSelections(
      candidate.selections,
      Array.isArray(candidate.parlayKeys)
        ? candidate.parlayKeys.filter((key) => typeof key === "string")
        : [],
      Array.isArray(candidate.straightKeys)
        ? candidate.straightKeys.filter((key) => typeof key === "string")
        : [],
    );
  } catch {
    return EMPTY_STATE;
  }
}

function setViewState(
  current: StoredSlip,
  selections: SlipSelection[],
  mode: "parlay" | "straight",
) {
  const normalized = selections
    .filter(isSlipSelection)
    .map((selection, index) => {
      const existing = current.selections.find(
        (candidate) => slipSelectionKey(candidate) === slipSelectionKey(selection),
      );
      return withClientSelectionId(
        selection,
        index,
        existing ? getClientSelectionId(existing, index) : undefined,
      );
    })
    .slice(0, MAX_PENDING_SELECTIONS);
  const nextKeys = normalized.map(slipSelectionKey);
  const retained = current.selections.filter((selection) => {
    const key = slipSelectionKey(selection);
    return mode === "parlay"
      ? current.straightKeys.includes(key)
      : current.parlayKeys.includes(key);
  });
  return stateFromSelections(
    [...retained, ...normalized],
    mode === "parlay" ? nextKeys : current.parlayKeys,
    mode === "straight" ? nextKeys : current.straightKeys,
  );
}

export function parseSlipSelections(serialized: string | null) {
  return parseStoredSlip(serialized).selections;
}

export function slipSelectionKey(
  selection: Pick<SlipSelection, "eventId" | "bookmakerId" | "marketType" | "selection" | "line">,
) {
  return `${selection.eventId}|${selection.bookmakerId}|${selection.marketType}|${selection.selection}|${selection.line ?? ""}`;
}

/**
 * Returns true only for opposite outcomes in the same market. These are
 * mutually exclusive alternatives, not same-game-parlay legs.
 */
export function areMutuallyExclusiveSelections(
  left: Pick<SlipSelection, "eventId" | "marketType" | "selection">,
  right: Pick<SlipSelection, "eventId" | "marketType" | "selection">,
) {
  if (left.eventId !== right.eventId || left.marketType !== right.marketType) return false;
  if (left.selection === right.selection) return false;
  if (left.marketType === "spread") {
    return (
      new Set([left.selection, right.selection]).size === 2 &&
      new Set([left.selection, right.selection]).has("home") &&
      new Set([left.selection, right.selection]).has("away")
    );
  }
  if (left.marketType === "total") {
    return (
      new Set([left.selection, right.selection]).size === 2 &&
      new Set([left.selection, right.selection]).has("over") &&
      new Set([left.selection, right.selection]).has("under")
    );
  }
  return (
    ["home", "away", "draw"].includes(left.selection) &&
    ["home", "away", "draw"].includes(right.selection)
  );
}

export function replaceMutuallyExclusiveSelection(
  selections: SlipSelection[],
  candidate: SlipSelection,
) {
  const index = selections.findIndex((selection) =>
    areMutuallyExclusiveSelections(selection, candidate),
  );
  if (index < 0) return null;
  const next = [...selections];
  next[index] = withClientSelectionId(
    candidate,
    index,
    getClientSelectionId(selections[index], index),
  );
  return next;
}

function isSameSimulatedAlternateAnchor(left: SlipSelection, right: SlipSelection) {
  return (
    left.pricingSource === "simulated_alternate" &&
    right.pricingSource === "simulated_alternate" &&
    left.eventId === right.eventId &&
    left.bookmakerId === right.bookmakerId &&
    left.marketType === right.marketType &&
    left.selection === right.selection &&
    left.anchorProviderLine === right.anchorProviderLine &&
    left.anchorProviderAmericanOdds === right.anchorProviderAmericanOdds
  );
}

/**
 * Reconciles the displayed selection with the durable straight slip in one
 * direction. A simulated alternate replaces its provider anchor (or the
 * previous simulated alternate) instead of allowing the auto-add and
 * alternate-line effects to re-add each other indefinitely.
 */
export function reconcileActiveStraightSelection(
  selections: SlipSelection[],
  baseSelection: SlipSelection,
  activeSelection: SlipSelection,
) {
  const activeKey = slipSelectionKey(activeSelection);
  if (selections.some((selection) => slipSelectionKey(selection) === activeKey)) {
    return selections;
  }

  const baseKey = slipSelectionKey(baseSelection);
  const baseIndex = selections.findIndex((selection) => slipSelectionKey(selection) === baseKey);
  if (baseIndex >= 0) {
    const next = [...selections];
    next[baseIndex] = activeSelection;
    return next;
  }

  const simulatedIndex = selections.findIndex((selection) =>
    isSameSimulatedAlternateAnchor(selection, activeSelection),
  );
  if (simulatedIndex >= 0) {
    const next = [...selections];
    next[simulatedIndex] = activeSelection;
    return next;
  }

  if (selections.length >= 12) return selections;
  const replacement = replaceMutuallyExclusiveSelection(selections, activeSelection);
  return replacement ?? [...selections, activeSelection];
}

export function assessParlayAvailability(selections: SlipSelection[]) {
  if (selections.length < 2) {
    return { eligible: false, reason: "Select at least two picks to build a parlay." };
  }
  if (selections.length > 12) {
    return { eligible: false, reason: "A parlay can contain at most 12 picks." };
  }
  if (new Set(selections.map((selection) => selection.eventId)).size !== selections.length) {
    return {
      eligible: false,
      reason: "Parlay unavailable — same-game parlays are not currently supported.",
    };
  }
  if (new Set(selections.map((selection) => selection.bookmakerId)).size !== 1) {
    return {
      eligible: false,
      reason: "Parlay unavailable — selections use different sportsbooks.",
    };
  }
  return { eligible: true, reason: "" };
}

export function removeSlipSelectionKeys(selections: SlipSelection[], keys: string[]) {
  const keySet = new Set(keys);
  return selections.filter((selection) => !keySet.has(slipSelectionKey(selection)));
}

let stateSnapshot: StoredSlip | null = null;
let modeSnapshotState: StoredSlip | null = null;
let parlayViewSnapshot = EMPTY_SLIP;
let straightViewSnapshot = EMPTY_SLIP;
const listeners = new Set<() => void>();
let slipDiagnosticsEnabled = false;
let slipDiagnosticMountCount = 0;
let slipDiagnosticMutations: SlipDiagnosticMutation[] = [];

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function straightSelectionsForState(state: StoredSlip) {
  return state.selections.filter((selection) =>
    state.straightKeys.includes(slipSelectionKey(selection)),
  );
}

function describeDiagnosticSelections(selections: readonly SlipSelection[]) {
  return selections.map((selection, index) => ({
    id: getClientSelectionId(selection, index),
    eventId: selection.eventId,
  }));
}

function classifyStraightMutation(
  before: SlipSelection[],
  after: SlipSelection[],
): SlipDiagnosticAction {
  if (!before.length && after.length) return "ADD";
  if (before.length && !after.length) return "CLEAR";
  if (after.length > before.length) return "ADD";
  if (after.length < before.length) return "REMOVE";
  if (
    before.some(
      (selection, index) =>
        slipSelectionKey(selection) !== slipSelectionKey(after[index] ?? selection),
    )
  ) {
    return "REPLACE";
  }
  return "SET";
}

function appendSlipDiagnosticMutation(
  action: SlipDiagnosticAction,
  reason: string,
  before: readonly SlipSelection[],
  after: readonly SlipSelection[],
) {
  if (!slipDiagnosticsEnabled) return;
  const beforeDescribed = describeDiagnosticSelections(before);
  const afterDescribed = describeDiagnosticSelections(after);
  slipDiagnosticMutations = [
    ...slipDiagnosticMutations,
    {
      timestamp: new Date().toISOString(),
      action,
      beforeCount: beforeDescribed.length,
      afterCount: afterDescribed.length,
      beforeSelectionIds: beforeDescribed.map((selection) => selection.id),
      afterSelectionIds: afterDescribed.map((selection) => selection.id),
      beforeEventIds: beforeDescribed.map((selection) => selection.eventId),
      afterEventIds: afterDescribed.map((selection) => selection.eventId),
      reason,
    },
  ].slice(-MAX_SLIP_DIAGNOSTIC_MUTATIONS);
}

export function setSlipDiagnosticsEnabled(enabled: boolean) {
  if (slipDiagnosticsEnabled === enabled) return;
  const current = enabled ? straightSelectionsForState(readState()) : [];
  slipDiagnosticsEnabled = enabled;
  if (enabled) appendSlipDiagnosticMutation("INITIALIZE", "diagnostics enabled", [], current);
  notifyListeners();
}

export function registerSlipDiagnosticsMount() {
  slipDiagnosticMountCount += 1;
  if (slipDiagnosticsEnabled) notifyListeners();
  return () => undefined;
}

export function getSlipDiagnosticsSnapshot(): SlipDiagnosticSnapshot {
  const durableStraight = straightSelectionsForState(readState());
  return {
    enabled: slipDiagnosticsEnabled,
    storeInstanceId: slipStoreInstanceId,
    mountCount: slipDiagnosticMountCount,
    durableStraight: describeDiagnosticSelections(durableStraight),
    recentMutations: slipDiagnosticMutations.slice(),
  };
}

function readState() {
  if (stateSnapshot) return stateSnapshot;
  if (typeof window === "undefined") return EMPTY_STATE;
  const current = window.localStorage.getItem(SLIP_STORAGE_KEY);
  if (current) {
    stateSnapshot = parseStoredSlip(current);
    return stateSnapshot;
  }

  const legacyParlay = parseSlipSelections(window.localStorage.getItem(LEGACY_PARLAY_STORAGE_KEY));
  const legacyStraight = parseSlipSelections(
    window.localStorage.getItem(LEGACY_STRAIGHT_STORAGE_KEY),
  );
  stateSnapshot = stateFromSelections(
    [...legacyParlay, ...legacyStraight],
    legacyParlay.map(slipSelectionKey),
    legacyStraight.map(slipSelectionKey),
  );
  if (stateSnapshot.selections.length) {
    writeState(stateSnapshot, "INITIALIZE", "legacy slip migration");
  }
  return stateSnapshot;
}

function writeState(
  next: StoredSlip,
  diagnosticAction?: SlipDiagnosticAction,
  diagnosticReason = "writeState",
) {
  const before = stateSnapshot ? straightSelectionsForState(stateSnapshot) : [];
  const after = straightSelectionsForState(next);
  stateSnapshot = next;
  modeSnapshotState = null;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SLIP_STORAGE_KEY, JSON.stringify(next));
      window.localStorage.removeItem(LEGACY_PARLAY_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_STRAIGHT_STORAGE_KEY);
    } catch {
      // The in-memory snapshot still keeps the slip usable when storage is blocked.
    }
  }
  if (diagnosticAction) {
    appendSlipDiagnosticMutation(diagnosticAction, diagnosticReason, before, after);
  }
  notifyListeners();
}

function selectionsForMode(state: StoredSlip, mode: "parlay" | "straight") {
  if (modeSnapshotState !== state) {
    modeSnapshotState = state;
    parlayViewSnapshot = state.selections.filter((selection) =>
      state.parlayKeys.includes(slipSelectionKey(selection)),
    );
    straightViewSnapshot = state.selections.filter((selection) =>
      state.straightKeys.includes(slipSelectionKey(selection)),
    );
  }
  return mode === "parlay" ? parlayViewSnapshot : straightViewSnapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (typeof window === "undefined") return () => listeners.delete(listener);
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== SLIP_STORAGE_KEY &&
      event.key !== LEGACY_PARLAY_STORAGE_KEY &&
      event.key !== LEGACY_STRAIGHT_STORAGE_KEY
    ) {
      return;
    }
    const before = stateSnapshot ? straightSelectionsForState(stateSnapshot) : [];
    stateSnapshot = event.key === SLIP_STORAGE_KEY ? parseStoredSlip(event.newValue) : null;
    if (!stateSnapshot) readState();
    appendSlipDiagnosticMutation(
      "HYDRATE",
      "storage event",
      before,
      straightSelectionsForState(stateSnapshot ?? EMPTY_STATE),
    );
    notifyListeners();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function subscribeToSlip(listener: () => void) {
  return subscribe(listener);
}

export function subscribeToStraightSlip(listener: () => void) {
  return subscribe(listener);
}

export function getPendingSlipState() {
  return readState();
}

export function getPendingSlipSnapshot() {
  return readState().selections;
}

export function getEmptyPendingSlipSnapshot() {
  return EMPTY_SLIP;
}

export function getSlipSnapshot() {
  return selectionsForMode(readState(), "parlay");
}

export function getEmptySlipSnapshot() {
  return EMPTY_SLIP;
}

export function getStraightSlipSnapshot() {
  return selectionsForMode(readState(), "straight");
}

export function getEmptyStraightSlipSnapshot() {
  return EMPTY_SLIP;
}

export function setSlipSelections(selections: SlipSelection[]) {
  writeState(setViewState(readState(), selections.slice(0, 12), "parlay"));
}

export function setStraightSlipSelections(selections: SlipSelection[]) {
  const current = readState();
  const next = setViewState(current, selections.slice(0, 12), "straight");
  writeState(
    next,
    classifyStraightMutation(straightSelectionsForState(current), straightSelectionsForState(next)),
    "setStraightSlipSelections",
  );
}

/** Mobile uses one selection collection; straight placement and parlay eligibility are derived. */
export function setPendingSlipSelections(selections: SlipSelection[]) {
  const current = readState();
  const normalized = selections
    .filter(isSlipSelection)
    .map((selection, index) => {
      const existing = current.selections.find(
        (candidate) => slipSelectionKey(candidate) === slipSelectionKey(selection),
      );
      return withClientSelectionId(
        selection,
        index,
        existing ? getClientSelectionId(existing, index) : undefined,
      );
    })
    .slice(0, MAX_PENDING_SELECTIONS);
  const keys = normalized.map(slipSelectionKey);
  const next = stateFromSelections(normalized, keys, keys);
  writeState(
    next,
    classifyStraightMutation(straightSelectionsForState(current), straightSelectionsForState(next)),
    "setPendingSlipSelections",
  );
}

export function clearSlip() {
  const state = readState();
  writeState(stateFromSelections(state.selections, [], state.straightKeys));
}

export function clearStraightSlip() {
  const state = readState();
  const next = stateFromSelections(state.selections, state.parlayKeys, []);
  writeState(next, "CLEAR", "clearStraightSlip");
}

export function removeSlipSelectionKeysAndPersist(keys: string[]) {
  const state = readState();
  writeState(
    stateFromSelections(
      state.selections,
      state.parlayKeys.filter((key) => !keys.includes(key)),
      state.straightKeys,
    ),
  );
}

export function removeStraightSlipSelectionKeysAndPersist(keys: string[]) {
  const state = readState();
  const next = stateFromSelections(
    state.selections,
    state.parlayKeys,
    state.straightKeys.filter((key) => !keys.includes(key)),
  );
  writeState(next, "REMOVE", "removeStraightSlipSelectionKeysAndPersist");
}

/** Used by cancellation/void cleanup: neither slip view may retain the cancelled ticket. */
export function removePendingSlipSelectionKeysAndPersist(keys: string[]) {
  const keySet = new Set(keys);
  const state = readState();
  const next = stateFromSelections(
    state.selections,
    state.parlayKeys.filter((key) => !keySet.has(key)),
    state.straightKeys.filter((key) => !keySet.has(key)),
  );
  writeState(next, "REMOVE", "removePendingSlipSelectionKeysAndPersist");
}

function removeSelectionIdsAndPersist(ids: string[], mode: "parlay" | "straight" | "both") {
  const idSet = new Set(ids);
  const state = readState();
  const removedKeys = new Set(
    state.selections
      .filter((selection, index) => idSet.has(getClientSelectionId(selection, index)))
      .map(slipSelectionKey),
  );
  const next = stateFromSelections(
    state.selections,
    mode === "parlay" || mode === "both"
      ? state.parlayKeys.filter((key) => !removedKeys.has(key))
      : state.parlayKeys,
    mode === "straight" || mode === "both"
      ? state.straightKeys.filter((key) => !removedKeys.has(key))
      : state.straightKeys,
  );
  writeState(
    next,
    mode === "parlay" ? undefined : "REMOVE",
    `removeSelectionIdsAndPersist:${mode}`,
  );
}

export function removeSlipSelectionIdsAndPersist(ids: string[]) {
  removeSelectionIdsAndPersist(ids, "parlay");
}

export function removeStraightSlipSelectionIdsAndPersist(ids: string[]) {
  removeSelectionIdsAndPersist(ids, "straight");
}

export function removePendingSlipSelectionIdsAndPersist(ids: string[]) {
  removeSelectionIdsAndPersist(ids, "both");
}
