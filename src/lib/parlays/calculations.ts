import { calculatePotential, decimalToAmerican } from "../wagers/calculations";

export type ParlayLegResult = "open" | "won" | "lost" | "push" | "void";

const DECIMAL_SCALE = 10_000n;
const MAX_COMBINED_SCALED = 214_748_374_700n;

function scaledDecimal(value: string | number) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(value).trim());
  if (!match) throw new Error("Decimal odds must have no more than four decimal places");
  const scaled = BigInt(match[1]) * DECIMAL_SCALE + BigInt((match[2] ?? "").padEnd(4, "0"));
  if (scaled <= DECIMAL_SCALE) throw new Error("Each parlay leg must have odds above 1.0000");
  return scaled;
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / 2n) / denominator;
}

function formatDecimal(value: bigint) {
  return `${value / DECIMAL_SCALE}.${(value % DECIMAL_SCALE).toString().padStart(4, "0")}`;
}

export function combineDecimalOdds(odds: readonly (string | number)[]) {
  if (!odds.length) return "1.0000";
  let product = 1n;
  for (const value of odds) product *= scaledDecimal(value);
  const denominator = DECIMAL_SCALE ** BigInt(odds.length - 1);
  const combined = divideRoundHalfUp(product, denominator);
  if (combined > MAX_COMBINED_SCALED) {
    throw new Error("Combined parlay odds exceed the supported range");
  }
  return formatDecimal(combined);
}

export function calculateParlayPotential(stake: string, odds: readonly (string | number)[]) {
  const decimalOdds = combineDecimalOdds(odds);
  if (decimalOdds === "1.0000") {
    throw new Error("A submitted parlay needs at least one priced leg");
  }
  return {
    decimalOdds,
    americanOdds: decimalToAmerican(decimalOdds),
    ...calculatePotential(stake, decimalOdds),
  };
}

export function calculateEffectiveParlay(
  stake: string,
  legs: readonly { decimalOdds: string | number; result: ParlayLegResult }[],
) {
  if (legs.some((leg) => leg.result === "open")) throw new Error("Open legs cannot be settled");
  const active = legs.filter((leg) => leg.result === "won" || leg.result === "lost");
  const decimalOdds = combineDecimalOdds(active.map((leg) => leg.decimalOdds));
  if (legs.some((leg) => leg.result === "lost")) {
    return { status: "lost" as const, decimalOdds, americanOdds: decimalToAmerican(decimalOdds) };
  }
  if (active.length) {
    return {
      status: "won" as const,
      decimalOdds,
      americanOdds: decimalToAmerican(decimalOdds),
      ...calculatePotential(stake, decimalOdds),
    };
  }
  return {
    status: legs.every((leg) => leg.result === "void") ? ("void" as const) : ("push" as const),
    decimalOdds: "1.0000",
    americanOdds: null,
    stake,
    profit: "0.00",
    return: stake,
  };
}
