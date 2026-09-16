import { formatUnits, parseStakeToMinorUnits } from "./wagers/calculations";

/** Cross-source normalization: one exact source dollar is one Vial. */
export function normalizeUsdToVials(value: string) {
  return formatUnits(parseStakeToMinorUnits(value));
}

export const USD_PER_VIAL = "1.00";
