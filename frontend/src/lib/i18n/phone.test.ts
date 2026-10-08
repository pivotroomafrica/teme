import { describe, expect, it } from "vitest";
import {
  formatEthiopianPhone,
  isEthiopianE164,
  maskEthiopianPhone,
  normalizeEthiopianPhone,
} from "./phone";

describe("normalizeEthiopianPhone", () => {
  it.each([
    ["0911234567", "+251911234567"],
    ["911234567", "+251911234567"],
    ["251911234567", "+251911234567"],
    ["+251 91 123 4567", "+251911234567"],
    ["00251911234567", "+251911234567"],
    ["(091) 123-4567", "+251911234567"],
    ["0711234567", "+251711234567"],
    ["0111234567", "+251111234567"],
  ])("reads %s", (input, expected) => {
    expect(normalizeEthiopianPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "091123456",
    "09112345678",
    "+254711234567",
    "0611234567",
    "0811234567",
    "+2519112345x7",
  ])("rejects %j", (input) => {
    expect(normalizeEthiopianPhone(input)).toBeNull();
  });
});

describe("presentation", () => {
  it("shows national and international styles", () => {
    expect(formatEthiopianPhone("+251911234567")).toBe("091 123 4567");
    expect(formatEthiopianPhone("0911234567", "international")).toBe("+251 91 123 4567");
    expect(formatEthiopianPhone("0111234567")).toBe("011 123 4567");
  });

  it("returns input it cannot read unchanged instead of guessing", () => {
    expect(formatEthiopianPhone("12345")).toBe("12345");
  });

  it("hides the middle of a number", () => {
    expect(maskEthiopianPhone("0911234567")).toBe("091 ••• 4567");
    expect(maskEthiopianPhone("0911234567", "international")).toBe("+251 91 ••• 4567");
    expect(maskEthiopianPhone("nope")).toBe("•••");
  });

  it("recognises canonical numbers", () => {
    expect(isEthiopianE164("+251911234567")).toBe(true);
    expect(isEthiopianE164("0911234567")).toBe(false);
  });
});
