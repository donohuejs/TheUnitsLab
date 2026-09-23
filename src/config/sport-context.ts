import { normalizeTeamName } from "@/lib/teams/logos";

import type { CompetitionId } from "@/lib/odds/types";

export type RankingSource = "ap" | "cfp";

export type TeamRecord = {
  wins: number;
  losses: number;
  ties?: number;
};

export type RankingEntry = {
  teamId: string;
  rank: number;
  record?: TeamRecord;
};

export type RankingSnapshot = {
  source: RankingSource;
  label: string;
  sourceUrl?: string;
  updatedAt: string;
  entries: readonly RankingEntry[];
};

export type SportTeamContext = {
  id: string;
  aliases: readonly string[];
  conference?: string;
  record?: TeamRecord;
};

export type LeagueStandingEntry = {
  teamId: string;
  position: number;
  points?: number;
  played?: number;
  wins?: number;
  draws?: number;
  losses?: number;
};

export type LeagueStandingsSnapshot = {
  competitionId: "epl" | "laliga";
  label: string;
  source?: string;
  updatedAt: string;
  entries: readonly LeagueStandingEntry[];
};

export const POWER_FOUR_CONFERENCES = new Set(["ACC", "Big 12", "Big Ten", "SEC"]);

const team = (
  id: string,
  aliases: readonly string[],
  conference?: string,
  record?: TeamRecord,
): SportTeamContext => ({ id, aliases, conference, record });

/**
 * Stable aliases for the context that can be maintained without a provider call.
 * Unknown provider names intentionally return no context rather than being guessed.
 */
export const COLLEGE_FOOTBALL_TEAMS: readonly SportTeamContext[] = [
  team("alabama", ["Alabama", "Alabama Crimson Tide", "Alabama Crimson Tide football"], "SEC"),
  team("arkansas", ["Arkansas", "Arkansas Razorbacks"], "SEC"),
  team("auburn", ["Auburn", "Auburn Tigers"], "SEC"),
  team("baylor", ["Baylor", "Baylor Bears"], "Big 12"),
  team("boston_college", ["Boston College", "Boston College Eagles"], "ACC"),
  team("clemson", ["Clemson", "Clemson Tigers"], "ACC"),
  team("colorado", ["Colorado", "Colorado Buffaloes"], "Big 12"),
  team("duke", ["Duke", "Duke Blue Devils"], "ACC"),
  team("florida", ["Florida", "Florida Gators"], "SEC", { wins: 3, losses: 0 }),
  team("florida_state", ["Florida State", "Florida State Seminoles", "Florida St"], "ACC"),
  team("georgia", ["Georgia", "Georgia Bulldogs", "University of Georgia"], "SEC"),
  team("houston", ["Houston", "Houston Cougars", "University of Houston"], "Big 12"),
  team("illinois", ["Illinois", "Illinois Fighting Illini"], "Big Ten"),
  team("indiana", ["Indiana", "Indiana Hoosiers"], "Big Ten"),
  team("iowa", ["Iowa", "Iowa Hawkeyes"], "Big Ten"),
  team("iowa_state", ["Iowa State", "Iowa State Cyclones"], "Big 12"),
  team("kansas", ["Kansas", "Kansas Jayhawks"], "Big 12"),
  team("kansas_state", ["Kansas State", "Kansas State Wildcats"], "Big 12"),
  team("kentucky", ["Kentucky", "Kentucky Wildcats"], "SEC"),
  team("lsu", ["LSU", "LSU Tigers", "Louisiana State"], "SEC"),
  team("louisville", ["Louisville", "Louisville Cardinals"], "ACC"),
  team("maryland", ["Maryland", "Maryland Terrapins"], "Big Ten"),
  team("miami", ["Miami", "Miami Hurricanes", "Miami (FL)", "Miami FL"], "ACC"),
  team("michigan", ["Michigan", "Michigan Wolverines", "University of Michigan"], "Big Ten"),
  team("michigan_state", ["Michigan State", "Michigan State Spartans"], "Big Ten"),
  team("minnesota", ["Minnesota", "Minnesota Golden Gophers"], "Big Ten"),
  team("mississippi_state", ["Mississippi State", "Mississippi State Bulldogs"], "SEC"),
  team("missouri", ["Missouri", "Missouri Tigers"], "SEC"),
  team("nc_state", ["NC State", "North Carolina State", "NC State Wolfpack"], "ACC"),
  team("nebraska", ["Nebraska", "Nebraska Cornhuskers"], "Big Ten"),
  team("north_carolina", ["North Carolina", "North Carolina Tar Heels"], "ACC"),
  team(
    "notre_dame",
    ["Notre Dame", "Notre Dame Fighting Irish", "Notre Dame University"],
    "Independent",
  ),
  team("ohio_state", ["Ohio State", "Ohio State Buckeyes", "Ohio State University"], "Big Ten"),
  team("oklahoma", ["Oklahoma", "Oklahoma Sooners"], "SEC"),
  team("oklahoma_state", ["Oklahoma State", "Oklahoma State Cowboys"], "Big 12"),
  team("ole_miss", ["Ole Miss", "Ole Miss Rebels", "Mississippi Rebels", "Mississippi"], "SEC"),
  team("oregon", ["Oregon", "Oregon Ducks"], "Big Ten"),
  team("penn_state", ["Penn State", "Penn State Nittany Lions"], "Big Ten"),
  team("pittsburgh", ["Pittsburgh", "Pitt", "Pitt Panthers", "Pittsburgh Panthers"], "ACC"),
  team("rutgers", ["Rutgers", "Rutgers Scarlet Knights"], "Big Ten"),
  team("south_carolina", ["South Carolina", "South Carolina Gamecocks", "SC Gamecocks"], "SEC"),
  team("smu", ["SMU", "SMU Mustangs", "Southern Methodist"], "ACC"),
  team("stanford", ["Stanford", "Stanford Cardinal"], "ACC"),
  team("syracuse", ["Syracuse", "Syracuse Orange"], "ACC"),
  team("tcu", ["TCU", "TCU Horned Frogs", "Texas Christian"], "Big 12"),
  team("tennessee", ["Tennessee", "Tennessee Volunteers", "Tennessee Vols"], "SEC"),
  team("texas", ["Texas", "Texas Longhorns", "University of Texas"], "SEC"),
  team("texas_a_m", ["Texas A&M", "Texas A&M Aggies", "Texas AM", "Texas A and M"], "SEC"),
  team("texas_tech", ["Texas Tech", "Texas Tech Red Raiders", "Texas Tech University"], "Big 12"),
  team("tulane", ["Tulane", "Tulane Green Wave"], "American"),
  team("usc", ["USC", "Southern California", "USC Trojans"], "Big Ten"),
  team("utah", ["Utah", "Utah Utes"], "Big 12"),
  team("vanderbilt", ["Vanderbilt", "Vanderbilt Commodores"], "SEC"),
  team("virginia", ["Virginia", "Virginia Cavaliers"], "ACC"),
  team("virginia_tech", ["Virginia Tech", "Virginia Tech Hokies"], "ACC"),
  team(
    "wake_forest",
    ["Wake Forest", "Wake Forest Demon Deacons", "Wake Forest University"],
    "ACC",
  ),
  team("west_virginia", ["West Virginia", "West Virginia Mountaineers"], "Big 12"),
  team("wisconsin", ["Wisconsin", "Wisconsin Badgers"], "Big Ten"),
  team("byu", ["BYU", "Brigham Young", "BYU Cougars"], "Big 12"),
];

