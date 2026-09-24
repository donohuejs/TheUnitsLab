export type TeamSport = "soccer" | "football" | "basketball" | "hockey" | string;

export type TeamResolutionStatus = "RESOLVED" | "TEAM_UNRESOLVED";
export type TeamLogoStatus = "LOGO_AVAILABLE" | "TEAM_UNRESOLVED" | "LOGO_LOAD_FAILED";

type LogoProviderPath = "nfl" | "nhl" | "ncaa" | "soccer";

export type TeamRegistryEntry = {
  canonicalId: string;
  canonicalKey: string;
  canonicalName: string;
  sport: "soccer" | "football" | "basketball" | "hockey";
  providerPath: LogoProviderPath;
  providerId: string;
  scopes: readonly string[];
  aliases: readonly string[];
};

export type TeamResolutionContext = {
  sport?: TeamSport;
  competitionId?: string;
};

export type ResolvedTeamIdentity = {
  canonicalId: string;
  canonicalName: string;
  initials: string;
  logoUrl: string;
  sport: TeamSport;
  resolution: "RESOLVED";
  resolutionReason: "EXACT_SCOPED_MATCH";
};

export type TeamResolution = {
  canonicalId: string | null;
  canonicalName: string | null;
  initials: string;
  logoUrl: string | null;
  sport: TeamSport;
  resolution: TeamResolutionStatus;
  resolutionReason: "EXACT_SCOPED_MATCH" | "UNKNOWN_TEAM" | "AMBIGUOUS_TEAM" | "OUT_OF_SCOPE";
};

const footballScopes = ["nfl"] as const;
const hockeyScopes = ["nhl"] as const;
const collegeFootballScopes = ["ncaaf"] as const;
const soccerScopes = ["epl", "ucl", "uel", "laliga"] as const;

function registryEntry(input: {
  canonicalKey: string;
  canonicalName: string;
  sport: TeamRegistryEntry["sport"];
  providerPath: LogoProviderPath;
  providerId: string;
  scopes: readonly string[];
  aliases?: readonly string[];
}): TeamRegistryEntry {
  return {
    canonicalId: `${input.providerPath}:${input.providerId}`,
    canonicalKey: input.canonicalKey,
    canonicalName: input.canonicalName,
    sport: input.sport,
    providerPath: input.providerPath,
    providerId: input.providerId,
    scopes: input.scopes,
    aliases: input.aliases ?? [],
  };
}

