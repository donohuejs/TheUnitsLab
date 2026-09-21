import Link from "next/link";

import { signOut, updatePassword } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PRODUCT_NAME } from "@/lib/ui";

type RecoveryPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function RecoveryPage({ searchParams }: RecoveryPageProps) {
  const { status } = await searchParams;
  const configured = hasPublicEnvironment(process.env);
  let authenticated = false;

  if (configured) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    authenticated = Boolean(data.user);
  }

  const updated = status === "updated";
  const invalid = !authenticated && !updated;

  return (
    <main className="shell narrow">
      <section className="card auth-result">
        <p className="eyebrow">{PRODUCT_NAME}</p>
        {updated ? (
          <>
            <h1>Password updated successfully.</h1>
            <p role="status" aria-live="polite">
              Your password has been changed. Your recovery session is still active.
            </p>
            <div className="auth-result-actions">
              <Link className="button" href="/account">
                Continue to The Units Lab
              </Link>
              <form action={signOut}>
                <SubmitButton className="button secondary" pendingLabel="Signing out…">
                  Sign out and sign in
                </SubmitButton>
              </form>
            </div>
          </>
        ) : invalid ? (
          <>
            <h1>Reset link unavailable</h1>
            <p role="alert" aria-live="polite">
              This password reset link is invalid or expired. Request a new reset email to continue.
            </p>
            <Link className="button" href="/auth/forgot-password">
              Request a new reset link
            </Link>
          </>
        ) : (
          <>
            <h1>Choose a new password</h1>
            <p>Enter a new password of at least 8 characters, then confirm it below.</p>
            <form action={updatePassword} className="form-stack">
              <label>
                New password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              <label>
                Confirm new password
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              <SubmitButton pendingLabel="Updating…">Update password</SubmitButton>
            </form>
            {status === "mismatch" ? (
              <p className="notice error" role="alert">
                Passwords do not match. Enter the same password in both fields.
              </p>
            ) : null}
            {status === "failed" ? (
              <p className="notice error" role="alert">
                Password could not be updated. Try again with a different password.
              </p>
            ) : null}
            {status === "weak" ? (
              <p className="notice error" role="alert">
                Passwords must be between 8 and 128 characters.
              </p>
            ) : null}
            <Link href="/auth">Return to sign in</Link>
          </>
        )}
      </section>
    </main>
  );
}
