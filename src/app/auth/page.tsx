import { redirect } from "next/navigation";
import Link from "next/link";

import { signIn, signUp } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { hasPublicEnvironment } from "@/config/env.public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PRODUCT_NAME } from "@/lib/ui";

type AuthPageProps = {
  searchParams: Promise<{ notice?: string }>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const { notice } = await searchParams;
  const configured = hasPublicEnvironment(process.env);

  if (configured) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      redirect("/account");
    }
  }

  return (
    <main className="shell narrow">
      <header className="page-header">
        <p className="eyebrow">Private entertainment and statistics</p>
        <h1>{PRODUCT_NAME}</h1>
        <p>Sign in or create an account to manage your profile and private Studies.</p>
      </header>

      {!configured ? (
        <section className="notice error" role="alert">
          Supabase public configuration is missing. Copy <code>.env.example</code> to{" "}
          <code>.env.local</code> and provide the project URL and public key.
        </section>
      ) : null}
      {notice ? (
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div className="auth-grid">
        <section className="card">
          <h2>Sign in</h2>
          <form action={signIn} className="form-stack">
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <SubmitButton disabled={!configured} pendingLabel="Signing in…">
              Sign in
            </SubmitButton>
          </form>
          <div className="auth-links">
            <Link href="/auth/forgot-password">Forgot password?</Link>
            <Link href="/auth/check-email">Need another confirmation email?</Link>
          </div>
        </section>

        <section className="card">
          <h2>Create account</h2>
          <form action={signUp} className="form-stack">
            <label>
              Display name
              <input name="displayName" minLength={2} maxLength={50} required />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <SubmitButton disabled={!configured} pendingLabel="Creating account…">
              Sign up
            </SubmitButton>
          </form>
        </section>
      </div>
    </main>
  );
}
