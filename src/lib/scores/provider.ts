import "server-only";

import { parseQuotaHeaders } from "@/lib/odds/quota";

import type { CanonicalScoreRequest } from "./request";

export async function fetchScoreProvider(request: CanonicalScoreRequest, apiKey: string) {
  const url = new URL(
    `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(request.providerSportKey)}/scores`,
  );
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("daysFrom", String(request.daysFrom));
  url.searchParams.set("dateFormat", request.dateFormat);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const quota = parseQuotaHeaders(response.headers);
  if (!response.ok) throw new Error(`Score provider request failed with status ${response.status}`);
  return { body: (await response.json()) as unknown, quota, status: response.status };
}
