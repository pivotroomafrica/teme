import { createHttpTransport } from "@/lib/api/http";

/**
 * Browser-side calls to this app's own session endpoints (/api/session/*). They set or clear the HttpOnly
 * session cookie on the server; the browser never receives a token, only where to go next.
 */
const transport = createHttpTransport({
  baseUrl: "/api/session",
  timeoutMs: 15_000,
  credentials: "same-origin",
  defaultHeaders: { "X-Requested-With": "tc-web" },
});

export interface SignInInput {
  email: string;
  password: string;
  /** Where the person was going; the server re-validates it and falls back to their home page. */
  next?: string;
  locale: string;
}

export interface SignInResult {
  redirectTo: string;
  user: { displayName: string; role: string };
}

function parseSignIn(data: unknown): SignInResult {
  const d = data as Partial<SignInResult> | null;
  if (!d || typeof d.redirectTo !== "string" || !d.redirectTo.startsWith("/")) {
    throw new Error("Unexpected sign-in answer");
  }
  return d as SignInResult;
}

export const sessionClient = {
  signIn: (input: SignInInput, signal?: AbortSignal) =>
    transport.request<SignInResult>({
      method: "POST",
      path: "/login",
      body: input,
      signal,
      parse: parseSignIn,
    }),
  signOut: () => transport.request<void>({ method: "POST", path: "/logout", body: {} }),
  signOutAllDevices: () =>
    transport.request<void>({ method: "POST", path: "/logout-all", body: {} }),
  selectBranch: (branchId: string) =>
    transport.request<void>({ method: "POST", path: "/branch", body: { branchId } }),
};
