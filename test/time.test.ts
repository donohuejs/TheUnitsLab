import { describe, expect, it } from "vitest";

import { formatKickoff, formatLocalDateTime, toDateTimeLocalValue } from "../src/lib/time";

describe("kickoff presentation", () => {
  it("uses a readable deterministic format without seconds", () => {
    expect(formatKickoff("2026-09-17T23:30:00Z", "America/New_York")).toBe("Thu, Sep 17 · 7:30 PM");
    expect(formatKickoff("2026-09-17T23:30:42Z", "America/New_York")).not.toContain(":42");
  });

  it("keeps rendering deterministic for an explicit timezone", () => {
    expect(formatKickoff("2026-09-18T00:15:00Z", "UTC")).toBe("Fri, Sep 18 · 12:15 AM");
  });

  it("uses the viewer timezone when the formatter is used without a fixed zone", () => {
    expect(formatLocalDateTime("2026-09-18T00:15:00Z", "America/New_York")).toBe(
      "Thu, Sep 17 · 8:15 PM",
    );
    expect(formatLocalDateTime("2026-09-18T00:15:42Z", "America/New_York")).not.toContain(":42");
  });

  it("creates a datetime-local value without converting the wall clock twice", () => {
    expect(toDateTimeLocalValue("2026-09-18T00:15:00Z", "America/New_York")).toBe(
      "2026-09-17T20:15",
    );
  });
});
