import {
  customerPageSchema,
  customerSchema,
  parseWith,
  type Customer,
  type CustomerPage,
} from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

/** Customer operations. Always scoped to the signed-in account's own business by the backend. */
export function createCustomersApi(transport: Transport) {
  return {
    /**
     * One page of customers, newest first. `q` is a complete phone number in any common format, 4 or more digits
     * (owners and managers), or part of a first name (2 or more characters). Branch staff see masked numbers and
     * must give a complete one. Pages are followed by cursor.
     */
    list: (input: { q?: string; limit?: number; cursor?: string } = {}, signal?: AbortSignal) =>
      transport.request<CustomerPage>({
        method: "GET",
        path: "/merchant/customers",
        query: { q: input.q || undefined, limit: input.limit ?? 10, cursor: input.cursor },
        signal,
        parse: parseWith(customerPageSchema),
      }),

    /** Records that the customer no longer agrees to marketing messages (needs customer:manage). */
    withdrawMarketing: (customerId: string) =>
      transport.request<Customer>({
        method: "POST",
        path: "/merchant/customers/{customerId}/consents/marketing/withdraw",
        pathParams: { customerId },
        parse: parseWith(customerSchema),
      }),

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
