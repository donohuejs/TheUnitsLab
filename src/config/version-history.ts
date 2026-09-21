export type VersionHistoryEntry = {
  version: string;
  title: string;
  changes: readonly string[];
};

export const VERSION_HISTORY: readonly VersionHistoryEntry[] = [
  {
    version: "0.12.1",
    title: "Authentication Onboarding Hotfix",
    changes: [
      "Completed the email-confirmation callback and success flow",
      "Added safe expired, invalid, and already-used confirmation states",
      "Added privacy-safe forgot-password and recovery-session password updates",
    ],
  },
  {
    version: "0.12.0",
    title: "Private Beta Launch",
    changes: [
      "Marked the start of the first formal private beta",
      "Completed the production clean-start and canonical admin bankroll reset",
      "Removed the beta test user and repaired My Bets production permissions",
      "Finalized feedback, tutorial, onboarding, maintenance, backup, and recovery readiness",
      "Passed the final production smoke checks",
    ],
  },
  {
    version: "0.11.2",
    title: "Tutorial Caption Layout Hotfix",
    changes: [
      "Repositioned tutorial captions to avoid covering important UI",
      "Preserved full accessibility caption support",
      "Kept the corrected multi-stage Import Betslip walkthrough unchanged",
    ],
  },
  {
    version: "0.11.1",
    title: "Tutorial Video Hotfix",
    changes: [
      "Replaced the stale Import Betslip tutorial recording",
      "Aligned the walkthrough with the current multi-stage review flow",
      "Kept the written tutorial and captions synchronized with the recording",
    ],
  },
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
