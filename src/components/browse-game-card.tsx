import Link from "next/link";
import type { ReactNode } from "react";

import { KickoffTime } from "@/components/kickoff-time";
import { StatusBadge } from "@/components/status-badge";
import { TeamMark } from "@/components/team-mark";
import { shouldShowBrowseEventStatus } from "@/lib/browse-schedule";
import type { NormalizedEvent } from "@/lib/odds/types";
import type { TeamResolution } from "@/lib/teams/logos";

type TeamSummary = {
  name: string;
  rank: number | null;
  record: string | null;
  sport: NormalizedEvent["sport"];
  competitionId: NormalizedEvent["competitionId"];
  identity?: TeamResolution;
};

function TeamSummaryLine({ team }: { team: TeamSummary }) {
  return (
    <span className="browse-team-line">
      <TeamMark
        teamName={team.name}
        sport={team.sport}
        competitionId={team.competitionId}
        identity={team.identity}
      />
      <span className="browse-team-name">
        {team.rank !== null ? (
          <span className="team-ranking" aria-label={"Rank " + team.rank}>
            #{team.rank}
          </span>
        ) : null}{" "}
        {team.name}
      </span>
      {team.record ? <small className="team-record">{team.record}</small> : null}
    </span>
  );
}

export function BrowseGameCard({
  event,
  href,
  active,
  away,
  home,
  marquee,
  timeZone,
  children,
}: {
  event: NormalizedEvent;
  href: string;
  active: boolean;
  away: TeamSummary;
  home: TeamSummary;
  marquee?: boolean;
  timeZone: string;
  children?: ReactNode;
}) {
  return (
    <article
      id={"browse-event-" + event.id}
      className={"card browse-game-card" + (active ? " is-active" : "")}
      aria-label={event.awayTeam + " at " + event.homeTeam}
    >
      <Link
        className="browse-game-row"
        href={href}
        scroll={false}
        aria-current={active ? "true" : undefined}
        aria-expanded={active}
      >
        <div className="browse-game-teams">
          <TeamSummaryLine team={away} />
          <span className="event-at">at</span>
          <TeamSummaryLine team={home} />
        </div>
        <div className="browse-game-side">
          <div className="browse-game-meta">
            <span className="event-kickoff browse-game-card-kickoff">
              <span className="sr-only">Kickoff </span>
              <KickoffTime value={event.scheduledStart} timeZone={timeZone} />
            </span>
            {shouldShowBrowseEventStatus(event.status) ? (
              <StatusBadge status={event.status} />
            ) : null}
            {marquee ? <span className="marquee-badge">Marquee Matchup</span> : null}
          </div>
          <span className="browse-game-action">
            <span className="browse-game-action-label">
              {active ? "Markets open" : "View markets"}
            </span>
            <span className="browse-game-chevron" aria-hidden="true">
              {active ? "⌃" : "⌄"}
            </span>
          </span>
        </div>
      </Link>
      {active && children ? <div className="browse-game-mobile-board">{children}</div> : null}
    </article>
  );
}
