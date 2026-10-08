import { parseWith, programListSchema, programSchema, type Program } from "@/lib/api/contract";
import type { Transport } from "@/lib/api/http";

export interface RewardInput {
  nameEn: string;
  nameAm?: string | null;
  descriptionEn?: string | null;
  descriptionAm?: string | null;
  /** Days an unlocked reward stays redeemable; null for no expiry. */
  validForDays?: number | null;
}

export interface CardDisplayInput {
  title?: string;
  subtitle?: string;
  stampIcon?: string;
  showProgressText?: boolean;
}

export interface CreateProgramInput {
  nameEn: string;
  nameAm?: string | null;
  termsEn?: string | null;
  termsAm?: string | null;
  stampsRequired?: number;
  cooldownMinutes?: number;
  brandColor?: string;
  cardDisplay?: CardDisplayInput;
  reward: RewardInput;
}

/** A partial update: only the fields that changed. `stampsRequired` is refused once customers have joined. */
export interface UpdateProgramInput {
  nameEn?: string;
  nameAm?: string | null;
  termsEn?: string | null;
  termsAm?: string | null;
  stampsRequired?: number;
  cooldownMinutes?: number;
  brandColor?: string | null;
  cardDisplay?: CardDisplayInput;
  reward?: Partial<RewardInput>;
}

/**
 * Loyalty programs. Reading needs `program:read`; creating, editing and every status change need
 * `program:manage`. The backend owns every rule (limits, the locked stamp count, the one default program, the
 * allowed status moves) and answers a refused request with a coded 4xx; the browser never assumes one will pass.
 */
export function createProgramsApi(transport: Transport) {
  const one = (path: string, method: "POST" | "PATCH", body: unknown, id?: string) =>
    transport.request<Program>({
      method,
      path,
      pathParams: id ? { programId: id } : undefined,
      body,
      parse: parseWith(programSchema),
    });

  return {
    list: (signal?: AbortSignal) =>
      transport.request<Program[]>({
        method: "GET",
        path: "/merchant/programs",
        signal,
        parse: parseWith(programListSchema),
      }),

    /** Creates a DRAFT. It does not accept customers until it is activated. */
    create: (input: CreateProgramInput) => one("/merchant/programs", "POST", input),

    update: (id: string, patch: UpdateProgramInput) =>
      one("/merchant/programs/{programId}", "PATCH", patch, id),

    /** DRAFT or PAUSED to ACTIVE; the program new customers join. Idempotent. */
    activate: (id: string) => one("/merchant/programs/{programId}/activate", "POST", {}, id),

    /** ACTIVE to PAUSED: no new customers; members and history untouched. Idempotent. */
    pause: (id: string) => one("/merchant/programs/{programId}/pause", "POST", {}, id),

    /** Any state to ARCHIVED, which is final. Nothing is deleted. Idempotent. */
    archive: (id: string) => one("/merchant/programs/{programId}/archive", "POST", {}, id),
  };
}
export type ProgramsApi = ReturnType<typeof createProgramsApi>;
