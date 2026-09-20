export type VersionHistoryEntry = {
  version: string;
  title: string;
  changes: readonly string[];
};

export const VERSION_HISTORY: readonly VersionHistoryEntry[] = [
  {
    version: "0.11.0",
    title: "Private Beta Readiness",
    changes: [
      "Added private-beta onboarding",
      "Added in-app Feedback & Bug reporting",
      "Added version display and release history",
      "Improved Import Betslip tutorial",
      "Added beta operations/recovery documentation",
    ],
  },
  {
    version: "0.10.1",
    title: "Production UX Hotfix",
    changes: [
      "Fixed mobile navigation stability",
      "Fixed final Bet Slip selection removal",
      "Improved mobile Bet Slip reliability",
      "Hardened release UX",
    ],
  },
] as const;
