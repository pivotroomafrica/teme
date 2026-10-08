import { ApiError, apiErrorFromResponse, toApiError } from "@/lib/errors/api-error";
import { isValidIdempotencyKey } from "./idempotency";
import { fillPath, serializeQuery, type Query } from "./query";
import { pathOnly, type ApiLogger } from "./safe-log";

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestSpec {
  method: HttpMethod;
  /** Path relative to the base URL, with {placeholders}: "/join/{joinReference}". */
  path: string;
  pathParams?: Record<string, string | number>;
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  /** Cancels the request (e.g. when a component unmounts or a newer search starts). */
  signal?: AbortSignal;
  /** Overrides the transport's default deadline. */
  timeoutMs?: number;
  /** Required for state-changing scanner actions. See idempotency.ts. */
  idempotencyKey?: string;
  /** Validates and types the JSON body. A throw becomes a "malformed" ApiError. */
  parse?: (data: unknown) => unknown;
}

/** What services depend on. Live HTTP and the in-process mock both implement it. */
/** A successful answer with its HTTP status (201 vs 200 vs 204), for the same-origin proxy that must repeat it. */
export interface TransportResponse<T> {
  status: number;
  data: T;
}

export interface Transport {
  request<T>(spec: RequestSpec): Promise<T>;
  requestWithMeta<T>(spec: RequestSpec): Promise<TransportResponse<T>>;
}

export interface RetryPolicy {
  /** Extra attempts after the first (safe reads only). */
  retries: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { retries: 2, baseDelayMs: 300 };

export interface HttpTransportConfig {
  /** Backend origin plus version prefix, or "/api/bff" in the browser. No trailing slash needed. */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Called per request; return undefined for public calls. */
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  /** Called once when the server answers 401 (so the session layer can refresh or sign out). */
  onUnauthorized?: (error: ApiError) => void;
  credentials?: RequestCredentials;
  defaultHeaders?: Record<string, string>;
  retry?: RetryPolicy;
  logger?: ApiLogger;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  createRequestId?: () => string;
  random?: () => number;
}

const SAFE_METHODS = new Set<HttpMethod>(["GET", "HEAD"]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The only place that talks HTTP. It guarantees, for every service built on top of it:
 *  - one correlation id per request (X-Request-Id) that also appears in errors and logs;
 *  - bearer credentials from a provider, never from a URL or from storage;
 *  - safe query serialization and path-parameter encoding;
 *  - a deadline (timeout) and caller cancellation;
 *  - ONE normalized error type (ApiError) for network, timeout, HTTP, validation and malformed responses;
 *  - limited retries for safe reads ONLY: a POST/PUT/PATCH/DELETE (stamping, redemption, reversal, ...) is
 *    sent exactly once, whatever happens;
 *  - no logging of bodies, headers, tokens or query strings.
 */
export function createHttpTransport(config: HttpTransportConfig): Transport {
  const doFetch =
    config.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const sleep = config.sleep ?? defaultSleep;
  const makeId = config.createRequestId ?? (() => globalThis.crypto.randomUUID());
  const random = config.random ?? Math.random;
  const retryPolicy = config.retry ?? DEFAULT_RETRY;
  const base = config.baseUrl.replace(/\/+$/, "");

  async function attempt<T>(
    spec: RequestSpec,
    requestId: string,
    number: number,
  ): Promise<TransportResponse<T>> {
    const started = Date.now();
    const path = fillPath(spec.path, spec.pathParams);
    const url = `${base}${path}${serializeQuery(spec.query)}`;

    const timeoutMs = spec.timeoutMs ?? config.timeoutMs ?? 10_000;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    if (spec.signal?.aborted) controller.abort();
    else spec.signal?.addEventListener("abort", onCallerAbort, { once: true });

    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Request-Id": requestId,
      ...config.defaultHeaders,
      ...spec.headers,
    };
    if (spec.body !== undefined) headers["Content-Type"] = "application/json";
    if (spec.idempotencyKey) headers["Idempotency-Key"] = spec.idempotencyKey;
    const token = await config.getAccessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    const log = (event: { status?: number; error?: ApiError }) =>
      config.logger?.({
        method: spec.method,
        path: pathOnly(url.slice(base.length)),
        status: event.status,
        durationMs: Date.now() - started,
        requestId,
        errorKind: event.error?.kind,
        errorCode: event.error?.code,
        attempt: number,
      });

    try {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: spec.method,
          headers,
          body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
          signal: controller.signal,
          credentials: config.credentials ?? "same-origin",
          cache: "no-store",
          redirect: "error",
        });
      } catch (cause) {
        const error = timedOut
          ? new ApiError({
              kind: "timeout",
              code: "TIMEOUT",
              message: `No answer within ${timeoutMs} ms`,
              requestId,
              cause,
            })
          : spec.signal?.aborted
            ? new ApiError({
                kind: "aborted",
                code: "ABORTED",
                message: "The request was cancelled.",
                requestId,
                cause,
              })
            : new ApiError({
                kind: "network",
                code: "NETWORK_ERROR",
                message: "The server could not be reached.",
                requestId,
                cause,
              });
        log({ error });
        throw error;
      }

      const text = await response.text().catch(() => "");
      let json: unknown;
      let jsonFailed = false;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          jsonFailed = true;
        }
      }

      if (!response.ok) {
        const error = apiErrorFromResponse({
          status: response.status,
          body: jsonFailed ? undefined : json,
          retryAfterHeader: response.headers.get("retry-after"),
          requestIdHeader: response.headers.get("x-request-id") ?? requestId,
        });
        log({ status: response.status, error });
        if (error.isAuthError) config.onUnauthorized?.(error);
        throw error;
      }

      if (jsonFailed) {
        const error = new ApiError({
          kind: "malformed",
          status: response.status,
          code: "MALFORMED_RESPONSE",
          message: "The server answered with something that is not valid JSON.",
          requestId,
        });
        log({ status: response.status, error });
        throw error;
      }

      let data: unknown = text ? json : undefined;
      if (spec.parse) {
        try {
          data = spec.parse(data);
        } catch (cause) {
          const error = new ApiError({
            kind: "malformed",
            status: response.status,
            code: "MALFORMED_RESPONSE",
            message: "The server's answer does not match the expected shape.",
            requestId,
            cause,
          });
          log({ status: response.status, error });
          throw error;
        }
      }
      log({ status: response.status });
      return { status: response.status, data: data as T };
    } finally {
      clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  async function run<T>(spec: RequestSpec): Promise<TransportResponse<T>> {
    if (spec.idempotencyKey !== undefined && !isValidIdempotencyKey(spec.idempotencyKey)) {
      throw new Error("Invalid idempotency key: use 8 to 128 characters from A-Z a-z 0-9 . _ : -");
    }
    const requestId = makeId();
    // State-changing requests get exactly one attempt. This is deliberate and not configurable.
    const maxRetries = SAFE_METHODS.has(spec.method) ? retryPolicy.retries : 0;

    for (let number = 1; ; number++) {
      try {
        return await attempt<T>(spec, requestId, number);
      } catch (raw) {
        const error = toApiError(raw);
        if (number > maxRetries || !error.isTransient) throw error;
        const delay = retryPolicy.baseDelayMs * 2 ** (number - 1) + Math.floor(random() * 100);
        await sleep(delay);
        if (spec.signal?.aborted) throw error;
      }
    }
  }

  return {
    request: async <T>(spec: RequestSpec) => (await run<T>(spec)).data,
    requestWithMeta: run,
  };
}
