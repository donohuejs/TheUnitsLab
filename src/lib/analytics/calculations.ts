export const RATE_LEADERBOARD_MINIMUM_WAGERS = 5;

export type AnalyticsSource = "simulated" | "external";
export type SourceFilter = "simulated" | "irl" | "combined";
export type AnalyticsPeriod = "week" | "month" | "season" | "all";
export type AnalyticsStatus = "open" | "won" | "lost" | "push" | "void";
export type LeaderboardCategory =
  | "units"
  | "roi"
  | "win_percentage"
  | "total_wagers"
  | "soccer"
  | "college_football"
  | "college_basketball";

export type AnalyticsWager = {
  wagerId: string;
  userId: string;
  source: AnalyticsSource;
  ticketType: "straight" | "parlay";
  status: AnalyticsStatus;
  stakeUnits: string | number;
  profitLossUnits: string | number;
  decimalOdds: string | number;
  wageredAt: string;
  sportKey: string;
  competitionKey: string;
  competitionName: string;
  marketType: string;
  sportsbookId: string;
  sportsbookName: string;
};

export type AnalyticsFilters = {
  source?: SourceFilter;
  period?: AnalyticsPeriod;
  timeZone?: string;
  now?: Date;
  sportKey?: string;
  competitionKey?: string;
  marketType?: string;
  sportsbookId?: string;
};

export type AnalyticsSummary = {
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  open: number;
  eligibleSettledBets: number;
  unitsWagered: string;
  unitsWonLost: string;
  roiPercent: string;
  winPercentage: string;
  averageDecimalOdds: string;
  currentStreak: string;
  bestStreak: number;
};

export type AnalyticsBreakdown = {
  key: string;
  label: string;
  summary: AnalyticsSummary;
};

export type GroupMember = { userId: string; displayName: string };

export type LeaderboardRow = {
  userId: string;
  displayName: string;
  rank: number | null;
  eligible: boolean;
  neededForEligibility: number;
  summary: AnalyticsSummary;
};

const fixedPattern = /^(-?)(\d+)(?:\.(\d+))?$/;

function parseFixed(value: string | number, scale: number) {
  const match = fixedPattern.exec(String(value).trim());
  if (!match) throw new Error(`Invalid fixed-precision value: ${value}`);
  const fraction = match[3] ?? "";
  if (fraction.length > scale) throw new Error(`Too many fractional digits: ${value}`);
  const magnitude = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
  return match[1] === "-" ? -magnitude : magnitude;
}

function formatFixed(value: bigint, scale: number) {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  const divisor = 10n ** BigInt(scale);
  return `${sign}${magnitude / divisor}.${(magnitude % divisor).toString().padStart(scale, "0")}`;
}

function divideRoundedHalfAway(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error("A positive denominator is required");
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  return sign * ((magnitude + denominator / 2n) / denominator);
}

export function normalizeAnalyticsTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return "UTC";
  }
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string) {
  const wallClock = Date.UTC(year, month - 1, day);
  let candidate = wallClock;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate += wallClock - represented;
  }
  return new Date(candidate);
}

export function getAnalyticsPeriodStart(
  period: AnalyticsPeriod,
  timeZone: string,
  now = new Date(),
) {
  if (period === "all") return null;
  const zone = normalizeAnalyticsTimeZone(timeZone);
  const local = zonedParts(now, zone);
  if (period === "month") return zonedMidnightUtc(local.year, local.month, 1, zone);
  if (period === "season") {
    const year = local.month >= 8 ? local.year : local.year - 1;
    return zonedMidnightUtc(year, 8, 1, zone);
  }
  const localMidnightAsUtc = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const mondayOffset = (localMidnightAsUtc.getUTCDay() + 6) % 7;
  localMidnightAsUtc.setUTCDate(localMidnightAsUtc.getUTCDate() - mondayOffset);
  return zonedMidnightUtc(
    localMidnightAsUtc.getUTCFullYear(),
    localMidnightAsUtc.getUTCMonth() + 1,
    localMidnightAsUtc.getUTCDate(),
    zone,
  );
}

export function filterAnalyticsWagers(records: AnalyticsWager[], filters: AnalyticsFilters = {}) {
  const now = filters.now ?? new Date();
  const start = getAnalyticsPeriodStart(filters.period ?? "all", filters.timeZone ?? "UTC", now);
  return records.filter((record) => {
    const wagerTime = new Date(record.wageredAt);
    if (!(wagerTime < now) || (start && wagerTime < start)) return false;
    if (filters.source === "simulated" && record.source !== "simulated") return false;
    if (filters.source === "irl" && record.source !== "external") return false;
    if (filters.sportKey && record.sportKey !== filters.sportKey) return false;
    if (filters.competitionKey && record.competitionKey !== filters.competitionKey) return false;
    if (filters.marketType && record.marketType !== filters.marketType) return false;
    if (filters.sportsbookId && record.sportsbookId !== filters.sportsbookId) return false;
    return true;
  });
}

