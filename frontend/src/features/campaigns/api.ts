import {
  campaignPageSchema,
  campaignSchema,
  parseWith,
  type Campaign,
  type CampaignPage,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

export interface CampaignInput {
  name: string;
  messageEn: string;
  messageAm?: string;
  audience: Campaign["audience"];
}

/**
 * PROPOSED campaign operations (needs `customer:manage`). The backend does not have them yet, so this client talks to
 * the mock backend only; in production every call is a 404. A campaign is a message to customers who agreed to
 * marketing. Sending is a state change: one idempotency key per attempt, reused only on a deliberate retry.
 */
export function createCampaignsApi(transport: Transport) {
  return {
    list: (input: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) =>
      transport.request<CampaignPage>({
        method: "GET",
        path: "/merchant/campaigns",
        query: { limit: input.limit ?? 10, cursor: input.cursor },
        signal,
        parse: parseWith(campaignPageSchema),
      }),

    create: (input: CampaignInput) =>
      transport.request<Campaign>({
        method: "POST",
        path: "/merchant/campaigns",
        body: input,
        parse: parseWith(campaignSchema),
      }),

    send: (campaignId: string, idempotencyKey: string) =>
      transport.request<Campaign>({
        method: "POST",
        path: "/merchant/campaigns/{campaignId}/send",
        pathParams: { campaignId },
        idempotencyKey,
        parse: parseWith(campaignSchema),
      }),

    cancel: (campaignId: string) =>
      transport.request<Campaign>({
        method: "POST",
        path: "/merchant/campaigns/{campaignId}/cancel",
        pathParams: { campaignId },
        parse: parseWith(campaignSchema),
      }),
  };
}
export type CampaignsApi = ReturnType<typeof createCampaignsApi>;
