import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerApi } from "@/lib/api/server";
import { errorResponse, noStore, plainError } from "@/lib/auth/session-server";
import { pickCard } from "@/lib/card/cards";
import { invalidRequest, readBody, refuseForeignRequest } from "@/lib/card/route-helpers";
import { cardsFromRequest } from "@/lib/card/server";

const bodySchema = z.object({
  provider: z.enum(["APPLE", "GOOGLE"]),
  cardId: z.string().min(1).max(64).optional(),
});

/**
 * Asks the backend for the add-to-wallet link of a card kept on this device. The wallet pass is signed by the
 * backend with credentials that never reach this app; this only relays the link, and only an https one.
 */
export async function POST(request: NextRequest) {
  const refused = refuseForeignRequest(request);
  if (refused) return refused;
  const body = await readBody(request, bodySchema);
  if (!body) return invalidRequest();

  const card = pickCard(await cardsFromRequest(request), body.cardId);
  if (!card) return plainError(404, "NOT_FOUND", "Card not found.");

  try {
    const link = await (await getServerApi()).card.createWalletLink(card.token, body.provider);
    if (link.url && !/^https:\/\//.test(link.url)) {
      return plainError(502, "BAD_WALLET_LINK", "The wallet link could not be used.");
    }
    return noStore(NextResponse.json({ kind: link.kind, url: link.url }));
  } catch (error) {
    return errorResponse(error);
  }
}
