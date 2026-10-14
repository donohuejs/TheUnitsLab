import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOddsRequest } from "../src/lib/odds/request";
import { fetchOddsProvider, OddsProviderError } from "../src/lib/odds/provider";

afterEach(() => vi.unstubAllGlobals());

describe("Odds API provider telemetry boundary", () => {
  it("captures provider cost headers and explicit request parameters", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("bookmakers=betrivers%2Cdraftkings%2Cfanduel");
      expect(String(input)).toContain("apiKey=key");
      return new Response("[]", {
        status: 200,
        headers: {
          "x-requests-used": "219",
          "x-requests-remaining": "281",
          "x-requests-last": "1",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    const result = await fetchOddsProvider(createOddsRequest("epl"), "key");
    expect(result.quota).toEqual({ used: 219, remaining: 281, lastRequestCost: 1 });
    expect(result.attempts).toBe(1);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps unavailable timing data safe without changing provider cost telemetry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("[]", {
            status: 200,
            headers: {
              "x-requests-used": "220",
              "x-requests-remaining": "280",
              "x-requests-last": "1",
            },
          }),
      ),
    );

    const result = await fetchOddsProvider(createOddsRequest("epl"), "key");

    expect(result.quota).toEqual({ used: 220, remaining: 280, lastRequestCost: 1 });
    expect(result.attempts).toBe(1);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("represents provider failures without exposing request secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 429 })),
    );

    await expect(fetchOddsProvider(createOddsRequest("epl"), "secret-value")).rejects.toMatchObject(
      {
        status: 429,
        code: "http_429",
      },
    );
    try {
      await fetchOddsProvider(createOddsRequest("epl"), "secret-value");
    } catch (error) {
      expect(error).toBeInstanceOf(OddsProviderError);
      expect((error as Error).message).not.toContain("secret-value");
    }
  });
});
