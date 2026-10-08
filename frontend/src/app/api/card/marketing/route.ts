import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerApi } from "@/lib/api/server";
import { errorResponse, noStore, plainError } from "@/lib/auth/session-server";
import { pickCard } from "@/lib/card/cards";
import { invalidRequest, readBody, refuseForeignRequest } from "@/lib/card/route-helpers";
import { cardsFromRequest } from "@/lib/card/server";

const bodySchema = z.object({ cardId: z.string().min(1).max(64).optional() });

/** Stops marketing messages for a card on this device. Loyalty membership, stamps and rewards are untouched. */
export async function DELETE(request: NextRequest) {
  const refused = refuseForeignRequest(request);
  if (refused) return refused;
  const body = await readBody(request, bodySchema);
  if (!body) return invalidRequest();

  const card = pickCard(await cardsFromRequest(request), body.cardId);
  if (!card) return plainError(404, "NOT_FOUND", "Card not found.");

  try {
    await (await getServerApi()).card.withdrawMarketingConsent(card.token);
    return noStore(new NextResponse(null, { status: 204 }));
  } catch (error) {
    return errorResponse(error);
  }
}
