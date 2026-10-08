import { z } from "zod";
import type { Branch } from "@/lib/api/contract";
import { normalizeEthiopianPhone } from "@/lib/i18n/phone";
import type { Translate } from "@/lib/i18n/translator";
import type { BranchInput } from "./api";

/** The backend's limits for a branch: name 120, address 300, city 80, phone 32 (normalised to +251…). */
export const BRANCH_LIMITS = { name: 120, address: 300, city: 80 } as const;

export interface BranchFormValues {
  nameEn: string;
  nameAm: string;
  addressText: string;
  city: string;
  phone: string;
}

export const BLANK_BRANCH: BranchFormValues = {
  nameEn: "",
  nameAm: "",
  addressText: "",
  city: "",
  phone: "",
};

export const branchToForm = (b: Branch): BranchFormValues => ({
  nameEn: b.nameEn,
  nameAm: b.nameAm ?? "",
  addressText: b.addressText ?? "",
  city: b.city ?? "",
  // Shown the way people write it; the backend keeps +251… and normalises again.
  phone: b.phoneE164 ? `0${b.phoneE164.slice(4)}` : "",
});

export function createBranchSchema(t: Translate) {
  const text = (max: number) => z.string().max(max, t("branches.errTooLong", { max }));
  return z.object({
    nameEn: text(BRANCH_LIMITS.name).refine((v) => v.trim().length > 0, t("branches.errName")),
    nameAm: text(BRANCH_LIMITS.name),
    addressText: text(BRANCH_LIMITS.address),
    city: text(BRANCH_LIMITS.city),
    phone: z
      .string()
      .max(32, t("branches.errTooLong", { max: 32 }))
      .refine(
        (v) => v.trim() === "" || normalizeEthiopianPhone(v) !== null,
        t("branches.errPhone"),
      ),
  });
}

const nullable = (v: string) => (v.trim() === "" ? null : v.trim());

export function toBranchInput(v: BranchFormValues): BranchInput {
  return {
    nameEn: v.nameEn.trim(),
    nameAm: nullable(v.nameAm),
    addressText: nullable(v.addressText),
    city: nullable(v.city),
    phone: nullable(v.phone),
  };
}

/** Only what changed, so a save never overwrites a field someone else edited meanwhile. `null` clears a field. */
export function toBranchPatch(v: BranchFormValues, saved: Branch): Partial<BranchInput> {
  const next = toBranchInput(v);
  const before = branchToForm(saved);
  const patch: Partial<BranchInput> = {};
  if (next.nameEn !== saved.nameEn) patch.nameEn = next.nameEn;
  if (next.nameAm !== saved.nameAm) patch.nameAm = next.nameAm;
  if (next.addressText !== saved.addressText) patch.addressText = next.addressText;
  if (next.city !== saved.city) patch.city = next.city;
  // Compare the phone as written (before and after normalising), so reformatting alone is not a change.
  const phoneNow = normalizeEthiopianPhone(v.phone) ?? v.phone.trim();
  const phoneBefore = normalizeEthiopianPhone(before.phone) ?? before.phone.trim();
  if (phoneNow !== phoneBefore) patch.phone = next.phone;
  return patch;
}
