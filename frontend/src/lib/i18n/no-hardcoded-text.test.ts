import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src");
// Developer-only pages and the test files themselves are English by design.
const SKIP = [/\.test\.tsx?$/, /\/dev\//, /\/mocks\//];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

/** Words a person would read: JSX text between tags, or common text-bearing attributes with a plain string. */
const JSX_TEXT = />\s*([A-Za-z][A-Za-z ,.'!?-]{2,})\s*</g;
const ATTRIBUTE = /\b(?:aria-label|title|placeholder|alt)="([A-Za-z][^"{}]*)"/g;

describe("user-facing text", () => {
  it("lives in the dictionaries, not in feature components", () => {
    const offenders: string[] = [];
    for (const file of files(ROOT)) {
      const posix = file.replaceAll("\\", "/");
      if (SKIP.some((pattern) => pattern.test(posix))) continue;
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of [JSX_TEXT, ATTRIBUTE]) {
        for (const match of source.matchAll(pattern)) {
          const text = match[1]!.trim();
          // Generic type arguments and comparisons such as `Array<string>` look like text to a regex.
          if (/^[A-Z][A-Za-z]*$/.test(text) && !text.includes(" ")) continue;
          offenders.push(`${relative(ROOT, file)}: "${text}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the text scan itself", () => {
  it("would catch a hardcoded label", () => {
    expect([..."<button>Save changes</button>".matchAll(JSX_TEXT)]).toHaveLength(1);
    expect([...'<input aria-label="Phone number" />'.matchAll(ATTRIBUTE)]).toHaveLength(1);
    expect(files(ROOT).length).toBeGreaterThan(20);
  });
});
