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
  const normalized = value
    .replace(/\s+/g, " ")
    .replace(/\bET\b/i, "")
    .trim();
  const candidates = [normalized];
  if (!/\b\d{4}\b/.test(normalized))
    candidates.push(`${normalized} ${new Date().getUTCFullYear()}`);
  for (const candidate of candidates) {
    const date = new Date(candidate.replace(/-/g, "/"));
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
  const labeled = /(?:spread|handicap|line|total)\s*[:#-]?\s*([+-]?\d+(?:\.\d+)?)/i.exec(text)?.[1];
  if (labeled) return labeled;
  return /(?<!\d)([+-]?\d+\.\d+)(?!\d)/.exec(text)?.[1] ?? "";
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
    return cleanLine(candidates[0].replace(odds, "").replace(line, ""))
      .replace(/^[:#-]+|[:#-]+$/g, "")
      .trim();
  }
  if (eventDescription) return eventDescription.split(" at ")[0];
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
  return "";
}

function detectEventDate(lines: string[], eventDescription: string | undefined) {
  const eventIndex = eventDescription
    ? lines.findIndex((line) => parseEventLine(line)?.eventDescription === eventDescription)
    : -1;
  const preferred = lines.filter(
    (line, index) =>
      index >= Math.max(0, eventIndex) &&
      !/\b(?:placed|wagered|submitted|bet\s+date)\b/i.test(line),
  );
  for (const line of [...preferred, ...lines]) {
    const value =
      new RegExp(NUMERIC_DATE, "i").exec(line)?.[1] ?? new RegExp(MONTH_DATE, "i").exec(line)?.[1];
    const parsed = parseDate(value);
    if (parsed) return parsed;
  }
  return undefined;
}

function detectParlayLegs(lines: string[]) {
  const legs: ExtractedParlayLeg[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const event = parseEventLine(lines[index]);
    if (!event) continue;
    const sameLineOdds = detectAmericanOdds(lines[index]);
    const nextLine = lines[index + 1];
    const nextLineOdds = !sameLineOdds && nextLine ? detectAmericanOdds(nextLine) : undefined;
    const americanOdds = sameLineOdds ?? nextLineOdds;
    const selectionSource = sameLineOdds ? lines[index] : nextLineOdds ? nextLine : undefined;
    const marketType = detectMarket(
      `${lines[index]} ${selectionSource ?? ""}`,
      selectionSource ?? event.left,
    );
    const line = detectLine(selectionSource ?? lines[index], marketType);
    const selection = selectionSource
      ? sameLineOdds
        ? event.left
        : detectSelection([selectionSource], event.eventDescription, americanOdds, line)
      : event.left;
    const leg: ExtractedParlayLeg = {
      eventDescription: event.eventDescription,
      selection: selection || event.left,
      americanOdds,
    };
    if (marketType !== "moneyline") {
      leg.marketType = marketType;
      leg.line = line;
    }
    const selectionKey = detectSelectionKey(
      selection || event.left,
      event.eventDescription,
      marketType,
    );
    if (selectionKey) leg.selectionKey = selectionKey;
    if (!legs.some((candidate) => candidate.eventDescription === leg.eventDescription))
      legs.push(leg);
  }
  return legs;
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
  const americanOdds = detectAmericanOdds(text);
  const initialMarket = detectMarket(text, undefined);
  const oddsLine = lines.find((line) => americanOdds && line.includes(americanOdds)) ?? "";
  const selection = detectSelection(
    lines,
    eventDescription,
    americanOdds,
    detectLine(oddsLine, initialMarket),
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
  const wagerDate = parseDate(
    labeledValue(
      text,
      "(?:placed|wager|bet)(?:\\s+date|\\s+time)?",
      `${NUMERIC_DATE.slice(1, -1)}|${MONTH_DATE.slice(1, -1)}`,
    ),
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
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const warnings = uncertainFields.map(
    (field) => `${field} was not confidently extracted; review it.`,
  );
  const explicitParlay = /\b(?:same game )?parlay\b|\bacca\b|\bmultiple\s+legs?\b/i.test(text);
  const explicitStraight = /\b(?:straight|single)\s+(?:bet|wager|ticket)\b/i.test(text);
  const ticketType: ExtractedTicketType = explicitParlay ? "parlay" : "straight";
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
    return best;
  } finally {
    await worker.terminate();
  }
}
