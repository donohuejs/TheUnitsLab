"use client";

import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";

function subscribeToMobileViewport(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(max-width: 760px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getMobileViewportSnapshot() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

function getServerMobileViewportSnapshot() {
  return false;
}

export function ResponsiveEventCard({
  children,
  heading,
}: {
  children: ReactNode;
  heading: ReactNode;
}) {
  const isMobile = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const expanded = !isMobile || mobileOpen;

  function toggleFromKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setMobileOpen((current) => !current);
    }
  }

  return (
    <article className={`card event-card${expanded ? " is-expanded" : " is-collapsed"}`}>
      <div
        className="event-card-toggle"
        role={isMobile ? "button" : undefined}
        tabIndex={isMobile ? 0 : undefined}
        aria-expanded={isMobile ? expanded : undefined}
        onClick={isMobile ? () => setMobileOpen((current) => !current) : undefined}
        onKeyDown={isMobile ? toggleFromKeyboard : undefined}
      >
        {heading}
        {isMobile ? (
          <span className="event-card-chevron" aria-hidden="true">
            {expanded ? "⌃" : "⌄"}
          </span>
        ) : null}
      </div>
      {expanded ? children : null}
    </article>
  );
}
