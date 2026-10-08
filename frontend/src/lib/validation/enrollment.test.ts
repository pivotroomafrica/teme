import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translator";
import { en } from "@/lib/i18n/messages/en";
import { createEnrollmentSchema, toE164 } from "./enrollment";

const schema = createEnrollmentSchema(createTranslator({ messages: en, fallback: en }));
const valid = {
  firstName: "Abebe",
  phone: "0911 234 567",
  acceptTerms: true,
  marketingConsent: false,
};

function problems(input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  if (result.success) return {};
  const out: Record<string, string> = {};
  // The form shows the first problem per field.
  for (const issue of result.error.issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}

describe("enrollment form rules", () => {
  it("accepts a complete form", () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each([
    "0911234567",
    "911234567",
    "+251 911 234 567",
    "251911234567",
    "00251911234567",
    "091-123-4567",
  ])("accepts the phone number written as %s", (phone) => {
    expect(problems({ ...valid, phone })).toEqual({});
  });

  it.each(["", "abc", "0611234567", "91123456", "+254711234567", "09112345678"])(
    "rejects the phone number %j",
    (phone) => {
      expect(problems({ ...valid, phone }).phone).toBeTruthy();
    },
  );

  it("asks for a name and keeps it plain", () => {
    expect(problems({ ...valid, firstName: "   " }).firstName).toBe(
      en.enrollment.firstNameRequired,
    );
    expect(problems({ ...valid, firstName: "<script>" }).firstName).toBe(
      en.enrollment.nameCharacters,
    );
    expect(problems({ ...valid, firstName: "a".repeat(61) }).firstName).toBe(
      en.enrollment.nameTooLong,
    );
    expect(problems({ ...valid, firstName: "አበበ" })).toEqual({});
    expect(problems({ ...valid, firstName: "Mary-Ann O'Neil" })).toEqual({});
  });

  it("requires the program terms but never the marketing opt-in", () => {
    expect(problems({ ...valid, acceptTerms: false }).acceptTerms).toBe(
      en.enrollment.consentRequired,
    );
    expect(problems({ ...valid, marketingConsent: false })).toEqual({});
  });
});

describe("toE164", () => {
  it("sends one canonical form whatever was typed", () => {
    for (const typed of [
      "0911234567",
      "911 234 567",
      "+251911234567",
      "251-911-234-567",
      "00251911234567",
    ]) {
      expect(toE164(typed)).toBe("+251911234567");
    }
  });
});
