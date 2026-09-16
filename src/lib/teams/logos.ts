export type TeamSport = "soccer" | "football" | "basketball" | "hockey" | string;

type LogoRecord = { sport: string; id: string };

const logoIds: Record<string, LogoRecord> = {
  // ESPN's public CDN is used as a best-effort presentation source. Unknown names use initials.
  "arizona cardinals": { sport: "nfl", id: "22" },
  "atlanta falcons": { sport: "nfl", id: "1" },
  "baltimore ravens": { sport: "nfl", id: "33" },
  "buffalo bills": { sport: "nfl", id: "2" },
  "carolina panthers": { sport: "nfl", id: "29" },
  "chicago bears": { sport: "nfl", id: "3" },
  "cincinnati bengals": { sport: "nfl", id: "4" },
  "cleveland browns": { sport: "nfl", id: "5" },
  "dallas cowboys": { sport: "nfl", id: "6" },
  "denver broncos": { sport: "nfl", id: "7" },
  "detroit lions": { sport: "nfl", id: "8" },
  "green bay packers": { sport: "nfl", id: "9" },
  "houston texans": { sport: "nfl", id: "34" },
  "indianapolis colts": { sport: "nfl", id: "11" },
  "jacksonville jaguars": { sport: "nfl", id: "30" },
  "kansas city chiefs": { sport: "nfl", id: "12" },
  "las vegas raiders": { sport: "nfl", id: "13" },
  "los angeles chargers": { sport: "nfl", id: "24" },
  "los angeles rams": { sport: "nfl", id: "14" },
  "miami dolphins": { sport: "nfl", id: "15" },
  "minnesota vikings": { sport: "nfl", id: "16" },
  "new england patriots": { sport: "nfl", id: "17" },
  "new orleans saints": { sport: "nfl", id: "18" },
  "new york giants": { sport: "nfl", id: "19" },
  "new york jets": { sport: "nfl", id: "20" },
  "philadelphia eagles": { sport: "nfl", id: "21" },
  "pittsburgh steelers": { sport: "nfl", id: "23" },
  "san francisco 49ers": { sport: "nfl", id: "25" },
  "seattle seahawks": { sport: "nfl", id: "26" },
  "tampa bay buccaneers": { sport: "nfl", id: "27" },
  "tennessee titans": { sport: "nfl", id: "10" },
  "washington commanders": { sport: "nfl", id: "28" },
  "boston bruins": { sport: "nhl", id: "6" },
  "buffalo sabres": { sport: "nhl", id: "7" },
  "calgary flames": { sport: "nhl", id: "20" },
  "carolina hurricanes": { sport: "nhl", id: "12" },
  "chicago blackhawks": { sport: "nhl", id: "16" },
  "colorado avalanche": { sport: "nhl", id: "21" },
  "dallas stars": { sport: "nhl", id: "25" },
  "detroit red wings": { sport: "nhl", id: "17" },
  "edmonton oilers": { sport: "nhl", id: "22" },
  "florida panthers": { sport: "nhl", id: "13" },
  "los angeles kings": { sport: "nhl", id: "26" },
  "minnesota wild": { sport: "nhl", id: "29" },
  "montreal canadiens": { sport: "nhl", id: "8" },
  "nashville predators": { sport: "nhl", id: "18" },
  "new jersey devils": { sport: "nhl", id: "1" },
  "new york islanders": { sport: "nhl", id: "2" },
  "new york rangers": { sport: "nhl", id: "3" },
  "ottawa senators": { sport: "nhl", id: "9" },
  "philadelphia flyers": { sport: "nhl", id: "4" },
  "pittsburgh penguins": { sport: "nhl", id: "5" },
  "san jose sharks": { sport: "nhl", id: "27" },
  "seattle kraken": { sport: "nhl", id: "35" },
  "st. louis blues": { sport: "nhl", id: "19" },
  "tampa bay lightning": { sport: "nhl", id: "14" },
  "toronto maple leafs": { sport: "nhl", id: "10" },
  "vancouver canucks": { sport: "nhl", id: "23" },
  "vegas golden knights": { sport: "nhl", id: "32" },
  "washington capitals": { sport: "nhl", id: "15" },
  "winnipeg jets": { sport: "nhl", id: "30" },
  arsenal: { sport: "soccer", id: "359" },
  "aston villa": { sport: "soccer", id: "362" },
  bournemouth: { sport: "soccer", id: "8678" },
  brentford: { sport: "soccer", id: "337" },
  brighton: { sport: "soccer", id: "397" },
  chelsea: { sport: "soccer", id: "363" },
  "crystal palace": { sport: "soccer", id: "384" },
  everton: { sport: "soccer", id: "368" },
  fulham: { sport: "soccer", id: "370" },
  liverpool: { sport: "soccer", id: "364" },
  "manchester city": { sport: "soccer", id: "382" },
  "manchester united": { sport: "soccer", id: "360" },
  newcastle: { sport: "soccer", id: "361" },
  "nottingham forest": { sport: "soccer", id: "393" },
  "tottenham hotspur": { sport: "soccer", id: "367" },
  "west ham": { sport: "soccer", id: "371" },
  "wolverhampton wanderers": { sport: "soccer", id: "380" },
  alabama: { sport: "ncaa", id: "333" },
  clemson: { sport: "ncaa", id: "228" },
  georgia: { sport: "ncaa", id: "61" },
  michigan: { sport: "ncaa", id: "130" },
  "notre dame": { sport: "ncaa", id: "87" },
  "ohio state": { sport: "ncaa", id: "194" },
  pittsburgh: { sport: "ncaa", id: "221" },
  "south carolina": { sport: "ncaa", id: "2579" },
  syracuse: { sport: "ncaa", id: "183" },
  texas: { sport: "ncaa", id: "251" },
  miami: { sport: "ncaa", id: "2390" },
};

