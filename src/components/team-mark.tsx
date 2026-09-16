"use client";

/* Public CDN marks intentionally use a native image element so load failures can reveal initials. */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

import { resolveTeamIdentity } from "@/lib/teams/logos";

export function TeamMark({ teamName, sport }: { teamName: string; sport: string }) {
  const identity = resolveTeamIdentity(teamName, sport);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const imageAvailable = Boolean(identity.logoUrl && identity.logoUrl !== failedLogoUrl);

  return (
    <span className="team-identity" title={teamName} aria-label={teamName}>
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
