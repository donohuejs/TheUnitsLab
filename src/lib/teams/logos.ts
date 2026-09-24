import teamCatalog from "../../config/team-catalog.json";

export type TeamSport = "soccer" | "football" | "basketball" | "hockey" | string;
export type TeamResolutionStatus = "RESOLVED" | "TEAM_UNRESOLVED";
export type TeamLogoStatus = "LOGO_AVAILABLE" | "TEAM_UNRESOLVED" | "LOGO_LOAD_FAILED";
export type LogoReferenceStatus =
  "IDENTITY_RESOLVED_LOGO_VALID" | "IDENTITY_RESOLVED_LOGO_MISSING" | "IDENTITY_UNRESOLVED";

type LogoProviderPath = "nfl" | "nhl" | "ncaa" | "soccer";
type LogoAssetStrategy = "numeric" | "abbreviation";
type CatalogTeam = {
  id: string;
  abbreviation: string;
  displayName: string;
  location: string;
  shortDisplayName: string;
  conference?: string;
};
type CatalogSnapshot = {
  season: string;
  count: number;
  teams: CatalogTeam[];
};

export type TeamRegistryEntry = {
  canonicalId: string;
  canonicalKey: string;
  canonicalName: string;
  abbreviation: string;
  sport: "soccer" | "football" | "basketball" | "hockey";
  league: string;
  source: "espn";
  providerPath: LogoProviderPath;
  providerId: string;
  logoAssetRef: string;
  logoAssetStrategy: LogoAssetStrategy;
  scopes: readonly string[];
  aliases: readonly string[];
  conference?: string;
};

export type TeamResolutionContext = {
  sport?: TeamSport;
  competitionId?: string;
};

export type TeamResolution = {
  canonicalId: string | null;
  canonicalName: string | null;
  abbreviation: string | null;
  initials: string;
  logoUrl: string | null;
  logoReferenceStatus: LogoReferenceStatus;
  sport: TeamSport;
  resolution: TeamResolutionStatus;
  resolutionReason: "EXACT_SCOPED_MATCH" | "UNKNOWN_TEAM" | "AMBIGUOUS_TEAM" | "OUT_OF_SCOPE";
};

const rawCatalog = teamCatalog as unknown as Record<string, CatalogSnapshot>;
const blockedFbsAliases = new Set(["miami", "miami oh", "usc", "ut", "tigers"]);

