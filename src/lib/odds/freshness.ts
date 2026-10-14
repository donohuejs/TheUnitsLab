import { sportsProviderConfiguration } from "../../config/sports";

const policy = sportsProviderConfiguration.oddsFreshness;

export type FreshnessEvent = {
  scheduledStart: string;
  status: "scheduled" | "live" | "completed";
};

export type OddsFreshnessBand = (typeof policy)[number]["id"] | "started";

export type OddsFreshnessDecision = {
  band: OddsFreshnessBand;
  targetFreshnessSeconds: number;
  maxStaleSeconds: number;
  refreshAllowed: boolean;
  scheduledStart: string | null;
};

function upcomingEvents(events: readonly FreshnessEvent[], now: Date) {
  const nowMs = now.getTime();
  return events
    .filter(
      (event) =>
        event.status !== "completed" &&
        Number.isFinite(Date.parse(event.scheduledStart)) &&
        Date.parse(event.scheduledStart) > nowMs,
    )
    .sort((left, right) => Date.parse(left.scheduledStart) - Date.parse(right.scheduledStart));
}

export function adaptiveOddsFreshness(
  events: readonly FreshnessEvent[],
  now: Date,
): OddsFreshnessDecision {
  const nextEvent = upcomingEvents(events, now)[0];
  if (!nextEvent) {
    return {
      band: "started",
      targetFreshnessSeconds: 0,
      maxStaleSeconds: 30 * 60,
      refreshAllowed: false,
      scheduledStart: null,
    };
  }

  const leadSeconds = Math.max(
    0,
    Math.floor((Date.parse(nextEvent.scheduledStart) - now.getTime()) / 1000),
  );
  const selected = policy.find(
    (band) =>
      leadSeconds >= band.minLeadSeconds &&
      (band.maxLeadSeconds === null || leadSeconds <= band.maxLeadSeconds),
  );
  if (!selected) throw new Error("Odds freshness policy does not cover the event lead time");

  return {
    band: selected.id,
    targetFreshnessSeconds: selected.targetFreshnessSeconds,
    maxStaleSeconds: selected.maxStaleSeconds,
    refreshAllowed: true,
    scheduledStart: nextEvent.scheduledStart,
  };
}

export function cacheIsHardExpired(
  fetchedAt: string,
  storedStaleUntil: string | null | undefined,
  decision: OddsFreshnessDecision,
  now: Date,
) {
  const storedLimit = storedStaleUntil ? Date.parse(storedStaleUntil) : Number.POSITIVE_INFINITY;
  const fetchedMs = Date.parse(fetchedAt);
  const fallbackLimit = Number.isFinite(fetchedMs)
    ? fetchedMs + decision.maxStaleSeconds * 1000
    : Number.NEGATIVE_INFINITY;
  return now.getTime() >= (Number.isFinite(storedLimit) ? storedLimit : fallbackLimit);
}

export function cacheExpiry(
  fetchedAt: string,
  decision: OddsFreshnessDecision,
  overrideTtlSeconds?: number,
) {
  const fetchedMs = Date.parse(fetchedAt);
  const ttlSeconds = overrideTtlSeconds ?? decision.targetFreshnessSeconds;
  return new Date(fetchedMs + ttlSeconds * 1000).toISOString();
}

export function cacheStaleUntil(fetchedAt: string, decision: OddsFreshnessDecision) {
  const fetchedMs = Date.parse(fetchedAt);
  return new Date(fetchedMs + decision.maxStaleSeconds * 1000).toISOString();
}

export function policyForTests() {
  return policy;
}
