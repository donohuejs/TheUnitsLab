"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="shell narrow">
      <section className="card error-state" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1>We couldn’t load this page</h1>
        <p className="muted">
          Your data was not changed. Try again, or use the navigation to continue.
        </p>
        <button className="button" type="button" onClick={() => reset()}>
          Try again
        </button>
      </section>
    </main>
  );
}
