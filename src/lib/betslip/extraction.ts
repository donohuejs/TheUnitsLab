export type ImportMethod = "screenshot" | "paste" | "entry";
export type ExtractedTicketType = "straight" | "parlay";

export type ExtractedParlayLeg = {
  eventDescription: string;
  selection?: string;
  americanOdds?: string;
};

export type BetslipDraftFields = {
  sportsbookId?: string;
  otherSportsbookName?: string;
  eventDescription?: string;
  eventDate?: string;
  wagerDate?: string;
  selection?: string;
  selectionKey?: "" | "home" | "away" | "draw" | "over" | "under";
  marketType?: "moneyline" | "spread" | "total";
  line?: string;
  americanOdds?: string;
  stakeDollars?: string;
  returnDollars?: string;
  sportsbookBetId?: string;
};

export type ExtractedBetslip = {
  fields: BetslipDraftFields;
  rawText: string;
  ticketType: ExtractedTicketType;
  parlayLegs: ExtractedParlayLeg[];
  confidence: "high" | "medium" | "low";
  uncertainFields: string[];
  warnings: string[];
};

export type OcrProgress = (progress: number, status: string) => void;

const MONEY = "\\$?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)";
const DATE = "(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}(?:\\s+\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)?)";

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").replace(/[|]+/g, " ").trim();
}

function cleanMoney(value: string) {
  return value.replace(/[$,\s]/g, "");
}

function labeledValue(text: string, labels: string, pattern: string) {
  return new RegExp(`(?:^|\\n)\\s*(?:${labels})\\s*[:#-]?\\s*${pattern}`, "im").exec(text)?.[1];
}

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/-/g, "/");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function detectSportsbook(text: string) {
  if (/draft\s*kings/i.test(text)) return { sportsbookId: "draftkings" };
  if (/fan\s*duel/i.test(text)) return { sportsbookId: "fanduel" };
  if (/bet\s*mgm/i.test(text)) return { sportsbookId: "betmgm" };
  if (/caesars/i.test(text)) return { sportsbookId: "caesars" };
  return {};
}

function detectEvent(lines: string[]) {
  for (const line of lines) {
    const event = parseEventLine(line);
    if (event) return event.eventDescription;
  }
  return undefined;
}

