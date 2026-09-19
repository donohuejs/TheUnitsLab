import { teamNamesMatch } from "../teams/logos";

export type ImportMethod = "screenshot" | "paste" | "entry";
export type ExtractedTicketType = "straight" | "parlay";

export type ExtractedParlayLeg = {
  eventDescription: string;
  eventDate?: string;
  selection?: string;
  selectionKey?: "" | "home" | "away" | "draw" | "over" | "under";
  marketType?: "moneyline" | "spread" | "total";
  line?: string;
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
  ticketTypeConfidence: "high" | "medium" | "low";
  parlayLegs: ExtractedParlayLeg[];
  confidence: "high" | "medium" | "low";
  uncertainFields: string[];
  warnings: string[];
  source?: "local" | "vision";
};

export type VisionBetslipDraft = {
  ticketType: ExtractedTicketType;
  sportsbook: string | null;
  sportsbookBetId: string | null;
  wagerDateText: string | null;
  stake: string | null;
  totalReturn: string | null;
  combinedAmericanOdds: string | null;
  legs: Array<{
    eventText: string | null;
    eventDateText: string | null;
    sportText?: string | null;
    competitionText?: string | null;
    market: "moneyline" | "spread" | "total" | null;
    selectionText: string | null;
    line: string | null;
    americanOdds: string | null;
  }>;
};

export type OcrProgress = (progress: number, status: string) => void;

const MONEY = "\\$?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)";
const NUMERIC_DATE = "(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}(?:\\s+\\d{1,2}:\\d{2}(?:\\s*[AP]M)?)?)";
const MONTH_DATE =
  "((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2}(?:,?\\s+\\d{4})?(?:,?\\s+\\d{1,2}:\\d{2}\\s*(?:[AP]M))?(?:\\s+[A-Z]{2,4})?)";

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
  const normalized = value.replace(/\s+/g, " ").trim();
  const eastern = /\bET\b/i.test(normalized);
  const withoutZone = normalized.replace(/\bET\b/i, "").trim();
  const candidates = [normalized];
  if (!/\b\d{4}\b/.test(withoutZone))
    candidates.push(`${withoutZone} ${new Date().getUTCFullYear()}`);
  for (const candidate of candidates) {
    const date = eastern
      ? new Date(`${candidate.replace(/\bET\b/i, "").trim()} UTC`.replace(/-/g, "/"))
      : new Date(candidate.replace(/-/g, "/"));
    if (eastern && !Number.isNaN(date.getTime())) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((item) => item.type === type)?.value);
      const wallClockUtc = Date.UTC(
        part("year"),
        part("month") - 1,
        part("day"),
        part("hour"),
        part("minute"),
        part("second"),
      );
      const requestedWallClock = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
      );
      return new Date(date.getTime() + (requestedWallClock - wallClockUtc)).toISOString();
    }
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}

function detectSportsbook(text: string) {
  if (/draft\s*kings/i.test(text)) return { sportsbookId: "draftkings" };
  if (/fan\s*duel/i.test(text)) return { sportsbookId: "fanduel" };
  if (/bet\s*mgm/i.test(text)) return { sportsbookId: "betmgm" };
  if (/caesars/i.test(text)) return { sportsbookId: "caesars" };
  return {};
}

