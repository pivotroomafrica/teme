import { createAnalyticsApi } from "@/features/analytics/api";
import { createAuditApi } from "@/features/audit/api";
import { createAuthApi } from "@/features/auth/api";
import { createBranchesApi } from "@/features/branches/api";
import { createCampaignsApi } from "@/features/campaigns/api";
import { createCardApi } from "@/features/card/api";
import { createCustomersApi } from "@/features/customers/api";
import { createEnrollmentApi } from "@/features/enrollment/api";
import { createOperationsApi } from "@/features/operations/api";
import { createFraudApi } from "@/features/fraud/api";
import { createMerchantApi } from "@/features/merchant/api";
import { createMembershipsApi } from "@/features/memberships/api";
import { createPrivacyApi } from "@/features/privacy/api";
import { createProgramsApi } from "@/features/program/api";
import { createTeamApi } from "@/features/team/api";
import { createScannerApi } from "@/features/scanner/api";
import type { Transport } from "./http";

/** Every feature service on one transport. Live HTTP and the in-process mock plug in the same way. */
export function createApi(transport: Transport) {
  return {
    auth: createAuthApi(transport),
    enrollment: createEnrollmentApi(transport),
    card: createCardApi(transport),
    memberships: createMembershipsApi(transport),
    programs: createProgramsApi(transport),
    scanner: createScannerApi(transport),
    team: createTeamApi(transport),
    analytics: createAnalyticsApi(transport),
    audit: createAuditApi(transport),
    branches: createBranchesApi(transport),
    customers: createCustomersApi(transport),
    merchant: createMerchantApi(transport),
    fraud: createFraudApi(transport),
    campaigns: createCampaignsApi(transport),
    privacy: createPrivacyApi(transport),
    operations: createOperationsApi(transport),
  };
}
export type Api = ReturnType<typeof createApi>;

export { ApiError, isApiError } from "@/lib/errors/api-error";
export { newIdempotencyKey } from "./idempotency";
export type { Transport } from "./http";
