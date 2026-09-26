import type { ReactNode } from "react";

import { BrowseBetSlipProvider } from "@/components/browse-bet-slip-host";
import { BrowseRootScrollLock } from "@/components/browse-root-scroll-lock";

export default function CompetitionLayout({ children }: { children: ReactNode }) {
  return (
    <BrowseBetSlipProvider>
      <BrowseRootScrollLock />
      {children}
    </BrowseBetSlipProvider>
  );
}
