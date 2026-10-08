import { describe, expect, it } from "vitest";
import type { Program } from "@/lib/api/contract";
import { en } from "@/lib/i18n/messages/en";
import { createTranslator } from "@/lib/i18n/translator";
import { seedPrograms } from "@/mocks/program-data";
import {
  BLANK_PROGRAM,
  LIMITS,
  createProgramSchema,
  hasChanges,
  memberVisibleFields,
  toCreateInput,
  toFormValues,
  toPatch,
  type ProgramFormValues,
} from "./program-form";

const schema = createProgramSchema(createTranslator({ messages: en, fallback: en }));
const valid: ProgramFormValues = {
  ...BLANK_PROGRAM,
  nameEn: "Coffee Card",
  rewardNameEn: "Free coffee",
};
const saved = (): Program => structuredClone(seedPrograms()[0]!);

function problems(values: Partial<ProgramFormValues>): Record<string, string> {
  const result = schema.safeParse({ ...valid, ...values });
  const out: Record<string, string> = {};
  if (!result.success) for (const i of result.error.issues) out[String(i.path[0])] ??= i.message;
  return out;
}

describe("validation follows the backend limits", () => {
  it("accepts a complete form and the exact limits", () => {
    expect(problems({})).toEqual({});
    expect(problems({ nameEn: "a".repeat(LIMITS.name) })).toEqual({});
    expect(problems({ stampsRequired: "1" })).toEqual({});
    expect(problems({ stampsRequired: "1000" })).toEqual({});
    expect(problems({ cooldownMinutes: "0" })).toEqual({});
    expect(problems({ cooldownMinutes: "10080" })).toEqual({});
    expect(problems({ validForDays: "3650" })).toEqual({});
    expect(problems({ termsEn: "x".repeat(LIMITS.terms) })).toEqual({});
  });

  it("requires an English name and an English reward", () => {
    expect(problems({ nameEn: "   " }).nameEn).toBe(en.program.errNameRequired);
    expect(problems({ rewardNameEn: "" }).rewardNameEn).toBe(en.program.errNameRequired);
  });

  it("refuses text that is too long, field by field", () => {
    expect(problems({ nameEn: "a".repeat(121) }).nameEn).toBe("Use 120 characters or fewer.");
    expect(problems({ rewardDescriptionEn: "a".repeat(401) }).rewardDescriptionEn).toBeTruthy();
    expect(problems({ termsAm: "a".repeat(2001) }).termsAm).toBeTruthy();
    expect(problems({ cardTitle: "a".repeat(41) }).cardTitle).toBe("Use 40 characters or fewer.");
    expect(problems({ cardSubtitle: "a".repeat(61) }).cardSubtitle).toBe(
      "Use 60 characters or fewer.",
    );
  });

  it.each(["0", "1001", "-3", "2.5", "abc", "", " "])("refuses %j stamps", (value) => {
    expect(problems({ stampsRequired: value }).stampsRequired).toBe(en.program.errStamps);
  });

  it.each(["-1", "10081", "1.5", "x", ""])("refuses %j minutes between stamps", (value) => {
    expect(problems({ cooldownMinutes: value }).cooldownMinutes).toBe(en.program.errCooldown);
  });

  it.each(["0", "3651", "1.2", "soon"])("refuses %j as the reward validity", (value) => {
    expect(problems({ validForDays: value }).validForDays).toBe(en.program.errDays);
  });

  it("lets the reward validity be empty (no expiry)", () => {
    expect(problems({ validForDays: "" })).toEqual({});
  });

  it.each(["red", "#fff", "#12345", "#GGGGGG", "1B5E3A"])("refuses the colour %j", (value) => {
    expect(problems({ brandColor: value }).brandColor).toBe(en.program.errColor);
  });

  it("accepts a six-digit colour in either case, or none", () => {
    expect(problems({ brandColor: "#1b5e3a" })).toEqual({});
    expect(problems({ brandColor: "#1B5E3A" })).toEqual({});
    expect(problems({ brandColor: "" })).toEqual({});
  });

  it("refuses an unknown stamp icon", () => {
    expect(problems({ stampIcon: "rocket" }).stampIcon).toBeTruthy();
    for (const icon of ["coffee", "star", "heart", "check", "gift"])
      expect(problems({ stampIcon: icon })).toEqual({});
  });
});

