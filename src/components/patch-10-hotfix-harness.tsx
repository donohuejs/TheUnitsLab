"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { BetSlip } from "@/components/bet-slip";
import { clearSlip, clearStraightSlip, type SlipSelection } from "@/lib/wagers/slip";

const choices: SlipSelection[] = [
  {
    clientSelectionId: "patch-10-hotfix-florida-spread",
    competitionKey: "ncaaf",
    eventId: "patch-10-hotfix-florida-event",
    sport: "football",
    competition: "College Football",
    event: "Florida at Gators",
    scheduledStart: "2099-09-20T23:30:00Z",
    homeTeam: "Gators",
    awayTeam: "Florida",
    bookmakerId: "fanduel",
    bookmaker: "FanDuel",
    marketType: "spread",
    selection: "away",
    selectionName: "Florida / Gators",
    line: -3.5,
    americanOdds: -110,
    decimalOdds: 1.9091,
  },
  {
    clientSelectionId: "patch-10-hotfix-alpha",
    competitionKey: "ncaaf",
    eventId: "patch-10-hotfix-alpha-event",
    sport: "football",
    competition: "College Football",
    event: "Alpha at Home",
    scheduledStart: "2099-09-17T23:30:00Z",
    homeTeam: "Home",
    awayTeam: "Alpha",
    bookmakerId: "fanduel",
    bookmaker: "FanDuel",
    marketType: "moneyline",
    selection: "away",
    selectionName: "Alpha",
    line: null,
    americanOdds: -110,
    decimalOdds: 1.9091,
  },
  {
    clientSelectionId: "patch-10-hotfix-beta",
    competitionKey: "ncaaf",
    eventId: "patch-10-hotfix-beta-event",
    sport: "football",
    competition: "College Football",
    event: "Beta at Home",
    scheduledStart: "2099-09-18T23:30:00Z",
    homeTeam: "Home",
    awayTeam: "Beta",
    bookmakerId: "fanduel",
    bookmaker: "FanDuel",
    marketType: "moneyline",
    selection: "away",
    selectionName: "Beta",
    line: null,
    americanOdds: 110,
    decimalOdds: 2.1,
  },
  {
    clientSelectionId: "patch-10-hotfix-gamma",
    competitionKey: "ncaaf",
    eventId: "patch-10-hotfix-gamma-event",
    sport: "football",
    competition: "College Football",
    event: "Gamma at Home",
    scheduledStart: "2099-09-19T23:30:00Z",
    homeTeam: "Home",
    awayTeam: "Gamma",
    bookmakerId: "fanduel",
    bookmaker: "FanDuel",
    marketType: "moneyline",
    selection: "away",
    selectionName: "Gamma",
    line: null,
    americanOdds: -105,
    decimalOdds: 1.9524,
  },
];

export function Patch10HotfixHarness() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectionKey = searchParams.get("event");
  const selection =
    choices.find((candidate) => candidate.clientSelectionId === selectionKey) ?? null;
  const [controlClicks, setControlClicks] = useState(0);

  const choose = (candidate: SlipSelection) => {
    router.replace(`/patch10_hotfix?event=${candidate.clientSelectionId}`, { scroll: false });
  };

  return (
    <>
      <section className="card patch-10-hotfix-controls" aria-label="Patch 10 test controls">
        <h1>Patch 10 hotfix harness</h1>
        <p className="muted">
          This development-only route renders the production MobileNav and BetSlip components.
        </p>
        <div className="inline-actions">
          {choices.map((candidate) => (
            <button
              className="button secondary"
              key={candidate.clientSelectionId}
              type="button"
              onClick={() => choose(candidate)}
            >
              Select {candidate.selectionName}
            </button>
          ))}
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              router.replace("/patch10_hotfix", { scroll: false });
              clearSlip();
              clearStraightSlip();
            }}
          >
            Reset harness slip
          </button>
        </div>
      </section>
      <div className="card" data-testid="patch-10-normal-control">
        <button
          className="button"
          type="button"
          onClick={() => setControlClicks((count) => count + 1)}
        >
          Normal page control
        </button>
        <output data-testid="patch-10-control-count">{controlClicks}</output>
      </div>
      <BetSlip selection={selection} groups={[]} />
    </>
  );
}
