"use client";

/* Public CDN marks intentionally use a native image element so load failures can reveal initials. */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

import { resolveTeamRecord, teamLogoStatus } from "@/lib/teams/logos";

export function TeamMark({
  teamName,
  sport,
  competitionId,
}: {
  teamName: string;
  sport: string;
  competitionId?: string;
}) {
  const identity = resolveTeamRecord(teamName, sport, competitionId);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const imageAvailable = Boolean(identity.logoUrl && identity.logoUrl !== failedLogoUrl);
  const logoStatus = teamLogoStatus(identity, failedLogoUrl);

  return (
    <span
      className="team-identity"
      title={teamName}
      aria-label={teamName}
      data-team-resolution={identity.resolution}
      data-logo-status={logoStatus}
    >
      <span className="team-mark-fallback" aria-hidden="true">
        {identity.initials}
      </span>
      {identity.logoUrl && imageAvailable ? (
        <img
          className="team-mark-image"
          src={identity.logoUrl}
          alt=""
          aria-hidden="true"
          onError={() => setFailedLogoUrl(identity.logoUrl)}
        />
      ) : null}
    </span>
  );
}