const nflTeams = [
  ["arizona-cardinals", "Arizona Cardinals", "22", ["arizona", "ari"]],
  ["atlanta-falcons", "Atlanta Falcons", "1", ["atlanta", "atl"]],
  ["baltimore-ravens", "Baltimore Ravens", "33", ["baltimore", "bal"]],
  ["buffalo-bills", "Buffalo Bills", "2", ["buffalo", "buf"]],
  ["carolina-panthers", "Carolina Panthers", "29", ["carolina", "car"]],
  ["chicago-bears", "Chicago Bears", "3", ["chicago", "chi"]],
  ["cincinnati-bengals", "Cincinnati Bengals", "4", ["cincinnati", "cin"]],
  ["cleveland-browns", "Cleveland Browns", "5", ["cleveland", "cle"]],
  ["dallas-cowboys", "Dallas Cowboys", "6", ["dallas", "dal"]],
  ["denver-broncos", "Denver Broncos", "7", ["denver", "den"]],
  ["detroit-lions", "Detroit Lions", "8", ["detroit", "det"]],
  ["green-bay-packers", "Green Bay Packers", "9", ["green bay", "gb"]],
  ["houston-texans", "Houston Texans", "34", ["houston texans", "hou texans"]],
  ["indianapolis-colts", "Indianapolis Colts", "11", ["indianapolis", "ind"]],
  ["jacksonville-jaguars", "Jacksonville Jaguars", "30", ["jacksonville", "jax"]],
  ["kansas-city-chiefs", "Kansas City Chiefs", "12", ["kansas city", "kc"]],
  ["las-vegas-raiders", "Las Vegas Raiders", "13", ["las vegas", "lv", "oakland raiders"]],
  ["los-angeles-chargers", "Los Angeles Chargers", "24", ["la chargers", "l.a. chargers"]],
  ["los-angeles-rams", "Los Angeles Rams", "14", ["la rams", "l.a. rams"]],
  ["miami-dolphins", "Miami Dolphins", "15", ["miami dolphins", "mia"]],
  ["minnesota-vikings", "Minnesota Vikings", "16", ["minnesota", "min"]],
  ["new-england-patriots", "New England Patriots", "17", ["new england", "ne"]],
  ["new-orleans-saints", "New Orleans Saints", "18", ["new orleans", "no"]],
  ["new-york-giants", "New York Giants", "19", ["ny giants", "new york giants", "nyg"]],
  ["new-york-jets", "New York Jets", "20", ["ny jets", "new york jets", "nyj"]],
  ["philadelphia-eagles", "Philadelphia Eagles", "21", ["philadelphia", "phi"]],
  ["pittsburgh-steelers", "Pittsburgh Steelers", "23", ["pittsburgh steelers", "pit"]],
  [
    "san-francisco-49ers",
    "San Francisco 49ers",
    "25",
    ["sf 49ers", "san fran 49ers", "49ers", "sf"],
  ],
  ["seattle-seahawks", "Seattle Seahawks", "26", ["seattle", "sea"]],
  ["tampa-bay-buccaneers", "Tampa Bay Buccaneers", "27", ["tampa bay", "tb", "buccaneers"]],
  ["tennessee-titans", "Tennessee Titans", "10", ["tennessee", "ten"]],
  ["washington-commanders", "Washington Commanders", "28", ["washington", "was"]],
] as const;

const nhlTeams = [
  ["boston-bruins", "Boston Bruins", "6"],
  ["buffalo-sabres", "Buffalo Sabres", "7"],
  ["calgary-flames", "Calgary Flames", "20"],
  ["carolina-hurricanes", "Carolina Hurricanes", "12"],
  ["chicago-blackhawks", "Chicago Blackhawks", "16"],
  ["colorado-avalanche", "Colorado Avalanche", "21"],
  ["dallas-stars", "Dallas Stars", "25"],
  ["detroit-red-wings", "Detroit Red Wings", "17"],
  ["edmonton-oilers", "Edmonton Oilers", "22"],
  ["florida-panthers", "Florida Panthers", "13"],
  ["los-angeles-kings", "Los Angeles Kings", "26"],
  ["minnesota-wild", "Minnesota Wild", "29"],
  ["montreal-canadiens", "Montreal Canadiens", "8"],
  ["nashville-predators", "Nashville Predators", "18"],
  ["new-jersey-devils", "New Jersey Devils", "1"],
  ["new-york-islanders", "New York Islanders", "2"],
  ["new-york-rangers", "New York Rangers", "3"],
  ["ottawa-senators", "Ottawa Senators", "9"],
  ["philadelphia-flyers", "Philadelphia Flyers", "4"],
  ["pittsburgh-penguins", "Pittsburgh Penguins", "5"],
  ["san-jose-sharks", "San Jose Sharks", "27"],
  ["seattle-kraken", "Seattle Kraken", "35"],
  ["st-louis-blues", "St. Louis Blues", "19"],
  ["tampa-bay-lightning", "Tampa Bay Lightning", "14"],
  ["toronto-maple-leafs", "Toronto Maple Leafs", "10"],
  ["vancouver-canucks", "Vancouver Canucks", "23"],
  ["vegas-golden-knights", "Vegas Golden Knights", "32"],
  ["washington-capitals", "Washington Capitals", "15"],
  ["winnipeg-jets", "Winnipeg Jets", "30"],
] as const;

