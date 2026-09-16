import {
  americanToDecimalString,
  calculatePotential,
  formatUnits,
  parseStakeToMinorUnits,
  validateAmericanOdds,
} from "../wagers/calculations";

export type ExternalResult = "open" | "won" | "lost" | "push" | "void";

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