const teamAliases: Record<string, string> = {
  "alabama crimson tide": "alabama",
  "alabama crimson tide football": "alabama",
  "alabama university": "alabama",
  "clemson tigers": "clemson",
  "clemson university": "clemson",
  "georgia bulldogs": "georgia",
  "georgia university": "georgia",
  uga: "georgia",
  "michigan wolverines": "michigan",
  "university of michigan": "michigan",
  "notre dame fighting irish": "notre dame",
  "notre dame university": "notre dame",
  "ohio state buckeyes": "ohio state",
  "ohio state university": "ohio state",
  pitt: "pittsburgh",
  "pitt panthers": "pittsburgh",
  "pittsburgh panthers": "pittsburgh",
  "university of pittsburgh": "pittsburgh",
  "south carolina gamecocks": "south carolina",
  "south carolina university": "south carolina",
  "sc gamecocks": "south carolina",
  "syracuse orange": "syracuse",
  "syracuse orange football": "syracuse",
  "syracuse university": "syracuse",
  "miami hurricanes": "miami",
  "miami hurricanes football": "miami",
  "miami fl": "miami",
  "miami florida": "miami",
  "miami university florida": "miami",
};

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

export function teamInitials(name: string) {
  const words = normalizeTeamName(name)
    .replace(/[^a-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

export function resolveTeamLogo(teamName: string, sport: TeamSport) {
  const normalizedName = normalizeTeamName(teamName);
  const match = logoIds[teamAliases[normalizedName] ?? normalizedName];
  if (!match) return null;
  const sportPath =
    match.sport === "nfl"
      ? "nfl"
      : match.sport === "nhl"
        ? "nhl"
        : match.sport === "ncaa"
          ? "ncaa"
          : "soccer";
  return {
    initials: teamInitials(teamName),
    logoUrl: `https://a.espncdn.com/i/teamlogos/${sportPath}/500/${match.id}.png`,
    sport,
  };
}

export function resolveTeamIdentity(teamName: string, sport: TeamSport) {
  return (
    resolveTeamLogo(teamName, sport) ?? {
      initials: teamInitials(teamName),
      logoUrl: null,
      sport,
    }
  );
}