const nflTeams = [
  ["arizona-cardinals", "Arizona Cardinals", "22", "ARI", ["arizona"]],
  ["atlanta-falcons", "Atlanta Falcons", "1", "ATL", ["atlanta"]],
  ["baltimore-ravens", "Baltimore Ravens", "33", "BAL", ["baltimore"]],
  ["buffalo-bills", "Buffalo Bills", "2", "BUF", ["buffalo"]],
  ["carolina-panthers", "Carolina Panthers", "29", "CAR", ["carolina"]],
  ["chicago-bears", "Chicago Bears", "3", "CHI", ["chicago"]],
  ["cincinnati-bengals", "Cincinnati Bengals", "4", "CIN", ["cincinnati"]],
  ["cleveland-browns", "Cleveland Browns", "5", "CLE", ["cleveland"]],
  ["dallas-cowboys", "Dallas Cowboys", "6", "DAL", ["dallas"]],
  ["denver-broncos", "Denver Broncos", "7", "DEN", ["denver"]],
  ["detroit-lions", "Detroit Lions", "8", "DET", ["detroit"]],
  ["green-bay-packers", "Green Bay Packers", "9", "GB", ["green bay"]],
  ["houston-texans", "Houston Texans", "34", "HOU", []],
  ["indianapolis-colts", "Indianapolis Colts", "11", "IND", ["indianapolis"]],
  ["jacksonville-jaguars", "Jacksonville Jaguars", "30", "JAX", ["jacksonville"]],
  ["kansas-city-chiefs", "Kansas City Chiefs", "12", "KC", ["kansas city"]],
  ["las-vegas-raiders", "Las Vegas Raiders", "13", "LV", ["las vegas", "oakland raiders"]],
  ["los-angeles-chargers", "Los Angeles Chargers", "24", "LAC", ["la chargers"]],
  ["los-angeles-rams", "Los Angeles Rams", "14", "LAR", ["la rams"]],
  ["miami-dolphins", "Miami Dolphins", "15", "MIA", []],
  ["minnesota-vikings", "Minnesota Vikings", "16", "MIN", ["minnesota"]],
  ["new-england-patriots", "New England Patriots", "17", "NE", ["new england"]],
  ["new-orleans-saints", "New Orleans Saints", "18", "NO", ["new orleans"]],
  ["new-york-giants", "New York Giants", "19", "NYG", ["ny giants"]],
  ["new-york-jets", "New York Jets", "20", "NYJ", ["ny jets"]],
  ["philadelphia-eagles", "Philadelphia Eagles", "21", "PHI", ["philadelphia"]],
  ["pittsburgh-steelers", "Pittsburgh Steelers", "23", "PIT", ["pittsburgh steelers"]],
  [
    "san-francisco-49ers",
    "San Francisco 49ers",
    "25",
    "SF",
    ["sf 49ers", "san fran 49ers", "49ers"],
  ],
  ["seattle-seahawks", "Seattle Seahawks", "26", "SEA", ["seattle"]],
  ["tampa-bay-buccaneers", "Tampa Bay Buccaneers", "27", "TB", ["tampa bay", "buccaneers"]],
  ["tennessee-titans", "Tennessee Titans", "10", "TEN", ["tennessee"]],
  ["washington-commanders", "Washington Commanders", "28", "WAS", ["washington"]],
] as const;

export function normalizeTeamName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lookupKey(name: string) {
  return normalizeTeamName(name).replace(/^\d+\s+/, "");
}

function uniqueAliases(values: readonly string[], block: Set<string> = new Set()) {
  return [...new Set(values.map(lookupKey).filter((value) => value && !block.has(value)))];
}

function registryEntry(
  input: Omit<TeamRegistryEntry, "canonicalId" | "canonicalKey" | "aliases"> & {
    aliases?: readonly string[];
  },
) {
  return {
    ...input,
    canonicalId: `espn:${input.league}:${input.providerId}`,
    canonicalKey: normalizeTeamName(input.canonicalName),
    aliases: uniqueAliases([input.canonicalName, input.abbreviation, ...(input.aliases ?? [])]),
  } satisfies TeamRegistryEntry;
}

function snapshotEntry(
  team: CatalogTeam,
  league: string,
  sport: TeamRegistryEntry["sport"],
  providerPath: LogoProviderPath,
  scopes: readonly string[],
  logoAssetStrategy: LogoAssetStrategy,
) {
  const aliases = [team.displayName, team.shortDisplayName, team.abbreviation, team.location];
  if (league === "ncaaf") {
    aliases.push(
      ...(team.id === "2390" ? ["Miami (FL)", "Miami FL", "Miami Florida"] : []),
      ...(team.id === "193" ? ["Miami (OH)", "Miami OH", "Miami Ohio"] : []),
      ...(team.id === "221" ? ["Pitt Panthers"] : []),
    );
  }
  const entry = registryEntry({
    canonicalName: team.displayName,
    abbreviation: team.abbreviation,
    sport,
    league,
    source: "espn",
    providerPath,
    providerId: team.id,
    logoAssetRef:
      logoAssetStrategy === "abbreviation"
        ? lookupKey(team.abbreviation).replace(/ /g, "")
        : team.id,
    logoAssetStrategy,
    scopes,
    aliases: [],
    conference: team.conference,
  });
  return {
    ...entry,
    aliases: uniqueAliases(aliases, league === "ncaaf" ? blockedFbsAliases : new Set()),
  };
}

