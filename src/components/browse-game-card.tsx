import Link from "next/link";
import type { ReactNode } from "react";

import { KickoffTime } from "@/components/kickoff-time";
import { StatusBadge } from "@/components/status-badge";
import { TeamMark } from "@/components/team-mark";
import type { NormalizedEvent } from "@/lib/odds/types";

type TeamSummary = {
  name: string;
  rank: number | null;
  record: string | null;
  sport: NormalizedEvent["sport"];
};

function TeamSummaryLine({ team }: { team: TeamSummary }) {
  return (
    <span className="browse-team-line">
      <TeamMark teamName={team.name} sport={team.sport} />
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
  children,
}: {
  event: NormalizedEvent;
  href: string;
  active: boolean;
  away: TeamSummary;
  home: TeamSummary;
  marquee?: boolean;
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
        <div className="browse-game-meta">
          <span className="event-kickoff">
            <span className="sr-only">Kickoff </span>
            <KickoffTime value={event.scheduledStart} />
          </span>
          <StatusBadge status={event.status} />
          {marquee ? <span className="marquee-badge">Marquee Matchup</span> : null}
        </div>
        <span className="browse-game-action" aria-hidden="true">
          {active ? "Markets open" : "View markets"} <span>{active ? "⌃" : "⌄"}</span>
        </span>
      </Link>
      {active && children ? <div className="browse-game-board">{children}</div> : null}
    </article>
  );
}
