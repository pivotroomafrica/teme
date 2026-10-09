import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHandlers } from "./handlers";

/**
 * The mock backend must not know operations the real backend does not have, or screens could be built and tested
 * against behaviour that does not exist. Every mock route is therefore checked against the OpenAPI document the
 * generated types come from (openapi/openapi.json, synced from the backend).
 */
const spec = JSON.parse(readFileSync(join(process.cwd(), "openapi", "openapi.json"), "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
};
const operations = new Set(
  Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map(
      (method) => `${method.toUpperCase()} ${path.replace(/^\/api\/v1/, "")}`,
    ),
  ),
);

/** Mock-only routes, each with the reason it is allowed. Keep this empty if at all possible. */
const MOCK_ONLY: Record<string, string> = {
  "GET /merchant/campaigns": "Proposed: the backend has no campaigns yet (docs/campaigns.md)",
  "POST /merchant/campaigns": "Proposed: the backend has no campaigns yet (docs/campaigns.md)",
  "POST /merchant/campaigns/{campaignId}/send":
    "Proposed: the backend has no campaigns yet (docs/campaigns.md)",
  "POST /merchant/campaigns/{campaignId}/cancel":
    "Proposed: the backend has no campaigns yet (docs/campaigns.md)",
};

describe("mock backend against the OpenAPI contract", () => {
  const handlers = createHandlers();

  it("has only operations that exist in the contract", () => {
    const unknown = handlers
      .map((h) => `${h.method} ${h.path}`)
      .filter((key) => !operations.has(key) && !(key in MOCK_ONLY));
    expect(unknown).toEqual([]);
  });

  it("does not keep stale exceptions", () => {
    for (const key of Object.keys(MOCK_ONLY)) expect(operations.has(key), key).toBe(false);
  });

  it("has no duplicate routes", () => {
    const keys = handlers.map((h) => `${h.method} ${h.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
