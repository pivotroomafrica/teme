import "server-only";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/config/server-env";
import { CARD_COOKIE, cardCookieOptions, openCards, sealCards, type StoredCard } from "./cards";

/** The cards kept on this device, for Server Components. Reading the cookie also makes the page per-request. */
export async function readCards(): Promise<StoredCard[]> {
  const jar = await cookies();
  return openCards(jar.get(CARD_COOKIE)?.value, getServerEnv().TC_SESSION_SECRET);
}

/** The cards kept on this device, for route handlers. */
export function cardsFromRequest(request: NextRequest): Promise<StoredCard[]> {
  return openCards(request.cookies.get(CARD_COOKIE)?.value, getServerEnv().TC_SESSION_SECRET);
}

export async function commitCards<T extends NextResponse>(
  response: T,
  cards: StoredCard[],
): Promise<T> {
  const env = getServerEnv();
  if (cards.length === 0) {
    response.cookies.set(CARD_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true });
    return response;
  }
  response.cookies.set(
    CARD_COOKIE,
    await sealCards(cards, env.TC_SESSION_SECRET),
    cardCookieOptions(env.NODE_ENV === "production"),
  );
  return response;
}
