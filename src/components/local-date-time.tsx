"use client";

import { useMemo, useSyncExternalStore } from "react";

import { formatLocalDateTime } from "@/lib/time";

const subscribeToTimezone = () => () => {};

export function LocalDateTime({ value }: { value: string | null }) {
  const safeValue = value ?? "";
  const clientSnapshot = useMemo(
    () => () => (safeValue ? formatLocalDateTime(safeValue) : "Unknown"),
    [safeValue],
  );
  const serverSnapshot = useMemo(
    () => () => (safeValue ? formatLocalDateTime(safeValue, "UTC") : "Unknown"),
    [safeValue],
  );
  const label = useSyncExternalStore(subscribeToTimezone, clientSnapshot, serverSnapshot);

  return value ? <time dateTime={value}>{label}</time> : <span>{label}</span>;
}
