import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";

async function loadServerApi(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("./server");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("server API selection (TC_API_MODE)", () => {
  it("uses the in-process mock backend in mock mode, through the same services", async () => {
    const { getServerApi } = await loadServerApi({
      TC_API_MODE: "mock",
      TC_SESSION_SECRET: SECRET,
    });
    const api = await getServerApi();
    const session = await api.auth.login({ email: "owner@mock.test", password: "mock-password-1" });
    expect(session.user.role).toBe("OWNER");
    const authed = await (
      await import("./server")
    ).getServerApi({ accessToken: session.accessToken });
    expect((await authed.auth.me()).role).toBe("OWNER");
  });

  it("talks HTTP to the configured backend in live mode, without cookies, with the bearer token", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            userId: "u",
            kind: "merchant",
            role: "OWNER",
            merchantId: null,
            permissions: [],
            branchScope: "ALL",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { getServerApi } = await loadServerApi({
      TC_API_MODE: "live",
      TC_API_BASE_URL: "https://backend.example.test/api/v1",
      TC_SESSION_SECRET: SECRET,
    });
    const api = await getServerApi({ accessToken: "tok-abc" });
    await api.auth.me();
    const calls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("https://backend.example.test/api/v1/auth/me");
    expect(calls[0]![1].credentials).toBe("omit");
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe("Bearer tok-abc");
  });

  it("refuses to start with an invalid configuration", async () => {
    const { getServerApi } = await loadServerApi({
      TC_API_MODE: "live",
      TC_SESSION_SECRET: "short",
    });
    await expect(getServerApi()).rejects.toThrow(/TC_SESSION_SECRET/);
  });
});
