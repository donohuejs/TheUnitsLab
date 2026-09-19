import "server-only";

import type { CanonicalOddsRequest } from "./request";
import { parseQuotaHeaders } from "./quota";

export async function fetchOddsProvider(request: CanonicalOddsRequest, apiKey: string) {
  const endpoint =
    request.endpoint === "event_odds"
      ? `events/${encodeURIComponent(request.eventId ?? "")}/odds`
      : request.endpoint === "events"
        ? "events"
        : "odds";
  const url = new URL(
    `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(request.providerSportKey)}/${endpoint}`,
  );
  url.searchParams.set("apiKey", apiKey);
  if (request.endpoint !== "events") {
    url.searchParams.set("regions", request.regions.join(","));
    url.searchParams.set("markets", request.markets.join(","));
    url.searchParams.set("bookmakers", request.bookmakers.join(","));
    url.searchParams.set("oddsFormat", request.oddsFormat);
  }
  url.searchParams.set("dateFormat", request.dateFormat);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const quota = parseQuotaHeaders(response.headers);
  if (!response.ok) throw new Error(`Odds provider request failed with status ${response.status}`);
  return { body: (await response.json()) as unknown, quota, status: response.status };
}
