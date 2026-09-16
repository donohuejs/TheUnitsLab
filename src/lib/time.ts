export function formatKickoff(value: string | Date, timeZone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("weekday")}, ${part("month")} ${part("day")} · ${part("hour")}:${part("minute")} ${part("dayPeriod")}`;
}
