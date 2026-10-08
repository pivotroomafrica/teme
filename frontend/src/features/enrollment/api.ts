import {
  enrollmentResultSchema,
  joinInfoSchema,
  parseWith,
  type EnrollmentResult,
  type JoinInfo,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";
import type { RequestBody } from "@/lib/api/types";

export type EnrollInput = RequestBody<"/join/{joinReference}/enroll", "post">;

/** Public customer enrollment. No authentication; the join reference is the public link identifier. */
export function createEnrollmentApi(transport: Transport) {
  return {
    /** What a join page shows. An unknown, suspended or not-joinable link all answer the same 404. */
    getJoinInfo: (joinReference: string, signal?: AbortSignal) =>
      transport.request<JoinInfo>({
        method: "GET",
        path: "/join/{joinReference}",
        pathParams: { joinReference },
        signal,
        parse: parseWith(joinInfoSchema),
      }),

    /**
     * Creates a membership (status CREATED, card token returned once) or reports that the number already
     * belongs to a member of THIS business (EXISTING, no token). Never sent twice automatically.
     */
    enroll: (joinReference: string, input: EnrollInput, signal?: AbortSignal) =>
      transport.request<EnrollmentResult>({
        method: "POST",
        path: "/join/{joinReference}/enroll",
        pathParams: { joinReference },
        body: input,
        signal,
        parse: parseWith(enrollmentResultSchema),
      }),
  };
}
export type EnrollmentApi = ReturnType<typeof createEnrollmentApi>;