function parseEventLine(line: string) {
  const match = /(.{2,90})\s+(?:at|vs?\.?|v\.?|@)\s+(.{2,90})/i.exec(line);
  if (!match) return undefined;
  const left = cleanLine(match[1]).replace(/^(?:event|game)\s*[:#-]?\s*/i, "");
  const right = cleanLine(match[2])
    .replace(/\s+[+-]\d{3,7}\b.*$/, "")
    .replace(/[|,:].*$/, "");
  if (!left || !right) return undefined;
  return { eventDescription: `${left} at ${right}`, left };
}

function detectParlayLegs(lines: string[]) {
  const legs: ExtractedParlayLeg[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const event = parseEventLine(lines[index]);
    if (!event) continue;

    const sameLineOdds = /(?<!\d)([+-]\d{3,7})(?!\d)/.exec(lines[index])?.[1];
    const nextLine = lines[index + 1];
    const nextLineOdds =
      !sameLineOdds && nextLine && !parseEventLine(nextLine)
        ? /(?<!\d)([+-]\d{3,7})(?!\d)/.exec(nextLine)?.[1]
        : undefined;
    const americanOdds = sameLineOdds ?? nextLineOdds;
    const selectionSource = sameLineOdds ? lines[index] : nextLineOdds ? nextLine : undefined;
    const selection = selectionSource
      ? cleanLine(selectionSource.replace(americanOdds ?? "", ""))
          .replace(event.eventDescription, "")
          .replace(/^[:#-]+|[:#-]+$/g, "")
          .trim() || event.left
      : event.left;
    const leg = { eventDescription: event.eventDescription, selection, americanOdds };
    if (!legs.some((candidate) => candidate.eventDescription === leg.eventDescription)) {
      legs.push(leg);
    }
  }
  return legs;
}

function detectSelection(
  lines: string[],
  eventDescription: string | undefined,
  odds: string | undefined,
) {
  const candidates = lines.filter((line) => {
    if (!odds || !line.includes(odds)) return false;
    return !/^(?:odds|price|american|stake|wager|payout|return|total|potential)/i.test(line);
  });
  if (candidates[0] && odds) {
    return cleanLine(
      candidates[0].replace(new RegExp(`[+\\-]?${odds.replace(/[+\-]/g, "\\$&")}`), ""),
    )
      .replace(/^[:#-]+|[:#-]+$/g, "")
      .trim();
  }
  if (eventDescription) return eventDescription.split(" at ")[0];
  return undefined;
}

function detectMarket(
  text: string,
  selection: string | undefined,
): "moneyline" | "spread" | "total" {
  if (/\b(?:total|over|under)\b/i.test(text) || /\b(?:over|under)\b/i.test(selection ?? "")) {
    return "total";
  }
  if (/\b(?:spread|handicap|point spread)\b/i.test(text)) return "spread";
  return "moneyline";
}

function detectSelectionKey(
  selection: string | undefined,
  eventDescription: string | undefined,
  marketType: "moneyline" | "spread" | "total",
): BetslipDraftFields["selectionKey"] {
  const value = `${selection ?? ""} ${eventDescription ?? ""}`.toLowerCase();
  if (marketType === "total") {
    if (/\bover\b/.test(value)) return "over";
    if (/\bunder\b/.test(value)) return "under";
  }
  if (/\bdraw\b|\btie\b/.test(value)) return "draw";
  return "";
}

/** Parse common receipt labels into reviewable fields; it never persists a wager. */
export function parseBetslipText(rawText: string): ExtractedBetslip {
  const text = rawText.replace(/\r/g, "").trim();
  const lines = text.split("\n").map(cleanLine).filter(Boolean);
  const sportsbook = detectSportsbook(text);
  const sportsbookBetId = labeledValue(
    text,
    "(?:bet|wager|ticket|reference)\\s*(?:id|number|#)",
    "([A-Za-z0-9-]{4,160})",
  );
  const eventDescription = detectEvent(lines);
  const oddsMatch = /(?<!\d)([+-]\d{3,7})(?!\d)/.exec(text);
  const americanOdds = oddsMatch?.[1];
  const selection = detectSelection(lines, eventDescription, americanOdds);
  const marketType = detectMarket(text, selection);
  const line = labeledValue(
    text,
    "(?:spread|handicap|total)(?:\\s+line)?",
    "([+-]?\\d+(?:\\.\\d+)?)",
  );
  const stake = labeledValue(text, "(?:stake|wager|bet amount)", MONEY);
  const returnValue = labeledValue(text, "(?:payout|return|total return|potential payout)", MONEY);
  const eventDate = parseDate(
    labeledValue(text, "(?:kickoff|game|event|start)(?:\\s+date|\\s+time)?", DATE),
  );
  const wagerDate = parseDate(
    labeledValue(text, "(?:placed|wager|bet)(?:\\s+date|\\s+time)?", DATE),
  );
  const fields: BetslipDraftFields = {
    ...sportsbook,
    sportsbookBetId,
    eventDescription,
    eventDate,
    wagerDate,
    selection,
    selectionKey: detectSelectionKey(selection, eventDescription, marketType),
    marketType,
    line: marketType === "moneyline" ? "" : line,
    americanOdds,
    stakeDollars: stake ? cleanMoney(stake) : undefined,
    returnDollars: returnValue ? cleanMoney(returnValue) : undefined,
  };
  const uncertainFields = Object.entries({
    sportsbook: fields.sportsbookId,
    "sportsbook bet ID": fields.sportsbookBetId,
    event: fields.eventDescription,
    "event date": fields.eventDate,
    selection: fields.selection,
    odds: fields.americanOdds,
    stake: fields.stakeDollars,
    payout: fields.returnDollars,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const warnings = uncertainFields.map(
    (field) => `${field} was not confidently extracted; review it.`,
  );
  const ticketType: ExtractedTicketType = /\b(?:same game )?parlay\b|\bacca\b/i.test(text)
    ? "parlay"
    : "straight";
  const parlayLegs = ticketType === "parlay" ? detectParlayLegs(lines) : [];
  if (ticketType === "parlay") {
    warnings.push(
      parlayLegs.length
        ? `A parlay was detected and ${parlayLegs.length} probable leg${parlayLegs.length === 1 ? "" : "s"} were extracted. Review each leg in the parlay importer before saving.`
        : "A parlay was detected. Review each leg in the parlay importer before saving.",
    );
  }
  const extractedCount = Object.values(fields).filter(
    (value) => value !== undefined && value !== "",
  ).length;
  const confidence = extractedCount >= 6 ? "high" : extractedCount >= 3 ? "medium" : "low";

  return { fields, rawText: text, ticketType, parlayLegs, confidence, uncertainFields, warnings };
}

/** Local, free OCR adapter. The image stays in the browser and is never sent to an OCR API. */
export async function extractBetslip(image: Blob, onProgress?: OcrProgress) {
  if (typeof window === "undefined") {
    throw new Error("Local screenshot OCR is available in the browser only.");
  }
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (message) => {
      const progress =
        typeof message.progress === "number" ? Math.round(message.progress * 100) : 0;
      onProgress?.(progress, message.status ?? "Reading screenshot");
    },
  });
  try {
    onProgress?.(1, "Reading screenshot");
    const result = await worker.recognize(image);
    return parseBetslipText(result.data.text);
  } finally {
    await worker.terminate();
  }
}
