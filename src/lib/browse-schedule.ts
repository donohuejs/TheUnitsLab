import type { NormalizedEvent } from "@/lib/odds/types";
import {
  areCollegeRivals,
  areSoccerRivals,
  getCollegeTeamContext,
  getStableTeamId,
  getTeamRanking,
  isConferenceMatchup,
  isPowerFourConference,
  type LeagueStandingsSnapshot,
  type RankingSnapshot,
} from "@/config/sport-context";

export type BrowseDateKey = string;

/**
 * Browse has historically presented US college schedules in Eastern Time. Profiles created
 * before Browse timezone support use UTC as their database default, so UTC is treated as the
 * legacy sentinel rather than allowing schedule groups to drift four hours from the card label.
 */
export const DEFAULT_BROWSE_TIME_ZONE = "America/New_York";

export function normalizeBrowseTimeZone(timeZone?: string | null) {
  const candidate = timeZone?.trim();
  if (!candidate || candidate === "UTC") return DEFAULT_BROWSE_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return DEFAULT_BROWSE_TIME_ZONE;
  }
}

export type KickoffGroup = {
  key: string;
  label: string;
  events: NormalizedEvent[];
};

export type BrowsePriorityContext = {
  rankingSnapshot?: RankingSnapshot | null;
  standingsSnapshot?: LeagueStandingsSnapshot | null;
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const pad = (value: number) => String(value).padStart(2, "0");

function localParts(value: string | Date, timeZone: string): LocalDateParts | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const result = {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

export function isBrowseDateKey(value: string | undefined): value is BrowseDateKey {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

export function getLocalDateKey(value: string | Date, timeZone: string) {
  const parts = localParts(value, timeZone);
  return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : null;
}

export function getLocalKickoffBucket(value: string | Date, timeZone: string) {
  const parts = localParts(value, timeZone);
  return parts
    ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
    : null;
}

export function formatBrowseTime(value: string | Date, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatBrowseDate(value: BrowseDateKey, timeZone: string) {
  void timeZone;
  if (!isBrowseDateKey(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function eventTime(event: NormalizedEvent) {
  return new Date(event.scheduledStart).getTime();
}

export function getDefaultBrowseDate(
  events: readonly NormalizedEvent[],
  timeZone: string,
  now = new Date(),
) {
  const today = getLocalDateKey(now, timeZone);
  const valid = events
    .map((event) => ({ event, date: getLocalDateKey(event.scheduledStart, timeZone) }))
    .filter((entry): entry is { event: NormalizedEvent; date: string } => Boolean(entry.date));
  if (!valid.length) return today ?? "";

  const todayHasRelevantEvent = valid.some(
    ({ event, date }) =>
      date === today &&
      event.status !== "completed" &&
      (event.status === "live" || eventTime(event) >= now.getTime()),
  );
  if (todayHasRelevantEvent && today) return today;

  const upcomingDates = valid
    .filter(({ event }) => eventTime(event) >= now.getTime())
    .map(({ date }) => date)
    .filter((date, index, dates) => dates.indexOf(date) === index)
    .sort();
  if (upcomingDates[0]) return upcomingDates[0];

  if (today && valid.some((entry) => entry.date === today)) return today;
  return [...new Set(valid.map((entry) => entry.date))].sort().at(-1) ?? today ?? "";
}

export function availableBrowseDates(events: readonly NormalizedEvent[], timeZone: string) {
  return [...new Set(events.map((event) => getLocalDateKey(event.scheduledStart, timeZone)))]
    .filter((value): value is string => Boolean(value))
    .sort();
}

export function filterEventsForBrowseDate(
  events: readonly NormalizedEvent[],
  date: BrowseDateKey,
  timeZone: string,
) {
  return events.filter((event) => getLocalDateKey(event.scheduledStart, timeZone) === date);
}

export function previousBrowseDate(date: string, dates: readonly string[]) {
  return [...dates].filter((candidate) => candidate < date).at(-1) ?? null;
}

export function nextBrowseDate(date: string, dates: readonly string[]) {
  return dates.find((candidate) => candidate > date) ?? null;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function statusOrder(status: NormalizedEvent["status"]) {
  if (status === "live") return 0;
  if (status === "scheduled") return 1;
  return 2;
}

function recordStrength(teamName: string) {
  const record = getCollegeTeamContext(teamName)?.record;
  if (!record) return { winning: 0, percentage: 0 };
  const games = record.wins + record.losses + (record.ties ?? 0);
  return {
    winning: record.wins > record.losses ? 1 : 0,
    percentage: games ? (record.wins + (record.ties ?? 0) / 2) / games : 0,
  };
}

function collegePriority(event: NormalizedEvent, context: BrowsePriorityContext) {
  const away = getTeamRanking(event.awayTeam, context.rankingSnapshot ?? null);
  const home = getTeamRanking(event.homeTeam, context.rankingSnapshot ?? null);
  const ranks = [away?.rank, home?.rank].filter((rank): rank is number => Number.isFinite(rank));
  const rankedVsRanked = ranks.length === 2;
  const rankedVsUnranked = ranks.length === 1;
  const primaryLevel = rankedVsRanked
    ? 0
    : rankedVsUnranked
      ? 1
      : isConferenceMatchup(event.awayTeam, event.homeTeam)
        ? 2
        : 3;
  const sortedRanks = ranks.sort((left, right) => left - right);
  const combinedRank = rankedVsRanked ? sortedRanks[0]! + sortedRanks[1]! : 0;
  const bestRank = sortedRanks[0] ?? 0;
  const secondRank = sortedRanks[1] ?? 0;
  const awayContext = getCollegeTeamContext(event.awayTeam);
  const homeContext = getCollegeTeamContext(event.homeTeam);
  const powerFourCount = [awayContext, homeContext].filter((entry) =>
    isPowerFourConference(entry?.conference),
  ).length;
  const rivalry = areCollegeRivals(event.awayTeam, event.homeTeam) ? 1 : 0;
  const awayRecord = recordStrength(event.awayTeam);
  const homeRecord = recordStrength(event.homeTeam);
  return [
    primaryLevel,
    combinedRank || bestRank,
    bestRank,
    secondRank,
    -rivalry,
    -powerFourCount,
    -(awayRecord.winning + homeRecord.winning),
    -(awayRecord.percentage + homeRecord.percentage),
  ] as const;
}

function standingPosition(teamName: string, snapshot: LeagueStandingsSnapshot | null) {
  if (!snapshot) return null;
  const teamId = getStableTeamId(teamName);
  return snapshot.entries.find((entry) => entry.teamId === teamId)?.position ?? null;
}

function soccerPriority(event: NormalizedEvent, context: BrowsePriorityContext) {
  const away = standingPosition(event.awayTeam, context.standingsSnapshot ?? null);
  const home = standingPosition(event.homeTeam, context.standingsSnapshot ?? null);
  const bothTopSix = away !== null && home !== null && away <= 6 && home <= 6;
  const oneTopSix = (away !== null && away <= 6) !== (home !== null && home <= 6);
  const level = bothTopSix ? 0 : oneTopSix ? 1 : 2;
  const positions = [away, home]
    .filter((position): position is number => position !== null)
    .sort((a, b) => a - b);
  const best = positions[0] ?? 99;
  const second = positions[1] ?? 99;
  const proximity = positions.length === 2 ? Math.abs(positions[0]! - positions[1]!) : 99;
  const rivalry = areSoccerRivals(event.awayTeam, event.homeTeam) ? 1 : 0;
  return [level, best + second, best, proximity, -rivalry] as const;
}

export function getMatchupPriority(event: NormalizedEvent, context: BrowsePriorityContext = {}) {
  if (event.competitionId === "ncaaf") return collegePriority(event, context);
  if (event.competitionId === "epl" || event.competitionId === "laliga") {
    return soccerPriority(event, context);
  }
  return [0] as const;
}

function comparePriority(
  left: NormalizedEvent,
  right: NormalizedEvent,
  context: BrowsePriorityContext,
) {
  const leftPriority = getMatchupPriority(left, context);
  const rightPriority = getMatchupPriority(right, context);
  const length = Math.max(leftPriority.length, rightPriority.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftPriority[index] ?? 0;
    const rightValue = rightPriority[index] ?? 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return compareText(left.id, right.id);
}

export function sortEventsForBrowse(
  events: readonly NormalizedEvent[],
  timeZone: string,
  context: BrowsePriorityContext = {},
) {
  return [...events].sort((left, right) => {
    const leftBucket = getLocalKickoffBucket(left.scheduledStart, timeZone);
    const rightBucket = getLocalKickoffBucket(right.scheduledStart, timeZone);
    if (leftBucket && rightBucket && leftBucket !== rightBucket)
      return compareText(leftBucket, rightBucket);
    if (!leftBucket || !rightBucket) {
      const timeDifference = eventTime(left) - eventTime(right);
      if (timeDifference) return timeDifference;
    }
    const statusDifference = statusOrder(left.status) - statusOrder(right.status);
    if (statusDifference) return statusDifference;
    return comparePriority(left, right, context);
  });
}

export function groupEventsByKickoff(
  events: readonly NormalizedEvent[],
  timeZone: string,
  context: BrowsePriorityContext = {},
): KickoffGroup[] {
  const byBucket = new Map<string, NormalizedEvent[]>();
  for (const event of sortEventsForBrowse(events, timeZone, context)) {
    const key = getLocalKickoffBucket(event.scheduledStart, timeZone) ?? `unknown:${event.id}`;
    const current = byBucket.get(key) ?? [];
    current.push(event);
    byBucket.set(key, current);
  }
  return [...byBucket.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, grouped]) => ({
      key,
      label: grouped[0] ? formatBrowseTime(grouped[0].scheduledStart, timeZone) : "Unknown time",
      events: grouped,
    }));
}

export function getMarqueeEventIds(
  events: readonly NormalizedEvent[],
  context: BrowsePriorityContext = {},
) {
  if (
    !events.length ||
    (events[0]?.competitionId !== "epl" && events[0]?.competitionId !== "laliga")
  ) {
    return new Set<string>();
  }
  const candidates = events.filter((event) => {
    const away = standingPosition(event.awayTeam, context.standingsSnapshot ?? null);
    const home = standingPosition(event.homeTeam, context.standingsSnapshot ?? null);
    return away !== null && home !== null && away <= 6 && home <= 6;
  });
  const winner = [...candidates].sort((left, right) => comparePriority(left, right, context))[0];
  return winner ? new Set([winner.id]) : new Set<string>();
}