const soccerTeams = [
  ["arsenal", "Arsenal", "359", ["arsenal fc"]],
  ["aston-villa", "Aston Villa", "362", ["aston villa fc"]],
  ["bournemouth", "AFC Bournemouth", "8678", ["afc bournemouth"]],
  ["brentford", "Brentford", "337", ["brentford fc"]],
  [
    "brighton",
    "Brighton & Hove Albion",
    "397",
    ["brighton and hove albion", "brighton hove albion", "brighton fc"],
  ],
  ["burnley", "Burnley", "379", ["burnley fc"]],
  ["chelsea", "Chelsea", "363", ["chelsea fc"]],
  ["crystal-palace", "Crystal Palace", "384", ["crystal palace fc"]],
  ["everton", "Everton", "368", ["everton fc"]],
  ["fulham", "Fulham", "370", ["fulham fc"]],
  ["leeds-united", "Leeds United", "357", ["leeds", "leeds united fc"]],
  ["liverpool", "Liverpool", "364", ["liverpool fc"]],
  ["manchester-city", "Manchester City", "382", ["manchester city fc"]],
  [
    "manchester-united",
    "Manchester United",
    "360",
    ["manchester united fc", "man utd", "man united"],
  ],
  ["newcastle-united", "Newcastle United", "361", ["newcastle", "newcastle united fc"]],
  ["nottingham-forest", "Nottingham Forest", "393", ["nottingham forest fc"]],
  ["southampton", "Southampton", "376", ["southampton fc"]],
  ["sunderland", "Sunderland", "366", ["sunderland afc"]],
  ["tottenham-hotspur", "Tottenham Hotspur", "367", ["tottenham", "tottenham hotspur fc", "spurs"]],
  ["west-ham-united", "West Ham United", "371", ["west ham", "west ham united fc"]],
  [
    "wolverhampton-wanderers",
    "Wolverhampton Wanderers",
    "380",
    ["wolverhampton", "wolves", "wolverhampton wanderers fc"],
  ],
  ["athletic-club", "Athletic Club", "93", ["athletic bilbao", "athletic club bilbao"]],
  ["atletico-madrid", "Atlético Madrid", "1068", ["atletico madrid", "atletico de madrid"]],
  ["barcelona", "Barcelona", "83", ["fc barcelona"]],
  ["real-madrid", "Real Madrid", "86", ["real madrid cf"]],
  ["real-betis", "Real Betis", "244", ["real betis balompie"]],
  ["real-sociedad", "Real Sociedad", "89", ["real sociedad de futbol"]],
  ["sevilla", "Sevilla", "243", ["sevilla fc"]],
  ["valencia", "Valencia", "94", ["valencia cf"]],
  ["villarreal", "Villarreal", "102", ["villarreal cf"]],
  ["bayern-munich", "Bayern Munich", "132", ["fc bayern munich", "bayern munchen"]],
  ["borussia-dortmund", "Borussia Dortmund", "124", ["dortmund", "bvb"]],
  ["paris-saint-germain", "Paris Saint-Germain", "160", ["psg", "paris sg", "paris saint germain"]],
  ["inter-milan", "Inter Milan", "110", ["inter", "internazionale"]],
  ["ac-milan", "AC Milan", "103", ["milan"]],
  ["juventus", "Juventus", "111", ["juventus fc"]],
  ["atalanta", "Atalanta", "105", ["atalanta bc"]],
  ["as-roma", "AS Roma", "104", ["roma"]],
  ["lazio", "Lazio", "487", ["ss lazio"]],
  ["benfica", "Benfica", "234", ["sl benfica"]],
  ["porto", "Porto", "437", ["fc porto"]],
  ["ajax", "Ajax", "139", ["afc ajax"]],
  ["psv", "PSV Eindhoven", "148", ["psv", "psv eindhoven"]],
  ["celtic", "Celtic", "256", ["celtic fc"]],
  ["rangers", "Rangers", "257", ["rangers fc"]],
  ["galatasaray", "Galatasaray", "432", ["galatasaray sk"]],
  ["fenerbahce", "Fenerbahçe", "436", ["fenerbahce sk", "fenerbahce"]],
] as const;