export function summarizeAnalytics(records: AnalyticsWager[]): AnalyticsSummary {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let voids = 0;
  let open = 0;
  let unitsWageredMinor = 0n;
  let unitsWonLostMinor = 0n;
  let decimalOddsTenThousandths = 0n;
  let averageOddsCount = 0n;

  for (const record of records) {
    if (record.status === "won") wins += 1;
    else if (record.status === "lost") losses += 1;
    else if (record.status === "push") pushes += 1;
    else if (record.status === "void") voids += 1;
    else open += 1;

    if (["won", "lost", "push"].includes(record.status)) {
      unitsWageredMinor += parseFixed(record.stakeUnits, 2);
      unitsWonLostMinor += parseFixed(record.profitLossUnits, 2);
      decimalOddsTenThousandths += parseFixed(record.decimalOdds, 4);
      averageOddsCount += 1n;
    }
  }

  const decisive = wins + losses;
  const roiHundredths = unitsWageredMinor
    ? divideRoundedHalfAway(unitsWonLostMinor * 10_000n, unitsWageredMinor)
    : 0n;
  const winPercentageHundredths = decisive
    ? divideRoundedHalfAway(BigInt(wins) * 10_000n, BigInt(decisive))
    : 0n;
  const averageOdds = averageOddsCount
    ? divideRoundedHalfAway(decimalOddsTenThousandths, averageOddsCount)
    : 0n;

  const decisiveResults = [...records]
    .filter((record) => record.status === "won" || record.status === "lost")
    .sort(
      (left, right) =>
        new Date(left.wageredAt).getTime() - new Date(right.wageredAt).getTime() ||
        left.source.localeCompare(right.source) ||
        left.wagerId.localeCompare(right.wagerId),
    );
  let currentType: "won" | "lost" | null = null;
  let currentCount = 0;
  let winningRun = 0;
  let bestStreak = 0;
  for (const record of decisiveResults) {
    if (record.status === currentType) currentCount += 1;
    else {
      currentType = record.status as "won" | "lost";
      currentCount = 1;
    }
    if (record.status === "won") {
      winningRun += 1;
      bestStreak = Math.max(bestStreak, winningRun);
    } else winningRun = 0;
  }

  return {
    totalBets: records.length,
    wins,
    losses,
    pushes,
    voids,
    open,
    eligibleSettledBets: wins + losses + pushes,
    unitsWagered: formatFixed(unitsWageredMinor, 2),
    unitsWonLost: formatFixed(unitsWonLostMinor, 2),
    roiPercent: formatFixed(roiHundredths, 2),
    winPercentage: formatFixed(winPercentageHundredths, 2),
    averageDecimalOdds: formatFixed(averageOdds, 4),
    currentStreak: currentType ? `${currentType === "won" ? "W" : "L"}${currentCount}` : "—",
    bestStreak,
  };
}

export function buildBreakdown(
  records: AnalyticsWager[],
  keyFor: (record: AnalyticsWager) => string,
  labelFor: (record: AnalyticsWager) => string = keyFor,
) {
  const groups = new Map<string, { label: string; records: AnalyticsWager[] }>();
  for (const record of records) {
    const key = keyFor(record);
    const existing = groups.get(key);
    if (existing) existing.records.push(record);
    else groups.set(key, { label: labelFor(record), records: [record] });
  }
  return [...groups.entries()]
    .map(([key, group]): AnalyticsBreakdown => ({
      key,
      label: group.label,
      summary: summarizeAnalytics(group.records),
    }))
    .sort((left, right) => {
      const leftUnits = parseFixed(left.summary.unitsWonLost, 2);
      const rightUnits = parseFixed(right.summary.unitsWonLost, 2);
      return (
        (leftUnits === rightUnits ? 0 : leftUnits > rightUnits ? -1 : 1) ||
        left.label.localeCompare(right.label)
      );
    });
}

const categorySport: Partial<Record<LeaderboardCategory, string>> = {
  soccer: "soccer",
  college_football: "football",
  college_basketball: "basketball",
};

function leaderboardValue(category: LeaderboardCategory, summary: AnalyticsSummary) {
  if (category === "roi") return parseFixed(summary.roiPercent, 2);
  if (category === "win_percentage") return parseFixed(summary.winPercentage, 2);
  if (category === "total_wagers") return BigInt(summary.totalBets);
  return parseFixed(summary.unitsWonLost, 2);
}

export function rankLeaderboard(
  members: GroupMember[],
  records: AnalyticsWager[],
  category: LeaderboardCategory,
  minimumWagers = RATE_LEADERBOARD_MINIMUM_WAGERS,
) {
  const sport = categorySport[category];
  const categoryRecords = sport ? records.filter((record) => record.sportKey === sport) : records;
  const rateCategory = category === "roi" || category === "win_percentage";
  const rows = members.map((member) => {
    const summary = summarizeAnalytics(
      categoryRecords.filter((record) => record.userId === member.userId),
    );
    const eligible = !rateCategory || summary.eligibleSettledBets >= minimumWagers;
    return {
      userId: member.userId,
      displayName: member.displayName,
      rank: null as number | null,
      eligible,
      neededForEligibility: eligible ? 0 : Math.max(0, minimumWagers - summary.eligibleSettledBets),
      summary,
      value: leaderboardValue(category, summary),
    };
  });

  rows.sort(
    (left, right) =>
      Number(right.eligible) - Number(left.eligible) ||
      (left.value === right.value ? 0 : left.value > right.value ? -1 : 1) ||
      left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
      left.userId.localeCompare(right.userId),
  );
  let rank = 0;
  let previousValue: bigint | null = null;
  for (const row of rows) {
    if (!row.eligible) continue;
    if (previousValue === null || row.value !== previousValue) rank += 1;
    row.rank = rank;
    previousValue = row.value;
  }
  return rows.map((row): LeaderboardRow => ({
    userId: row.userId,
    displayName: row.displayName,
    rank: row.rank,
    eligible: row.eligible,
    neededForEligibility: row.neededForEligibility,
    summary: row.summary,
  }));
}
