import {
  parseWith,
  walletLinkResultSchema,
  webCardSchema,
  type WalletLinkResult,
  type WebCard,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

/** Customer card operations. The card token is the credential; it is sent in the body, never in a URL. */
export function createCardApi(transport: Transport) {
  return {
    getWebCard: (cardToken: string, signal?: AbortSignal) =>
      transport.request<WebCard>({
        method: "POST",
        path: "/card/web",
        body: { cardToken },
        signal,
        parse: parseWith(webCardSchema),
      }),

    createWalletLink: (
      cardToken: string,
      provider: "APPLE" | "GOOGLE" | "WEB",
      signal?: AbortSignal,
    ) =>
      transport.request<WalletLinkResult>({
        method: "POST",
        path: "/card/wallet/links",
        body: { cardToken, provider },
        signal,
        parse: parseWith(walletLinkResultSchema),
      }),

    /** Idempotent; the membership and history are untouched. */
    withdrawMarketingConsent: (cardToken: string, signal?: AbortSignal) =>
      transport.request<void>({
        method: "POST",
        path: "/card/consent/marketing/withdraw",
        body: { cardToken },
        signal,
      }),
  };
}
export type CardApi = ReturnType<typeof createCardApi>;
