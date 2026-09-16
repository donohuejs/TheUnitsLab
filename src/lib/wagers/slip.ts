import type { MarketType, SelectionType } from "@/lib/odds/types";

export type SlipSelection = {
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
};

export const SLIP_STORAGE_KEY = "sportsbook-simulator:phase7-parlay";
export const STRAIGHT_SLIP_STORAGE_KEY = "sportsbook-simulator:release-candidate-straights";

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

export function parseSlipSelections(serialized: string | null) {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter(isSlipSelection).slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function slipSelectionKey(
  selection: Pick<SlipSelection, "eventId" | "bookmakerId" | "marketType" | "selection" | "line">,
) {
  return `${selection.eventId}|${selection.bookmakerId}|${selection.marketType}|${selection.selection}|${selection.line ?? ""}`;
}

export function removeSlipSelectionKeys(selections: SlipSelection[], keys: string[]) {
  const keySet = new Set(keys);
  return selections.filter((selection) => !keySet.has(slipSelectionKey(selection)));
}

let snapshot: SlipSelection[] | null = null;
let straightSnapshot: SlipSelection[] | null = null;
const listeners = new Set<() => void>();

function readSnapshot() {
  if (snapshot) return snapshot;
  if (typeof window === "undefined") return [];
  snapshot = parseSlipSelections(window.localStorage.getItem(SLIP_STORAGE_KEY));
  return snapshot;
}

function readStraightSnapshot() {
  if (straightSnapshot) return straightSnapshot;
  if (typeof window === "undefined") return [];
  straightSnapshot = parseSlipSelections(window.localStorage.getItem(STRAIGHT_SLIP_STORAGE_KEY));
  return straightSnapshot;
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeToSlip(listener: () => void) {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SLIP_STORAGE_KEY) return;
      snapshot = parseSlipSelections(event.newValue);
      notify();
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", handleStorage);
    };
  }
  return () => listeners.delete(listener);
}

export function subscribeToStraightSlip(listener: () => void) {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STRAIGHT_SLIP_STORAGE_KEY) return;
      straightSnapshot = parseSlipSelections(event.newValue);
      notify();
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", handleStorage);
    };
  }
  return () => listeners.delete(listener);
}

export function getSlipSnapshot() {
  return readSnapshot();
}

export function getEmptySlipSnapshot() {
  return [] as SlipSelection[];
}

export function getStraightSlipSnapshot() {
  return readStraightSnapshot();
}

export function getEmptyStraightSlipSnapshot() {
  return [] as SlipSelection[];
}

export function setSlipSelections(selections: SlipSelection[]) {
  snapshot = selections.slice(0, 12);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SLIP_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // The in-memory snapshot still keeps the slip usable when storage is blocked.
    }
  }
  notify();
}

export function setStraightSlipSelections(selections: SlipSelection[]) {
  straightSnapshot = selections.slice(0, 12);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STRAIGHT_SLIP_STORAGE_KEY, JSON.stringify(straightSnapshot));
    } catch {
      // The in-memory snapshot still keeps the slip usable when storage is blocked.
    }
  }
  notify();
}

export function clearSlip() {
  snapshot = [];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(SLIP_STORAGE_KEY);
    } catch {
      // Clearing the in-memory slip is still safe when storage is blocked.
    }
  }
  notify();
}

export function clearStraightSlip() {
  straightSnapshot = [];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STRAIGHT_SLIP_STORAGE_KEY);
    } catch {
      // Clearing the in-memory slip is still safe when storage is blocked.
    }
  }
  notify();
}

export function removeSlipSelectionKeysAndPersist(keys: string[]) {
  setSlipSelections(removeSlipSelectionKeys(getSlipSnapshot(), keys));
}

export function removeStraightSlipSelectionKeysAndPersist(keys: string[]) {
  setStraightSlipSelections(removeSlipSelectionKeys(getStraightSlipSnapshot(), keys));
}
