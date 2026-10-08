import { describe, expect, it } from "vitest";
import { am } from "./am";
import { en } from "./en";

function flatten(node: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const english = flatten(en);
const amharic = flatten(am);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Brand and technical words that are legitimately identical in both languages.
const SAME_IN_BOTH = new Set(["common.appName", "wallet.addApple", "wallet.addGoogle"]);

describe("dictionaries", () => {
  it("have exactly the same keys", () => {
    expect(Object.keys(amharic).sort()).toEqual(Object.keys(english).sort());
  });

  it("have no empty text", () => {
    for (const [key, value] of [...Object.entries(english), ...Object.entries(amharic)]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("use the same {placeholders} in both languages", () => {
    for (const key of Object.keys(english)) {
      expect(placeholders(amharic[key]!), key).toEqual(placeholders(english[key]!));
    }
  });

  it("are really translated, not copied from English", () => {
    const untranslated = Object.keys(english).filter(
      (key) =>
        amharic[key] === english[key] &&
        !SAME_IN_BOTH.has(key) &&
        /[A-Za-z]{4,}/.test(english[key]!),
    );
    // Short shared words (e.g. "Menu") are fine; whole sentences are not.
    expect(untranslated.filter((key) => english[key]!.split(" ").length > 2)).toEqual([]);
  });

  it("covers the core vocabulary groups", () => {
    for (const group of [
      "nav",
      "auth",
      "enrollment",
      "scanner",
      "wallet",
      "loyalty",
      "reward",
      "errors",
      "confirm",
    ]) {
      expect(
        Object.keys(english).some((key) => key.startsWith(`${group}.`)),
        group,
      ).toBe(true);
    }
  });
});
