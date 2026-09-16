import Link from "next/link";

import { browseCompetitionGroups } from "@/config/sports";

export function CompetitionSwitcher({ currentCompetition }: { currentCompetition?: string }) {
  return (
    <nav className="competition-switcher" aria-label="Browse odds competitions">
      {browseCompetitionGroups.map((group) => (
        <div className="competition-switcher-group" key={group.id}>
          <span className="competition-switcher-label">{group.label}</span>
          <div className="competition-switcher-links">
            {group.competitions.map((competition) => {
              const active = currentCompetition === competition.id;
              return (
                <Link
                  className={
                    active ? "competition-switcher-link active" : "competition-switcher-link"
                  }
                  href={`/sports/${competition.id}`}
                  key={competition.id}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                >
                  {competition.browseLabel}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
