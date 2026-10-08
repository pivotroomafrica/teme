import { customerPageSchema, parseWith, type CustomerPage } from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

/** Customer operations. Always scoped to the signed-in account's own business by the backend. */
export function createCustomersApi(transport: Transport) {
  return {
    /**
     * Finds customers by phone number (any common Ethiopian format). Branch staff see masked numbers and must
     * search with the complete number; owners and managers can also search by 4 or more digits.
     */
    search: (input: { q: string; limit?: number; cursor?: string }, signal?: AbortSignal) =>
      transport.request<CustomerPage>({
        method: "GET",
        path: "/merchant/customers",
        query: { q: input.q, limit: input.limit ?? 5, cursor: input.cursor },
        signal,
        parse: parseWith(customerPageSchema),
      }),
  };
}
export type CustomersApi = ReturnType<typeof createCustomersApi>;
