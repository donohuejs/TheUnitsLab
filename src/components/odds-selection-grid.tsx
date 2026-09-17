"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type DisplayOdd = {
  bookmakerId: string;
  bookmakerName: string;
  marketType: string;
  selection: string;
  selectionName: string;
  point: number | null;
  americanOdds: number;
  decimalOdds: number;
  isAlternate?: boolean;
  href: string;
  isSelected: boolean;
  eventStarted: boolean;
};

const price = (value: number) => (value > 0 ? `+${value}` : String(value));

export function OddsSelectionGrid({ odds }: { odds: DisplayOdd[] }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const groups = useMemo(() => {
    const bySelection = new Map<string, DisplayOdd[]>();
    for (const odd of odds) {
      const key = `${odd.selection}|${odd.point ?? ""}`;
      const current = bySelection.get(key) ?? [];
      current.push(odd);
      bySelection.set(key, current);
    }
    return [...bySelection.entries()].map(([key, prices]) => ({
      key,
      prices: [...prices].sort((left, right) => right.americanOdds - left.americanOdds),
    }));
  }, [odds]);

  function toggle(key: string) {
    setExpanded((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  return (
    <div className="odds-selection-grid">
      <div className="desktop-odds-items">
        {odds.map((odd, index) => (
          <OddChoice odd={odd} key={`${odd.bookmakerId}-${odd.selection}-${odd.point}-${index}`} />
        ))}
      </div>
      <div className="mobile-odds-items">
        {groups.map(({ key, prices }) => {
          const best = prices[0];
          if (!best) return null;
          const isExpanded = expanded.includes(key);
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
                <OddChoice odd={best} />
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

function OddChoice({ odd }: { odd: DisplayOdd }) {
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
      <small>{odd.isSelected ? "Selected for simulated slip" : "Select for simulated slip"}</small>
    </>
  );
  return odd.eventStarted ? (
    <div className="odd locked" aria-disabled="true">
      {content}
    </div>
  ) : (
    <Link
      className={odd.isSelected ? "odd selected" : "odd"}
      href={odd.href}
      aria-current={odd.isSelected ? "true" : undefined}
    >
      {content}
    </Link>
  );
}
