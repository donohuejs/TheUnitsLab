import type { QuotaMetadata, QuotaState } from "./types";

function integerHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (value === null || !/^[0-9]+$/.test(value.trim())) return null;
  return Number(value);
}

export function parseQuotaHeaders(headers: Headers): QuotaMetadata {
  return {
    used: integerHeader(headers, "x-requests-used"),
    remaining: integerHeader(headers, "x-requests-remaining"),
    lastRequestCost: integerHeader(headers, "x-requests-last"),
  };
}

export function quotaState(used: number | null, allowance: number): QuotaState {
  if (used === null || allowance <= 0) return "normal";
  const percent = (used / allowance) * 100;
  if (percent >= 95) return "critical";
  if (percent >= 85) return "high";
  if (percent >= 70) return "conserve";
  return "normal";
}

export function effectiveTtlSeconds(base: number, state: QuotaState) {
  return state === "conserve" ? Math.max(base, 1800) : base;
}

export function mayRefresh(state: QuotaState, manual: boolean) {
  if (state === "critical") return manual;
  if (state === "high") return false;
  return true;
}
