import { redirect } from "next/navigation";

import { signIn, signUp } from "@/app/actions";
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
            <button className="button" type="submit" disabled={!configured}>
              Sign in
            </button>
          </form>
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
            <button className="button" type="submit" disabled={!configured}>
              Sign up
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