describe("toCreateInput", () => {
  it("sends trimmed text, numbers as numbers, and empty optional text as null", () => {
    const input = toCreateInput({
      ...valid,
      nameEn: "  Coffee Card  ",
      nameAm: "",
      termsEn: " ",
      validForDays: "",
    });
    expect(input).toMatchObject({
      nameEn: "Coffee Card",
      nameAm: null,
      termsEn: null,
      stampsRequired: 8,
      cooldownMinutes: 120,
      reward: { nameEn: "Free coffee", nameAm: null, validForDays: null },
    });
  });

  it("omits an empty colour and empty card text", () => {
    const input = toCreateInput({ ...valid, brandColor: "", cardTitle: "", cardSubtitle: "" });
    expect(input).not.toHaveProperty("brandColor");
    expect(input.cardDisplay).toEqual({ stampIcon: "coffee", showProgressText: true });
  });
});

describe("toPatch sends only what changed", () => {
  it("is empty when nothing changed", () => {
    expect(toPatch(toFormValues(saved()), saved())).toEqual({});
    expect(hasChanges({})).toBe(false);
  });

  it("includes just the edited field", () => {
    const values = { ...toFormValues(saved()), nameEn: "Coffee Club" };
    expect(toPatch(values, saved())).toEqual({ nameEn: "Coffee Club" });
  });

  it("groups reward edits and sends only the changed reward fields", () => {
    const values = { ...toFormValues(saved()), rewardNameAm: "ነጻ ማኪያቶ", validForDays: "30" };
    expect(toPatch(values, saved())).toEqual({ reward: { nameAm: "ነጻ ማኪያቶ", validForDays: 30 } });
  });

  it("clears an optional field with null, never with an empty string", () => {
    const values = { ...toFormValues(saved()), termsAm: "", nameAm: "" };
    expect(toPatch(values, saved())).toEqual({ termsAm: null, nameAm: null });
  });

  it("does not see a colour in different letter case as a change", () => {
    const values = { ...toFormValues(saved()), brandColor: "#1b5e3a" };
    expect(toPatch(values, saved())).toEqual({});
  });

  it("sends the whole card look when any part of it changes", () => {
    const values = { ...toFormValues(saved()), stampIcon: "gift" };
    expect(toPatch(values, saved()).cardDisplay).toEqual({
      title: "Coffee card",
      subtitle: "Sample Cafe",
      stampIcon: "gift",
      showProgressText: true,
    });
  });

  it("reports a changed stamp requirement, so the backend can refuse it when members exist", () => {
    const values = { ...toFormValues(saved()), stampsRequired: "10" };
    expect(toPatch(values, saved())).toEqual({ stampsRequired: 10 });
  });
});

describe("memberVisibleFields", () => {
  it("names what members would notice", () => {
    expect(memberVisibleFields({ nameEn: "x" })).toEqual(["program.fieldName"]);
    expect(memberVisibleFields({ reward: { nameEn: "x" } })).toEqual(["program.fieldReward"]);
    expect(memberVisibleFields({ termsAm: null })).toEqual(["program.fieldTerms"]);
    expect(memberVisibleFields({ brandColor: "#000000" })).toEqual(["program.fieldColor"]);
    expect(memberVisibleFields({ cardDisplay: {} })).toEqual(["program.fieldCard"]);
    expect(memberVisibleFields({ cooldownMinutes: 5 })).toEqual(["program.fieldCooldown"]);
  });

  it("lists several at once, and nothing for an empty patch", () => {
    expect(memberVisibleFields({ nameEn: "x", brandColor: null })).toHaveLength(2);
    expect(memberVisibleFields({})).toEqual([]);
  });
});
