export function PageLoading({ label = "Loading your data…" }: { label?: string }) {
  return (
    <main className="shell loading-shell" aria-busy="true" aria-live="polite">
      <section className="card loading-card">
        <span className="loading-spinner" aria-hidden="true" />
        <p>{label}</p>
      </section>
    </main>
  );
}
