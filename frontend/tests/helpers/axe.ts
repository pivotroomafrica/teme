import axe from "axe-core";
import { expect } from "vitest";

/**
 * Runs axe-core on rendered DOM. jsdom has no layout engine, so colour contrast is excluded here and
 * verified in the browser tests instead (tests/e2e/design-system.spec.ts).
 */
export async function expectNoA11yViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
  });
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}
