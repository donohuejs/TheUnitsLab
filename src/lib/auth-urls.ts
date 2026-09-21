import { headers } from "next/headers";

const PRODUCTION_SITE_URL = "https://theunitslab.vercel.app";

function normalizeSiteUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The application URL must use HTTP or HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/**
 * Resolve the origin used in Supabase email redirects.
 *
 * APP_URL is the production-safe configuration. The request-origin fallback is
 * limited to local development and the known production hostname so a forged
 * Host header cannot turn an auth email into an arbitrary redirect.
 */
export async function getApplicationSiteUrl() {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    return normalizeSiteUrl(configured);
  }

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = (forwardedHost ?? requestHeaders.get("host") ?? "").split(",")[0]?.trim();
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (host === "theunitslab.vercel.app") {
    return PRODUCTION_SITE_URL;
  }

  if (host === "localhost:3000" || host === "127.0.0.1:3000" || host === "[::1]:3000") {
    return normalizeSiteUrl(`${forwardedProtocol === "https" ? "https" : "http"}://${host}`);
  }

  if (!host) {
    return "http://localhost:3000";
  }

  throw new Error("APP_URL must be configured for this host.");
}
