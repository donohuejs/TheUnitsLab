import {
  americanToDecimalString,
  calculatePotential,
  formatUnits,
  parseStakeToMinorUnits,
  validateAmericanOdds,
} from "../wagers/calculations";

export type ExternalResult = "open" | "won" | "lost" | "push" | "void";

export function parseNonNegativeMoneyToMinorUnits(input: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) throw new Error("Money must use at most two decimal places");
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor > 99_999_999_999_999n) throw new Error("Money exceeds the supported range");
  return minor;
}

export type ImportedEconomics = {
  stakeDollars: string;
  americanOdds: number;
  returnDollars: string;
  calculatedField: "stake" | "odds" | "return" | null;
};

function optionalAmericanOdds(input: string | number) {
  const text = String(input).trim();
  if (!text) return null;
  if (!/^-?\d+$/.test(text)) throw new Error("American odds must be an integer");
  const odds = Number(text);
  validateAmericanOdds(odds);
  return odds;
}

function deriveAmericanOdds(stakeMinor: bigint, returnMinor: bigint) {
  if (returnMinor <= stakeMinor)
    throw new Error("Payout must be greater than stake to derive odds");
  const profit = returnMinor - stakeMinor;
  const american =
    returnMinor >= stakeMinor * 2n
      ? (profit * 100n + stakeMinor / 2n) / stakeMinor
      : -((stakeMinor * 100n + profit / 2n) / profit);
  const result = Number(american);
  validateAmericanOdds(result);
  return result;
}

function deriveStakeMinor(returnMinor: bigint, americanOdds: number) {
  if (returnMinor <= 0n) throw new Error("Payout must be greater than zero to derive stake");
  const magnitude = BigInt(Math.abs(americanOdds));
  const denominator = 100n + magnitude;
  const numerator = americanOdds > 0 ? returnMinor * 100n : returnMinor * magnitude;
  const stake = (numerator + denominator / 2n) / denominator;
  if (stake <= 0n) throw new Error("The supplied payout and odds cannot derive a positive stake");
  return stake;
}

/** Exact cents/integers for the progressive imported-entry economics step. */
export function calculateImportedEconomics(
  stakeInput: string,
  oddsInput: string | number,
  returnInput: string,
): ImportedEconomics {
  const hasStake = stakeInput.trim() !== "";
  const hasOdds = String(oddsInput).trim() !== "";
  const hasReturn = returnInput.trim() !== "";
  if (Number(hasStake) + Number(hasOdds) + Number(hasReturn) < 2) {
    throw new Error("Enter any two of stake, odds, or payout");
  }

  let stakeMinor = hasStake ? parseNonNegativeMoneyToMinorUnits(stakeInput) : null;
  if (stakeMinor === 0n) throw new Error("Stake must be greater than zero");
  let americanOdds = hasOdds ? optionalAmericanOdds(oddsInput) : null;
  let returnMinor = hasReturn ? parseNonNegativeMoneyToMinorUnits(returnInput) : null;

  if (stakeMinor !== null && americanOdds !== null && returnMinor === null) {
    returnMinor = parseNonNegativeMoneyToMinorUnits(
      calculatePotential(formatUnits(stakeMinor), americanToDecimalString(americanOdds)).return,
    );
    return {
      stakeDollars: formatUnits(stakeMinor),
      americanOdds,
      returnDollars: formatUnits(returnMinor),
      calculatedField: "return",
    };
  }
  if (stakeMinor !== null && returnMinor !== null && americanOdds === null) {
    americanOdds = deriveAmericanOdds(stakeMinor, returnMinor);
    return {
      stakeDollars: formatUnits(stakeMinor),
      americanOdds,
      returnDollars: formatUnits(returnMinor),
      calculatedField: "odds",
    };
  }
  if (returnMinor !== null && americanOdds !== null && stakeMinor === null) {
    stakeMinor = deriveStakeMinor(returnMinor, americanOdds);
    return {
      stakeDollars: formatUnits(stakeMinor),
      americanOdds,
      returnDollars: formatUnits(returnMinor),
      calculatedField: "stake",
    };
  }
  if (stakeMinor === null || americanOdds === null || returnMinor === null) {
    throw new Error("Enter any two of stake, odds, or payout");
  }
  return {
    stakeDollars: formatUnits(stakeMinor),
    americanOdds,
    returnDollars: formatUnits(returnMinor),
    calculatedField: null,
  };
}

function parseSignedUnits(value: string | number) {
  const text = String(value).trim();
  const negative = text.startsWith("-");
  const magnitude = parseStakeToMinorUnits(negative ? text.slice(1) : text);
  return negative ? -magnitude : magnitude;
}

function formatPercentHundredths(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  return `${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}`;
}

export function calculateExternalProfitLoss(
  stake: string,
  americanOdds: number,
  result: ExternalResult,
) {
  validateAmericanOdds(americanOdds);
  if (Math.abs(americanOdds) > 1_000_000) {
    throw new Error("External American odds exceed the supported range");
  }
  const stakeMinor = parseStakeToMinorUnits(stake);
  const decimalOdds = americanToDecimalString(americanOdds);
  const profitLoss =
    result === "won"
      ? calculatePotential(stake, decimalOdds).profit
      : result === "lost"
        ? formatUnits(-stakeMinor)
        : "0.00";
  return { decimalOdds, profitLoss };
}

export type ExternalAnalyticsRecord = {
  status: ExternalResult;
  stakeUnits: string | number;
  profitLossUnits: string | number;
};

export function summarizeExternalWagers(records: ExternalAnalyticsRecord[]) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let voids = 0;
  let unitsWageredMinor = 0n;
  let netUnitsMinor = 0n;

  for (const record of records) {
    if (record.status === "open") continue;
    if (record.status === "won") wins += 1;
    if (record.status === "lost") losses += 1;
    if (record.status === "push") pushes += 1;
    if (record.status === "void") voids += 1;
    if (record.status !== "void") {
      unitsWageredMinor += parseStakeToMinorUnits(String(record.stakeUnits));
    }
    if (String(record.profitLossUnits) !== "0" && String(record.profitLossUnits) !== "0.00") {
      netUnitsMinor += parseSignedUnits(record.profitLossUnits);
    }
  }

  const roiHundredths =
    unitsWageredMinor === 0n
      ? 0n
      : (netUnitsMinor * 10_000n +
          (netUnitsMinor >= 0n ? unitsWageredMinor / 2n : -(unitsWageredMinor / 2n))) /
        unitsWageredMinor;

  return {
    totalSettled: wins + losses + pushes + voids,
    wins,
    losses,
    pushes,
    voids,
    unitsWagered: formatUnits(unitsWageredMinor),
    netUnits: formatUnits(netUnitsMinor),
    roiPercent: formatPercentHundredths(roiHundredths),
  };
}
