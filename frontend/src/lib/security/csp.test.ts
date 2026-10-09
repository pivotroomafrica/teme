import { describe, expect, it } from "vitest";
import { API_CSP, buildCsp, newNonce } from "./csp";

const parse = (csp: string) =>
  Object.fromEntries(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name!, values];
    }),
  );

describe("buildCsp", () => {
  const prod = parse(buildCsp({ nonce: "abc123", production: true }));
  const dev = parse(buildCsp({ nonce: "abc123", production: false }));

  it("allows scripts only with the request's nonce, never inline or eval, in production", () => {
    expect(prod["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(prod["script-src"]).not.toContain("'unsafe-inline'");
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in development, where React needs it", () => {
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("keeps style elements nonce-only and allows inline style attributes only", () => {
    expect(prod["style-src"]).toEqual(["'self'", "'nonce-abc123'"]);
    expect(prod["style-src-attr"]).toEqual(["'unsafe-inline'"]);
  });

  it("lets only the development server inject styles", () => {
    expect(dev["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(prod["style-src"]).not.toContain("'unsafe-inline'");
  });

  it("closes everything else", () => {
    expect(prod["default-src"]).toEqual(["'self'"]);
    expect(prod["connect-src"]).toEqual(["'self'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
    expect(prod["form-action"]).toEqual(["'self'"]);
    expect(prod["img-src"]).not.toContain("https:");
    expect(prod["upgrade-insecure-requests"]).toEqual([]);
    expect(dev["upgrade-insecure-requests"]).toBeUndefined();
    expect(dev["connect-src"]).toContain("ws:");
    expect(prod["connect-src"]).not.toContain("ws:");
  });

  it("locks down the JSON API routes completely", () => {
    expect(API_CSP).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});

describe("newNonce", () => {
  it("is different every time and long enough to be unguessable", () => {
    const values = new Set(Array.from({ length: 50 }, newNonce));
    expect(values.size).toBe(50);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
