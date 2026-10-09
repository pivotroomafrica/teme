import type { Campaign } from "@/lib/api/contract";
import { derive, type Records } from "./records-data";

/**
 * Mock campaigns: a PROPOSAL, not a copy of any backend (there is none). The rules it follows are the ones the
 * product needs:
 *  - a campaign only ever reaches customers who agreed to marketing and still have a name and phone number on file
 *    (anonymised customers are never included), whichever audience is chosen;
 *  - the audience size is worked out by the service when the campaign is made;
 *  - only a draft can be sent or cancelled; sending needs an idempotency key and repeating it changes nothing;
 *  - NOTHING IS DELIVERED: sending only records that it happened.
 */
export type Reply = { status: number; body: unknown };

const err = (status: number, code: string, message: string, details?: unknown): Reply => ({
  status,
  body: {
    error: {
      code,
      message,
      details,
      requestId: "mock-request",
      timestamp: new Date().toISOString(),
    },
  },
});

export interface CampaignData {
  campaigns: Campaign[];
  keys: Map<string, string>;
}
export type CampaignStore = Map<string, CampaignData>;

export function campaignsFor(store: CampaignStore, email: string): CampaignData {
  let data = store.get(email);
  if (!data) {
    data = { campaigns: [], keys: new Map() };
    store.set(email, data);
  }
  return data;
}

const AUDIENCES = ["ALL_OPTED_IN", "INACTIVE_30_DAYS", "NEAR_REWARD"];

export function audienceSize(records: Records, audience: string, now = Date.now()): number {
  return records.customers.filter((rec) => {
    if (!rec.customer.marketingConsent || !rec.phone) return false;
    if (audience === "ALL_OPTED_IN") return true;
    const summary = derive(rec);
    if (audience === "NEAR_REWARD")
      return summary.progress.current >= summary.progress.required - 2;
    const last = Math.max(
      0,
      ...rec.entries.filter((e) => e.type === "STAMP").map((e) => Date.parse(e.occurredAt)),
    );
    return last < now - 30 * 86_400_000;
  }).length;
}

export function listCampaigns(data: CampaignData, query: Record<string, unknown>): Reply {
  const limit = Math.min(Math.max(Number(query.limit ?? 10) || 10, 1), 100);
  const offset =
    typeof query.cursor === "string" && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const sorted = [...data.campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const items = sorted.slice(offset, offset + limit);
  const next = offset + items.length;
  return { status: 200, body: { items, nextCursor: next < sorted.length ? String(next) : null } };
}

export function createCampaign(
  data: CampaignData,
  records: Records,
  body: unknown,
  now = Date.now(),
): Reply {
  const input = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const problems: string[] = [];
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 80)
    problems.push("name must be between 1 and 80 characters");
  const messageEn = typeof input.messageEn === "string" ? input.messageEn.trim() : "";
  if (messageEn.length < 1 || messageEn.length > 300)
    problems.push("messageEn must be between 1 and 300 characters");
  const messageAm = typeof input.messageAm === "string" ? input.messageAm.trim() : "";
  if (messageAm.length > 300) problems.push("messageAm must be at most 300 characters");
  if (typeof input.audience !== "string" || !AUDIENCES.includes(input.audience)) {
    problems.push("audience must be one of the following values: " + AUDIENCES.join(", "));
  }
  if (problems.length) return err(400, "VALIDATION_FAILED", "Request validation failed.", problems);
  const campaign: Campaign = {
    id: `00000000-0000-4000-8000-0000000ca${String(data.campaigns.length + 1).padStart(3, "0")}`,
    name,
    messageEn,
    messageAm: messageAm || null,
    audience: input.audience as Campaign["audience"],
    audienceSize: audienceSize(records, input.audience as string, now),
    status: "DRAFT",
    createdAt: new Date(now).toISOString(),
    sentAt: null,
  };
  data.campaigns.push(campaign);
  return { status: 201, body: campaign };
}

export function sendCampaign(
  data: CampaignData,
  id: string,
  idempotencyKey: string | undefined,
  now = Date.now(),
): Reply {
  if (!idempotencyKey) {
    return err(400, "VALIDATION_FAILED", "Request validation failed.", [
      "Idempotency-Key header is required",
    ]);
  }
  const campaign = data.campaigns.find((c) => c.id === id);
  if (!campaign) return err(404, "NOT_FOUND", "Campaign not found.");
  const remembered = data.keys.get(idempotencyKey);
  if (remembered) {
    return remembered === id
      ? { status: 200, body: { ...campaign, replayed: true } }
      : err(422, "IDEMPOTENCY_KEY_REUSED", "This key was already used for a different request.");
  }
  if (campaign.status !== "DRAFT") return err(409, "CONFLICT", "Only a draft can be sent.");
  campaign.status = "SENT";
  campaign.sentAt = new Date(now).toISOString();
  data.keys.set(idempotencyKey, id);
  return { status: 200, body: campaign };
}

export function cancelCampaign(data: CampaignData, id: string): Reply {
  const campaign = data.campaigns.find((c) => c.id === id);
  if (!campaign) return err(404, "NOT_FOUND", "Campaign not found.");
  if (campaign.status !== "DRAFT") return err(409, "CONFLICT", "Only a draft can be cancelled.");
  campaign.status = "CANCELLED";
  return { status: 200, body: campaign };
}