const AP_TOP_25_ENTRIES: readonly RankingEntry[] = [
  { teamId: "texas", rank: 1 },
  { teamId: "georgia", rank: 2 },
  { teamId: "notre_dame", rank: 3 },
  { teamId: "ole_miss", rank: 4 },
  { teamId: "indiana", rank: 5 },
  { teamId: "miami", rank: 6 },
  { teamId: "ohio_state", rank: 7 },
  { teamId: "alabama", rank: 8 },
  { teamId: "byu", rank: 9 },
  { teamId: "lsu", rank: 10 },
  { teamId: "texas_tech", rank: 11 },
  { teamId: "usc", rank: 12 },
  { teamId: "penn_state", rank: 13 },
  { teamId: "tennessee", rank: 14 },
  { teamId: "utah", rank: 15 },
  { teamId: "louisville", rank: 16 },
  { teamId: "iowa", rank: 17 },
  { teamId: "michigan", rank: 18 },
  { teamId: "missouri", rank: 19 },
  { teamId: "oregon", rank: 20 },
  { teamId: "florida", rank: 21 },
  { teamId: "smu", rank: 22 },
  { teamId: "texas_a_m", rank: 23 },
  { teamId: "mississippi_state", rank: 24 },
  { teamId: "houston", rank: 25 },
];

/**
 * The snapshot is deliberately source-controlled and manually updateable. It is not refreshed
 * with odds and it is not a claim that The Odds API supplies rankings.
 */
export const DEFAULT_RANKING_SNAPSHOTS: Readonly<Record<RankingSource, RankingSnapshot | null>> = {
  ap: {
    source: "ap",
    label: "AP Top 25",
    sourceUrl:
      "https://apnews.com/article/college-football-rankings-top-25-24005ba778fee95626d65d5deb5a18f8",
    updatedAt: "2026-09-20T20:00:00.000Z",
    entries: AP_TOP_25_ENTRIES,
  },
  cfp: null,
};

