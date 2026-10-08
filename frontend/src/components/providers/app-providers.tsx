"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Client-side providers. TanStack Query is used only where a Client Component needs interactive fetching
 * (scanner lookups, filters, polling); pages themselves fetch on the server.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Conservative defaults for slow connections: no refetch storms on focus or reconnect.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          // State-changing requests are never retried automatically (stamps, redemptions, reversals).
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
