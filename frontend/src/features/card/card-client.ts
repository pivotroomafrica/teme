import { createHttpTransport } from "@/lib/api/http";

/**
 * Browser calls to this app's own `/api/card/*` endpoints. The card token lives in a sealed HttpOnly cookie, so
 * these calls name a card by an opaque id (or by nothing, meaning "the newest") and never carry the token
 * except once, when a card is first put on the device.
 */
const transport = createHttpTransport({
  baseUrl: "/api/card",
  timeoutMs: 15_000,
  credentials: "same-origin",
  defaultHeaders: { "X-Requested-With": "tc-web" },
});

function parseId(data: unknown): { id: string } {
  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !id) throw new Error("Unexpected answer");
  return { id };
}

export interface WalletLink {
  kind: "DOWNLOAD" | "REDIRECT" | "NONE";
  url: string | null;
}

function parseWalletLink(data: unknown): WalletLink {
  const d = data as Partial<WalletLink> | null;
  if (!d || (d.kind !== "DOWNLOAD" && d.kind !== "REDIRECT" && d.kind !== "NONE")) {
    throw new Error("Unexpected answer");
  }
  return { kind: d.kind, url: typeof d.url === "string" ? d.url : null };
}

export const cardClient = {
  /** Puts a card on this device. Returns the id used to refer to it from now on. */
  claim: (token: string, signal?: AbortSignal) =>
    transport.request<{ id: string }>({
      method: "POST",
      path: "/session",
      body: { token },
      signal,
      parse: parseId,
    }),

  forget: (id: string) =>
    transport.request<void>({ method: "DELETE", path: "/session", body: { id } }),

  walletLink: (provider: "APPLE" | "GOOGLE", cardId?: string, signal?: AbortSignal) =>
    transport.request<WalletLink>({
      method: "POST",
      path: "/wallet-link",
      body: { provider, ...(cardId ? { cardId } : {}) },
      signal,
      parse: parseWalletLink,
    }),

  stopMarketing: (cardId?: string) =>
    transport.request<void>({
      method: "DELETE",
      path: "/marketing",
      body: cardId ? { cardId } : {},
    }),
};
