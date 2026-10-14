import "server-only";

import { parseQuotaHeaders } from "@/lib/odds/quota";
import { OddsProviderError } from "@/lib/odds/provider";

import type { CanonicalScoreRequest } from "./request";

export async function fetchScoreProvider(request: CanonicalScoreRequest, apiKey: string) {
  const url = new URL(
    `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(request.providerSportKey)}/scores`,
  );
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("daysFrom", String(request.daysFrom));
  url.searchParams.set("dateFormat", request.dateFormat);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const quota = parseQuotaHeaders(response.headers);
    const responseTimeMs = Date.now() - startedAt;
    if (!response.ok) {
      throw new OddsProviderError(`Score provider request failed with status ${response.status}`, {
        quota,
        status: response.status,
        telemetry: { responseTimeMs },
        code: `http_${response.status}`,
      });
    }
    return {
      body: (await response.json()) as unknown,
      quota,
      status: response.status,
      attempts: 1,
      responseTimeMs,
    };
  } catch (error) {
    if (error instanceof OddsProviderError) throw error;
    throw new OddsProviderError("Score provider request failed", {
      telemetry: { responseTimeMs: Date.now() - startedAt },
      code: "network_or_timeout",
    });
  }
}
