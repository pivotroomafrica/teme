import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage, resolveLocale, splitLocale } from "./resolve-locale";

describe("localeFromAcceptLanguage", () => {
  it("honours quality weights and regions", () => {
    expect(localeFromAcceptLanguage("am-ET,am;q=0.9,en;q=0.5")).toBe("am");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,am;q=0.2")).toBe("en");
    expect(localeFromAcceptLanguage("fr;q=0.9,am;q=0.8")).toBe("am");
    expect(localeFromAcceptLanguage("am;q=0,en;q=0.1")).toBe("en");
  });

  it("returns undefined when nothing matches", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.8")).toBeUndefined();
    expect(localeFromAcceptLanguage("")).toBeUndefined();
    expect(localeFromAcceptLanguage(null)).toBeUndefined();
  });
});

describe("resolveLocale", () => {
  it("prefers the saved cookie, then the browser, then English", () => {
    expect(resolveLocale({ cookie: "am", acceptLanguage: "en" })).toBe("am");
    expect(resolveLocale({ cookie: "xx", acceptLanguage: "am" })).toBe("am");
    expect(resolveLocale({})).toBe("en");
  });
});

describe("splitLocale", () => {
  it("separates a language prefix from the rest of the path", () => {
    expect(splitLocale("/am/dashboard/team")).toEqual({ locale: "am", rest: "/dashboard/team" });
    expect(splitLocale("/en")).toEqual({ locale: "en", rest: "/" });
    expect(splitLocale("/en/")).toEqual({ locale: "en", rest: "/" });
    expect(splitLocale("/dashboard")).toEqual({ locale: undefined, rest: "/dashboard" });
    expect(splitLocale("/english")).toEqual({ locale: undefined, rest: "/english" });
  });
});
