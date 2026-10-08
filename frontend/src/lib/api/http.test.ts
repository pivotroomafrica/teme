import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/errors/api-error";
import { createHttpTransport, type HttpTransportConfig } from "./http";

type FetchArgs = [string, RequestInit];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });
const envelope = (code: string, message = "msg", extra: object = {}) => ({
  error: { code, message, requestId: "srv-req", timestamp: "now", ...extra },
});

function setup(
  responder: (call: number, url: string, init: RequestInit) => Response | Promise<Response>,
  config: Partial<HttpTransportConfig> = {},
) {
  const calls: FetchArgs[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return responder(calls.length, url, init);
  });
  const transport = createHttpTransport({
    baseUrl: "https://api.test/api/v1/",
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async () => undefined,
    createRequestId: () => "req-fixed",
    random: () => 0,
    ...config,
  });
  const headersOf = (index = 0) => calls[index]![1].headers as Record<string, string>;
  return { transport, calls, headersOf, fetchMock };
}

/** A fetch that never answers but, like the real one, rejects when its signal aborts (even if already aborted). */
const pendingUntilAborted = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort);
  });

const expectApiError = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

describe("successful requests", () => {
  it("returns parsed JSON and builds the URL, query and headers", async () => {
    const { transport, calls, headersOf } = setup(() => json(200, { ok: true }), {
      getAccessToken: () => "tok-123",
    });
    const result = await transport.request<{ ok: boolean }>({
      method: "GET",
      path: "/merchant/customers/{id}",
      pathParams: { id: "a b" },
      query: { q: "abebe", limit: 25, skip: undefined },
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0]![0]).toBe("https://api.test/api/v1/merchant/customers/a%20b?limit=25&q=abebe");
    expect(headersOf()).toMatchObject({
      Accept: "application/json",
      "X-Request-Id": "req-fixed",
      Authorization: "Bearer tok-123",
    });
    expect(headersOf()["Content-Type"]).toBeUndefined();
    expect(calls[0]![1]).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  });

  it("sends JSON bodies, an idempotency key and no Authorization for public calls", async () => {
    const { transport, calls, headersOf } = setup(() => json(200, {}));
    await transport.request({
      method: "POST",
      path: "/scanner/stamps",
      body: { cardToken: "x" },
      idempotencyKey: "key-12345678",
    });
    expect(headersOf()["Content-Type"]).toBe("application/json");
    expect(headersOf()["Idempotency-Key"]).toBe("key-12345678");
    expect(headersOf().Authorization).toBeUndefined();
    expect(calls[0]![1].body).toBe('{"cardToken":"x"}');
  });

  it("treats 204 and empty bodies as no content", async () => {
    const { transport } = setup(() => new Response(null, { status: 204 }));
    expect(
      await transport.request({ method: "POST", path: "/auth/logout", body: {} }),
    ).toBeUndefined();
  });

  it("applies the response parser", async () => {
    const { transport } = setup(() => json(200, { n: "7" }));
    const value = await transport.request<number>({
      method: "GET",
      path: "/x",
      parse: (d) =>
        z
          .object({ n: z.string() })
          .transform((o) => Number(o.n))
          .parse(d),
    });
    expect(value).toBe(7);
  });

  it("can send credentials explicitly (browser to the same-origin proxy)", async () => {
    const { transport, calls } = setup(() => json(200, {}), { credentials: "same-origin" });
    await transport.request({ method: "GET", path: "/x" });
    expect(calls[0]![1].credentials).toBe("same-origin");
  });
});

describe("validation errors", () => {
  it("maps 400 details to field errors and keeps the support reference", async () => {
    const { transport } = setup(() =>
      json(
        400,
        envelope("VALIDATION_FAILED", "Request validation failed.", {
          details: [
            "firstName should not be empty",
            "phone must be a valid Ethiopian mobile number",
          ],
        }),
      ),
    );
    const error = await expectApiError(
      transport.request({ method: "POST", path: "/join/x/enroll", body: {} }),
    );
    expect(error).toMatchObject({
      kind: "validation",
      status: 400,
      code: "VALIDATION_FAILED",
      requestId: "srv-req",
    });
    expect(error.fieldErrors).toEqual({
      firstName: "should not be empty",
      phone: "must be a valid Ethiopian mobile number",
    });
  });
});