export const DEFAULT_LEAGUE_STANDINGS: Readonly<
  Record<"epl" | "laliga", LeagueStandingsSnapshot | null>
> = {
  epl: null,
  laliga: null,
};

const contextById = new Map(COLLEGE_FOOTBALL_TEAMS.map((entry) => [entry.id, entry]));
const teamIdByAlias = new Map(
  COLLEGE_FOOTBALL_TEAMS.flatMap((entry) =>
    entry.aliases.map(
      (alias) => [normalizeTeamName(alias).replace(/^\d+\s+/, ""), entry.id] as const,
    ),
  ),
);

function teamAliasKey(name: string) {
  return normalizeTeamName(name)
    .replace(/^#?\d+\s+/, "")
    .replace(/\s+football$/, "");
}

export function getCollegeTeamId(teamName: string) {
  return teamIdByAlias.get(teamAliasKey(teamName)) ?? null;
}

export function getCollegeTeamContext(teamNameOrId: string) {
  return contextById.get(teamIdByAlias.get(teamAliasKey(teamNameOrId)) ?? teamNameOrId) ?? null;
}

export function getActiveRankingSnapshot(
  now = new Date(),
  snapshots: Readonly<Record<RankingSource, RankingSnapshot | null>> = DEFAULT_RANKING_SNAPSHOTS,
) {
  const cfp = snapshots.cfp;
  if (cfp && new Date(cfp.updatedAt).getTime() <= now.getTime() && cfp.entries.length) return cfp;
  const ap = snapshots.ap;
  return ap && ap.entries.length ? ap : null;
}

export function getTeamRanking(
  teamName: string,
  snapshot: RankingSnapshot | null = getActiveRankingSnapshot(),
) {
  const teamId = getCollegeTeamId(teamName);
  if (!teamId || !snapshot) return null;
  return snapshot.entries.find((entry) => entry.teamId === teamId) ?? null;
}

export const COLLEGE_RIVALRIES: readonly (readonly [string, string])[] = [
  ["alabama", "auburn"],
  ["clemson", "south_carolina"],
  ["florida", "florida_state"],
  ["florida", "georgia"],
  ["georgia", "auburn"],
  ["iowa", "iowa_state"],
  ["lsu", "ole_miss"],
  ["michigan", "ohio_state"],
  ["notre_dame", "usc"],
  ["ole_miss", "mississippi_state"],
  ["texas", "texas_a_m"],
];

const rivalryKeys = new Set(
  COLLEGE_RIVALRIES.map(([left, right]) => [left, right].sort().join("|")),
);

export const SOCCER_RIVALRIES: readonly (readonly [string, string])[] = [
  ["arsenal", "tottenham_hotspur"],
  ["brighton", "crystal_palace"],
  ["chelsea", "tottenham_hotspur"],
  ["liverpool", "everton"],
  ["manchester_city", "manchester_united"],
  ["real_madrid", "barcelona"],
];

const soccerRivalryKeys = new Set(
  SOCCER_RIVALRIES.map(([left, right]) => [left, right].sort().join("|")),
);

export function areCollegeRivals(leftTeamName: string, rightTeamName: string) {
  const left = getCollegeTeamId(leftTeamName);
  const right = getCollegeTeamId(rightTeamName);
  return Boolean(left && right && rivalryKeys.has([left, right].sort().join("|")));
}

export function getStableTeamId(teamName: string) {
  return getCollegeTeamId(teamName) ?? teamAliasKey(teamName).replace(/\s+/g, "_");
}

export function areSoccerRivals(leftTeamName: string, rightTeamName: string) {
  const left = getStableTeamId(leftTeamName);
  const right = getStableTeamId(rightTeamName);
  return soccerRivalryKeys.has([left, right].sort().join("|"));
}

export function isPowerFourConference(conference: string | undefined) {
  return Boolean(conference && POWER_FOUR_CONFERENCES.has(conference));
}

export function isConferenceMatchup(leftTeamName: string, rightTeamName: string) {
  const left = getCollegeTeamContext(leftTeamName);
  const right = getCollegeTeamContext(rightTeamName);
  if (!left?.conference || !right?.conference) return false;
  if (left.conference === "Independent" || right.conference === "Independent") return false;
  return left.conference === right.conference;
}

export function getLeagueStandingsSnapshot(
  competitionId: CompetitionId,
  snapshots: Readonly<
    Record<"epl" | "laliga", LeagueStandingsSnapshot | null>
  > = DEFAULT_LEAGUE_STANDINGS,
) {
  if (competitionId !== "epl" && competitionId !== "laliga") return null;
  return snapshots[competitionId];
}
