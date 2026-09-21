import Link from "next/link";

import { resendConfirmation } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { hasPublicEnvironment } from "@/config/env.public";
import { PRODUCT_NAME } from "@/lib/ui";

type CheckEmailPageProps = {
  searchParams: Promise<{ email?: string; notice?: string }>;
};

export default async function CheckEmailPage({ searchParams }: CheckEmailPageProps) {
  const { email = "", notice } = await searchParams;
  const configured = hasPublicEnvironment(process.env);

  return (
    <main className="shell narrow">
      <section className="card auth-result">
        <p className="eyebrow">{PRODUCT_NAME}</p>
        <h1>Check your email</h1>
        <p>
          We sent a confirmation link to <strong>{email || "your email address"}</strong>.
        </p>
        <p>Click the link in that email to activate your account.</p>
        {notice ? (
          <p className="notice" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}

        <form action={resendConfirmation} className="form-stack auth-resend-form">
          <label>
            Need another confirmation email?
            <input
              name="email"
              type="email"
              defaultValue={email}
              autoComplete="email"
              placeholder="you@example.com"
              required
              disabled={!configured}
            />
          </label>
          <SubmitButton disabled={!configured} pendingLabel="Sending…">
            Resend confirmation
          </SubmitButton>
        </form>

        <Link href="/auth">Return to sign in</Link>
      </section>
    </main>
  );
}