describe("authorization errors", () => {
  it("reports 401 once through onUnauthorized and throws an auth error", async () => {
    const onUnauthorized = vi.fn();
    const { transport } = setup(() => json(401, envelope("UNAUTHENTICATED")), { onUnauthorized });
    const error = await expectApiError(transport.request({ method: "GET", path: "/auth/me" }));
    expect(error).toMatchObject({ kind: "unauthenticated", isAuthError: true });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledWith(error);
  });

  it("does not retry a 401 (a new session is needed, not another attempt)", async () => {
    const { transport, fetchMock } = setup(() => json(401, envelope("UNAUTHENTICATED")));
    await expectApiError(transport.request({ method: "GET", path: "/auth/me" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports 403 as forbidden without signing the user out", async () => {
    const onUnauthorized = vi.fn();
    const { transport } = setup(() => json(403, envelope("FORBIDDEN")), { onUnauthorized });
    const error = await expectApiError(
      transport.request({ method: "GET", path: "/merchant/audit" }),
    );
    expect(error.kind).toBe("forbidden");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("maps the other documented statuses", async () => {
    const cases: Array<[number, string]> = [
      [404, "not_found"],
      [409, "conflict"],
      [422, "unprocessable"],
      [429, "rate_limited"],
      [500, "server"],
    ];
    for (const [status, kind] of cases) {
      const { transport } = setup(() => json(status, envelope("X")), {
        retry: { retries: 0, baseDelayMs: 1 },
      });
      expect((await expectApiError(transport.request({ method: "POST", path: "/x" }))).kind).toBe(
        kind,
      );
    }
  });

  it("exposes Retry-After on rate limits", async () => {
    const { transport } = setup(() => json(429, envelope("RATE_LIMITED"), { "retry-after": "45" }));
    const error = await expectApiError(
      transport.request({ method: "POST", path: "/auth/login", body: {} }),
    );
    expect(error.retryAfterSeconds).toBe(45);
  });

  it("turns a proxy's HTML error page into a clean ApiError", async () => {
    const { transport } = setup(() => text(502, "<html>Bad gateway</html>"), {
      retry: { retries: 0, baseDelayMs: 1 },
    });
    const error = await expectApiError(transport.request({ method: "GET", path: "/x" }));
    expect(error).toMatchObject({ kind: "unavailable", status: 502, code: "HTTP_502" });
    expect(error.message).not.toContain("<html>");
  });
});

describe("network failures, timeouts and cancellation", () => {
  it("reports a failed connection as a network error", async () => {
    const { transport } = setup(
      () => {
        throw new TypeError("fetch failed");
      },
      { retry: { retries: 0, baseDelayMs: 1 } },
    );
    const error = await expectApiError(transport.request({ method: "GET", path: "/x" }));
    expect(error).toMatchObject({ kind: "network", code: "NETWORK_ERROR", requestId: "req-fixed" });
  });

  describe("with fake timers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const hang = (_: number, __: string, init: RequestInit) => pendingUntilAborted(init);

    it("gives up after the deadline with a timeout error", async () => {
      const { transport } = setup(hang, { timeoutMs: 5000, retry: { retries: 0, baseDelayMs: 1 } });
      const pending = expectApiError(transport.request({ method: "GET", path: "/x" }));
      await vi.advanceTimersByTimeAsync(5000);
      const error = await pending;
      expect(error).toMatchObject({ kind: "timeout", code: "TIMEOUT" });
    });

    it("lets a single request override the deadline", async () => {
      const { transport } = setup(hang, {
        timeoutMs: 60_000,
        retry: { retries: 0, baseDelayMs: 1 },
      });
      const pending = expectApiError(
        transport.request({ method: "GET", path: "/x", timeoutMs: 1000 }),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect((await pending).kind).toBe("timeout");
    });
  });

  it("reports caller cancellation as 'aborted', not as a network or timeout problem", async () => {
    const controller = new AbortController();
    const { transport, fetchMock } = setup((_n, _u, init) => pendingUntilAborted(init));
    const pending = expectApiError(
      transport.request({ method: "GET", path: "/x", signal: controller.signal }),
    );
    controller.abort();
    expect((await pending).kind).toBe("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1); // a cancelled request is never retried
  });

  it("does not even start when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport } = setup((_n, _u, init) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return json(200, {});
    });
    expect(
      (
        await expectApiError(
          transport.request({ method: "GET", path: "/x", signal: controller.signal }),
        )
      ).kind,
    ).toBe("aborted");
  });
});

describe("malformed responses", () => {
  it("rejects a success answer that is not JSON", async () => {
    const { transport } = setup(() => text(200, "<html>oops</html>"));
    const error = await expectApiError(transport.request({ method: "GET", path: "/x" }));
    expect(error).toMatchObject({ kind: "malformed", code: "MALFORMED_RESPONSE", status: 200 });
  });

  it("rejects JSON that does not match the expected shape", async () => {
    const { transport } = setup(() => json(200, { outcome: "SOMETHING_NEW" }));
    const error = await expectApiError(
      transport.request({
        method: "GET",
        path: "/x",
        parse: (d) => z.object({ outcome: z.enum(["STAMPED", "REJECTED"]) }).parse(d),
      }),
    );
    expect(error).toMatchObject({ kind: "malformed", code: "MALFORMED_RESPONSE" });
    expect(error.cause).toBeDefined();
  });

  it("does not retry malformed answers", async () => {
    const { transport, fetchMock } = setup(() => text(200, "not json"));
    await expectApiError(transport.request({ method: "GET", path: "/x" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("retries", () => {
  it("retries safe reads after a transient failure and then succeeds", async () => {
    const { transport, fetchMock } = setup((n) =>
      n < 3 ? json(503, envelope("HTTP_503")) : json(200, { ok: 1 }),
    );
    expect(await transport.request({ method: "GET", path: "/x" })).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a network error once for GET and keeps the same correlation id", async () => {
    const { transport, calls } = setup((n) => {
      if (n === 1) throw new TypeError("offline");
      return json(200, { ok: 1 });
    });
    await transport.request({ method: "GET", path: "/x" });
    expect(calls).toHaveLength(2);
    expect((calls[0]![1].headers as Record<string, string>)["X-Request-Id"]).toBe("req-fixed");
    expect((calls[1]![1].headers as Record<string, string>)["X-Request-Id"]).toBe("req-fixed");
  });

  it("gives up after the configured attempts and reports the last error", async () => {
    const { transport, fetchMock } = setup(() => json(503, envelope("HTTP_503")), {
      retry: { retries: 2, baseDelayMs: 1 },
    });
    const error = await expectApiError(transport.request({ method: "GET", path: "/x" }));
    expect(error.kind).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("backs off exponentially", async () => {
    const delays: number[] = [];
    const { transport } = setup(() => json(503, envelope("HTTP_503")), {
      retry: { retries: 3, baseDelayMs: 100 },
      sleep: async (ms) => void delays.push(ms),
    });
    await expectApiError(transport.request({ method: "GET", path: "/x" }));
    expect(delays).toEqual([100, 200, 400]);
  });

  it("does not retry client errors", async () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      const { transport, fetchMock } = setup(() => json(status, envelope("X")));
      await expectApiError(transport.request({ method: "GET", path: "/x" }));
      expect(fetchMock, `status ${status}`).toHaveBeenCalledTimes(1);
    }
  });

  it("never retries state-changing requests, even after a network failure or a 503", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      for (const failure of ["network", "503"] as const) {
        const { transport, fetchMock } = setup(() => {
          if (failure === "network") throw new TypeError("offline");
          return json(503, envelope("HTTP_503"));
        });
        await expectApiError(transport.request({ method, path: "/x", body: {} }));
        expect(fetchMock, `${method} ${failure}`).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("sends stamping and redemption exactly once, however the answer fails", async () => {
    for (const path of ["/scanner/stamps", "/scanner/redemptions"]) {
      const { transport, fetchMock } = setup(() => {
        throw new TypeError("connection reset");
      });
      const error = await expectApiError(
        transport.request({
          method: "POST",
          path,
          body: { cardToken: "t" },
          idempotencyKey: "key-abcdefgh",
        }),
      );
      expect(error.kind).toBe("network");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});

describe("idempotency keys", () => {
  it("rejects keys the backend would refuse, before sending anything", async () => {
    const { transport, fetchMock } = setup(() => json(200, {}));
    for (const key of ["short", "has spaces in it", "x".repeat(129), "emoji-💥-key-1234"]) {
      await expect(
        transport.request({ method: "POST", path: "/scanner/stamps", idempotencyKey: key }),
      ).rejects.toThrow(/idempotency key/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("logging", () => {
  it("logs method, path and outcome but never tokens, bodies, queries or phone numbers", async () => {
    const events: Array<Record<string, unknown>> = [];
    const { transport } = setup(() => json(500, envelope("INTERNAL_ERROR")), {
      logger: (e) => void events.push({ ...e }),
      getAccessToken: () => "super-secret-token",
      retry: { retries: 0, baseDelayMs: 1 },
    });
    await expectApiError(
      transport.request({
        method: "POST",
        path: "/join/{ref}/enroll",
        pathParams: { ref: "sample-cafe" },
        query: { phone: "0911234567" },
        body: { phone: "0911234567", firstName: "Abebe", password: "hunter2" },
        idempotencyKey: "key-secret-1",
      }),
    );
    expect(events).toHaveLength(1);
    const logged = JSON.stringify(events);
    expect(logged).not.toMatch(/super-secret-token|0911234567|Abebe|hunter2|key-secret-1/);
    expect(events[0]).toMatchObject({
      method: "POST",
      path: "/join/sample-cafe/enroll",
      status: 500,
      requestId: "req-fixed",
      errorKind: "server",
    });
  });
});
