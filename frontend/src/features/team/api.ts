import {
  invitedStaffSchema,
  parseWith,
  staffActivitySchema,
  staffListSchema,
  staffSchema,
  type InvitedStaff,
  type MerchantRole,
  type Staff,
  type StaffActivity,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

export interface InviteInput {
  email: string;
  displayName: string;
  role: MerchantRole;
  /** At least one for branch staff; owners and managers may have none (they work at every branch). */
  branchIds: string[];
  preferredLanguage?: "EN" | "AM";
}

/**
 * The team. Listing and reading activity need `staff:read`; everything else needs `staff:manage` (owners manage
 * everyone, managers only branch staff). The backend also guarantees the safety rules: nobody changes their own
 * role, branches or status, and the last active owner can be neither demoted nor deactivated. Those arrive as coded
 * refusals, never as something the browser assumes.
 */
export function createTeamApi(transport: Transport) {
  const member = (
    method: "POST" | "PUT" | "PATCH",
    path: string,
    id: string,
    body: unknown = {},
  ): Promise<Staff> =>
    transport.request<Staff>({
      method,
      path,
      pathParams: { staffId: id },
      body,
      parse: parseWith(staffSchema),
    });

  return {
    list: (signal?: AbortSignal) =>
      transport.request<Staff[]>({
        method: "GET",
        path: "/merchant/staff",
        signal,
        parse: parseWith(staffListSchema),
      }),

    /** Creates an INVITED account and returns the one-time token. Email is not sent: the inviter hands it over. */
    invite: (input: InviteInput) =>
      transport.request<InvitedStaff>({
        method: "POST",
        path: "/merchant/staff",
        body: input,
        parse: parseWith(invitedStaffSchema),
      }),

    /** A new one-time token; the previous link stops working. Only for people who have not accepted yet. */
    reissueInvitation: (id: string) =>
      transport.request<InvitedStaff["invitation"]>({
        method: "POST",
        path: "/merchant/staff/{staffId}/invitation",
        pathParams: { staffId: id },
        body: {},
        parse: (data) => parseWith(invitedStaffSchema.shape.invitation)(data),
      }),

    changeRole: (id: string, role: MerchantRole) =>
      member("PATCH", "/merchant/staff/{staffId}/role", id, { role }),

    /** Replaces the whole set of branches. */
    setBranches: (id: string, branchIds: string[]) =>
      member("PUT", "/merchant/staff/{staffId}/branches", id, { branchIds }),

    activate: (id: string) => member("POST", "/merchant/staff/{staffId}/activate", id),
    deactivate: (id: string) => member("POST", "/merchant/staff/{staffId}/deactivate", id),

    activity: (id: string, input: { limit?: number; cursor?: string } = {}, signal?: AbortSignal) =>
      transport.request<StaffActivity>({
        method: "GET",
        path: "/merchant/staff/{staffId}/activity",
        pathParams: { staffId: id },
        query: { limit: input.limit ?? 10, cursor: input.cursor },
        signal,
        parse: parseWith(staffActivitySchema),
      }),
  };
}
export type TeamApi = ReturnType<typeof createTeamApi>;
