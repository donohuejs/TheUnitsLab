"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export function BrowseMarketPane({
  activeEventId,
  children,
}: {
  activeEventId: string | null;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLElement>(null);

  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeEventId]);

  return (
    <section
      ref={paneRef}
      className="browse-market-detail"
      aria-label="Selected game markets"
      aria-live="polite"
    >
      {children}
    </section>
  );
}
