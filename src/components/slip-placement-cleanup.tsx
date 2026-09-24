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
  pendingSlipKeys,
  voidedSlipKeys,
}: {
  slipKeys: string[];
  straightSlipKeys?: string[];
  pendingSlipKeys?: string[];
  voidedSlipKeys?: string[];
}) {
  useEffect(() => {
    if (slipKeys.length) removeSlipSelectionKeysAndPersist(slipKeys, "submission cleanup: parlay");
    if (straightSlipKeys?.length)
      removeStraightSlipSelectionKeysAndPersist(straightSlipKeys, "submission cleanup: straight");
    if (pendingSlipKeys?.length)
      removePendingSlipSelectionKeysAndPersist(pendingSlipKeys, "submission cleanup: pending");
    if (voidedSlipKeys?.length)
      removePendingSlipSelectionKeysAndPersist(voidedSlipKeys, "stale/void cleanup");
  }, [slipKeys, straightSlipKeys, pendingSlipKeys, voidedSlipKeys]);

  return null;
}
