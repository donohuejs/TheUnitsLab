export const PRODUCT_NAME = "The Units Lab";
export const PRODUCT_SUBTITLE = "Experiment | Analyze | Improve";
export const VIAL_LABEL = "Vials";

export const WAGER_STATUSES = ["open", "won", "lost", "push", "void"] as const;

export type WagerStatus = (typeof WAGER_STATUSES)[number];

const labels: Record<string, string> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  push: "Push",
  void: "Void / Cancelled",
  scheduled: "Scheduled",
  live: "LIVE",
  hit: "Fresh",
  miss: "Freshly loaded",
  refreshed: "Refreshed",
  stale: "Stale",
  normal: "Normal quota",
  conserve: "Conserve quota",
  high: "High quota",
  critical: "Critical quota",
};

export function displayLabel(value: string) {
  const label = labels[value] ?? value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function sourceLabel(source: "simulated" | "external" | "irl") {
  return source === "simulated" ? "Simulated" : "Imported";
}

export function importedSourceLabel(sportsbookName?: string | null) {
  return sportsbookName?.trim() ? `Imported · ${sportsbookName.trim()}` : "Imported · Other";
}

export function welcomeName(displayName?: string | null) {
  return displayName?.trim() || "Scientist";
}

export function ticketTypeLabel(ticketType: "straight" | "parlay") {
  return ticketType === "straight" ? "Straight" : "Parlay";
}

export function marketLabel(market: string) {
  if (market === "moneyline") return "Moneyline";
  if (market === "spread") return "Point spread / handicap";
  return displayLabel(market);
}
