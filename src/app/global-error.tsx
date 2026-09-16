"use client";

import { PRODUCT_NAME } from "@/lib/ui";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          color: "#17332a",
          background: "#f4f7f8",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main role="alert" style={{ maxWidth: "36rem" }}>
          <p style={{ color: "#087443", fontWeight: 800, letterSpacing: "0.08em" }}>
            {PRODUCT_NAME}
          </p>
          <h1>We couldn’t load the application</h1>
          <p>Your data was not changed. Refresh the application and try again.</p>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
