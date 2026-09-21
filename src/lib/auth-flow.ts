export const AUTH_CALLBACK_PATH = "/auth/callback";
export const AUTH_CHECK_EMAIL_PATH = "/auth/check-email";
export const AUTH_CONFIRMED_PATH = "/auth/confirmed";
export const AUTH_FORGOT_PASSWORD_PATH = "/auth/forgot-password";
export const AUTH_RECOVERY_PATH = "/auth/recovery";

export const AUTH_CALLBACK_DESTINATIONS = [AUTH_CONFIRMED_PATH, AUTH_RECOVERY_PATH] as const;

export type AuthCallbackDestination = (typeof AUTH_CALLBACK_DESTINATIONS)[number];

export const AUTH_CALLBACK_STATUSES = [
  "success",
  "expired",
  "invalid",
  "already-used",
  "missing",
  "exchange-failed",
  "initialization-failed",
] as const;

export type AuthCallbackStatus = (typeof AUTH_CALLBACK_STATUSES)[number];

export function normalizeAuthCallbackDestination(
  value: string | null | undefined,
): AuthCallbackDestination {
  return AUTH_CALLBACK_DESTINATIONS.includes(value as AuthCallbackDestination)
    ? (value as AuthCallbackDestination)
    : AUTH_CONFIRMED_PATH;
}

export function buildAuthCallbackUrl(siteUrl: string, destination: AuthCallbackDestination) {
  const baseUrl = new URL(siteUrl);
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("The application URL must use HTTP or HTTPS.");
  }

  const callbackUrl = new URL(AUTH_CALLBACK_PATH, baseUrl);
  callbackUrl.searchParams.set("next", destination);
  return callbackUrl.toString();
}

export function classifyAuthCallbackFailure(input: {
  code?: string | null;
  message?: string | null;
}): Exclude<AuthCallbackStatus, "success"> {
  const value = `${input.code ?? ""} ${input.message ?? ""}`.toLowerCase();

  if (value.includes("expired") || value.includes("otp_expired")) {
    return "expired";
  }
  if (value.includes("already used") || value.includes("already_used") || value.includes("used")) {
    return "already-used";
  }
  if (value.includes("missing") || value.includes("code_verifier")) {
    return "missing";
  }
  if (value.includes("invalid") || value.includes("bad_code") || value.includes("not found")) {
    return "invalid";
  }
  return "exchange-failed";
}
