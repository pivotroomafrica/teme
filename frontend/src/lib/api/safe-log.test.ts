import { describe, expect, it, vi } from "vitest";
import { consoleApiLogger, pathOnly, redact } from "./safe-log";

describe("redact", () => {
  it("hides credentials and personal data at any depth", () => {
    const out = redact({
      email: "visible@example.org",
      password: "hunter2",
      nested: {
        accessToken: "a",
        refreshToken: "b",
        cardToken: "c",
        phone: "0911",
        firstName: "Abebe",
      },
      list: [{ Authorization: "Bearer x" }, { ok: 1 }],
      headers: { "Idempotency-Key": "k", cookie: "s=1" },
    });
    expect(JSON.stringify(out)).not.toMatch(/hunter2|Bearer x|"a"|"b"|"c"|0911|Abebe|s=1/);
    expect(out.email).toBe("visible@example.org");
    expect(out.nested.phone).toBe("[REDACTED]");
    expect(out.list[1]).toEqual({ ok: 1 });
  });

  it("leaves primitives alone and survives deep or circular-looking input", () => {
    expect(redact("text")).toBe("text");
    expect(redact(null)).toBeNull();
    let deep: Record<string, unknown> = { token: "t" };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});

describe("pathOnly", () => {
  it("drops query strings and fragments, which can carry search terms or phone numbers", () => {
    expect(pathOnly("/merchant/customers?q=0911234567")).toBe("/merchant/customers");
    expect(pathOnly("/a#frag")).toBe("/a");
  });
});

describe("consoleApiLogger", () => {
  it("stays quiet for successful requests", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consoleApiLogger({ method: "GET", path: "/x", status: 200, durationMs: 5, requestId: "r" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs failures as one JSON line without the query string", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    consoleApiLogger({
      method: "GET",
      path: "/merchant/customers?q=0911234567",
      status: 500,
      durationMs: 12,
      requestId: "r-1",
      errorKind: "server",
      errorCode: "HTTP_500",
    });
    const line = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      path: "/merchant/customers",
      requestId: "r-1",
      errorKind: "server",
    });
    expect(line).not.toContain("0911234567");
  });
});
