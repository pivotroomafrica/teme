import QRCode from "qrcode";

/**
 * The membership QR code as an SVG string. It encodes exactly the opaque value the backend supplied and
 * nothing else: no name, phone number, business or program information, and nothing computed in the browser.
 * Generated on the server, so no QR library is sent to the phone and the code appears with the first byte.
 * Black on white with a quiet zone, because scanners read high contrast best (dark mode does not change it).
 */
export function qrSvg(value: string): Promise<string> {
  return QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
