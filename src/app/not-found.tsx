import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell narrow">
      <section className="card error-state">
        <p className="eyebrow">404</p>
        <h1>That page isn’t available</h1>
        <p className="muted">The link may be out of date or the destination may have moved.</p>
        <Link className="button link-button" href="/">
          Go to home
        </Link>
      </section>
    </main>
  );
}