function parseEventLine(line: string) {
  const match = /(.{2,90}?)\s+(?:at|vs?\.?|v\.?|@)\s+(.{2,90})/i.exec(line);
  if (!match) return undefined;
  const left = cleanLine(match[1]).replace(/^(?:event|game)\s*[:#-]?\s*/i, "");
  const right = cleanLine(match[2])
    .replace(/\s+[+-]\d{3,7}\b.*$/, "")
    .replace(/\s+(?:moneyline|spread|handicap|total)\b.*$/i, "")
    .replace(/[|,:].*$/, "")
    .trim();
  if (!left || !right) return undefined;
  return { eventDescription: `${left} at ${right}`, left };
}

function detectEvent(lines: string[]) {
  for (const line of lines) {
    const event = parseEventLine(line);
    if (event) return event.eventDescription;
  }
  return undefined;
}

function detectAmericanOdds(text: string) {
  return /(?<!\d)([+-]\d{3,7})(?!\d)/.exec(text)?.[1];
}

function detectMarket(
  text: string,
  selection: string | undefined,
): "moneyline" | "spread" | "total" {
  if (/\b(?:spread|handicap|point spread)\b/i.test(text)) return "spread";
  if (/\b(?:over|under)\b/i.test(text) || /\b(?:over|under)\b/i.test(selection ?? ""))
    return "total";
  if (/\btotal\s+(?:line|points?|goals?)\b/i.test(text)) return "total";
  return "moneyline";
}

function detectLine(text: string, marketType: "moneyline" | "spread" | "total") {
  if (marketType === "moneyline") return "";
  const labeled =
    marketType === "spread"
      ? /(?:point\s+spread|spread|handicap)\s*[:#-]?[^\n]*?([+-]?\d+(?:\.\d+)?)/i.exec(text)?.[1]
      : /(?:total|over|under)\s*[:#-]?[^\n]*?([+-]?\d+(?:\.\d+)?)/i.exec(text)?.[1];
  if (labeled) return labeled;
  return /(?<!\d)([+-]?\d+\.\d+)(?!\d)/.exec(text)?.[1] ?? "";
}

function cleanSelection(value: string, line = "", odds = "") {
  return cleanLine(value)
    .replace(/^(?:point\s+spread|spread|handicap|selection|pick)\s*[:#-]?\s*/i, "")
    .replace(line, "")
    .replace(odds, "")
    .replace(/^[+#:-]+|[+#:-]+$/g, "")
    .trim();
}

function detectSelection(
  lines: string[],
  eventDescription: string | undefined,
  odds: string | undefined,
  line = "",
) {
  const candidates = lines.filter((candidate) => {
    if (!odds || !candidate.includes(odds)) return false;
    return !/^(?:odds|price|american|stake|wager|payout|return|total return|potential)/i.test(
      candidate,
    );
  });
  if (candidates[0] && odds) {
    return cleanSelection(candidates[0], line, odds);
  }
  if (line) {
    const lineCandidate = lines.find(
      (candidate) =>
        candidate.includes(line) &&
        !/^(?:odds|price|american|stake|wager|payout|return|total return|potential)\b/i.test(
          candidate,
        ),
    );
    if (lineCandidate) return cleanSelection(lineCandidate, line, odds);
  }
  if (eventDescription) return cleanSelection(eventDescription.split(" at ")[0]);
  return undefined;
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
  if (marketType === "moneyline") return "";
  const event = eventDescription ? parseEventLine(eventDescription) : undefined;
  if (selection && event) {
    if (teamNamesMatch(selection, event.left)) return "away";
    if (teamNamesMatch(selection, event.eventDescription.split(" at ").slice(1).join(" at "))) {
      return "home";
    }
  }
  return "";
}

/** Infer the private grading key from the pick text. The user-facing draft keeps the pick text;
 * this helper only supplies metadata for deterministic settlement. */
export function inferSelectionKey(
  selection: string | undefined,
  eventDescription: string | undefined,
  marketType: "moneyline" | "spread" | "total",
): BetslipDraftFields["selectionKey"] {
  return detectSelectionKey(selection, eventDescription, marketType);
}

function detectEventDate(lines: string[], eventDescription: string | undefined) {
  const eventIndex = eventDescription
    ? lines.findIndex((line) => parseEventLine(line)?.eventDescription === eventDescription)
    : -1;
  const preferred = lines.filter(
    (line, index) =>
      index >= Math.max(0, eventIndex) &&
      !/\b(?:placed|wagered|submitted|bet\s+date|wager\s+date|ticket\s+timestamp)\b/i.test(line),
  );
  for (const line of [...preferred, ...lines]) {
    if (/\b(?:placed|wagered|submitted|bet\s+date|wager\s+date|ticket\s+timestamp)\b/i.test(line)) {
      continue;
    }
    const value =
      new RegExp(NUMERIC_DATE, "i").exec(line)?.[1] ?? new RegExp(MONTH_DATE, "i").exec(line)?.[1];
    const parsed = parseDate(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function isLegMetadataLine(line: string) {
  return /^(?:leg|pick|selection|market|moneyline|spread|handicap|total|odds|price|american|stake|wager|payout|return|total return|potential|combined|parlay|ticket|bet id|placed|wagered|submitted|game time|event time|kickoff|event|game)\b/i.test(
    line,
  );
}

function legBlocks(lines: string[]) {
  const markerIndexes = lines
    .map((line, index) => (/^(?:leg|pick)\s*#?\s*\d+\b/i.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (markerIndexes.length >= 2) {
    return markerIndexes.map((start, index) =>
      lines.slice(start, markerIndexes[index + 1] ?? lines.length),
    );
  }

  const eventIndexes = lines
    .map((line, index) => (parseEventLine(line) ? index : -1))
    .filter((index) => index >= 0);
  if (eventIndexes.length) {
    return eventIndexes.map((start, index) =>
      lines.slice(start, eventIndexes[index + 1] ?? lines.length),
    );
  }

  // Some receipts show one selection/event heading per block and omit the opponent. In that
  // layout odds are the reliable boundary. Each odds line owns the nearest preceding pick text;
  // no field is assembled by zipping independent event/selection/price arrays.
  const oddsIndexes = lines
    .map((line, index) => (detectAmericanOdds(line) ? index : -1))
    .filter((index) => index >= 0);
  return oddsIndexes.map((oddsIndex, index) => {
    const previousOddsIndex = oddsIndexes[index - 1] ?? -1;
    const start = Math.max(previousOddsIndex + 1, oddsIndex - 4);
    return lines.slice(start, oddsIndex + 1);
  });
}

function parseLegBlock(block: string[]): ExtractedParlayLeg | null {
  if (!block.length) return null;
  const eventLine = block.find((line) => parseEventLine(line));
  const event = eventLine ? parseEventLine(eventLine) : undefined;
  const americanOdds = block.map(detectAmericanOdds).find(Boolean);
  const marketType = detectMarket(block.join(" "), event?.left ?? block.join(" "));
  const line = detectLine(block.join(" "), marketType);
  const selectionSource = block.find(
    (lineValue) =>
      Boolean(americanOdds && lineValue.includes(americanOdds)) &&
      !/^\+?\d+(?:\.\d+)?$/.test(lineValue),
  );
  const fallbackSelection = [...block]
    .reverse()
    .find(
      (lineValue) =>
        !isLegMetadataLine(lineValue) &&
        !detectAmericanOdds(lineValue) &&
        !/^[-+]?\d+(?:\.\d+)?$/.test(lineValue),
    );
  const selection = event
    ? selectionSource && selectionSource !== eventLine
      ? detectSelection([selectionSource], event.eventDescription, americanOdds, line)
      : event.left
    : fallbackSelection;
  const eventDescription = event?.eventDescription ?? selection;
  if (!eventDescription || !selection) return null;
  const leg: ExtractedParlayLeg = {
    eventDescription: cleanLine(eventDescription),
    selection: cleanLine(selection),
    americanOdds,
  };
  if (marketType !== "moneyline") {
    leg.marketType = marketType;
    leg.line = line;
  }
  const selectionKey = detectSelectionKey(selection, eventDescription, marketType);
  if (selectionKey) leg.selectionKey = selectionKey;
  const eventDate = detectEventDate(block, event?.eventDescription);
  if (eventDate) leg.eventDate = eventDate;
  return leg;
}

function detectParlayLegs(lines: string[]) {
  const legs: ExtractedParlayLeg[] = [];
  for (const block of legBlocks(lines)) {
    const leg = parseLegBlock(block);
    if (!leg) continue;
    const duplicate = legs.some(
      (candidate) =>
        candidate.eventDescription === leg.eventDescription &&
        candidate.americanOdds === leg.americanOdds,
    );
    if (!duplicate) legs.push(leg);
  }
  return legs;
}

function detectTicketOdds(text: string, ticketType: ExtractedTicketType) {
  if (ticketType === "parlay") {
    const labeled = /(?:combined|parlay|ticket|total)\s*(?:odds|price)?[^\n]*?([+-]\d{3,7})/i.exec(
      text,
    )?.[1];
    if (labeled) return labeled;
  }
  return detectAmericanOdds(text);
}

/** Parse common receipt labels into a normalized, reviewable draft; it never persists a wager. */
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
  const explicitParlay = /\b(?:same game )?parlay\b|\bacca\b|\bmultiple\s+legs?\b/i.test(text);
  const explicitStraight = /\b(?:straight|single)\s+(?:bet|wager|ticket)\b/i.test(text);
  const ticketType: ExtractedTicketType = explicitParlay ? "parlay" : "straight";
  const americanOdds = detectTicketOdds(text, ticketType);
  const initialMarket = detectMarket(text, undefined);
  const oddsLine = lines.find((line) => americanOdds && line.includes(americanOdds)) ?? "";
  const selection = detectSelection(
    lines,
    eventDescription,
    americanOdds,
    detectLine(text, initialMarket),
  );
  const marketType = detectMarket(text, selection);
  const resolvedLine = detectLine(oddsLine, marketType) || detectLine(text, marketType);
  const stake = labeledValue(text, "(?:stake|wager|bet amount)", MONEY);
  const returnValue = labeledValue(text, "(?:total return|payout|return|potential payout)", MONEY);
  const eventDate =
    parseDate(
      labeledValue(text, "(?:kickoff|game|event|start)(?:\\s+date|\\s+time)?", NUMERIC_DATE) ??
        labeledValue(text, "(?:kickoff|game|event|start)(?:\\s+date|\\s+time)?", MONTH_DATE),
    ) ?? detectEventDate(lines, eventDescription);
  const wagerDate =
    parseDate(
      labeledValue(
        text,
        "(?:placed|wager|bet|ticket)(?:\\s+(?:date|time|timestamp))?",
        `${NUMERIC_DATE.slice(1, -1)}|${MONTH_DATE.slice(1, -1)}`,
      ),
    ) ??
    parseDate(
      (() => {
        const line = lines.find((candidate) => /^(?:placed|wager|bet|ticket)\b/i.test(candidate));
        const match = line?.match(new RegExp(`${NUMERIC_DATE}|${MONTH_DATE}`, "i"));
        return match?.[1] ?? match?.[2];
      })(),
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
    line: marketType === "moneyline" ? "" : resolvedLine,
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
    "wager date": fields.wagerDate,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const warnings = uncertainFields.map(
    (field) => `${field} was not confidently extracted; review it.`,
  );
  const ticketTypeConfidence = explicitParlay || explicitStraight ? "high" : "low";
  const parlayLegs = ticketType === "parlay" ? detectParlayLegs(lines) : [];
  if (ticketType === "parlay") {
    warnings.push(
      parlayLegs.length
        ? `A parlay was detected and ${parlayLegs.length} probable leg${parlayLegs.length === 1 ? "" : "s"} were extracted. Review each leg before saving.`
        : "A parlay was detected. Review each leg before saving.",
    );
  }
  const extractedCount = Object.values(fields).filter(
    (value) => value !== undefined && value !== "",
  ).length;
  const confidence = extractedCount >= 6 ? "high" : extractedCount >= 3 ? "medium" : "low";
  return {
    fields,
    rawText: text,
    ticketType,
    ticketTypeConfidence,
    parlayLegs,
    confidence,
    uncertainFields,
    warnings,
  };
}

type OcrPass = "enhanced" | "threshold";

async function decodeImage(image: Blob) {
  if (typeof createImageBitmap === "function") {
    // Browser decoders can apply EXIF orientation before drawing the pixels.
    return createImageBitmap(image, { imageOrientation: "from-image" });
  }
  const objectUrl = URL.createObjectURL(image);
  const element = new Image();
  element.src = objectUrl;
  await element.decode();
  URL.revokeObjectURL(objectUrl);
  return element;
}

/** Preprocess one local OCR pass; no screenshot bytes leave the browser. */
export async function preprocessBetslipImage(image: Blob, pass: OcrPass = "enhanced") {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Local screenshot preprocessing is available in the browser only.");
  }
  const source = await decodeImage(image);
  const sourceWidth = source instanceof ImageBitmap ? source.width : source.naturalWidth;
  const sourceHeight = source instanceof ImageBitmap ? source.height : source.naturalHeight;
  const sourceMax = Math.max(sourceWidth, sourceHeight);
  const scale = sourceMax > 2400 ? 2400 / sourceMax : sourceMax < 1400 ? 1400 / sourceMax : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas preprocessing is unavailable.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  // Convert to grayscale, enhance contrast, and optionally threshold the local image.
  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance =
      pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
    const contrast = Math.max(0, Math.min(255, (luminance - 128) * 1.35 + 128));
    const value = pass === "threshold" ? (contrast > 178 ? 255 : 0) : contrast;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  const result = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode OCR image."))),
      "image/png",
    );
  });
  if (source instanceof ImageBitmap) source.close();
  return result;
}

function extractionScore(extraction: ExtractedBetslip) {
  return (
    extraction.uncertainFields.length * -2 +
    Object.values(extraction.fields).filter((value) => value !== undefined && value !== "").length *
      3 +
    extraction.parlayLegs.length * 4
  );
}

/**
 * Local OCR is intentionally conservative. Stake may be absent without requiring a paid
 * escalation, but missing ticket-critical fields or ambiguous leg structure should be reviewed by
 * the server-side vision adapter when it is available.
 */
export function shouldUseVisionFallback(extraction: ExtractedBetslip) {
  const critical = new Set(["event", "event date", "selection", "odds"]);
  const criticalMissing = extraction.uncertainFields.some((field) => critical.has(field));
  const invalidParlay =
    extraction.ticketType === "parlay" &&
    (extraction.parlayLegs.length < 2 ||
      extraction.parlayLegs.some(
        (leg) => !leg.eventDescription || !leg.selection || !leg.americanOdds,
      ));
  return extraction.confidence === "low" || criticalMissing || invalidParlay;
}

function parseVisionDate(value: string | null | undefined) {
  return parseDate(value ?? undefined);
}

export function isAmericanOddsLiteral(value: string | null | undefined) {
  return Boolean(value && /^[+-](?:[1-9][0-9]{2,6})$/.test(value.trim()));
}

function visionSportsbookId(value: string | null) {
  if (!value) return undefined;
  if (/draft\s*kings/i.test(value)) return "draftkings";
  if (/fan\s*duel/i.test(value)) return "fanduel";
  if (/bet\s*mgm/i.test(value)) return "betmgm";
  if (/caesars/i.test(value)) return "caesars";
  return undefined;
}

/** Convert strict vision output into the same editable draft contract as local OCR. */
export function visionDraftToBetslipDraft(draft: VisionBetslipDraft): ExtractedBetslip {
  const legs = draft.legs.map((leg) => {
    const marketType = leg.market ?? "moneyline";
    const line =
      marketType === "moneyline"
        ? ""
        : leg.line ||
          detectLine(
            `${marketType}: ${leg.selectionText ?? ""} ${leg.eventText ?? ""}`,
            marketType,
          );
    return {
      eventDescription: cleanLine(leg.eventText ?? ""),
      eventDate: parseVisionDate(leg.eventDateText),
      selection: leg.selectionText
        ? cleanSelection(
            leg.selectionText,
            leg.line ?? detectLine(`${marketType}: ${leg.selectionText}`, marketType),
            leg.americanOdds ?? "",
          )
        : undefined,
      selectionKey: detectSelectionKey(
        leg.selectionText ?? undefined,
        leg.eventText ?? undefined,
        marketType,
      ),
      marketType: leg.market ?? undefined,
      line,
      americanOdds: isAmericanOddsLiteral(leg.americanOdds) ? leg.americanOdds!.trim() : undefined,
    };
  });
  const first = legs[0];
  const missing = Object.entries({
    event: first?.eventDescription,
    "event date": first?.eventDate,
    selection: first?.selection,
    odds: first?.americanOdds,
    stake: draft.stake,
    payout: draft.totalReturn,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  return {
    fields: {
      sportsbookId: visionSportsbookId(draft.sportsbook),
      otherSportsbookName:
        draft.sportsbook && !visionSportsbookId(draft.sportsbook) ? draft.sportsbook : undefined,
      sportsbookBetId: draft.sportsbookBetId ?? undefined,
      eventDescription: first?.eventDescription || undefined,
      eventDate: first?.eventDate,
      wagerDate: parseVisionDate(draft.wagerDateText),
      selection: first?.selection,
      selectionKey: first?.selectionKey,
      marketType: first?.marketType ?? "moneyline",
      line: first?.line ?? (first?.marketType === "moneyline" ? "" : undefined),
      americanOdds:
        draft.ticketType === "parlay"
          ? isAmericanOddsLiteral(draft.combinedAmericanOdds)
            ? draft.combinedAmericanOdds!.trim()
            : undefined
          : isAmericanOddsLiteral(draft.combinedAmericanOdds)
            ? draft.combinedAmericanOdds!.trim()
            : first?.americanOdds,
      stakeDollars: draft.stake ? cleanMoney(draft.stake) : undefined,
      returnDollars: draft.totalReturn ? cleanMoney(draft.totalReturn) : undefined,
    },
    rawText: "",
    ticketType: draft.ticketType,
    ticketTypeConfidence: "high",
    parlayLegs: legs,
    confidence: missing.length ? "medium" : "high",
    uncertainFields: missing,
    warnings: [
      "AI-assisted draft — verify the event, pick, line, odds, stake, payout, and Study before saving.",
      ...missing.map((field) => `${field} was not confidently extracted; review it.`),
    ],
    source: "vision",
  };
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
      onProgress?.(10 + Math.round(progress * 0.4), message.status ?? "Reading screenshot");
    },
  });
  try {
    onProgress?.(2, "Preprocessing image locally");
    const passes: OcrPass[] = ["enhanced", "threshold"];
    const extractions: ExtractedBetslip[] = [];
    for (const [index, pass] of passes.entries()) {
      onProgress?.(5 + index * 45, `OCR pass ${index + 1} of ${passes.length}`);
      let processed = image;
      try {
        processed = await preprocessBetslipImage(image, pass);
      } catch {
        // The original image remains a safe fallback if browser canvas APIs are unavailable.
      }
      const result = await worker.recognize(processed);
      extractions.push(parseBetslipText(result.data.text));
    }
    const best = extractions.sort(
      (left, right) => extractionScore(right) - extractionScore(left),
    )[0];
    if (!best) throw new Error("OCR returned no text.");
    onProgress?.(100, "OCR complete");
    return { ...best, source: "local" as const };
  } finally {
    await worker.terminate();
  }
}
