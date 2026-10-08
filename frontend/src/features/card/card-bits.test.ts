import { describe, expect, it } from "vitest";
import { tokenFromHash } from "./components/card-claim";
import { qrSvg } from "./qr";

describe("tokenFromHash", () => {
  it("reads a card token from the address fragment", () => {
    expect(tokenFromHash("#t=mock-ok-1-4567")).toBe("mock-ok-1-4567");
    expect(tokenFromHash("#t=abc.def_ghi~jkl-123")).toBe("abc.def_ghi~jkl-123");
  });

  it("decodes an encoded token", () => {
    expect(tokenFromHash("#t=token%2Dvalue%2D1234")).toBe("token-value-1234");
  });

  it.each([
    "",
    "#",
    "#x=mock-ok-1-4567",
    "#t=",
    "#t=short",
    "#t=<script>alert(1)</script>",
    "#t=a b c d e f g h i",
    "#t=%E0%A4%A",
    "#t=mock-ok-1-4567&x=1",
    "#t=a%2Fb%2Fc%2Fd%2Fe%2Ff",
  ])("ignores %j", (hash) => {
    expect(tokenFromHash(hash)).toBeNull();
  });
});

describe("qrSvg", () => {
  it("makes an SVG that carries only what it is given", async () => {
    const svg = await qrSvg("opaque-card-token-1234567890");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("opaque-card-token");
    expect(svg).not.toContain("<script");
    expect(svg).toContain("#ffffff");
    expect(svg).toContain("#000000");
  });

  it("makes different codes for different values", async () => {
    expect(await qrSvg("token-aaaaaaaa")).not.toBe(await qrSvg("token-bbbbbbbb"));
  });
});
