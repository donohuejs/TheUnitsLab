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
    if (slipKeys.length) removeSlipSelectionKeysAndPersist(slipKeys);
    if (straightSlipKeys?.length) removeStraightSlipSelectionKeysAndPersist(straightSlipKeys);
    if (pendingSlipKeys?.length) removePendingSlipSelectionKeysAndPersist(pendingSlipKeys);
    if (voidedSlipKeys?.length) removePendingSlipSelectionKeysAndPersist(voidedSlipKeys);
  }, [slipKeys, straightSlipKeys, pendingSlipKeys, voidedSlipKeys]);

  return null;
}
