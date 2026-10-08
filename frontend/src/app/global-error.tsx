"use client";

/**
 * Last-resort boundary for errors in the root layout itself, where translations are not available.
 * Static, bilingual, and it exposes nothing about the error.
 */
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
          fontFamily: "system-ui, sans-serif",
          background: "#fbf7ee",
          color: "#1e2321",
          margin: 0,
        }}
      >
        <main style={{ maxWidth: 480, margin: "0 auto", padding: "4rem 1rem" }}>
          <h1 style={{ fontSize: "1.5rem" }}>Something went wrong · የሆነ ችግር ተፈጥሯል</h1>
          <p>Please try again. · እባክዎ እንደገና ይሞክሩ።</p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: "0 1.25rem",
              background: "#1b5e3a",
              color: "#fff",
              border: 0,
              borderRadius: 12,
              fontSize: "1rem",
            }}
          >
            Try again · እንደገና ሞክር
          </button>
        </main>
      </body>
    </html>
  );
}
