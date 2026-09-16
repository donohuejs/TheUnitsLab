import {
  displayLabel,
  importedSourceLabel,
  marketLabel,
  sourceLabel,
  ticketTypeLabel,
} from "@/lib/ui";

export function StatusBadge({ status }: { status: string }) {
  const className = status.replace(/[^a-z0-9_-]/gi, "-");
  return (
    <span
      className={`status-badge status-${className}`}
      aria-label={`Status: ${displayLabel(status)}`}
    >
      {displayLabel(status)}
    </span>
  );
}

export function SourceBadge({
  source,
  sportsbookName,
}: {
  source: "simulated" | "external" | "irl";
  sportsbookName?: string | null;
}) {
  const label = source === "simulated" ? sourceLabel(source) : importedSourceLabel(sportsbookName);
  return <span className={`source-badge source-${source}`}>{label}</span>;
}

export function TicketTypeBadge({ ticketType }: { ticketType: "straight" | "parlay" }) {
  return <span className="ticket-type-badge">{ticketTypeLabel(ticketType)}</span>;
}

export function MarketBadge({ market }: { market: string }) {
  return <span className="market-badge">{marketLabel(market)}</span>;
}
