import "server-only";

import type { CanonicalOddsRequest } from "./request";
import { parseQuotaHeaders } from "./quota";
import type { OddsProviderId, QuotaMetadata } from "./types";

export type ProviderResponseTelemetry = {
  attempts: number;
  responseTimeMs: number | null;
};

export type OddsProviderResponse = ProviderResponseTelemetry & {
  body: unknown;
  quota: QuotaMetadata;
  status: number;
};

export type OddsProviderCapabilities = {
  events: boolean;
  coreMarkets: readonly string[];
  eventMarkets: boolean;
  playerProps: boolean;
  scores: boolean;
};

export class OddsProviderError extends Error {
  readonly provider = "the_odds_api_v4" as const;
  readonly quota: QuotaMetadata;
  readonly status: number;
  readonly telemetry: ProviderResponseTelemetry;
  readonly code: string;

  constructor(
    message: string,
    options: {
      quota?: QuotaMetadata;
      status?: number;
      telemetry?: Partial<ProviderResponseTelemetry>;
      code?: string;
    } = {},
  ) {
    super(message);
    this.name = "OddsProviderError";
    this.quota = options.quota ?? { used: null, remaining: null, lastRequestCost: null };
    this.status = options.status ?? 599;
    this.telemetry = {
      attempts: options.telemetry?.attempts ?? 1,
      responseTimeMs: options.telemetry?.responseTimeMs ?? null,
    };
    this.code = options.code ?? "provider_request_failed";
  }
}

export interface OddsProvider {
  readonly id: OddsProviderId;
  getCapabilities(): OddsProviderCapabilities;
  getOdds(request: CanonicalOddsRequest): Promise<OddsProviderResponse>;
}

export class TheOddsApiProvider implements OddsProvider {
  readonly id = "the_odds_api_v4" as const;

  constructor(private readonly apiKey: string) {}

  getCapabilities() {
    return {
      events: true,
      coreMarkets: ["h2h", "spreads", "totals"],
      eventMarkets: true,
      playerProps: false,
      scores: true,
    } as const;
  }

  getOdds(request: CanonicalOddsRequest) {
    return fetchOddsProvider(request, this.apiKey);
  }
}

export async function fetchOddsProvider(
  request: CanonicalOddsRequest,
  apiKey: string,
): Promise<OddsProviderResponse> {
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
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const quota = parseQuotaHeaders(response.headers);
    const responseTimeMs = Date.now() - startedAt;
    if (!response.ok) {
      throw new OddsProviderError(`Odds provider request failed with status ${response.status}`, {
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
    throw new OddsProviderError("Odds provider request failed", {
      telemetry: { responseTimeMs: Date.now() - startedAt },
      code: "network_or_timeout",
    });
  }
}
