"use client";

import { useState } from "react";

import { setImportedParlayResult } from "@/app/my-bets/actions";
import { SubmitButton } from "@/components/submit-button";

type Result = "open" | "won" | "lost" | "push" | "void";

export function ExternalParlayResultForm({
  wagerId,
  status,
  legs,
}: {
  wagerId: string;
  status: Result;
  legs: { legNumber: number; result: Result }[];
}) {
  const [ticketResult, setTicketResult] = useState<Result>(status);
  const [results, setResults] = useState(legs);
  return (
    <form action={setImportedParlayResult} className="result-form parlay-result-form">
      <input type="hidden" name="wagerId" value={wagerId} />
      <input type="hidden" name="legResults" value={JSON.stringify(results)} />
      <label>
        Ticket result
        <select
          name="status"
          value={ticketResult}
          onChange={(event) => setTicketResult(event.target.value as Result)}
        >
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="push">Push</option>
          <option value="void">Void</option>
        </select>
      </label>
      {results.map((leg, index) => (
        <label key={leg.legNumber}>
          Leg {leg.legNumber}
          <select
            value={leg.result}
            onChange={(event) =>
              setResults((current) =>
                current.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? { ...candidate, result: event.target.value as Result }
                    : candidate,
                ),
              )
            }
          >
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="push">Push</option>
            <option value="void">Void</option>
          </select>
        </label>
      ))}
      <SubmitButton className="button secondary" pendingLabel="Updating parlay…">
        Update parlay results
      </SubmitButton>
    </form>
  );
}
