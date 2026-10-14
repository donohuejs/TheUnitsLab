import type { NormalizedScore } from "./types";
import type { CompetitionId } from "@/lib/odds/types";

export type ScoreRefreshTarget = {
  competitionId: CompetitionId;
  providerEventId: string;
  scheduledStart: string;
};

export function shouldRefreshScoreTargets(
  scores: readonly NormalizedScore[],
  targets: readonly ScoreRefreshTarget[],
  now: Date,
) {
  if (!targets.length) return true;
  const byEvent = new Map(scores.map((score) => [score.providerEventId, score]));
  return targets.some((target) => {
    const score = byEvent.get(target.providerEventId);
    if (score?.isFinal) return false;
    const start = score?.scheduledStart ?? target.scheduledStart;
    return score?.isLive === true || Date.parse(start) <= now.getTime();
  });
}

export function uniqueScoreTargets(targets: readonly ScoreRefreshTarget[]): ScoreRefreshTarget[] {
  const unique = new Map<string, ScoreRefreshTarget>();
  for (const target of targets) {
    if (!unique.has(target.providerEventId)) unique.set(target.providerEventId, target);
  }
  return [...unique.values()];
}
