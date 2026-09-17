import { americanToDecimalString, calculatePotential, decimalToAmerican } from "./calculations";

export const SIMULATED_ALTERNATE_SPREAD_MODEL = "simulated-alternate-spread-v1";
export const SIMULATED_ALTERNATE_SPREAD_MODEL_VERSION = "1";

const MIN_PROBABILITY = 0.02;
const MAX_PROBABILITY = 0.98;
const PROBABILITY_PER_HALF_POINT = 0.025;

function assertAmericanOdds(value: number) {
  if (!Number.isInteger(value) || value === 0 || (value > -100 && value < 100)) {
    throw new Error("American odds must be an integer of at least 100 in absolute value.");
  }
}

function assertLine(value: number) {
  if (!Number.isFinite(value)) throw new Error("Spread line must be finite.");
}

function impliedProbability(americanOdds: number) {
  assertAmericanOdds(americanOdds);
  return americanOdds > 0
    ? 100 / (americanOdds + 100)
    : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function americanFromProbability(probability: number) {
  const rounded =
    probability >= 0.5
      ? Math.round((-100 * probability) / (1 - probability))
      : Math.round((100 * (1 - probability)) / probability);
  if (rounded === 0 || (rounded > -100 && rounded < 100)) {
    return rounded >= 0 ? 101 : -101;
  }
  return rounded;
}

export type SimulatedAlternateSpread = {
  anchorProviderLine: number;
  anchorProviderAmericanOdds: number;
  adjustedLine: number;
  simulatedAmericanOdds: number;
  simulatedDecimalOdds: number;
  pricingSource: "simulated_alternate";
  pricingModel: string;
  pricingModelVersion: string;
};

export function simulateAlternateSpreadPrice(input: {
  anchorProviderLine: number;
  anchorProviderAmericanOdds: number;
  adjustedLine: number;
}): SimulatedAlternateSpread {
  const { anchorProviderLine, anchorProviderAmericanOdds, adjustedLine } = input;
  assertLine(anchorProviderLine);
  assertLine(adjustedLine);
  const baseProbability = impliedProbability(anchorProviderAmericanOdds);
  const probability = Math.min(
    MAX_PROBABILITY,
    Math.max(
      MIN_PROBABILITY,
      baseProbability + (adjustedLine - anchorProviderLine) * PROBABILITY_PER_HALF_POINT,
    ),
  );
  const simulatedAmericanOdds =
    adjustedLine === anchorProviderLine
      ? anchorProviderAmericanOdds
      : americanFromProbability(probability);
  const simulatedDecimalOdds = Number(americanToDecimalString(simulatedAmericanOdds));

  return {
    anchorProviderLine,
    anchorProviderAmericanOdds,
    adjustedLine,
    simulatedAmericanOdds,
    simulatedDecimalOdds,
    pricingSource: "simulated_alternate",
    pricingModel: SIMULATED_ALTERNATE_SPREAD_MODEL,
    pricingModelVersion: SIMULATED_ALTERNATE_SPREAD_MODEL_VERSION,
  };
}

export function alternateSpreadLines(anchorProviderLine: number, radius = 2.5, step = 0.5) {
  assertLine(anchorProviderLine);
  if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(step) || step <= 0) {
    throw new Error("Alternate spread range must be finite and positive.");
  }
  const count = Math.floor(radius / step);
  return Array.from({ length: count * 2 + 1 }, (_, index) =>
    Number((anchorProviderLine + (index - count) * step).toFixed(4)),
  );
}

export function alternateSpreadPotential(stake: string, price: SimulatedAlternateSpread) {
  return calculatePotential(stake, price.simulatedDecimalOdds.toFixed(4));
}

export function simulatedAmericanOddsFromProbability(probability: number) {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error("Probability must be between zero and one.");
  }
  return decimalToAmerican((1 / probability).toFixed(4));
}
