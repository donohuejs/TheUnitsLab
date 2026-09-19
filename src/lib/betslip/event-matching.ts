import { canonicalTeamKey, teamNamesMatch } from "../teams/logos";

export type CanonicalImportEvent = {
  providerEventId: string;
  sportKey: string;
  competitionKey: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string;
};

export type CanonicalEventMatch =
  | { state: "matched"; event: CanonicalImportEvent }
  | { state: "ambiguous"; candidates: CanonicalImportEvent[]; reason: string }
  | { state: "unmatched"; candidates: []; reason: string };

function cleanTeamText(value: string) {
  return value.replace(/^\s*\(?\d{1,3}\)?[.)]?\s*/, "").trim();
}

export function parseImportedEventDescription(value: string) {
  const match = /^(.{2,120}?)\s+(?:at|@|vs?\.?|v\.?)\s+(.{2,120})$/i.exec(value.trim());
  if (!match) return null;
  return { awayTeam: cleanTeamText(match[1]), homeTeam: cleanTeamText(match[2]) };
}

function withinWindow(candidate: CanonicalImportEvent, eventDate: string | undefined) {
  if (!eventDate) return true;
  const requested = new Date(eventDate).getTime();
  const scheduled = new Date(candidate.scheduledStart).getTime();
  return (
    Number.isFinite(requested) &&
    Number.isFinite(scheduled) &&
    Math.abs(scheduled - requested) <= 18 * 60 * 60 * 1000
  );
}

export function matchCanonicalImportEvent(
  events: CanonicalImportEvent[],
  input: {
    eventDescription: string;
    eventDate?: string;
    sportKey?: string;
    competitionKey?: string;
  },
): CanonicalEventMatch {
  const participants = parseImportedEventDescription(input.eventDescription);
  if (!participants)
    return {
      state: "unmatched",
      candidates: [],
      reason: "Event text needs an away and home team.",
    };

  const candidates = events.filter(
    (event) =>
      (!input.sportKey || event.sportKey === input.sportKey) &&
      (!input.competitionKey || event.competitionKey === input.competitionKey) &&
      withinWindow(event, input.eventDate) &&
      teamNamesMatch(participants.awayTeam, event.awayTeam) &&
      teamNamesMatch(participants.homeTeam, event.homeTeam),
  );
  if (candidates.length === 1) return { state: "matched", event: candidates[0] };
  if (candidates.length > 1) {
    return {
      state: "ambiguous",
      candidates,
      reason: "More than one canonical event matched the teams and available time window.",
    };
  }
  return {
    state: "unmatched",
    candidates: [],
    reason: input.eventDate
      ? "No canonical event matched the teams, competition, sport, and time window."
      : "No unique canonical event matched the teams and supported competition candidates.",
  };
}

const collegeFootballTeams = new Set([
  "miami",
  "wake forest",
  "houston",
  "texas tech",
  "alabama",
  "clemson",
  "georgia",
  "michigan",
  "notre dame",
  "ohio state",
  "pittsburgh",
  "south carolina",
  "syracuse",
]);

export function inferCompetitionCandidates(eventDescription: string, knownCompetition?: string) {
  if (knownCompetition) return [knownCompetition];
  const participants = parseImportedEventDescription(eventDescription);
  if (!participants) return [];
  const keys = [
    canonicalTeamKey(participants.awayTeam),
    canonicalTeamKey(participants.homeTeam),
  ].filter((key): key is string => Boolean(key));
  const normalizedText = eventDescription.toLowerCase();
  if (
    normalizedText.includes("college football") ||
    normalizedText.includes("ncaaf") ||
    keys.some((key) => collegeFootballTeams.has(key))
  ) {
    return ["ncaaf"];
  }
  if (normalizedText.includes("college basketball") || normalizedText.includes("ncaab")) {
    return ["ncaab"];
  }
  return [];
}
