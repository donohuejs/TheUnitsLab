const DECIMAL_SCALE = 10_000n;
const UNIT_SCALE = 100n;
const MAX_STAKE_MINOR = 99_999_999_999_999n;

function divideRoundHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n) throw new Error("Invalid decimal operation");
  return (numerator + denominator / 2n) / denominator;
}

function decimalScaled(value: string | number) {
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) throw new Error("Decimal odds must have no more than four decimal places");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(4, "0"));
  const scaled = whole * DECIMAL_SCALE + fraction;
  if (scaled <= DECIMAL_SCALE) throw new Error("Decimal odds must be greater than 1.0000");
  return scaled;
}

function formatScaled(value: bigint, scaleDigits: number) {
  const scale = 10n ** BigInt(scaleDigits);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(scaleDigits, "0");
  return `${whole}.${fraction}`;
}

export function validateAmericanOdds(american: number) {
  if (!Number.isSafeInteger(american) || (american > -100 && american < 100)) {
    throw new Error("American odds must be an integer of +100 or greater, or -100 or lower");
  }
  return american;
}

export function americanToDecimalString(american: number) {
  validateAmericanOdds(american);
  const magnitude = BigInt(Math.abs(american));
  const profitScale =
    american > 0 ? magnitude * 100n : divideRoundHalfUp(100n * DECIMAL_SCALE, magnitude);
  return formatScaled(DECIMAL_SCALE + profitScale, 4);
}

export function decimalToAmerican(decimal: string | number) {
  const scaled = decimalScaled(decimal);
  const profitScale = scaled - DECIMAL_SCALE;
  const american =
    scaled >= 2n * DECIMAL_SCALE
      ? divideRoundHalfUp(profitScale * 100n, DECIMAL_SCALE)
      : -divideRoundHalfUp(100n * DECIMAL_SCALE, profitScale);
  return Number(american);
}

export function parseStakeToMinorUnits(input: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalizeCurrencyInput(input));
  if (!match) throw new Error("Stake must use at most two decimal places");
  const minor = BigInt(match[1]) * UNIT_SCALE + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor <= 0n) throw new Error("Stake must be greater than zero");
  if (minor > MAX_STAKE_MINOR) throw new Error("Stake exceeds the supported range");
  return minor;
}

/** Normalize harmless currency presentation characters before fixed-point validation. */
export function normalizeCurrencyInput(input: string) {
  const normalized = String(input)
    .trim()
    .replace(/[$,\s]/g, "");
  if (!normalized) throw new Error("Currency value is required");
  return normalized;
}

export function formatUnits(minorUnits: bigint) {
  const sign = minorUnits < 0n ? "-" : "";
  return `${sign}${formatScaled(minorUnits < 0n ? -minorUnits : minorUnits, 2)}`;
}

export function calculatePotential(stakeInput: string, decimal: string | number) {
  const stakeMinor = parseStakeToMinorUnits(stakeInput);
  const oddsScaled = decimalScaled(decimal);
  const profitMinor = divideRoundHalfUp(stakeMinor * (oddsScaled - DECIMAL_SCALE), DECIMAL_SCALE);
  return {
    stake: formatUnits(stakeMinor),
    profit: formatUnits(profitMinor),
    return: formatUnits(stakeMinor + profitMinor),
  };
}
