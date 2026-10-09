import { merchantProfileSchema, parseWith, type MerchantProfile } from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

export interface ProfilePatch {
  nameEn?: string;
  nameAm?: string | null;
  timezone?: string;
  defaultLanguage?: "EN" | "AM";
  supportEmail?: string | null;
  supportPhone?: string | null;
  defaultStampsRequired?: number;
  defaultCooldownMinutes?: number;
}

/** The signed-in merchant's own business. Needs merchant:read (owners and managers). */
export function createMerchantApi(transport: Transport) {
  return {
    /**
     * Partial update (needs `merchant:update`): only the fields given change, `null` clears an optional one. The
     * backend validates the time zone, the contact details and the program defaults; a refusal is shown in words.
     */
    updateProfile: (patch: ProfilePatch) =>
      transport.request<MerchantProfile>({
        method: "PATCH",
        path: "/merchant/profile",
        body: patch,
        parse: parseWith(merchantProfileSchema),
      }),

    getProfile: (signal?: AbortSignal) =>
      transport.request<MerchantProfile>({
        method: "GET",
        path: "/merchant/profile",
        signal,
        parse: parseWith(merchantProfileSchema),
      }),
  };
}
export type MerchantApi = ReturnType<typeof createMerchantApi>;
