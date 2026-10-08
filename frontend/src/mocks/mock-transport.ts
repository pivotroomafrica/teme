import { ApiError, apiErrorFromResponse } from "@/lib/errors/api-error";
import type { RequestSpec, Transport, TransportResponse } from "@/lib/api/http";
import { isValidIdempotencyKey } from "@/lib/api/idempotency";
import { fillPath } from "@/lib/api/query";
import { createHandlers, createMockState, type MockState } from "./handlers";

export interface MockTransportOptions {
  /** Simulated network delay in ms (0 in tests; a little latency in development shows loading states). */
  latencyMs?: number;
  /** Supplies the bearer token the way the live transport does. */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  /** Share state (stamp counts, idempotency records) across transports; defaults to a fresh state. */
  state?: MockState;
}

export interface MockReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface MockContext {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  token: string | undefined;
  idempotencyKey: string | undefined;
  state: MockState;
}

export interface MockRoute {
  method: string;
  /** Template such as "/join/{joinReference}". */
  path: string;
  handle: (ctx: MockContext) => MockReply | Promise<MockReply>;
}

const matcher = (template: string) =>
  new RegExp(`^${template.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)")}$`);

/**
 * An in-process stand-in for the backend. It implements the same Transport interface as the real HTTP
 * transport, so feature services run their real code (request building, parsing, error handling) against
 * it. Failures are produced through the same ApiError normalisation as live traffic.
 */
export function createMockTransport(options: MockTransportOptions = {}): Transport {
  const routes = createHandlers().map((route) => ({ route, regex: matcher(route.path) }));
  const state = options.state ?? createMockState();

  async function run<T>(spec: RequestSpec): Promise<TransportResponse<T>> {
    if (spec.idempotencyKey !== undefined && !isValidIdempotencyKey(spec.idempotencyKey)) {
      throw new Error("Invalid idempotency key: use 8 to 128 characters from A-Z a-z 0-9 . _ : -");
    }
    if (spec.signal?.aborted) {
      throw new ApiError({
        kind: "aborted",
        code: "ABORTED",
        message: "The request was cancelled.",
      });
    }
    if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));

    const concrete = fillPath(spec.path, spec.pathParams);
    const found = routes.find(
      ({ route, regex }) => route.method === spec.method && regex.test(concrete),
    );
    if (!found) {
      throw apiErrorFromResponse({
        status: 404,
        body: {
          error: {
            code: "NOT_FOUND",
            message: `No mock handler for ${spec.method} ${spec.path}`,
          },
        },
      });
    }
    const reply = await found.route.handle({
      params: { ...(found.regex.exec(concrete)?.groups ?? {}) },
      query: (spec.query ?? {}) as Record<string, unknown>,
      // A copy, as if the request had crossed the network.
      body: spec.body === undefined ? undefined : JSON.parse(JSON.stringify(spec.body)),
      token: await options.getAccessToken?.(),
      idempotencyKey: spec.idempotencyKey,
      state,
    });

    if (reply.status >= 400) {
      throw apiErrorFromResponse({
        status: reply.status,
        body: reply.body,
        retryAfterHeader: reply.headers?.["retry-after"],
        requestIdHeader: "mock-request",
      });
    }
    // Same validation step as live responses, so a fixture that violates the contract fails loudly.
    return { status: reply.status, data: (spec.parse ? spec.parse(reply.body) : reply.body) as T };
  }

  return {
    request: async <T>(spec: RequestSpec) => (await run<T>(spec)).data,
    requestWithMeta: run,
  };
}
