import { merchantProfileSchema, parseWith, type MerchantProfile } from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

/** The signed-in merchant's own business. Needs merchant:read (owners and managers). */
export function createMerchantApi(transport: Transport) {
  return {
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
