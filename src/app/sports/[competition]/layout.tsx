import type { ReactNode } from "react";

import { BrowseBetSlipProvider } from "@/components/browse-bet-slip-host";

export default function CompetitionLayout({ children }: { children: ReactNode }) {
  return <BrowseBetSlipProvider>{children}</BrowseBetSlipProvider>;
}
