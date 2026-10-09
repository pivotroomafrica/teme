import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/errors/api-error";
import {
  deadJobs,
  opsFor,
  outboxStats,
  platformAudit,
  requeueDead,
  type OpsStores,
} from "./ops-data";
import { createMockApiFor } from "./test-api";

const NOW = Date.parse("2026-10-08T09:00:00Z");
const fresh = () => opsFor(new Map() as OpsStores, "admin@mock.test", NOW);
type AuditBody = {
  items: Array<{ action: string; occurredAt: string; metadata?: Record<string, unknown> }>;
  nextCursor: string | null;
};

describe("outbox (mock)", () => {
  it("re-queues a dead job: it leaves the dead list, the counts follow, and the action is audited", () => {
    const store = fresh();
    const job = store.dead[0]!;
    const before = { ...store.counts };
    const reply = requeueDead(store, job.id, NOW);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ id: job.id, attempts: 0, lastError: null });
    expect((deadJobs(store).body as unknown[]).length).toBe(3);
    const stats = outboxStats(store).body as Record<string, number>;
    expect(stats.DEAD).toBe(before.DEAD! - 1);
    expect(stats.PENDING).toBe(before.PENDING! + 1);
    expect(store.audit[0]).toMatchObject({ action: "outbox.job_requeued", targetId: job.id });
  });

  it("answers 404 for an unknown job and for one that is no longer dead", () => {
    const store = fresh();
    expect(requeueDead(store, "00000000-0000-4000-8000-000000000000").status).toBe(404);
    const id = store.dead[0]!.id;
    expect(requeueDead(store, id).status).toBe(200);
    expect(requeueDead(store, id).status).toBe(404);
  });
});

describe("platform audit (mock)", () => {
  const page = (store: ReturnType<typeof fresh>, query: Record<string, unknown>) =>
    platformAudit(store, { limit: 100, ...query }, NOW);

  it("shows platform-level events only unless a merchant is named", () => {
    const store = fresh();
    const body = page(store, {}).body as AuditBody;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((i) => i.action === "customer.anonymized")).toBe(false);
  });

  it("records that a merchant was named, in the audit, and 404s for an unknown merchant", () => {
    const store = fresh();
    const merchant = store.merchants[0]!;
    const before = store.audit.length;
    const body = page(store, { merchantId: merchant.id }).body as AuditBody;
    expect(body.items.some((i) => i.action === "customer.anonymized")).toBe(true);
    expect(store.audit.length).toBe(before + 1);
    expect(store.audit[0]).toMatchObject({
      action: "audit.platform_accessed",
      targetId: merchant.id,
    });
    expect(page(store, { merchantId: "00000000-0000-4000-8000-000000000000" }).status).toBe(404);
  });

  it("filters by action, prefix and day, and rejects a start after the end", () => {
    const store = fresh();
    const merchantId = store.merchants[0]!.id;
    const exact = page(store, { merchantId, action: "customer.anonymized" }).body as AuditBody;
    expect(exact.items.every((i) => i.action === "customer.anonymized")).toBe(true);
    const prefix = page(store, { merchantId, actionPrefix: "customer.data_" }).body as AuditBody;
    expect(prefix.items.length).toBeGreaterThan(0);
    expect(prefix.items.every((i) => i.action.startsWith("customer.data_"))).toBe(true);
    expect(page(store, { from: "2026-10-09", to: "2026-10-01" }).status).toBe(400);
  });

  it("pages without gaps", () => {
    const store = fresh();
    let cursor: string | undefined;
    let total = 0;
    do {
      const body = platformAudit(store, { limit: 10, cursor }, NOW).body as AuditBody;
      total += body.items.length;
      cursor = body.nextCursor ?? undefined;
    } while (cursor);
    expect(total).toBe(store.audit.filter((e) => e.merchantId === null).length);
  });
});

describe("who may call platform routes (mock backend)", () => {
  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("forbidden");
  };

  for (const email of [
    "owner@mock.test",
    "manager@mock.test",
    "staff@mock.test",
    "viewer@mock.test",
  ] as const) {
    it(`refuses every platform route to ${email}`, async () => {
      const { api } = createMockApiFor(email);
      await refused(api.operations.merchants());
      await refused(api.operations.outboxStats());
      await refused(api.operations.deadJobs());
      await refused(api.operations.requeueDeadJob("00000000-0000-4000-8000-000000000001"));
      await refused(api.operations.audit({}));
    });
  }

  it("lets the platform administrator read and re-queue", async () => {
    const { api } = createMockApiFor("admin@mock.test");
    expect((await api.operations.merchants()).length).toBe(12);
    const dead = await api.operations.deadJobs();
    expect((await api.operations.requeueDeadJob(dead[0]!.id)).attempts).toBe(0);
    expect((await api.operations.deadJobs()).length).toBe(dead.length - 1);
    expect((await api.operations.health()).status).toBe("ok");
  });
});
