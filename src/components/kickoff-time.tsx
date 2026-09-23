"use client";

import { useMemo, useSyncExternalStore } from "react";

import { formatLocalDateTime } from "@/lib/time";

const subscribeToTimezone = () => () => {};

export function KickoffTime({ value, timeZone }: { value: string; timeZone?: string }) {
  const clientSnapshot = useMemo(
    () => () => formatLocalDateTime(value, timeZone),
    [timeZone, value],
  );
  const serverSnapshot = useMemo(
    () => () => formatLocalDateTime(value, timeZone ?? "UTC"),
    [timeZone, value],
  );
  const label = useSyncExternalStore(subscribeToTimezone, clientSnapshot, serverSnapshot);

  return <time dateTime={value}>{label}</time>;
}
