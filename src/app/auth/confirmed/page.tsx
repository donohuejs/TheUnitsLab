import Link from "next/link";

import { type AuthCallbackStatus } from "@/lib/auth-flow";
import { PRODUCT_NAME } from "@/lib/ui";

type ConfirmedPageProps = {
  searchParams: Promise<{ status?: string }>;
};

const statusCopy: Record<Exclude<AuthCallbackStatus, "success">, string> = {
  expired: "This confirmation link has expired. Request a new confirmation email and try again.",
  invalid: "This confirmation link is invalid. Request a new confirmation email and try again.",
  "already-used":
    "This confirmation link has already been used. You can sign in if your email was confirmed.",
  missing:
    "This confirmation link is incomplete. Open the full link from your email or request a new one.",
  "exchange-failed":
    "We could not complete this confirmation link. Request a new confirmation email and try again.",
  "initialization-failed":
    "Your email was confirmed, but account setup could not finish. Refresh this page or try signing in again.",
};

export default async function ConfirmedPage({ searchParams }: ConfirmedPageProps) {
  const { status = "success" } = await searchParams;
  const successful = status === "success";
  const failureStatus =
    status in statusCopy ? (status as Exclude<AuthCallbackStatus, "success">) : "exchange-failed";

  return (
    <main className="shell narrow">
      <section className={`card auth-result ${successful ? "" : "auth-result-error"}`}>
        <p className="eyebrow">{PRODUCT_NAME}</p>
        <h1>{successful ? "Email confirmed" : "Confirmation link issue"}</h1>
        <p role={successful ? "status" : "alert"} aria-live="polite">
          {successful
            ? "Your Units Lab account is ready. You may now continue into the app."
            : statusCopy[failureStatus]}
        </p>
        <div className="auth-result-actions">
          {successful ? (
            <Link className="button" href="/account">
              Continue to The Units Lab
            </Link>
          ) : null}
          <Link className="button secondary" href="/auth">
            Return to sign in
          </Link>
          {!successful ? (
            <Link className="text-button" href="/auth/check-email">
              Resend confirmation email
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