const nflEntries = nflTeams.map(([canonicalName, displayName, providerId, abbreviation, aliases]) =>
  registryEntry({
    canonicalName: displayName,
    abbreviation,
    sport: "football",
    league: "nfl",
    source: "espn",
    providerPath: "nfl",
    providerId,
    logoAssetRef: providerId,
    logoAssetStrategy: "numeric",
    scopes: ["nfl"],
    aliases: [canonicalName, ...aliases],
  }),
);

const nhlEntries = (rawCatalog.nhl?.teams ?? []).map((team) =>
  snapshotEntry(team, "nhl", "hockey", "nhl", ["nhl"], "abbreviation"),
);

const soccerEntriesById = new Map<string, TeamRegistryEntry>();
for (const league of ["epl", "ucl", "uel", "laliga"] as const) {
  for (const team of rawCatalog[league]?.teams ?? []) {
    const next = snapshotEntry(team, "soccer", "soccer", "soccer", [league], "numeric");
    const current = soccerEntriesById.get(next.canonicalId);
    if (!current) {
      soccerEntriesById.set(next.canonicalId, next);
      continue;
    }
    soccerEntriesById.set(next.canonicalId, {
      ...current,
      scopes: [...new Set([...current.scopes, league])],
      aliases: [...new Set([...current.aliases, ...next.aliases])],
    });
  }
}

const ncaafEntries = (rawCatalog.ncaaf?.teams ?? []).map((team) =>
  snapshotEntry(team, "ncaaf", "football", "ncaa", ["ncaaf"], "numeric"),
);

export const TEAM_REGISTRY: readonly TeamRegistryEntry[] = [
  ...nflEntries,
  ...nhlEntries,
  ...soccerEntriesById.values(),
  ...ncaafEntries,
];

function entryMatchesContext(entry: TeamRegistryEntry, context: TeamResolutionContext) {
  const sport = context.sport?.toLowerCase().trim();
  const competitionId = context.competitionId?.toLowerCase().trim();
  if (competitionId && !entry.scopes.includes(competitionId)) return false;
  if (!sport) return true;
  return entry.sport === sport || entry.scopes.includes(sport);
}

function entryMatchesName(entry: TeamRegistryEntry, key: string) {
  return entry.canonicalKey === key || entry.aliases.includes(key);
}

function resolveRegistryEntry(teamName: string, context: TeamResolutionContext = {}) {
  const key = lookupKey(teamName);
  const nameMatches = TEAM_REGISTRY.filter((entry) => entryMatchesName(entry, key));
  const scopedMatches = nameMatches.filter((entry) => entryMatchesContext(entry, context));
  if (scopedMatches.length === 1)
    return { entry: scopedMatches[0], reason: "EXACT_SCOPED_MATCH" as const };
  if (scopedMatches.length > 1) return { entry: null, reason: "AMBIGUOUS_TEAM" as const };
  if (nameMatches.length > 0) return { entry: null, reason: "OUT_OF_SCOPE" as const };
  return { entry: null, reason: "UNKNOWN_TEAM" as const };
}

function logoUrl(entry: TeamRegistryEntry) {
  return `https://a.espncdn.com/i/teamlogos/${entry.providerPath}/500/${entry.logoAssetRef}.png`;
}

function hasValidLogoReference(entry: TeamRegistryEntry) {
  const url = logoUrl(entry);
  if (entry.logoAssetStrategy === "abbreviation" && !/\/nhl\/500\/[a-z0-9]+\.png$/.test(url))
    return false;
  if (entry.logoAssetStrategy === "numeric" && !/\/(?:nfl|ncaa|soccer)\/500\/\d+\.png$/.test(url))
    return false;
  return true;
}

