import Link from "next/link";

import { requestPasswordReset } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { hasPublicEnvironment } from "@/config/env.public";
import { PRODUCT_NAME } from "@/lib/ui";

type ForgotPasswordPageProps = {
  searchParams: Promise<{ notice?: string }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const { notice } = await searchParams;
  const configured = hasPublicEnvironment(process.env);

  return (
    <main className="shell narrow">
      <section className="card auth-result">
        <p className="eyebrow">{PRODUCT_NAME}</p>
        <h1>Reset your password</h1>
        <p>Enter your email and we will send password reset instructions if an account exists.</p>
        {notice ? (
          <p className="notice" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
        {!configured ? (
          <p className="notice error" role="alert">
            Supabase public configuration is missing. Password recovery is unavailable until the app
            is configured.
          </p>
        ) : null}

        <form action={requestPasswordReset} className="form-stack">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required disabled={!configured} />
          </label>
          <SubmitButton disabled={!configured} pendingLabel="Sending…">
            Send reset instructions
          </SubmitButton>
        </form>
        <Link href="/auth">Return to sign in</Link>
      </section>
    </main>
  );
}
