import { z } from "zod";
import type { Translate } from "@/lib/i18n/translator";

/**
 * Sign-in form rules. Deliberately light: the server decides whether credentials are right. The form only
 * catches empty and obviously malformed input so people get immediate, translated help. There is no password
 * strength rule here (that belongs to account creation, and the backend enforces it).
 */
export function createLoginSchema(t: Translate) {
  return z.object({
    email: z
      .string()
      .trim()
      .min(1, t("auth.emailRequired"))
      .max(254, t("auth.emailInvalid"))
      .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), t("auth.emailInvalid")),
    password: z.string().min(1, t("auth.passwordRequired")).max(256),
  });
}
export type LoginValues = z.infer<ReturnType<typeof createLoginSchema>>;
