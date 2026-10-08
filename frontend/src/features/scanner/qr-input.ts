import { CARD_TOKEN } from "@/lib/card/cards";

/**
 * What the scanner accepts from a QR code or the keyboard: only a plain card token. Any other text (a menu link,
 * a Wi-Fi code, a phone number) is not sent to the backend at all, so arbitrary scanned content never leaves the
 * phone. Whether a well-formed token is a real card of this business is the backend's decision.
 */
export function parseScannedCode(text: string): string | null {
  const trimmed = text.trim();
  // A run of digits is a phone number typed into the wrong box, never a card: keep it on the phone.
  if (/^\+?\d+$/.test(trimmed)) return null;
  return CARD_TOKEN.test(trimmed) ? trimmed : null;
}

let decoder: Promise<typeof import("jsqr")> | undefined;

/**
 * Reads a QR code out of one camera frame, or returns null. The decoder is loaded the first time the camera is
 * used, so the page itself stays light. The frame is only inspected, never stored or sent anywhere.
 */
export async function decodeQrFrame(frame: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): Promise<string | null> {
  decoder ??= import("jsqr");
  const { default: jsQR } = await decoder;
  const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
  return found?.data ?? null;
}