const collegeFootballTeams = [
  ["alabama", "Alabama Crimson Tide", "333", ["alabama crimson tide", "alabama university"]],
  ["clemson", "Clemson Tigers", "228", ["clemson tigers", "clemson university"]],
  ["georgia", "Georgia Bulldogs", "61", ["georgia bulldogs", "georgia university", "uga"]],
  ["michigan", "Michigan Wolverines", "130", ["michigan wolverines", "university of michigan"]],
  [
    "notre-dame",
    "Notre Dame Fighting Irish",
    "87",
    ["notre dame", "notre dame fighting irish", "notre dame university"],
  ],
  [
    "ohio-state",
    "Ohio State Buckeyes",
    "194",
    ["ohio state", "ohio state buckeyes", "ohio state university"],
  ],
  [
    "pittsburgh",
    "Pittsburgh Panthers",
    "221",
    ["pitt", "pitt panthers", "pittsburgh panthers", "university of pittsburgh"],
  ],
  [
    "south-carolina",
    "South Carolina Gamecocks",
    "2579",
    ["south carolina", "south carolina gamecocks", "south carolina university", "sc gamecocks"],
  ],
  [
    "syracuse",
    "Syracuse Orange",
    "183",
    ["syracuse orange", "syracuse orange football", "syracuse university"],
  ],
  ["texas", "Texas Longhorns", "251", ["texas longhorns", "university of texas"]],
  [
    "miami-fl",
    "Miami Hurricanes",
    "2390",
    [
      "miami hurricanes",
      "miami hurricanes football",
      "miami fl",
      "miami florida",
      "miami university florida",
    ],
  ],
  [
    "wake-forest",
    "Wake Forest Demon Deacons",
    "154",
    ["wake forest", "wake forest demon deacons", "wake forest university"],
  ],
  ["houston", "Houston Cougars", "248", ["houston cougars", "university of houston"]],
  [
    "texas-tech",
    "Texas Tech Red Raiders",
    "2641",
    ["texas tech", "texas tech red raiders", "texas tech university"],
  ],
] as const;

export const TEAM_REGISTRY: readonly TeamRegistryEntry[] = [
  ...nflTeams.map(([canonicalKey, canonicalName, providerId, aliases]) =>
    registryEntry({
      canonicalKey,
      canonicalName,
      providerId,
      providerPath: "nfl",
      sport: "football",
      scopes: footballScopes,
      aliases,
    }),
  ),
  ...nhlTeams.map(([canonicalKey, canonicalName, providerId]) =>
    registryEntry({
      canonicalKey,
      canonicalName,
      providerId,
      providerPath: "nhl",
      sport: "hockey",
      scopes: hockeyScopes,
    }),
  ),
  ...soccerTeams.map(([canonicalKey, canonicalName, providerId, aliases]) =>
    registryEntry({
      canonicalKey,
      canonicalName,
      providerId,
      providerPath: "soccer",
      sport: "soccer",
      scopes: soccerScopes,
      aliases,
    }),
  ),
  ...collegeFootballTeams.map(([canonicalKey, canonicalName, providerId, aliases]) =>
    registryEntry({
      canonicalKey,
      canonicalName,
      providerId,
      providerPath: "ncaa",
      sport: "football",
      scopes: collegeFootballScopes,
      aliases,
    }),
  ),
];

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

function normalizedSport(sport: TeamSport | undefined) {
  if (!sport) return undefined;
  return sport.toLowerCase().trim();
}

function entryMatchesContext(entry: TeamRegistryEntry, context: TeamResolutionContext) {
  const sport = normalizedSport(context.sport);
  const competitionId = context.competitionId?.toLowerCase().trim();
  if (competitionId && !entry.scopes.includes(competitionId)) return false;
  if (!sport) return true;
  return entry.sport === sport || entry.scopes.includes(sport);
}

