import { describe, expect, it } from "vitest";
import type { Branch } from "@/lib/api/contract";
import { en } from "@/lib/i18n/messages/en";
import { createTranslator } from "@/lib/i18n/translator";
import {
  BLANK_BRANCH,
  branchToForm,
  createBranchSchema,
  toBranchInput,
  toBranchPatch,
} from "./branch-form";

const schema = createBranchSchema(createTranslator({ messages: en, fallback: en }));
const saved: Branch = {
  id: "b1",
  nameEn: "Bole",
  nameAm: "ቦሌ",
  addressText: "Bole Road",
  city: "Addis Ababa",
  phoneE164: "+251911234567",
  status: "ACTIVE",
};
const problems = (over: object) => {
  const r = schema.safeParse({ ...BLANK_BRANCH, nameEn: "Bole", ...over });
  const out: Record<string, string> = {};
  if (!r.success) for (const i of r.error.issues) out[String(i.path[0])] ??= i.message;
  return out;
};

describe("branch form", () => {
  it("needs a name and respects the backend's limits", () => {
    expect(problems({})).toEqual({});
    expect(problems({ nameEn: " " }).nameEn).toBe(en.branches.errName);
    expect(problems({ nameEn: "x".repeat(121) }).nameEn).toBe("Use 120 characters or fewer.");
    expect(problems({ addressText: "x".repeat(301) }).addressText).toBeTruthy();
    expect(problems({ city: "x".repeat(81) }).city).toBeTruthy();
  });

  it("accepts any common Ethiopian phone format, or none, and refuses the rest", () => {
    for (const phone of ["", "0911234567", "+251 91 123 4567", "011 123 4567"])
      expect(problems({ phone })).toEqual({});
    for (const phone of ["12345", "0611234567", "abc"])
      expect(problems({ phone }).phone).toBe(en.branches.errPhone);
  });

  it("shows a saved branch the way people write its number", () => {
    expect(branchToForm(saved).phone).toBe("0911234567");
    expect(branchToForm({ ...saved, phoneE164: null, nameAm: null }).nameAm).toBe("");
  });

  it("turns empty optional text into null", () => {
    expect(toBranchInput({ ...BLANK_BRANCH, nameEn: " Piassa " })).toEqual({
      nameEn: "Piassa",
      nameAm: null,
      addressText: null,
      city: null,
      phone: null,
    });
  });

  it("sends nothing when nothing changed, even if the number is written differently", () => {
    expect(toBranchPatch(branchToForm(saved), saved)).toEqual({});
    expect(toBranchPatch({ ...branchToForm(saved), phone: "+251 91 123 4567" }, saved)).toEqual({});
  });

  it("sends only what changed, and null to clear", () => {
    expect(toBranchPatch({ ...branchToForm(saved), city: "" }, saved)).toEqual({ city: null });
    expect(
      toBranchPatch({ ...branchToForm(saved), nameEn: "Bole 2", phone: "0922000000" }, saved),
    ).toEqual({
      nameEn: "Bole 2",
      phone: "0922000000",
    });
  });
});
