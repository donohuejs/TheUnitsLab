"use client";

import { useEffect } from "react";

import {
  removeSlipSelectionKeysAndPersist,
  removeStraightSlipSelectionKeysAndPersist,
  removePendingSlipSelectionKeysAndPersist,
} from "@/lib/wagers/slip";

export function SlipPlacementCleanup({
  slipKeys,
  straightSlipKeys,
  voidedSlipKeys,
}: {
  slipKeys: string[];
  straightSlipKeys?: string[];
  voidedSlipKeys?: string[];
}) {
  useEffect(() => {
    if (slipKeys.length) removeSlipSelectionKeysAndPersist(slipKeys);
    if (straightSlipKeys?.length) removeStraightSlipSelectionKeysAndPersist(straightSlipKeys);
    if (voidedSlipKeys?.length) removePendingSlipSelectionKeysAndPersist(voidedSlipKeys);
  }, [slipKeys, straightSlipKeys, voidedSlipKeys]);

  return null;
}
