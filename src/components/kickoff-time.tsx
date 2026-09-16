"use client";

import { useMemo, useSyncExternalStore } from "react";

import { formatKickoff } from "@/lib/time";

const subscribeToTimezone = () => () => {};

export function KickoffTime({ value }: { value: string }) {
  const clientSnapshot = useMemo(() => () => formatKickoff(value), [value]);
  const serverSnapshot = useMemo(() => () => formatKickoff(value, "UTC"), [value]);
  const label = useSyncExternalStore(subscribeToTimezone, clientSnapshot, serverSnapshot);

  return <time dateTime={value}>{label}</time>;
}
