import type { ReactNode } from "react";

export function BrowseGamesPane({ children }: { children: ReactNode }) {
  return (
    <section className="browse-games-grid" aria-label="Games">
      {children}
    </section>
  );
}
