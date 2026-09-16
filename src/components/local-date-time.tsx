"use client";

import { useMemo, useSyncExternalStore } from "react";

import { formatLocalDateTime } from "@/lib/time";

const subscribeToTimezone = () => () => {};

export function LocalDateTime({ value }: { value: string }) {
  const clientSnapshot = useMemo(() => () => formatLocalDateTime(value), [value]);
  const serverSnapshot = useMemo(() => () => formatLocalDateTime(value, "UTC"), [value]);
  const label = useSyncExternalStore(subscribeToTimezone, clientSnapshot, serverSnapshot);

  return <time dateTime={value}>{label}</time>;
}
