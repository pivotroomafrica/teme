import { describe, expect, it, vi } from "vitest";
import { am } from "./messages/am";
import { en } from "./messages/en";
import { createTranslator, pickNamespaces } from "./translator";

function keys(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("dictionaries", () => {
  it("define exactly the same keys in English and Amharic", () => {
    expect(keys(am).sort()).toEqual(keys(en).sort());
  });

  it("never leave an Amharic value empty", () => {
    for (const key of keys(am)) {
      const value = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], am);
      expect((value as string).trim()).not.toBe("");
    }
  });
});

describe("createTranslator", () => {
  it("returns the active language", () => {
    const t = createTranslator({ messages: am, fallback: en });
    expect(t("errors.notFoundTitle")).toBe(am.errors.notFoundTitle);
  });

  it("falls back to English for a missing key and reports it", () => {
    const onMissing = vi.fn();
    const t = createTranslator({ messages: { common: {} }, fallback: en, onMissing });
    expect(t("common.retry")).toBe("Try again");
    expect(onMissing).toHaveBeenCalledWith("common.retry");
  });

  it("does not report keys that exist", () => {
    const onMissing = vi.fn();
    createTranslator({ messages: en, fallback: en, onMissing })("common.retry");
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    const t = createTranslator({
      messages: { common: { retry: "Hi {name}, {missing}" } },
      fallback: en,
    });
    expect(t("common.retry", { name: "Abebe" })).toBe("Hi Abebe, {missing}");
  });
});

describe("pickNamespaces", () => {
  it("sends only the requested namespaces to the browser", () => {
    expect(Object.keys(pickNamespaces(en, ["common", "errors"]))).toEqual(["common", "errors"]);
  });
});
