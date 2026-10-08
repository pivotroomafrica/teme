import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerApi } from "@/lib/api/server";
import { errorResponse, noStore, plainError } from "@/lib/auth/session-server";
import { CARD_TOKEN, addCard, removeCard } from "@/lib/card/cards";
import { invalidRequest, readBody, refuseForeignRequest } from "@/lib/card/route-helpers";
import { cardsFromRequest, commitCards } from "@/lib/card/server";

const claimSchema = z.object({ token: z.string().regex(CARD_TOKEN) });
const forgetSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * Puts a card on this device. The browser hands over the token it was just given (at sign-up, or from a saved
 * link); the server checks with the backend that it is a real card, then keeps it in a sealed HttpOnly cookie.
 * The answer carries only an opaque id, never the token.
 */
export async function POST(request: NextRequest) {
  const refused = refuseForeignRequest(request);
  if (refused) return refused;
  const body = await readBody(request, claimSchema);
  if (!body) return invalidRequest();

  try {
    const card = await (await getServerApi()).card.getWebCard(body.token);
    const cards = await cardsFromRequest(request);
    const id = crypto.randomUUID();
    const next = addCard(cards, {
      id,
      token: body.token,
      merchantEn: card.merchant.nameEn,
      merchantAm: card.merchant.nameAm,
      brandColor: card.program.brandColor,
    });
    const stored = next[0]!;
    return await commitCards(noStore(NextResponse.json({ id: stored.id })), next);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Takes a card off this device (for a shared or lost phone). The membership itself is untouched. */
export async function DELETE(request: NextRequest) {
  const refused = refuseForeignRequest(request);
  if (refused) return refused;
  const body = await readBody(request, forgetSchema);
  if (!body) return invalidRequest();

  const cards = await cardsFromRequest(request);
  if (!cards.some((c) => c.id === body.id)) return plainError(404, "NOT_FOUND", "Card not found.");
  return commitCards(noStore(new NextResponse(null, { status: 204 })), removeCard(cards, body.id));
}
