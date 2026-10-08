import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translator";
import { am } from "@/lib/i18n/messages/am";
import { en } from "@/lib/i18n/messages/en";
import {
  ApiError,
  apiErrorFromResponse,
  isApiError,
  kindForStatus,
  mapFieldErrors,
  toApiError,
} from "./api-error";
import { describeApiError } from "./messages";

const envelope = (code: string, message: string, extra: object = {}) => ({
  error: { code, message, requestId: "req-1", timestamp: "2026-10-09T00:00:00.000Z", ...extra },
});

describe("kindForStatus", () => {
  it.each([
    [400, "validation"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [413, "payload_too_large"],
    [422, "unprocessable"],
    [429, "rate_limited"],
    [502, "unavailable"],
    [503, "unavailable"],
    [504, "unavailable"],
    [500, "server"],
    [501, "server"],
    [418, "unknown"],
  ])("maps %i to %s", (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });
});

describe("apiErrorFromResponse", () => {
  it("reads the backend's error envelope", () => {
    const error = apiErrorFromResponse({
      status: 409,
      body: envelope("COOLDOWN_ACTIVE", "Too soon", { details: { retryAfterSeconds: 90 } }),
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: "conflict",
      status: 409,
      code: "COOLDOWN_ACTIVE",
      message: "Too soon",
      requestId: "req-1",
      details: { retryAfterSeconds: 90 },
    });
  });

  it("falls back sensibly when the body is not an envelope (a proxy's HTML page, an empty body)", () => {
    const html = apiErrorFromResponse({ status: 502, body: undefined, requestIdHeader: "hdr-1" });
    expect(html).toMatchObject({ kind: "unavailable", code: "HTTP_502", requestId: "hdr-1" });
    const weird = apiErrorFromResponse({ status: 500, body: { error: "string, not an object" } });
    expect(weird).toMatchObject({ kind: "server", code: "HTTP_500" });
  });

  it("reads Retry-After, ignoring nonsense", () => {
    expect(
      apiErrorFromResponse({ status: 429, body: undefined, retryAfterHeader: "30" })
        .retryAfterSeconds,
    ).toBe(30);
    expect(
      apiErrorFromResponse({ status: 429, body: undefined, retryAfterHeader: "soon" })
        .retryAfterSeconds,
    ).toBeUndefined();
    expect(
      apiErrorFromResponse({ status: 429, body: undefined, retryAfterHeader: "-5" })
        .retryAfterSeconds,
    ).toBeUndefined();
  });

  it("maps validation details to fields", () => {
    const error = apiErrorFromResponse({
      status: 400,
      body: envelope("VALIDATION_FAILED", "Request validation failed.", {
        details: ["firstName should not be empty", "phone must be a valid Ethiopian mobile number"],
      }),
    });
    expect(error.kind).toBe("validation");
    expect(error.fieldErrors).toEqual({
      firstName: "should not be empty",
      phone: "must be a valid Ethiopian mobile number",
    });
  });

  it("does not map field errors for non-validation failures", () => {
    const error = apiErrorFromResponse({
      status: 409,
      body: envelope("CONFLICT", "x", { details: ["firstName should not be empty"] }),
    });
    expect(error.fieldErrors).toEqual({});
  });
});

describe("mapFieldErrors", () => {
  it("handles nested paths and keeps the first message per field", () => {
    expect(
      mapFieldErrors([
        "program.reward.nameEn must be a string",
        "program.reward.nameEn should not be empty",
        "items[0].qty must not be less than 1",
      ]),
    ).toEqual({
      "program.reward.nameEn": "must be a string",
      "items[0].qty": "must not be less than 1",
    });
  });

  it("ignores things that are not field messages", () => {
    expect(mapFieldErrors(undefined)).toEqual({});
    expect(mapFieldErrors("firstName empty")).toEqual({});
    expect(mapFieldErrors([42, null, "Something general went wrong", "x"])).toEqual({
      Something: "general went wrong",
    });
  });
});

describe("toApiError", () => {
  it("passes ApiErrors through and wraps everything else", () => {
    const original = new ApiError({ kind: "network", code: "NETWORK_ERROR", message: "x" });
    expect(toApiError(original)).toBe(original);
    const wrapped = toApiError(new TypeError("boom"));
    expect(wrapped).toMatchObject({ kind: "unknown", code: "UNEXPECTED", message: "boom" });
    expect(isApiError(wrapped)).toBe(true);
    expect(toApiError("a string").kind).toBe("unknown");
  });

  it("recognises cancellation", () => {
    expect(toApiError(new DOMException("aborted", "AbortError")).kind).toBe("aborted");
  });

  it("flags authentication errors and transient failures for callers", () => {
    expect(new ApiError({ kind: "unauthenticated", code: "X", message: "x" }).isAuthError).toBe(
      true,
    );
    for (const kind of ["network", "timeout", "unavailable"] as const) {
      expect(new ApiError({ kind, code: "X", message: "x" }).isTransient).toBe(true);
    }
    expect(new ApiError({ kind: "conflict", code: "X", message: "x" }).isTransient).toBe(false);
  });
});

describe("describeApiError", () => {
  const tEn = createTranslator({ messages: en, fallback: en });
  const tAm = createTranslator({ messages: am, fallback: en });
  const make = (
    kind: ApiError["kind"],
    extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {},
  ) => new ApiError({ kind, code: "X", message: "Internal English detail", ...extra });

  it("never shows the backend's own wording", () => {
    for (const kind of [
      "network",
      "timeout",
      "unauthenticated",
      "forbidden",
      "rate_limited",
      "unavailable",
      "server",
      "validation",
      "conflict",
      "not_found",
      "unprocessable",
      "payload_too_large",
      "malformed",
      "unknown",
    ] as const) {
      const text = describeApiError(make(kind), tEn);
      expect(text.title + text.description).not.toContain("Internal English detail");
      expect(text.description.length).toBeGreaterThan(10);
    }
  });

  it("includes the wait time for rate limits", () => {
    expect(
      describeApiError(make("rate_limited", { retryAfterSeconds: 30 }), tEn).description,
    ).toContain("30 seconds");
    expect(describeApiError(make("rate_limited"), tEn).description).toContain("Too many attempts");
  });

  it("speaks Amharic", () => {
    expect(describeApiError(make("network"), tAm).description).toBe(am.errors.network);
    expect(
      describeApiError(make("rate_limited", { retryAfterSeconds: 30 }), tAm).description,
    ).toContain("30");
  });
});
