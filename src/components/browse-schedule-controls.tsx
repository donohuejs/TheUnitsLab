"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

type DateOption = { value: string; label: string };
type EventOption = { id: string; label: string };

function buildHref(pathname: string, baseQuery: string, changes: Record<string, string | null>) {
  const params = new URLSearchParams(baseQuery);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

function clearActiveEventChanges(): Record<string, string | null> {
  return {
    event: null,
    book: null,
    market: null,
    selection: null,
    point: null,
    alternates: null,
    mobileSheet: null,
  };
}

export function BrowseScheduleControls({
  pathname,
  baseQuery,
  competitionId,
  selectedDate,
  dateOptions,
  previousDate,
  nextDate,
  eventOptions,
  activeEventId,
}: {
  pathname: string;
  baseQuery: string;
  competitionId: string;
  selectedDate: string;
  dateOptions: readonly DateOption[];
  previousDate: string | null;
  nextDate: string | null;
  eventOptions: readonly EventOption[];
  activeEventId: string | null;
}) {
  const router = useRouter();
  const dateInputRef = useRef<HTMLInputElement>(null);

  function navigate(changes: Record<string, string | null>) {
    router.push(buildHref(pathname, baseQuery, changes), { scroll: false });
  }

  function changeDate(value: string) {
    if (!value) return;
    navigate({ date: value, ...clearActiveEventChanges() });
  }

  function changeEvent(value: string) {
    const changes = clearActiveEventChanges();
    if (value) changes.event = value;
    navigate(changes);
  }

  function openDatePicker() {
    const input = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    if (typeof input.showPicker === "function") input.showPicker();
    else {
      input.focus();
      input.click();
    }
  }

  const selectedDateLabel =
    dateOptions.find((option) => option.value === selectedDate)?.label ?? selectedDate;

  return (
    <section className="browse-schedule-controls" aria-label="Browse Odds schedule controls">
      <div className="browse-date-control">
        <label htmlFor={`browse-date-${competitionId}`}>Date</label>
        <div className="browse-date-input-row">
          <button
            className="button secondary browse-date-step"
            type="button"
            aria-label="Previous date with games"
            disabled={!previousDate}
            onClick={() => previousDate && changeDate(previousDate)}
          >
            ←
          </button>
          <div className="browse-date-input-shell">
            <span aria-hidden="true" className="browse-date-icon">
              ▣
            </span>
            <button
              className="browse-date-readable"
              type="button"
              aria-label={"Choose date, " + selectedDateLabel}
              aria-haspopup="dialog"
              onClick={openDatePicker}
            >
              {selectedDateLabel}
            </button>
            <input
              ref={dateInputRef}
              id={`browse-date-${competitionId}`}
              name="date"
              className="browse-date-native-input"
              type="date"
              value={selectedDate}
              list={`browse-date-options-${competitionId}`}
              onChange={(event) => changeDate(event.target.value)}
              aria-describedby={`browse-date-help-${competitionId}`}
              tabIndex={-1}
              aria-hidden="true"
            />
          </div>
          <button
            className="button secondary browse-date-step"
            type="button"
            aria-label="Next date with games"
            disabled={!nextDate}
            onClick={() => nextDate && changeDate(nextDate)}
          >
            →
          </button>
        </div>
        <small id={`browse-date-help-${competitionId}`} className="sr-only">
          {dateOptions.length
            ? "Choose a date with available games."
            : "No games are available yet."}
        </small>
        <datalist id={`browse-date-options-${competitionId}`}>
          {dateOptions.map((option) => (
            <option key={option.value} value={option.value} label={option.label} />
          ))}
        </datalist>
      </div>

      <div className="browse-jump-control">
        <label htmlFor={`browse-jump-${competitionId}`}>Jump to game</label>
        <select
          id={`browse-jump-${competitionId}`}
          value={activeEventId ?? ""}
          onChange={(event) => changeEvent(event.target.value)}
          disabled={!eventOptions.length}
        >
          <option value="">Select a matchup...</option>
          {eventOptions.length
            ? eventOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))
            : null}
        </select>
      </div>
    </section>
  );
}
