import { z } from "zod";
import type { MerchantRole, Staff } from "@/lib/api/contract";
import type { Translate } from "@/lib/i18n/translator";

/**
 * What the team screen SHOWS as possible. These rules only decide which buttons are offered and what is explained
 * up front; they are not authorization. The backend re-checks every request with the real rules (owners manage
 * everyone, managers only branch staff, nobody changes themselves, the last active owner is protected), and its
 * refusal is always displayed. A button being enabled never means the change will be accepted.
 */
export interface Actor {
  userId: string;
  role: MerchantRole | string;
}

const RANK: Record<MerchantRole, number> = { OWNER: 3, MANAGER: 2, STAFF: 1 };

export function isSelf(actor: Actor, target: Staff): boolean {
  return actor.userId === target.id;
}

/** Whether to offer management actions for this person at all. */
export function canManageMember(actor: Actor, target: Staff, canManage: boolean): boolean {
  if (!canManage || isSelf(actor, target)) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "MANAGER") return target.roleKey === "STAFF";
  return false;
}

/** The roles this actor can hand out. */
export function grantableRoles(actor: Actor): MerchantRole[] {
  if (actor.role === "OWNER") return ["OWNER", "MANAGER", "STAFF"];
  if (actor.role === "MANAGER") return ["STAFF"];
  return [];
}

export const isLastActiveOwner = (team: readonly Staff[], target: Staff): boolean =>
  target.roleKey === "OWNER" &&
  target.status === "ACTIVE" &&
  team.filter((s) => s.roleKey === "OWNER" && s.status === "ACTIVE").length <= 1;

/** A role change that lowers access (so it is confirmed with extra care). */
export const isDemotion = (from: MerchantRole, to: MerchantRole) => RANK[to] < RANK[from];

export function createInviteSchema(t: Translate) {
  return z
    .object({
      email: z
        .string()
        .trim()
        .max(254, t("team.errTooLong", { max: 254 }))
        .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, t("team.errEmail")),
      displayName: z
        .string()
        .max(120, t("team.errTooLong", { max: 120 }))
        .refine((v) => v.trim().length > 0, t("team.errName")),
      role: z.enum(["OWNER", "MANAGER", "STAFF"]),
      branchIds: z.array(z.string()),
      preferredLanguage: z.enum(["EN", "AM"]),
    })
    .superRefine((value, ctx) => {
      if (value.role === "STAFF" && value.branchIds.length === 0) {
        ctx.addIssue({ code: "custom", path: ["branchIds"], message: t("team.branchesNeedOne") });
      }
    });
}
export type InviteFormValues = z.infer<ReturnType<typeof createInviteSchema>>;

/** Filters the list as the person typed and chose. */
export function filterTeam(
  team: readonly Staff[],
  filter: { search: string; role: string; status: string },
): Staff[] {
  const needle = filter.search.trim().toLowerCase();
  return team.filter(
    (s) =>
      (!needle ||
        s.displayName.toLowerCase().includes(needle) ||
        s.email.toLowerCase().includes(needle)) &&
      (!filter.role || s.roleKey === filter.role) &&
      (!filter.status || s.status === filter.status),
  );
}
