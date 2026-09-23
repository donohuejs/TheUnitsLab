"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import { watchOdds } from "@/app/watchlist/actions";
import { SubmitButton } from "@/components/submit-button";
import {
  getEmptyPendingSlipSnapshot,
  getPendingSlipSnapshot,
  slipSelectionKey,
  subscribeToSlip,
} from "@/lib/wagers/slip";
import type { MarketType, SelectionType } from "@/lib/odds/types";

type DisplayOdd = {
  providerEventId: string;
  competitionKey: string;
  eventId: string;
  bookmakerId: string;
  bookmakerName: string;
  marketType: MarketType;
  selection: SelectionType;
  selectionName: string;
  point: number | null;
  americanOdds: number;
  decimalOdds: number;
  isAlternate?: boolean;
  href: string;
  isSelected: boolean;
  eventStarted: boolean;
  watch: {
    initialLine: number | null;
    initialAmericanOdds: number;
  } | null;
};

const price = (value: number) => (value > 0 ? `+${value}` : String(value));

function subscribeToMobileViewport(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia("(max-width: 760px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getMobileViewportSnapshot() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

function getServerMobileViewportSnapshot() {
  return false;
}

export function OddsSelectionGrid({
  odds,
  watchlistAvailable = true,
}: {
  odds: DisplayOdd[];
  watchlistAvailable?: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const isMobileViewport = useSyncExternalStore(
    subscribeToMobileViewport,
    getMobileViewportSnapshot,
    getServerMobileViewportSnapshot,
  );
  const pendingSelections = useSyncExternalStore(
    subscribeToSlip,
    getPendingSlipSnapshot,
    getEmptyPendingSlipSnapshot,
  );
  const pendingSelectionKeys = useMemo(
    () => new Set(pendingSelections.map(slipSelectionKey)),
    [pendingSelections],
  );
  const displayOdds = useMemo(
    () =>
      odds.map((odd) => ({
        ...odd,
        isSelected: (() => {
          const inSlip = pendingSelectionKeys.has(
            slipSelectionKey({
              eventId: odd.eventId,
              bookmakerId: odd.bookmakerId,
              marketType: odd.marketType,
              selection: odd.selection,
              line: odd.point,
            }),
          );
          return isMobileViewport ? inSlip : odd.isSelected || inSlip;
        })(),
      })),
    [isMobileViewport, odds, pendingSelectionKeys],
  );
  const groups = useMemo(() => {
    const bySelection = new Map<string, DisplayOdd[]>();
    for (const odd of displayOdds) {
      const key = `${odd.selection}|${odd.point ?? ""}`;
      const current = bySelection.get(key) ?? [];
      current.push(odd);
      bySelection.set(key, current);
    }
    return [...bySelection.entries()].map(([key, prices]) => ({
      key,
      prices: [...prices].sort((left, right) => right.americanOdds - left.americanOdds),
    }));
  }, [displayOdds]);

  const selectedGroupKeys = useMemo(
    () => groups.filter(({ prices }) => prices.some((odd) => odd.isSelected)).map(({ key }) => key),
    [groups],
  );

  function toggle(key: string) {
    setExpanded((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return (
    <div className="odds-selection-grid">
      <div className="desktop-odds-items">
        {displayOdds.map((odd, index) => (
          <OddChoice
            odd={odd}
            watchlistAvailable={watchlistAvailable}
            key={`${odd.bookmakerId}-${odd.selection}-${odd.point}-${index}`}
          />
        ))}
      </div>
      <div className="mobile-odds-items">
        {groups.map(({ key, prices }) => {
          const best = prices[0];
          if (!best) return null;
          const isExpanded = expanded.includes(key) || selectedGroupKeys.includes(key);
          return (
            <article className="mobile-odds-card" key={key}>
              <div className="mobile-odds-summary">
                <strong>
                  {best.selectionName}
                  {best.point === null ? "" : ` ${best.point > 0 ? "+" : ""}${best.point}`}
                </strong>
                <span>
                  Best: {price(best.americanOdds)} · {best.bookmakerName}
                </span>
                <OddChoice odd={best} watchlistAvailable={watchlistAvailable} />
              </div>
              {prices.length > 1 ? (
                <button
                  className="compare-books-button"
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => toggle(key)}
                >
                  {isExpanded ? "Hide prices" : `Compare ${prices.length} books`}
                </button>
              ) : null}
              {isExpanded ? (
                <div className="mobile-book-prices">
                  {prices.map((odd, index) => (
                    <OddChoice
                      odd={odd}
                      watchlistAvailable={watchlistAvailable}
                      key={`${odd.bookmakerId}-${odd.selection}-${odd.point}-${index}`}
                    />
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function OddChoice({ odd, watchlistAvailable }: { odd: DisplayOdd; watchlistAvailable: boolean }) {
  const content = (
    <>
      <small>
        {odd.bookmakerName} · {odd.eventStarted ? "LIVE · pregame price locked" : "pregame price"}
      </small>
      <strong>
        {odd.selectionName}
        {odd.point === null ? "" : ` ${odd.point > 0 ? "+" : ""}${odd.point}`}
      </strong>
      <span>
        {price(odd.americanOdds)} <small>({odd.decimalOdds.toFixed(2)})</small>
      </span>
      {odd.isSelected ? (
        <span className="odd-selected-indicator">
          <span aria-hidden="true">✓</span> Selected for simulated slip
        </span>
      ) : (
        <small>Select for simulated slip</small>
      )}
    </>
  );
  const selection = odd.eventStarted ? (
    <div className="odd locked" aria-disabled="true">
      {content}
    </div>
  ) : (
    <Link
      className={odd.isSelected ? "odd selected" : "odd"}
      href={odd.href}
      scroll={false}
      aria-current={odd.isSelected ? "true" : undefined}
    >
      {content}
    </Link>
  );
  return (
    <div className="odd-choice">
      {selection}
      {watchlistAvailable && !odd.eventStarted && !odd.isAlternate ? (
        odd.watch ? (
          <div className="watch-control is-watching">
            <Link href="/watchlist">★ Watching</Link>
            <small>
              Started:{" "}
              {odd.watch.initialLine === null
                ? ""
                : `${odd.watch.initialLine > 0 ? "+" : ""}${odd.watch.initialLine} `}
              ({price(odd.watch.initialAmericanOdds)}) · Now:{" "}
              {odd.point === null ? "" : `${odd.point > 0 ? "+" : ""}${odd.point} `}(
              {price(odd.americanOdds)})
            </small>
          </div>
        ) : (
          <form action={watchOdds} className="watch-control">
            <input type="hidden" name="competitionKey" value={odd.competitionKey} />
            <input type="hidden" name="eventId" value={odd.providerEventId} />
            <input type="hidden" name="bookmakerId" value={odd.bookmakerId} />
            <input type="hidden" name="marketType" value={odd.marketType} />
            <input type="hidden" name="selection" value={odd.selection} />
            <input type="hidden" name="expectedLine" value={odd.point ?? ""} />
            <input type="hidden" name="expectedAmericanOdds" value={odd.americanOdds} />
            <input type="hidden" name="returnTo" value={`/sports/${odd.competitionKey}`} />
            <SubmitButton className="watch-button" pendingLabel="Watching…">
              ☆ Watch Odds
            </SubmitButton>
          </form>
        )
      ) : null}
    </div>
  );
}
