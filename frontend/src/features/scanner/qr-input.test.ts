import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { decodeQrFrame, parseScannedCode } from "./qr-input";

/** Draws a QR code into RGBA pixels the way a camera frame would hold it. */
function frameFor(text: string, scale = 6, quiet = 4) {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  const side = (size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
      }
    }
  }
  return { data: pixels, width: side, height: side };
}

describe("decodeQrFrame", () => {
  it("reads a card token out of a camera-like frame", async () => {
    const token = "q8Zr2vNn-3Kx_4tLw.Y9aBcD~eFgHiJkLmNoPqRsT";
    expect(await decodeQrFrame(frameFor(token))).toBe(token);
  });

  it("returns nothing for a frame with no code in it", async () => {
    const blank = { data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 };
    expect(await decodeQrFrame(blank)).toBeNull();
  });
});

describe("parseScannedCode", () => {
  it("accepts a plain card token, trimmed", () => {
    expect(parseScannedCode("  mock-ok-1-4567 \n")).toBe("mock-ok-1-4567");
  });

  it.each([
    "",
    "short",
    "https://example.com/menu",
    "WIFI:T:WPA;S:Cafe;P:secret;;",
    "0911234567",
    "<script>alert(1)</script>",
    "has spaces inside it",
    "x".repeat(300),
  ])("never lets %j reach the backend", (text) => {
    expect(parseScannedCode(text)).toBeNull();
  });
});