export function teamInitials(name: string) {
  const words = normalizeTeamName(name)
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

export function resolveTeamRecord(
  teamName: string,
  sport: TeamSport,
  competitionId?: string,
): TeamResolution {
  const result = resolveRegistryEntry(teamName, { sport, competitionId });
  if (!result.entry) {
    return {
      canonicalId: null,
      canonicalName: null,
      abbreviation: null,
      initials: teamInitials(teamName),
      logoUrl: null,
      logoReferenceStatus: "IDENTITY_UNRESOLVED",
      sport,
      resolution: "TEAM_UNRESOLVED",
      resolutionReason: result.reason,
    };
  }
  return {
    canonicalId: result.entry.canonicalId,
    canonicalName: result.entry.canonicalName,
    abbreviation: result.entry.abbreviation,
    initials: teamInitials(teamName),
    logoUrl: hasValidLogoReference(result.entry) ? logoUrl(result.entry) : null,
    logoReferenceStatus: hasValidLogoReference(result.entry)
      ? "IDENTITY_RESOLVED_LOGO_VALID"
      : "IDENTITY_RESOLVED_LOGO_MISSING",
    sport,
    resolution: "RESOLVED",
    resolutionReason: "EXACT_SCOPED_MATCH",
  };
}

export function isTeamInCompetition(teamName: string, competitionId: string) {
  return resolveRegistryEntry(teamName, { competitionId }).entry !== null;
}

export function canonicalTeamKey(name: string, sport?: TeamSport, competitionId?: string) {
  return resolveRegistryEntry(name, { sport, competitionId }).entry?.canonicalKey ?? null;
}

export function teamNamesMatch(left: string, right: string, context: TeamResolutionContext = {}) {
  const leftResolution = resolveRegistryEntry(left, context);
  const rightResolution = resolveRegistryEntry(right, context);
  if (leftResolution.entry && rightResolution.entry) {
    return leftResolution.entry.canonicalId === rightResolution.entry.canonicalId;
  }
  if (leftResolution.entry || rightResolution.entry) return false;
  // Exact provider text is safe for matching unknown imported text, but never creates a logo identity.
  return lookupKey(left) === lookupKey(right);
}

export function resolveTeamLogo(teamName: string, sport: TeamSport, competitionId?: string) {
  const identity = resolveTeamRecord(teamName, sport, competitionId);
  if (identity.resolution !== "RESOLVED" || !identity.logoUrl) return null;
  return { initials: identity.initials, logoUrl: identity.logoUrl, sport };
}

export function resolveTeamIdentity(teamName: string, sport: TeamSport, competitionId?: string) {
  const identity = resolveTeamRecord(teamName, sport, competitionId);
  return { initials: identity.initials, logoUrl: identity.logoUrl, sport };
}

export function teamLogoStatus(
  identity: Pick<TeamResolution, "resolution" | "logoUrl">,
  failedLogoUrl: string | null,
): TeamLogoStatus {
  if (identity.resolution !== "RESOLVED" || !identity.logoUrl) return "TEAM_UNRESOLVED";
  return identity.logoUrl === failedLogoUrl ? "LOGO_LOAD_FAILED" : "LOGO_AVAILABLE";
}

export type TeamCoverageInput = { teamName: string; sport: TeamSport; competitionId?: string };

export function auditTeamCoverage(inputs: readonly TeamCoverageInput[]) {
  const rows = inputs.map((input) => ({
    input,
    result: resolveTeamRecord(input.teamName, input.sport, input.competitionId),
  }));
  const unresolved = rows.filter(({ result }) => result.resolution !== "RESOLVED");
  const missingLogo = rows.filter(
    ({ result }) => result.logoReferenceStatus === "IDENTITY_RESOLVED_LOGO_MISSING",
  );
  const ambiguous = unresolved.filter(({ result }) => result.resolutionReason === "AMBIGUOUS_TEAM");
  return {
    encountered: inputs.length,
    resolved: inputs.length - unresolved.length,
    unresolved: unresolved.length,
    missingLogo: missingLogo.length,
    ambiguous: ambiguous.length,
    resolutionRate: inputs.length ? (inputs.length - unresolved.length) / inputs.length : 1,
    unresolvedTeams: unresolved.map(({ input, result }) => ({
      ...input,
      reason: result.resolutionReason,
    })),
    missingLogoTeams: missingLogo.map(({ input }) => input),
  };
}
