import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertNoPublicSecrets, parsePublicEnv, parseServerEnv } from "./env";

const secret = "Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";
const dev = { TC_SESSION_SECRET: secret };

describe("server environment", () => {
  it("applies development defaults", () => {
    const env = parseServerEnv(dev);
    expect(env).toMatchObject({
      NODE_ENV: "development",
      TC_API_MODE: "live",
      TC_API_BASE_URL: "http://localhost:3000/api/v1",
      TC_API_TIMEOUT_MS: 10_000,
    });
  });

  it("requires a long session secret", () => {
    expect(() => parseServerEnv({})).toThrow(/TC_SESSION_SECRET/);
    expect(() => parseServerEnv({ TC_SESSION_SECRET: "short" })).toThrow(/TC_SESSION_SECRET/);
  });

  it("rejects unknown modes and malformed values", () => {
    expect(() => parseServerEnv({ ...dev, TC_API_MODE: "demo" })).toThrow(/TC_API_MODE/);
    expect(() => parseServerEnv({ ...dev, TC_API_BASE_URL: "not a url" })).toThrow(
      /TC_API_BASE_URL/,
    );
    expect(() => parseServerEnv({ ...dev, TC_API_TIMEOUT_MS: "5" })).toThrow(/TC_API_TIMEOUT_MS/);
  });

  describe("production safeguards", () => {
    const prod = {
      ...dev,
      NODE_ENV: "production",
      TC_API_BASE_URL: "https://api.example.org/api/v1",
    };

    it("accepts a sound production configuration", () => {
      expect(() => parseServerEnv(prod)).not.toThrow();
    });

    it("forbids mock mode, plain http and placeholder secrets", () => {
      expect(() => parseServerEnv({ ...prod, TC_API_MODE: "mock" })).toThrow(/mock mode/);
      expect(() =>
        parseServerEnv({ ...prod, TC_API_BASE_URL: "http://api.example.org/api/v1" }),
      ).toThrow(/https/);
      expect(() =>
        parseServerEnv({
          ...prod,
          TC_SESSION_SECRET: "replace_with_a_long_random_value_0123456789",
        }),
      ).toThrow(/placeholder/);
    });
  });
});

describe("public environment", () => {
  it("defaults the app URL and validates it", () => {
    expect(parsePublicEnv({}).NEXT_PUBLIC_APP_URL).toBe("http://localhost:3001");
    expect(() => parsePublicEnv({ NEXT_PUBLIC_APP_URL: "nope" })).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("never lets a credential-looking variable be public", () => {
    expect(() =>
      assertNoPublicSecrets({ NEXT_PUBLIC_APP_URL: "x", NEXT_PUBLIC_API_KEY: "y" }),
    ).toThrow(/API_KEY/);
    expect(() => assertNoPublicSecrets({ NEXT_PUBLIC_SESSION_SECRET: "y" })).toThrow(/SECRET/);
    expect(() =>
      assertNoPublicSecrets({ NEXT_PUBLIC_APP_URL: "x", TC_SESSION_SECRET: "fine on the server" }),
    ).not.toThrow();
  });

  it("keeps the committed example free of public secrets and of real values", () => {
    const example = readFileSync(".env.example", "utf8");
    const names = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    expect(() =>
      assertNoPublicSecrets(Object.fromEntries(names.map((n) => [n, "x"]))),
    ).not.toThrow();
    expect(names).toContain("TC_SESSION_SECRET");
    expect(example).not.toMatch(/TC_SESSION_SECRET=.+/);
  });
});
