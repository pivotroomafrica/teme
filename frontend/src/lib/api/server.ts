import "server-only";
import { getServerEnv } from "@/lib/config/server-env";
import { createHttpTransport, type Transport } from "./http";
import { createApi, type Api } from "./index";
import { consoleApiLogger } from "./safe-log";

export interface ServerApiOptions {
  /**
   * The signed-in user's backend access token, read from the sealed session cookie by the auth layer.
   * Omit for public calls (join pages). It never leaves the server.
   */
  accessToken?: string;
}

/**
 * Transport for Server Components, Route Handlers and Server Actions.
 *  - `TC_API_MODE=live`: HTTP straight to the backend (no cookies are sent or accepted: credentials are explicit).
 *  - `TC_API_MODE=mock`: the in-process fake backend. It is imported dynamically so it stays out of every
 *    bundle that does not need it, and production configuration rejects mock mode altogether.
 */
export async function createServerTransport(options: ServerApiOptions = {}): Promise<Transport> {
  const env = getServerEnv();
  const getAccessToken = () => options.accessToken;

  // The guard on NODE_ENV is resolved at build time, so production builds contain no mock backend at all (the
  // configuration also refuses mock mode in production, as a second barrier).
  if (process.env.NODE_ENV !== "production" && env.TC_API_MODE === "mock") {
    const { createMockTransport } = await import("@/mocks/mock-transport");
    const { sharedMockState } = await import("@/mocks/shared-state");
    return createMockTransport({
      state: sharedMockState(),
      getAccessToken,
      latencyMs: env.NODE_ENV === "development" ? 150 : 0,
    });
  }

  return createHttpTransport({
    baseUrl: env.TC_API_BASE_URL,
    timeoutMs: env.TC_API_TIMEOUT_MS,
    getAccessToken,
    credentials: "omit",
    logger: consoleApiLogger,
  });
}

export async function getServerApi(options: ServerApiOptions = {}): Promise<Api> {
  return createApi(await createServerTransport(options));
}
