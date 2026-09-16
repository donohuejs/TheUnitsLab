"use client";

import { useEffect } from "react";

import {
  removeSlipSelectionKeysAndPersist,
  removeStraightSlipSelectionKeysAndPersist,
} from "@/lib/wagers/slip";

export function SlipPlacementCleanup({
  slipKeys,
  straightSlipKeys,
}: {
  slipKeys: string[];
  straightSlipKeys?: string[];
}) {
  useEffect(() => {
    if (slipKeys.length) removeSlipSelectionKeysAndPersist(slipKeys);
    if (straightSlipKeys?.length) removeStraightSlipSelectionKeysAndPersist(straightSlipKeys);
  }, [slipKeys, straightSlipKeys]);

  return null;
}
