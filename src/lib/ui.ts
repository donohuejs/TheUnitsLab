export const PRODUCT_NAME = "The Units Lab";

export const WAGER_STATUSES = ["open", "won", "lost", "push", "void"] as const;

export type WagerStatus = (typeof WAGER_STATUSES)[number];

const labels: Record<string, string> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  push: "Push",
  void: "Void",
  scheduled: "Scheduled",
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
  return source === "simulated" ? "Simulated" : "IRL / external";
}

export function ticketTypeLabel(ticketType: "straight" | "parlay") {
  return ticketType === "straight" ? "Straight" : "Parlay";
}

export function marketLabel(market: string) {
  return market === "moneyline" ? "Moneyline" : displayLabel(market);
}
