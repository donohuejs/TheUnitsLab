"use client";

/* Public CDN marks intentionally use a native image element so load failures can reveal initials. */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

import { resolveTeamRecord, teamLogoStatus, type TeamResolution } from "@/lib/teams/logos";

export function TeamMark({
  teamName,
  sport,
  competitionId,
  identity,
}: {
  teamName: string;
  sport: string;
  competitionId?: string;
  identity?: TeamResolution;
}) {
  const resolvedIdentity = identity ?? resolveTeamRecord(teamName, sport, competitionId);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const imageAvailable = Boolean(
    resolvedIdentity.logoUrl && resolvedIdentity.logoUrl !== failedLogoUrl,
  );
  const logoStatus = teamLogoStatus(resolvedIdentity, failedLogoUrl);

  return (
    <span
      className="team-identity"
      title={teamName}
      aria-label={teamName}
      data-team-resolution={resolvedIdentity.resolution}
      data-logo-status={logoStatus}
    >
      <span className="team-mark-fallback" aria-hidden="true">
        {resolvedIdentity.initials}
      </span>
      {resolvedIdentity.logoUrl && imageAvailable ? (
        <img
          className="team-mark-image"
          src={resolvedIdentity.logoUrl}
          alt=""
          aria-hidden="true"
          onError={() => setFailedLogoUrl(resolvedIdentity.logoUrl)}
        />
      ) : null}
    </span>
  );
}
