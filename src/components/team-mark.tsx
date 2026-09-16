import { resolveTeamIdentity } from "@/lib/teams/logos";

export function TeamMark({ teamName, sport }: { teamName: string; sport: string }) {
  const identity = resolveTeamIdentity(teamName, sport);
  return (
    <span className="team-identity" title={teamName} aria-label={teamName}>
      <span className="team-mark-fallback" aria-hidden="true">
        {identity.initials}
      </span>
      {identity.logoUrl ? (
        <span
          className="team-mark-image"
          aria-hidden="true"
          style={{ backgroundImage: `url("${identity.logoUrl}")` }}
        />
      ) : null}
    </span>
  );
}
