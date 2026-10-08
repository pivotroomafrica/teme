"use client";

import { ErrorView } from "@/components/layout/state-views";

/** Route-level error boundary: shows a friendly message and a reference, never the raw error. */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView reference={error.digest} onRetry={reset} />;
}
