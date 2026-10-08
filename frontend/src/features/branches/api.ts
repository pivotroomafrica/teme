import { branchListSchema, branchSchema, parseWith, type Branch } from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

export type { Branch };

export interface BranchInput {
  nameEn: string;
  nameAm?: string | null;
  addressText?: string | null;
  city?: string | null;
  /** Any common Ethiopian format; the backend stores it as +251… */
  phone?: string | null;
}

/**
 * Branch operations. Owners and managers see every branch (inactive ones too); branch staff see only the active
 * branches they are assigned to. Changing branches needs `branch:manage`, and the backend (not this client) enforces
 * it, along with "a business always keeps at least one active branch".
 */
export function createBranchesApi(transport: Transport) {
  const one = (
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
    id?: string,
  ): Promise<Branch> =>
    transport.request<Branch>({
      method,
      path,
      pathParams: id ? { branchId: id } : undefined,
      body,
      parse: parseWith(branchSchema),
    });

  return {
    list: (signal?: AbortSignal) =>
      transport.request<Branch[]>({
        method: "GET",
        path: "/merchant/branches",
        signal,
        parse: parseWith(branchListSchema),
      }),
    create: (input: BranchInput) => one("POST", "/merchant/branches", input),
    /** Only the fields that changed; `null` clears an optional field. */
    update: (id: string, patch: Partial<BranchInput>) =>
      one("PATCH", "/merchant/branches/{branchId}", patch, id),
    /** History is kept; assigned staff stop being able to operate there. The last active branch is refused. */
    deactivate: (id: string) => one("POST", "/merchant/branches/{branchId}/deactivate", {}, id),
    activate: (id: string) => one("POST", "/merchant/branches/{branchId}/activate", {}, id),
  };
}
export type BranchesApi = ReturnType<typeof createBranchesApi>;
