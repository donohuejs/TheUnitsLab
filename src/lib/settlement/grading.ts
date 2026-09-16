export type StraightLeg = {
  sportKey: string;
  marketType: "moneyline" | "spread" | "total";
  selection: "home" | "away" | "draw" | "over" | "under";
  line: number | null;
};

export type FinalScore = { homeScore: number; awayScore: number };
export type Grade = "won" | "lost" | "push";

export function gradeStraightLeg(leg: StraightLeg, score: FinalScore): Grade {
  if (![score.homeScore, score.awayScore].every(Number.isInteger)) {
    throw new Error("Final scores must be integers");
  }
  if (score.homeScore < 0 || score.awayScore < 0)
    throw new Error("Final scores cannot be negative");

  if (leg.marketType === "moneyline") {
    if (leg.sportKey === "soccer") {
      if (leg.selection === "draw") return score.homeScore === score.awayScore ? "won" : "lost";
      if (leg.selection === "home") return score.homeScore > score.awayScore ? "won" : "lost";
      if (leg.selection === "away") return score.awayScore > score.homeScore ? "won" : "lost";
    } else if (leg.selection === "home" || leg.selection === "away") {
      if (score.homeScore === score.awayScore) return "push";
      const selectedScore = leg.selection === "home" ? score.homeScore : score.awayScore;
      const opponentScore = leg.selection === "home" ? score.awayScore : score.homeScore;
      return selectedScore > opponentScore ? "won" : "lost";
    }
  }

  if (leg.marketType === "spread" && leg.line !== null) {
    if (leg.selection !== "home" && leg.selection !== "away")
      throw new Error("Invalid spread selection");
    const selectedScore = leg.selection === "home" ? score.homeScore : score.awayScore;
    const opponentScore = leg.selection === "home" ? score.awayScore : score.homeScore;
    const adjustedMargin = selectedScore + leg.line - opponentScore;
    return adjustedMargin > 0 ? "won" : adjustedMargin < 0 ? "lost" : "push";
  }

  if (leg.marketType === "total" && leg.line !== null) {
    if (leg.selection !== "over" && leg.selection !== "under")
      throw new Error("Invalid total selection");
    const combined = score.homeScore + score.awayScore;
    if (combined === leg.line) return "push";
    return leg.selection === "over"
      ? combined > leg.line
        ? "won"
        : "lost"
      : combined < leg.line
        ? "won"
        : "lost";
  }
  throw new Error("Unsupported stored market semantics");
}

export function liveWagerState(leg: StraightLeg, score: FinalScore) {
  const selectedScore = leg.selection === "away" ? score.awayScore : score.homeScore;
  const opponentScore = leg.selection === "away" ? score.homeScore : score.awayScore;
  if (leg.marketType === "moneyline") {
    if (leg.sportKey === "soccer" && leg.selection === "draw") {
      return selectedScore === opponentScore
        ? "Draw is currently hitting"
        : "Draw is not currently hitting";
    }
    return selectedScore > opponentScore
      ? "Winning"
      : selectedScore < opponentScore
        ? "Losing"
        : "Tied";
  }
  if (leg.marketType === "spread" && leg.line !== null) {
    const margin = selectedScore - opponentScore;
    const cover = margin + leg.line;
    return cover > 0
      ? `Covering by ${formatDistance(cover)} (margin ${signed(margin)})`
      : cover < 0
        ? `Not covering by ${formatDistance(-cover)} (margin ${signed(margin)})`
        : `Push at current score (margin ${signed(margin)})`;
  }
  if (leg.marketType === "total" && leg.line !== null) {
    const combined = score.homeScore + score.awayScore;
    const distance = Math.abs(combined - leg.line);
    if (combined === leg.line) return `Current total ${combined}: push`;
    const position = combined > leg.line ? "over" : "under";
    return `Current total ${combined}: ${position} by ${formatDistance(distance)}`;
  }
  return "Live state unavailable";
}

const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;
const formatDistance = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);
