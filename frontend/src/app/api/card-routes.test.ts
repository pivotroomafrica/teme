import { NextRequest, type NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_COOKIE, openCards } from "@/lib/card/cards";

const SECRET = "Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU";
const ORIGIN = "http://localhost:3001";

type Handler = (request: NextRequest) => Promise<NextResponse> | NextResponse;
const routes: Record<string, Record<string, Handler>> = {};

beforeAll(async () => {
  vi.stubEnv("TC_SESSION_SECRET", SECRET);
  vi.stubEnv("TC_API_MODE", "mock");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  routes.session = await import("./card/session/route");
  routes.wallet = await import("./card/wallet-link/route");
  routes.marketing = await import("./card/marketing/route");
});

beforeEach(() => {
  (globalThis as Record<symbol, unknown>)[Symbol.for("temelashcard.mockState")] = undefined;
});

const CSRF = { "x-requested-with": "tc-web", origin: ORIGIN, "sec-fetch-site": "same-origin" };

function call(
  method: string,
  path: string,
  body: unknown,
  init: { headers?: Record<string, string>; cookie?: string } = {},
) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...CSRF,
      ...init.headers,
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function claim(token: string, cookie?: string) {
  const response = await routes.session!.POST!(
    call("POST", "/api/card/session", { token }, { cookie }),
  );
  const value = response.cookies.get(CARD_COOKIE)?.value;
  return { response, value, header: value ? `${CARD_COOKIE}=${value}` : undefined };
}

describe("POST /api/card/session", () => {
  it("keeps a real card in a sealed HttpOnly cookie and answers with an opaque id only", async () => {
    const { response, value } = await claim("mock-ok-1-4567");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ id: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("mock-ok");
    expect(value).toMatch(/^v1\./);
    expect(value).not.toContain("mock-ok");
    const header = response.headers.get("set-cookie")!.toLowerCase();
    expect(header).toContain("httponly");
    expect(header).toContain("samesite=lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cards = await openCards(value, SECRET);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      token: "mock-ok-1-4567",
      merchantEn: "Sample Cafe",
      id: body.id,
    });
  });

  it("refuses a token the backend does not know, and stores nothing", async () => {
    const { response, value } = await claim("not-a-real-card-token");
    expect(response.status).toBe(404);
    expect(value).toBeUndefined();
  });

  it("refuses a malformed token without asking the backend", async () => {
    for (const token of ["short", "<script>x</script>", "a b c d e f g h", "x".repeat(300)]) {
      const response = await routes.session!.POST!(call("POST", "/api/card/session", { token }));
      expect(response.status).toBe(400);
    }
    const missing = await routes.session!.POST!(call("POST", "/api/card/session", {}));
    expect(missing.status).toBe(400);
  });

  it("adds a second card next to the first and does not duplicate the same one", async () => {
    const first = await claim("mock-ok-1-4567");
    const second = await claim("mock-reward", first.header);
    const again = await claim("mock-reward", second.header);
    const cards = await openCards(again.value, SECRET);
    expect(cards.map((c) => c.token)).toEqual(["mock-reward", "mock-ok-1-4567"]);
  });

  it("answers a backend outage with a retryable error and keeps what was already saved", async () => {
    const response = await routes.session!.POST!(
      call("POST", "/api/card/session", { token: "mock-down" }),
    );
    expect(response.status).toBe(503);
    expect(response.cookies.get(CARD_COOKIE)).toBeUndefined();
  });

  it("refuses requests that do not come from this app's own pages", async () => {
    const noMarker = new NextRequest(`${ORIGIN}/api/card/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ token: "mock-ok-1-4567" }),
    });
    expect((await routes.session!.POST!(noMarker)).status).toBe(403);

    const foreign = call(
      "POST",
      "/api/card/session",
      { token: "mock-ok-1-4567" },
      {
        headers: { origin: "https://evil.example" },
      },
    );
    expect((await routes.session!.POST!(foreign)).status).toBe(403);
  });
});

describe("DELETE /api/card/session", () => {
  it("takes one card off the device and clears the cookie when none are left", async () => {
    const saved = await claim("mock-ok-1-4567");
    const { id } = (await openCards(saved.value, SECRET))[0]!;
    const response = await routes.session!.DELETE!(
      call("DELETE", "/api/card/session", { id }, { cookie: saved.header }),
    );
    expect(response.status).toBe(204);
    expect(response.cookies.get(CARD_COOKIE)?.value).toBe("");
  });

  it("answers 404 for a card that is not on this device", async () => {
    const saved = await claim("mock-ok-1-4567");
    const response = await routes.session!.DELETE!(
      call("DELETE", "/api/card/session", { id: "someone-elses" }, { cookie: saved.header }),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/card/wallet-link", () => {
  it("returns the backend link for a card on this device, never the token", async () => {
    const saved = await claim("mock-ok-google-1");
    const response = await routes.wallet!.POST!(
      call("POST", "/api/card/wallet-link", { provider: "GOOGLE" }, { cookie: saved.header }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ kind: "REDIRECT", url: expect.stringMatching(/^https:\/\//) });
    expect(JSON.stringify(body)).not.toContain("mock-ok");
  });

  it("passes on a wallet the business has not set up as a conflict", async () => {
    const saved = await claim("mock-ok-1-4567");
    const response = await routes.wallet!.POST!(
      call("POST", "/api/card/wallet-link", { provider: "APPLE" }, { cookie: saved.header }),
    );
    expect(response.status).toBe(409);
  });

  it("needs a card on the device and a known provider", async () => {
    const none = await routes.wallet!.POST!(
      call("POST", "/api/card/wallet-link", { provider: "APPLE" }),
    );
    expect(none.status).toBe(404);
    const saved = await claim("mock-ok-1-4567");
    const web = await routes.wallet!.POST!(
      call("POST", "/api/card/wallet-link", { provider: "WEB" }, { cookie: saved.header }),
    );
    expect(web.status).toBe(400);
  });
});

describe("DELETE /api/card/marketing", () => {
  it("withdraws marketing consent for a card on this device", async () => {
    const saved = await claim("mock-ok-1-4567");
    const response = await routes.marketing!.DELETE!(
      call("DELETE", "/api/card/marketing", {}, { cookie: saved.header }),
    );
    expect(response.status).toBe(204);
  });

  it("does nothing without a card on the device", async () => {
    const response = await routes.marketing!.DELETE!(call("DELETE", "/api/card/marketing", {}));
    expect(response.status).toBe(404);
  });
});
