import { z } from "zod";
import { normalizeEthiopianPhone } from "@/lib/i18n/phone";
import type { Translate } from "@/lib/i18n/translator";

/** Same character rule as the backend (`SAFE_NAME`): letters, marks, numbers, space and . ' ’ / - */
const SAFE_NAME = /^[\p{L}\p{M}\p{N} .'’/-]+$/u;

/**
 * Customer enrollment form. Two consents are separate on purpose: accepting the program terms is required,
 * marketing messages are an optional, unticked opt-in. The phone number is sent in its canonical +251 form;
 * the backend normalizes it again and stays the authority.
 */
export function createEnrollmentSchema(t: Translate) {
  return z.object({
    firstName: z
      .string()
      .trim()
      .min(1, t("enrollment.firstNameRequired"))
      .max(60, t("enrollment.nameTooLong"))
      .regex(SAFE_NAME, t("enrollment.nameCharacters")),
    phone: z
      .string()
      .trim()
      .min(1, t("enrollment.phoneRequired"))
      .refine((v) => v === "" || normalizeEthiopianPhone(`+251${stripCountryCode(v)}`) !== null, {
        message: t("enrollment.phoneInvalid"),
      }),
    acceptTerms: z
      .boolean()
      .refine((v) => v === true, { message: t("enrollment.consentRequired") }),
    marketingConsent: z.boolean(),
  });
}
export type EnrollmentValues = z.infer<ReturnType<typeof createEnrollmentSchema>>;

/** The field shows "+251" already; people may still type 0911…, 911… or paste +251 911…. */
function stripCountryCode(raw: string): string {
  const compact = raw.replace(/[\s\-.()]/g, "");
  return compact.replace(/^(?:\+|00)?251/, "").replace(/^0/, "");
}

/** The number to send: always `+251` followed by the nine national digits (or the raw text if unreadable). */
export function toE164(raw: string): string {
  return normalizeEthiopianPhone(`+251${stripCountryCode(raw)}`) ?? raw;
}
