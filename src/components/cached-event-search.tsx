"use client";

import { useMemo, useState } from "react";

import { LocalDateTime } from "@/components/local-date-time";

export type CachedEvent = {
  providerEventId: string;
  sportKey: string;
  competitionKey: string;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string;
};

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function eventRelevance(event: CachedEvent, query: string, now: number) {
  const teams = normalize(`${event.awayTeam} ${event.homeTeam}`);
  const competition = normalize(event.competitionName);
  const terms = query ? normalize(query).split(" ").filter(Boolean) : [];
  const matchedTerms = terms.filter((term) => teams.includes(term) || competition.includes(term));
  const teamMatch = terms.some((term) => teams.includes(term));
  const kickoff = new Date(event.scheduledStart).getTime();
  const delta = kickoff - now;
  const currentBonus = delta >= 0 ? 40 : delta >= -24 * 60 * 60 * 1000 ? 20 : -20;
  const queryBonus = terms.length === 0 ? 0 : matchedTerms.length * 100 + (teamMatch ? 40 : 0);
  return queryBonus + currentBonus - Math.min(Math.abs(delta) / (24 * 60 * 60 * 1000), 30);
}

function formatEvent(event: CachedEvent) {
  return `${event.awayTeam} at ${event.homeTeam}`;
}

export function CachedEventSearch({
  events,
  selectedEventId,
  nowIso,
  onSelect,
  inputId = "cached-event-query",
}: {
  events: CachedEvent[];
  selectedEventId: string;
  nowIso: string;
  onSelect: (providerEventId: string) => void;
  inputId?: string;
}) {
  const [query, setQuery] = useState("");
  const now = new Date(nowIso).getTime();
  const results = useMemo(() => {
    const normalizedQuery = normalize(query);
    return events
      .filter((event) => {
        const kickoff = new Date(event.scheduledStart).getTime();
        if (kickoff < now - 48 * 60 * 60 * 1000) return false;
        if (!normalizedQuery) return true;
        const searchable = normalize(
          `${event.awayTeam} ${event.homeTeam} ${event.competitionName} ${event.sportKey}`,
        );
        return normalizedQuery
          .split(" ")
          .filter(Boolean)
          .every((term) => searchable.includes(term));
      })
      .sort((left, right) => eventRelevance(right, query, now) - eventRelevance(left, query, now))
      .slice(0, 8);
  }, [events, now, query]);

  return (
    <div className="cached-event-search">
      <label htmlFor={inputId}>
        Search cached events
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try a team name, e.g. Bills"
          autoComplete="off"
        />
      </label>
      <div className="cached-event-results" aria-live="polite">
        {results.length ? (
          results.map((event) => (
            <button
              className={
                selectedEventId === event.providerEventId ? "cached-event selected" : "cached-event"
              }
              key={event.providerEventId}
              type="button"
              onClick={() => onSelect(event.providerEventId)}
            >
              <strong>{formatEvent(event)}</strong>
              <span>
                {event.competitionName} · <LocalDateTime value={event.scheduledStart} />
              </span>
            </button>
          ))
        ) : (
          <p className="muted">No cached upcoming or recent event matches that search.</p>
        )}
      </div>
      <small className="muted">Showing the most relevant cached upcoming or recent events.</small>
    </div>
  );
}
