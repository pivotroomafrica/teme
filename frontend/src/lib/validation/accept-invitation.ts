import { z } from "zod";
import type { Translate } from "@/lib/i18n/translator";

/** Mirrors the backend's rule for a new password: 12 to 128 characters with a letter and a digit. */
export function createAcceptInvitationSchema(t: Translate) {
  return z
    .object({
      token: z.string().trim().min(1, t("auth.acceptCodeRequired")).max(512),
      password: z
        .string()
        .min(12, t("auth.acceptPasswordShort"))
        .max(128, t("auth.acceptPasswordLong"))
        .refine((v) => /\p{L}/u.test(v) && /\d/.test(v), t("auth.acceptPasswordNeeds")),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      path: ["confirm"],
      message: t("auth.acceptMismatch"),
    });
}
export type AcceptInvitationValues = z.infer<ReturnType<typeof createAcceptInvitationSchema>>;