function entryMatchesName(entry: TeamRegistryEntry, key: string) {
  return (
    entry.canonicalKey === key ||
    normalizeTeamName(entry.canonicalName) === key ||
    entry.aliases.some((alias) => normalizeTeamName(alias) === key)
  );
}

function resolveRegistryEntry(teamName: string, context: TeamResolutionContext = {}) {
  const key = lookupKey(teamName);
  const nameMatches = TEAM_REGISTRY.filter((entry) => entryMatchesName(entry, key));
  const scopedMatches = nameMatches.filter((entry) => entryMatchesContext(entry, context));
  if (scopedMatches.length === 1) {
    return { entry: scopedMatches[0], reason: "EXACT_SCOPED_MATCH" as const };
  }
  if (scopedMatches.length > 1) {
    return { entry: null, reason: "AMBIGUOUS_TEAM" as const };
  }
  if (nameMatches.length > 0) {
    return { entry: null, reason: "OUT_OF_SCOPE" as const };
  }
  return { entry: null, reason: "UNKNOWN_TEAM" as const };
}

function logoUrl(entry: TeamRegistryEntry) {
  return `https://a.espncdn.com/i/teamlogos/${entry.providerPath}/500/${entry.providerId}.png`;
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
      initials: teamInitials(teamName),
      logoUrl: null,
      sport,
      resolution: "TEAM_UNRESOLVED",
      resolutionReason: result.reason,
    };
  }
  return {
    canonicalId: result.entry.canonicalId,
    canonicalName: result.entry.canonicalName,
    initials: teamInitials(teamName),
    logoUrl: logoUrl(result.entry),
    sport,
    resolution: "RESOLVED",
    resolutionReason: "EXACT_SCOPED_MATCH",
  };
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
  // This is an exact provider-text fallback only. It never creates a logo identity.
  return lookupKey(left) === lookupKey(right);
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

/** Backward-compatible logo-only view used by existing import and presentation callers. */
export function resolveTeamLogo(teamName: string, sport: TeamSport, competitionId?: string) {
  const identity = resolveTeamRecord(teamName, sport, competitionId);
  if (identity.resolution !== "RESOLVED") return null;
  return {
    initials: identity.initials,
    logoUrl: identity.logoUrl,
    sport,
  };
}

/** Backward-compatible identity shape. Detailed resolution status is available from resolveTeamRecord. */
export function resolveTeamIdentity(teamName: string, sport: TeamSport, competitionId?: string) {
  const identity = resolveTeamRecord(teamName, sport, competitionId);
  return {
    initials: identity.initials,
    logoUrl: identity.logoUrl,
    sport,
  };
}

export function teamLogoStatus(
  identity:
    | Pick<TeamResolution, "resolution" | "logoUrl">
    | Pick<ResolvedTeamIdentity, "resolution" | "logoUrl">,
  failedLogoUrl: string | null,
): TeamLogoStatus {
  if (identity.resolution !== "RESOLVED" || !identity.logoUrl) return "TEAM_UNRESOLVED";
  return identity.logoUrl === failedLogoUrl ? "LOGO_LOAD_FAILED" : "LOGO_AVAILABLE";
}

export type TeamCoverageInput = {
  teamName: string;
  sport: TeamSport;
  competitionId?: string;
};

export function auditTeamCoverage(inputs: readonly TeamCoverageInput[]) {
  const unresolved = inputs.flatMap((input) => {
    const result = resolveTeamRecord(input.teamName, input.sport, input.competitionId);
    return result.resolution === "TEAM_UNRESOLVED"
      ? [{ ...input, reason: result.resolutionReason }]
      : [];
  });
  return {
    encountered: inputs.length,
    resolved: inputs.length - unresolved.length,
    unresolved: unresolved.length,
    resolutionRate: inputs.length ? (inputs.length - unresolved.length) / inputs.length : 1,
    unresolvedTeams: unresolved,
  };
}
