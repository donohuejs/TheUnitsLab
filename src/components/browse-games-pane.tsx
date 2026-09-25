"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export function BrowseGamesPane({
  competitionId,
  children,
}: {
  competitionId: string;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLElement>(null);
  const storageKey = "sportsbook-simulator:browse-games-scroll:" + competitionId;

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    try {
      const saved = Number(window.sessionStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) pane.scrollTop = saved;
    } catch {
      // Scroll restoration is an enhancement; the pane remains usable when storage is blocked.
    }
    const saveScroll = () => {
      try {
        window.sessionStorage.setItem(storageKey, String(pane.scrollTop));
      } catch {
        // Ignore storage failures without affecting navigation.
      }
    };
    pane.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      saveScroll();
      pane.removeEventListener("scroll", saveScroll);
    };
  }, [storageKey]);

  return (
    <aside ref={paneRef} className="browse-games-rail" aria-label="Games navigator">
      {children}
    </aside>
  );
}
