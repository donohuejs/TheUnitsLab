"use client";

import { useEffect } from "react";

import { removeSlipSelectionKeysAndPersist } from "@/lib/wagers/slip";

export function SlipPlacementCleanup({ slipKeys }: { slipKeys: string[] }) {
  useEffect(() => {
    if (slipKeys.length) removeSlipSelectionKeysAndPersist(slipKeys);
  }, [slipKeys]);

  return null;
}
