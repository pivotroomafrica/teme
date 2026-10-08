import { seal, unseal } from "@/lib/auth/seal";

/**
 * The customer's cards on this device.
 *
 * A card token is the customer's only credential and the backend shows it once, so it has to be kept. It is
 * kept in a sealed (encrypted, tamper-proof) HttpOnly cookie, never in localStorage, sessionStorage or
 * IndexedDB: page scripts cannot read it, so a script injected into the page cannot steal it. The browser
 * only ever holds an opaque id per card; every operation that needs the token runs on the server.
 *
 * A customer can belong to several businesses, so the cookie holds a short list (newest first).
 */
export const CARD_COOKIE = "tc_card";
export const MAX_CARDS = 5;

/** What a backend card token looks like. Anything else is refused before it is sent anywhere. */
export const CARD_TOKEN = /^[A-Za-z0-9._~-]{8,256}$/;

export interface StoredCard {
  /** Random id used by the browser to refer to this card. Not secret and not derived from the token. */
  id: string;
  token: string;
  /** Business name, kept so cards can be listed without asking the backend about each. */
  merchantEn: string;
  merchantAm: string | null;
  brandColor: string | null;
}

interface Payload {
  /** Stops a value sealed for another purpose (for example the staff session) being accepted here. */
  purpose: "cards";
  cards: StoredCard[];
}

const isStoredCard = (value: unknown): value is StoredCard => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.token === "string" &&
    CARD_TOKEN.test(v.token) &&
    typeof v.merchantEn === "string" &&
    (v.merchantAm === null || typeof v.merchantAm === "string") &&
    (v.brandColor === null || typeof v.brandColor === "string")
  );
};

export async function sealCards(cards: StoredCard[], secret: string): Promise<string> {
  const payload: Payload = { purpose: "cards", cards };
  return seal(payload, secret);
}

/** The cards in a cookie value, or an empty list for anything missing, forged or damaged. */
export async function openCards(value: string | undefined, secret: string): Promise<StoredCard[]> {
  const payload = await unseal<Partial<Payload>>(value, secret);
  if (!payload || payload.purpose !== "cards" || !Array.isArray(payload.cards)) return [];
  return payload.cards.filter(isStoredCard).slice(0, MAX_CARDS);
}

/** Adds a card as the newest. The same token is never listed twice, and the oldest card drops off at the limit. */
export function addCard(cards: StoredCard[], card: StoredCard): StoredCard[] {
  const others = cards.filter((c) => c.token !== card.token);
  const keepId = cards.find((c) => c.token === card.token)?.id;
  return [{ ...card, id: keepId ?? card.id }, ...others].slice(0, MAX_CARDS);
}

export const removeCard = (cards: StoredCard[], id: string): StoredCard[] =>
  cards.filter((c) => c.id !== id);

/** The card a request refers to: the one named by id, otherwise the newest. */
export const pickCard = (cards: StoredCard[], id: string | null | undefined) =>
  (id ? cards.find((c) => c.id === id) : undefined) ?? cards[0];

/** Roughly a year (browsers cap cookie lifetimes at 400 days). Renewed every time a card is added. */
export const CARD_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const cardCookieOptions = (secure: boolean) =>
  ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: CARD_COOKIE_MAX_AGE_SECONDS,
  }) as const;
